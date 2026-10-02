-- GNERAI OS · seguimiento comercial sacado del buzón info@gnerai.com (IONOS) el 2 de octubre de 2026.
-- Carga, como el socio Marc Sanjuan y en una sola transacción:
--   · contactos, datos fiscales y el hilo de correos de los leads que ya existían (Little Forest, BAKoffice,
--     Metrickal, Maher Homes) y del cliente Illa Fantasía (propuesta 2027);
--   · los leads nuevos que están en el correo (entrantes de la web y salientes de prospección) con su
--     deal, su próxima acción y cada mensaje enviado o recibido como actividad del expediente;
--   · los que llevan semanas sin respuesta, como perdidos («Sin respuesta»), con el historial de etapas fechado.
-- Idempotente: cliente por nombre, contacto por email, deal por título, actividad por título y fecha.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f scripts/cargar-seguimiento-mail-2026-10-02.sql

begin;

-- Ayudantes temporales (viven solo en esta sesión). Se crean como postgres y se ejecutan con el rol
-- de quien los llama, así que las filas pasan por la RLS del socio igual que desde la app.
create function pg_temp.client(p_org uuid, p_name text, p_fields jsonb) returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  select id into v_id from public.clients where org_id = p_org and display_name = p_name;
  if v_id is null then
    insert into public.clients (org_id, display_name, legal_name, tax_id, address_line, postal_code, city, province, country_code, sector, website, owner_member_id, preferred_language, manual_status, notes)
    values (p_org, p_name, p_fields->>'legal_name', p_fields->>'tax_id', p_fields->>'address_line', p_fields->>'postal_code', p_fields->>'city', p_fields->>'province',
            coalesce(p_fields->>'country_code', 'ES'), p_fields->>'sector', p_fields->>'website', (p_fields->>'owner')::uuid,
            coalesce(p_fields->>'language', 'es')::public.app_locale, coalesce(p_fields->>'manual_status', 'lead')::public.client_manual_status, p_fields->>'notes')
    returning id into v_id;
    raise notice 'cliente nuevo: % (%)', p_name, v_id;
  else
    raise notice 'cliente ya existía: % (%)', p_name, v_id;
  end if;
  return v_id;
end $$;

create function pg_temp.contact(p_org uuid, p_client uuid, p_name text, p_email text, p_role text, p_phone text, p_primary boolean) returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  select id into v_id from public.contacts
   where client_id = p_client and archived_at is null and ((p_email is not null and email = p_email) or (p_email is null and full_name = p_name));
  if v_id is null then
    insert into public.contacts (org_id, client_id, full_name, email, role, phone, is_primary)
    values (p_org, p_client, p_name, p_email, p_role, p_phone, p_primary and not exists (select 1 from public.contacts where client_id = p_client and is_primary and archived_at is null))
    returning id into v_id;
  end if;
  return v_id;
end $$;

create function pg_temp.deal(p_org uuid, p_client uuid, p_title text, p_stage uuid, p_created timestamptz, p_one_off bigint, p_mrr bigint, p_prob integer,
                             p_source uuid, p_owner uuid, p_next text, p_next_on date) returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  select id into v_id from public.deals where client_id = p_client and title = p_title;
  if v_id is null then
    perform set_config('app.stage_changed_at', p_created::text, true);
    insert into public.deals (org_id, client_id, title, stage_id, est_one_off_cents, est_mrr_cents, probability_bps, source_id, brought_by_member_id, owner_member_id, next_action, next_action_on, created_at)
    values (p_org, p_client, p_title, p_stage, p_one_off, p_mrr, p_prob, p_source, p_owner, p_owner, p_next, p_next_on, p_created)
    returning id into v_id;
    perform set_config('app.stage_changed_at', '', true);
  end if;
  return v_id;
end $$;

create function pg_temp.lose(p_deal uuid, p_stage uuid, p_reason uuid, p_note text, p_at timestamptz) returns void
language plpgsql as $$
begin
  perform set_config('app.stage_changed_at', p_at::text, true);
  update public.deals set stage_id = p_stage, loss_reason_id = p_reason, loss_note = p_note, next_action = null, next_action_on = null, probability_bps = 0
   where id = p_deal and stage_id <> p_stage;
  perform set_config('app.stage_changed_at', '', true);
end $$;

-- Un mensaje del expediente (kind = email con sentido y canal). No se repite si ya está.
create function pg_temp.mail(p_org uuid, p_client uuid, p_deal uuid, p_member uuid, p_dir text, p_channel text, p_at timestamptz, p_title text, p_body text, p_counterpart text, p_ref text) returns void
language plpgsql as $$
begin
  if exists (select 1 from public.activities where client_id = p_client and title = p_title and occurred_at = p_at) then return; end if;
  insert into public.activities (org_id, client_id, deal_id, kind, title, body, occurred_at, member_id, direction, channel, counterpart, external_reference)
  values (p_org, p_client, p_deal, 'email', p_title, p_body, p_at, p_member, p_dir, p_channel, p_counterpart, p_ref);
end $$;

-- Llamada, reunión o nota.
create function pg_temp.act(p_org uuid, p_client uuid, p_deal uuid, p_member uuid, p_kind public.activity_kind, p_at timestamptz, p_title text, p_body text) returns void
language plpgsql as $$
begin
  if exists (select 1 from public.activities where client_id = p_client and title = p_title and occurred_at = p_at) then return; end if;
  insert into public.activities (org_id, client_id, deal_id, kind, title, body, occurred_at, member_id)
  values (p_org, p_client, p_deal, p_kind, p_title, p_body, p_at, p_member);
end $$;

select set_config('request.jwt.claim.sub', '0658fe85-fe43-4e55-b85b-e9190a25718b', true);
select set_config('request.jwt.claims', '{"sub":"0658fe85-fe43-4e55-b85b-e9190a25718b","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  org uuid := 'b9d59f11-12c6-4e73-b4b8-b9d754d95faa';
  me uuid := 'c58fa402-06fa-4eed-808f-440d4fb6bb51';            -- Marc Sanjuan (member)
  st_lead uuid := 'acefbeec-4f78-411c-8d3a-cfce7f61d272';
  st_meeting uuid := '80ec33fc-094c-49cc-aa1f-a72bb3d744bc';
  st_sent uuid := '828c2a25-d70a-48a0-9896-a607f789d52b';
  st_nego uuid := '3e372b55-c4a4-438e-896a-7725fe129952';
  st_lost uuid := 'c3426749-e1e4-4c6a-becc-d45f7fe28022';
  src_web uuid := 'd1205d24-4bdd-4bc4-928c-7e4dea1570fa';
  src_outreach uuid := 'bbc44e15-78b9-4829-884e-ab3c46a2294e';
  loss_silence uuid := 'd003131c-3373-4a5a-8d4d-d9237bcf18fd';  -- Sin respuesta
  loss_nofit uuid := '93e42daa-43d8-4e14-82ce-137029644735';    -- No encaja
  closed_at timestamptz := '2026-10-02 18:00+02';               -- cuándo se cierran los «sin respuesta»
  c uuid; d uuid; d2 uuid; k uuid;
  r record;
begin
  -- =========================================================================
  -- 1. Little Forest (ya existía): datos fiscales, contactos, hilo completo y paso a Negociación
  -- =========================================================================
  select id into c from public.clients where org_id = org and display_name = 'Little Forest';
  update public.clients set
    legal_name = 'The Little Forest S.L.', tax_id = 'B93912582',
    address_line = 'Calle Equador 82-92, planta baja, bloque A, local B', postal_code = '08029', city = 'Barcelona', province = 'Barcelona',
    sector = 'Ocio infantil (ludoteca y cafetería)', website = 'littleforestcafe.com',
    notes = 'Ludoteca en Barcelona, en obras (apertura prevista en diciembre). Aforo 200–220. Planta baja: juego simbólico y estructura de juego; segunda planta: dos salas de eventos/talleres/yoga y zona de bebés (3 espacios reservables). Sin TPV de cafetería decidido. Logo: cinco pinos (los cinco niños de la familia). Branding en comparación con agencias especializadas.'
  where id = c;
  perform pg_temp.contact(org, c, 'Karina Rosales', 'karina2692@gmail.com', 'Socia fundadora', null, true);
  perform pg_temp.contact(org, c, 'Patricia Rosales', null, 'Socia (hermana de Karina)', null, false);
  perform pg_temp.contact(org, c, 'Marc Gómez', null, 'Inversor del proyecto', null, false);
  select id into d from public.deals where client_id = c and title like 'Ludoteca%';
  perform set_config('app.stage_changed_at', '2026-09-30 11:05+02', true);
  update public.deals set stage_id = st_nego, probability_bps = 9500,
    next_action = 'Confirmación definitiva + pago (prometidos para el viernes 2/10). Enviar contrato con: propiedad del software y código (excepción GTiQ bajo licencia), transición de 30 días, cuota ajustable tras el 1er año. Branding: pendiente de que decidan si lo hacemos nosotros.',
    next_action_on = '2026-10-02'
  where id = d;
  perform set_config('app.stage_changed_at', '', true);
  perform pg_temp.mail(org, c, d, me, 'incoming', 'email', '2026-09-17 10:00+02', 'Proyecto Ludoteca Barcelona: primer contacto', 'Buscan un único proveedor para branding, web, reservas y control de estancia (QR/pulsera, tiempo y tarifas) integrando con terceros solo lo necesario. (Hora aproximada: el correo original no está en la bandeja, solo las respuestas.)', 'karina2692@gmail.com', null);
  perform pg_temp.mail(org, c, d, me, 'incoming', 'email', '2026-09-17 17:01+02', 'Detalles del proyecto y reunión el lunes', 'Aforo 200–220. Sin TPV de cafetería elegido (lo valoramos juntos). Tarifas por tiempo pendientes. 3 espacios reservables. Local en obras (derribo acabado; empiezan instalaciones). Proponen reunión el lunes 21/9 a las 16:00. En copia: Patricia Rosales (socia) y Marc Gómez (inversor).', 'karina2692@gmail.com', null);
  perform pg_temp.mail(org, c, d, me, 'outgoing', 'email', '2026-09-18 18:24+02', 'Primera sesión por videollamada el lunes a las 16:00', 'Como la obra no ha avanzado, primera sesión por Google Meet; la visita al local, en unas semanas. Renders y distribución en pantalla.', 'karina2692@gmail.com', null);
  perform pg_temp.mail(org, c, d, me, 'incoming', 'email', '2026-09-18 19:24+02', 'Piden mover la cita al lunes a las 15:00', 'Preguntan cuánto dura la sesión.', 'karina2692@gmail.com', null);
  perform pg_temp.mail(org, c, d, me, 'incoming', 'email', '2026-09-21 10:35+02', 'Renders, precios orientativos y referencias de logo', 'Adjuntan presentación con renders (IMAGINA10.pdf), estructura de precios inicial (Little_Forest_Talleres_FINAL_2.pdf) y dos referencias de logo. El logo debe incorporar cinco pinos. Nombre en trámite en el Registro Mercantil. Dominio comprado: littleforestcafe.com. Valoran descuento de apertura. Piden adelantar la sesión a las 14:00.', 'karina2692@gmail.com', null);
  perform pg_temp.act(org, c, d, me, 'meeting', '2026-09-21 15:00+02', 'Primera reunión (videollamada): necesidades, renders y distribución', 'Con Karina, Patricia Rosales y Marc Gómez.');
  perform pg_temp.act(org, c, d, me, 'meeting', '2026-09-23 16:00+02', 'Presentación de la propuesta (videollamada)', 'Packs, alcance, calendario y preguntas frecuentes.');
  perform pg_temp.mail(org, c, d, me, 'outgoing', 'email', '2026-09-23 17:15+02', 'Resumen de la llamada + documentación en littleforest.gnerai.com', 'Presupuesto resumido y propuesta completa (PDF y web). El presupuesto es una base para decidir juntos. Con la confirmación, kick-off la semana del 28/9.', 'karina2692@gmail.com', 'https://littleforest.gnerai.com/');
  perform pg_temp.mail(org, c, d, me, 'outgoing', 'email', '2026-09-28 15:31+02', 'Seguimiento: ¿qué decisión habéis tomado?', 'Preguntamos si siguen adelante, con qué pack y si quieren ajustar alguna partida antes de firmar.', 'karina2692@gmail.com', null);
  perform pg_temp.mail(org, c, d, me, 'incoming', 'email', '2026-09-29 12:06+02', 'Dudas finales: cuota a largo plazo, propiedad del código y continuidad', 'Entienden los 550 €/mes del Pack 03 el primer año, pero quieren poder bajar a una cuota de mantenimiento esencial a partir del 2º año. Preguntan: propiedad del software y código fuente, acceso a código/datos/documentación, continuidad sin el Pack 03 (y si GNERAI cesara), periodo de transición, qué cubren las 4 h/mes de mejoras y tarifa de horas extra. Branding: lo comparan con agencias especializadas (papelería y piezas gráficas). Piden una última llamada con su esposo.', 'karina2692@gmail.com', null);
  perform pg_temp.act(org, c, d, me, 'note', '2026-09-29 12:59+02', 'Consulta interna a Nacho Cortada sobre la respuesta', 'Le pasamos el correo de Little Forest y nuestro borrador. Su línea: el desarrollo a medida es propiedad del cliente (front y base de datos); la cuota a largo plazo puede limitarse a servidores y base de datos, con traspaso a una cuenta suya si dejan el servicio.');
  perform pg_temp.mail(org, c, d, me, 'outgoing', 'email', '2026-09-29 14:00+02', 'Respuestas por escrito: propiedad, continuidad y cuota a largo plazo', 'Cuota: calculada por lo que incluye; a partir del 2º año baja en proporción y el mantenimiento técnico esencial se puede contratar solo (punto 10). Propiedad: una vez abonado el desarrollo, el software y el código fuente son de Little Forest; excepciones: GTiQ (control horario, producto de GNERAI bajo licencia incluida en la cuota) y herramientas de terceros. Transición ordenada si se acaba la relación. Disponibles para llamada hoy desde las 16:30. (Hora aproximada del envío.)', 'karina2692@gmail.com', null);
  perform pg_temp.mail(org, c, d, me, 'incoming', 'email', '2026-09-30 11:05+02', '95 % seguros de seguir adelante: confirmación y pago el viernes 2/10', 'Su esposo da el visto bueno técnico. Esperan presupuestos de industriales para cuadrar el global; confirmación definitiva y pago el viernes. Podemos preparar el contrato: The Little Forest S.L., NIF B93912582, Calle Equador 82-92, planta baja, bloque A, local B, 08029 Barcelona. Quieren reflejar la propiedad del software/código/base de datos una vez pagado (con las excepciones indicadas) y una transición de 30 días (código, base de datos, documentación y accesos) al acabar la permanencia. Branding: lo confirman también el viernes.', 'karina2692@gmail.com', null);
  perform pg_temp.mail(org, c, d, me, 'outgoing', 'email', '2026-09-30 11:46+02', 'Redactamos el contrato con todo lo hablado', 'Quedamos a la espera de la confirmación del viernes.', 'karina2692@gmail.com', null);

  -- =========================================================================
  -- 2. Metrickal y BAKoffice (ya existían): Jaume Boada y el hilo de la propuesta conjunta
  -- =========================================================================
  for r in select * from (values ('Metrickal', 'https://bakmet.gnerai.com/#metrickal'), ('BAKoffice', 'https://bakmet.gnerai.com/#bakoffice')) v(name, ref) loop
    select id into c from public.clients where org_id = org and display_name = r.name;
    update public.clients set website = case r.name when 'Metrickal' then 'metrickal.com' else website end,
      notes = coalesce(notes, '') || case when coalesce(notes, '') like '%Jaume Boada%' then '' else E'\nInterlocutor de los dos negocios: Jaume Boada (Metrickal), 622 362 549. Buscaban agencia para empezar con Meta Ads (Facebook e Instagram); la propuesta conjunta incluye ChatGPT Ads. Las creatividades van dentro de las tarifas.' end
    where id = c;
    perform pg_temp.contact(org, c, 'Jaume Boada', 'jaume@metrickal.com', case r.name when 'Metrickal' then 'Metrickal' else 'Interlocutor (Metrickal)' end, '622362549', true);
    select id into d from public.deals where client_id = c and archived_at is null order by created_at limit 1;
    update public.deals set probability_bps = 6000,
      next_action = 'Decisión interna de BAKoffice + Metrickal la semana del 5/10 («us puc dir ok»). Si el jueves 8/10 no han escrito, llamar a Jaume (622 362 549) y proponer la reunión presencial.',
      next_action_on = '2026-10-08'
    where id = d;
    perform pg_temp.mail(org, c, d, me, 'incoming', 'email', '2026-09-28 11:00+02', 'Información: Metrickal busca agencia para Meta Ads', 'Jaume, de Metrickal: quieren empezar a trabajar sus campañas de Meta Ads (Facebook e Instagram) con una agencia. Proponen videollamada de 20–30 minutos para conocerse.', 'jaume@metrickal.com', null);
    perform pg_temp.mail(org, c, d, me, 'outgoing', 'email', '2026-09-28 12:13+02', 'Confirmada la reunión del miércoles 30/9 a las 10:30', 'Tras hablar por teléfono, enviamos el enlace de la videollamada.', 'jaume@metrickal.com', null);
    perform pg_temp.act(org, c, d, me, 'meeting', '2026-09-30 10:30+02', 'Videollamada de descubrimiento: BAKoffice + Metrickal', 'Necesidades de los dos negocios; quedamos en enviar una propuesta conjunta.');
    perform pg_temp.mail(org, c, d, me, 'outgoing', 'email', '2026-10-01 13:31+02', 'Proposta conjunta enviada: bakmet.gnerai.com', 'Propuesta para BAKoffice y Metrickal. Pendientes de saber si encaja para vernos la semana que viene y definir cómo trabajaremos. Contacto: WhatsApp / 623 808 712.', 'jaume@metrickal.com', r.ref);
    perform pg_temp.mail(org, c, d, me, 'incoming', 'email', '2026-10-01 18:00+02', 'Duda: ¿ChatGPT Ads ya está activo en España?', 'Gràcies. Pensaban que en España no estaba activo.', 'jaume@metrickal.com', null);
    perform pg_temp.mail(org, c, d, me, 'outgoing', 'email', '2026-10-01 18:57+02', 'ChatGPT Ads está activo desde el 31 de agosto', 'A la espera de si encaja la propuesta y de si quieren reunión presencial para los siguientes pasos.', 'jaume@metrickal.com', null);
    perform pg_temp.mail(org, c, d, me, 'incoming', 'email', '2026-10-02 13:36+02', 'Duda: ¿las creatividades de las campañas las hacéis vosotros?', null, 'jaume@metrickal.com', null);
    perform pg_temp.mail(org, c, d, me, 'outgoing', 'email', '2026-10-02 14:15+02', 'Sí: las creatividades van dentro de las tarifas de las campañas', null, 'jaume@metrickal.com', null);
    perform pg_temp.mail(org, c, d, me, 'incoming', 'email', '2026-10-02 14:36+02', '«Ok perfect»: se reúnen internamente la semana que viene y nos dan el OK', 'Bon cap de setmana.', 'jaume@metrickal.com', null);
  end loop;

  -- =========================================================================
  -- 3. Maher Homes (ya existía): formulario de diagnóstico y propuesta enviada hoy por correo
  -- =========================================================================
  select id into c from public.clients where org_id = org and display_name = 'Maher Homes';
  update public.clients set website = 'maherhomes.es', sector = 'Inmobiliaria',
    notes = coalesce(notes, '') || case when coalesce(notes, '') like '%diagnostico-digital-gratuito%' then '' else E'\nEntró por el formulario «Diagnóstico digital gratuito» de gnerai.com el 25/9 (/diagnostico-digital-gratuito, directo, sin UTMs): «Quiero mejorar mi marca».' end
  where id = c;
  perform pg_temp.contact(org, c, 'Oscar Lazo', 'oscar@maherhomes.es', 'Maher Homes', '617131503', true);
  select id into d from public.deals where client_id = c and archived_at is null order by created_at limit 1;
  update public.deals set source_id = src_web,
    next_action = 'Propuesta enviada por correo el 2/10 (PDF). Llamar a Oscar (617 131 503, WhatsApp) para cerrar detalles y arrancar la semana del 5/10.',
    next_action_on = '2026-10-07'
  where id = d;
  perform pg_temp.mail(org, c, d, me, 'incoming', 'other', '2026-09-25 12:00+02', 'Formulario «Diagnóstico digital gratuito»: Oscar Lazo (Maher Homes)', 'Necesidad: «Quiero mejorar mi marca». Web actual: maherhomes.es. Teléfono 617 131 503 (WhatsApp). Origen: /diagnostico-digital-gratuito, directo / sin UTMs. (Hora aproximada.)', 'oscar@maherhomes.es', null);
  perform pg_temp.mail(org, c, d, me, 'outgoing', 'email', '2026-10-02 15:03+02', 'PROPUESTA MAHER HOMES 02/10/2026 (PDF adjunto)', 'Como hablamos, adjuntamos la propuesta para empezar a trabajar juntos. Que la revisen con el equipo y, si encaja, quedamos la semana que viene para cerrar detalles y arrancar.', 'oscar@maherhomes.es', null);

  -- =========================================================================
  -- 4. Illa Fantasía (cliente activo): contactos y deal «Temporada 2027»
  -- =========================================================================
  select id into c from public.clients where org_id = org and display_name = 'Illa Fantasía';
  perform pg_temp.contact(org, c, 'Carlos Santillana', 'carlossantillana@illafantasia.com', 'Illa Fantasia', null, true);
  perform pg_temp.contact(org, c, 'Christian Ribot', 'christianribot@illafantasia.com', 'Illa Fantasia', null, false);
  perform pg_temp.contact(org, c, 'Josep Mateu', 'josep.mateu@webbing.online', 'Proveedor web / Prestashop (Webbing)', null, false);
  d := pg_temp.deal(org, c, 'Temporada 2027: campañas Meta + contenido audiovisual', st_sent, '2026-08-25 15:20+02', 0, 0, 5000, null, me,
         'Sin respuesta desde el 28/8 (lo valoraban internamente). Llamar a Carlos para fijar la reunión de cierre de temporada 2026 y decidir la propuesta 2027. Importes: en el PDF «Proposta 2027».', '2026-10-06');
  perform pg_temp.mail(org, c, d, me, 'outgoing', 'email', '2026-08-25 15:20+02', 'Proposta 2027 enviada (PDF)', 'La propuesta comentada en la reunión previa; a la espera de comentarios.', 'carlossantillana@illafantasia.com', null);
  perform pg_temp.mail(org, c, d, me, 'outgoing', 'email', '2026-08-28 06:51+02', 'Tarifa del equipo audiovisual: 650 €', '4 h de fotografía y vídeo, 2 h de vuelo de dron, 2 personas del equipo audiovisual.', 'carlossantillana@illafantasia.com', null);
  perform pg_temp.mail(org, c, d, me, 'incoming', 'email', '2026-08-28 12:38+02', 'Lo valoran internamente; preguntan por fotos un día de sol', 'Agradecen la gestión; proponen organizar la sesión de fotos la semana siguiente si vamos nosotros.', 'carlossantillana@illafantasia.com', null);
  perform pg_temp.mail(org, c, d, me, 'incoming', 'email', '2026-08-28 16:17+02', 'Recordatorio: «sortim amb tot el diumenge» + enlace de la promo', 'Promo septiembre 18 € online: https://entradas.illafantasia.com/inicio/98-oferta-septembre-18-e-online.html', 'carlossantillana@illafantasia.com', 'https://entradas.illafantasia.com/inicio/98-oferta-septembre-18-e-online.html');
  perform pg_temp.mail(org, c, null, me, 'incoming', 'email', '2026-08-31 15:16+02', 'Josep Mateu: URL de confirmación de compra para el endpoint de Meta', 'Siempre https://entradas.illafantasia.com/confirmacion-pedido; cambian los parámetros (id_cart, id_module, id_order, key). Regla recomendada: «la URL contiene /confirmacion-pedido» (y /es/confirmacion-pedido si hay prefijo de idioma).', 'josep.mateu@webbing.online', 'https://entradas.illafantasia.com/confirmacion-pedido');
  perform pg_temp.mail(org, c, d, me, 'outgoing', 'email', '2026-09-09 12:00+02', 'Informe temporada 2026 · anuncios Meta (PDF)', 'Resumen de cómo fueron las campañas de la temporada. (Hora aproximada.)', 'carlossantillana@illafantasia.com', null);
  perform pg_temp.mail(org, c, d, me, 'outgoing', 'email', '2026-09-15 19:44+02', 'Temporada 2027: proponemos reunión para comentar el resumen y planificar', 'Esperamos que hayan cerrado bien la temporada; que nos digan cuándo les va bien.', 'carlossantillana@illafantasia.com', null);

  -- =========================================================================
  -- 5. UDB Sports (cliente activo): diagnóstico web del 17/6
  -- =========================================================================
  select id into c from public.clients where org_id = org and display_name = 'UDB Sports';
  perform pg_temp.contact(org, c, 'Fundador (founder@udbsports.com)', 'founder@udbsports.com', 'UDB Sports', null, true);
  perform pg_temp.act(org, c, null, me, 'note', '2026-06-17 12:00+02', 'Diagnóstico web (gnerai.com): warm (51)', 'Restaurante / negocio local, más de 50 personas. Fricciones: soporte o incidencias, comunicación interna. Sistema bastante bien montado; prioridad «lo estoy explorando»; objetivo «todo lo anterior».');

  -- =========================================================================
  -- 6. Leads nuevos, abiertos
  -- =========================================================================
  -- 6.1 Nadia Pedraza · carpas profesionales (entrante hoy)
  c := pg_temp.client(org, 'Nadia Pedraza (carpas profesionales)', jsonb_build_object('sector', 'Comercio · carpas profesionales', 'owner', me,
         'notes', 'Web en Squarespace. Google Ads activo (Maximizar conversiones) con botón de WhatsApp y formulario; la conversión de WhatsApp está INACTIVA y Tag Assistant no la detecta. Gasto importante con pocas ventas; no quiere seguir invirtiendo hasta medir bien. Quiere un trabajo puntual con precio cerrado, no gestión mensual: auditar la cuenta, arreglar el seguimiento de WhatsApp/formularios (Tag/GA4/GTM/Squarespace), revisar estructura de campañas, dejarlo preparado para gestionarlo ella y documentarlo. Cuentas y accesos a nombre de su empresa.'));
  perform pg_temp.contact(org, c, 'Nadia Pedraza Martínez', 'nadiapedraza@outlook.es', 'Propietaria', null, true);
  d := pg_temp.deal(org, c, 'Auditoría de Google Ads y medición de WhatsApp/formularios en Squarespace (precio cerrado)', st_lead, '2026-10-02 10:55+02', 0, 0, 2500, src_web, me,
         'Enviar las dos propuestas con precio cerrado prometidas «esta tarde» (auditoría + arreglo de medición; alternativa si Squarespace no permite medir WhatsApp).', '2026-10-02');
  perform pg_temp.mail(org, c, d, me, 'incoming', 'email', '2026-10-02 10:55+02', 'Solicitud de información y presupuesto (trabajo puntual, precio cerrado)', 'Auditar Google Ads; revisar y arreglar el seguimiento de WhatsApp y formularios (Google Tag / GA4 / GTM / Squarespace); revisar estructura de campañas; dejar la cuenta para gestionarla ella; documentación. Pregunta qué alternativa técnica proponemos si no se puede medir WhatsApp en Squarespace. Las cuentas quedan a nombre de su empresa.', 'nadiapedraza@outlook.es', null);
  perform pg_temp.mail(org, c, d, me, 'outgoing', 'email', '2026-10-02 11:22+02', 'Esta tarde enviamos un par de propuestas con precio cerrado', null, 'nadiapedraza@outlook.es', null);

  -- 6.2 Banc de Recursos (entitat sense ànim de lucre)
  c := pg_temp.client(org, 'Banc de Recursos (Jose S. Moreno)', jsonb_build_object('sector', 'Entidad sin ánimo de lucro', 'owner', me, 'language', 'ca',
         'notes', 'Web per a un Banc de Recursos: sol·licitud, reserva per dates i cessió de material, control de disponibilitat, aprovació de sol·licituds, albarans amb signatura i historial de préstecs. Preguntaven cost aproximat i si el manteniment va a part. No treballem amb WordPress: plataforma a mida.'));
  perform pg_temp.contact(org, c, 'Jose S. Moreno Domínguez', 'josemodo2610@gmail.com', 'Responsable del Banc de Recursos', null, true);
  d := pg_temp.deal(org, c, 'Web a mida del Banc de Recursos: sol·licituds, reserves per dates, albarans amb signatura i historial', st_lead, '2026-09-23 14:20+02', 0, 0, 1500, src_web, me,
         'Dos correus sense resposta (23/9 i 25/9). Tercer intent per telèfon o WhatsApp; si no respon, tancar com a «Sin respuesta».', '2026-10-06');
  perform pg_temp.mail(org, c, d, me, 'incoming', 'email', '2026-09-23 14:20+02', 'Sol·licitud de pressupost: web per al Banc de Recursos de l''entitat', 'Volen una web amb sistema de sol·licitud, reserva i cessió de material. Pregunten si ho podem fer, cost aproximat i si el manteniment posterior va a part.', 'josemodo2610@gmail.com', null);
  perform pg_temp.mail(org, c, d, me, 'outgoing', 'email', '2026-09-23 16:00+02', 'Resposta: plataforma a mida (no WordPress) i proposta de reunió demà al matí', 'Expliquem que desenvolupem a mida (reserves per dates, disponibilitat, aprovació, albarans amb signatura, historial). Proposem reunió per presentar una primera estimació i després una proposta econòmica definitiva separant desenvolupament i manteniment.', 'josemodo2610@gmail.com', null);
  perform pg_temp.mail(org, c, d, me, 'outgoing', 'email', '2026-09-25 10:46+02', 'Seguiment: «vas poder veure el correu amb la proposta?»', null, 'josemodo2610@gmail.com', null);

  -- 6.3 Jowke (demo de app enviada)
  c := pg_temp.client(org, 'Jowke', jsonb_build_object('sector', 'Ocio nocturno', 'owner', me,
         'notes', 'Club. Hoy venden entradas con Fourvenues y gestionan mesas por WhatsApp e Instagram. Les hemos construido una demo de app propia (vídeo en iPhone + PDF) sin que la pidieran.'));
  perform pg_temp.contact(org, c, 'Jowke (delacamaraoficial@gmail.com)', 'delacamaraoficial@gmail.com', 'Dirección', null, true);
  d := pg_temp.deal(org, c, 'App propia de Jowke: entradas (Fourvenues), mesas VIP en 3D, amigos, historias de Instagram y avisos push', st_lead, '2026-09-18 18:44+02', 0, 0, 1500, src_outreach, me,
         'Sin respuesta a la demo del 18/9. Llamada corta o WhatsApp para enseñarla en persona y preguntar qué cambiarían.', '2026-10-06');
  perform pg_temp.mail(org, c, d, me, 'outgoing', 'email', '2026-09-18 18:44+02', 'Demo de la app de Jowke (vídeo + PDF)', 'Entradas con compra directa en su Fourvenues (sin comisión), mesas VIP sobre el plano real en 3D con solicitud en un minuto, «amigos» (quién va cada noche), historias de Instagram con QR, carta VIP, entradas con QR, push, Jowke Music y cómo llegar. Todo se puede cambiar: es una idea construida desde cero. Vídeo: https://we.tl/t-T1UsUZOAoVxDAEhQ', 'delacamaraoficial@gmail.com', 'https://we.tl/t-T1UsUZOAoVxDAEhQ');

  -- 6.4 FITZ (Grupo Sounds)
  c := pg_temp.client(org, 'FITZ (Grupo Sounds)', jsonb_build_object('sector', 'Ocio nocturno', 'owner', me,
         'notes', 'Tres locales: Madrid (ticketing Fourvenues), Mallorca y Marbella (calendario de la web). Demo de app nativa iPhone/Android construida sin que la pidieran.'));
  perform pg_temp.contact(org, c, 'Pablo (Grupo Sounds)', 'pablo@gruposounds.com', 'Grupo Sounds', null, true);
  d := pg_temp.deal(org, c, 'App nativa FITZ: Madrid, Mallorca y Marbella en una sola app (mesas, push, newsletter, entradas)', st_lead, '2026-09-18 13:08+02', 0, 0, 1500, src_outreach, me,
         'Sin respuesta a la demo del 18/9. Llamada corta o WhatsApp a Pablo para enseñarla y recoger cambios.', '2026-10-06');
  perform pg_temp.mail(org, c, d, me, 'outgoing', 'email', '2026-09-18 13:08+02', 'Demo Aplicación Eventos · solo para FITZ (vídeo + PDF)', 'App nativa que reúne los tres locales: portada, programación, noticias, contacto y plano de mesas por local. Mesas ordenadas (destino, fecha, zona, personas, presupuesto → WhatsApp/email de reservas), canal propio (push y newsletter por destino y estilo), entradas en un toque (ticketing oficial), una sola marca. Vídeo: https://we.tl/t-XeHeQuEYNRcQGY6V', 'pablo@gruposounds.com', 'https://we.tl/t-XeHeQuEYNRcQGY6V');

  -- 6.5 Sami Halawa · sistema de gestión agrícola
  c := pg_temp.client(org, 'Sami Halawa (sistema de gestión agrícola)', jsonb_build_object('sector', 'Agricultura · software', 'owner', me,
         'notes', 'Piden presupuesto cerrado sin llamadas: panel web + apps móviles offline (iOS/Android). GIS y SIGPAC, costes por hectárea e inventario (paridad Agroptima), cuaderno de campo SIEX/CUE con validación ROPO/RETO, offline con CRDTs, NDVI/NDWI Sentinel-2 con mapas de prescripción e ISOBUS ISO-XML, IA en dispositivo (ONNX) y cifrado AES-256. Nuestra orientación: 40.000–100.000 € completo; MVP 15.000–25.000 €.'));
  perform pg_temp.contact(org, c, 'Sami Halawa', 'eugproductions@gmail.com', null, null, true);
  d := pg_temp.deal(org, c, 'Farm Management Software: panel web + apps offline, SIGPAC, SIEX/CUE, satélite e ISOBUS', st_lead, '2026-09-17 14:40+02', 2000000, 0, 1000, src_web, me,
         'Sin respuesta a las 5 preguntas del 17/9 (hectáreas y operarios, acceso a la API de SIEX, prioridad de módulos, consolas ISOBUS y fotos etiquetadas, presupuesto de referencia). Último recordatorio o cerrar.', '2026-10-06');
  perform pg_temp.mail(org, c, d, me, 'incoming', 'email', '2026-09-17 14:40+02', 'Solicitud de presupuesto cerrado: FMS, CUE/SIEX y analítica satelital', 'Evalúan solo por claridad técnica y precisión en el precio; no hacen llamadas comerciales previas. Piden precio final u horquilla, plazo (MVP y final) y stack.', 'eugproductions@gmail.com', null);
  perform pg_temp.mail(org, c, d, me, 'outgoing', 'email', '2026-09-17 16:25+02', 'Orientación: 40–100 k€ completo, MVP 15–25 k€; 5 preguntas para cerrar precio', 'Stack propuesto: Next.js + Supabase (PostGIS), React Native/Expo con SQLite cifrado, Sentinel-2 vía Copernicus Data Space, ONNX Runtime. Experiencia: Scropp, Altura Intelligence, GTIQ. Precio cerrado por fases en 48 h con sus respuestas.', 'eugproductions@gmail.com', null);

  -- 6.6 Umbramed · clínica de injerto capilar
  c := pg_temp.client(org, 'Umbramed (clínica de injerto capilar)', jsonb_build_object('sector', 'Salud · clínica capilar', 'owner', me, 'website', 'umbramed.org',
         'notes', 'Clínica privada de injerto capilar. Quieren una app de recordatorios pre y postoperatorios para pacientes. Les dijimos que con tan pocos datos es difícil valorar y que puede haber alternativas más efectivas y económicas; propusimos una reunión breve.'));
  perform pg_temp.contact(org, c, 'Valerio Trigos Domínguez', 'valeriotrigos@umbramed.org', null, null, true);
  d := pg_temp.deal(org, c, 'App de recordatorios pre y postoperatorios para pacientes de injerto capilar', st_lead, '2026-09-06 13:23+02', 0, 0, 1000, src_web, me,
         'Sin respuesta desde el 7/9. Proponer llamada breve con dos o tres alternativas (app, WhatsApp automatizado, portal) o cerrar.', '2026-10-06');
  perform pg_temp.mail(org, c, d, me, 'incoming', 'email', '2026-09-06 13:23+02', 'Solicitud de presupuesto: app de recordatorios pre y postoperatorios', 'Vieron que hacemos landings, agentes de IA y apps a medida. Piden cotización y ofrecen más datos si hacen falta.', 'valeriotrigos@umbramed.org', null);
  perform pg_temp.mail(org, c, d, me, 'outgoing', 'email', '2026-09-07 16:47+02', 'Difícil valorar con esos datos: proponemos reunión breve y alternativas', 'Si el objetivo es solo recordatorios, quizá haya opciones más efectivas y económicas; una reunión corta fijaría objetivos para la propuesta económica.', 'valeriotrigos@umbramed.org', null);

  -- 6.7 Lexicon · Roman Gil Ledesma (Argentina)
  c := pg_temp.client(org, 'Lexicon (Roman Gil Ledesma)', jsonb_build_object('sector', 'Educación · app de idiomas', 'owner', me, 'country_code', 'AR',
         'notes', 'App de práctica de inglés que ya funciona; quiere generar frases de práctica con IA según nivel, contexto y vocabulario del usuario. Trabaja sin backend. Ya instaló una API de Gemini por su cuenta. Duda de costes y de si los institutos de su zona lo aceptarán al precio que corresponda. WhatsApp: +54 9 11 2368 0225.'));
  perform pg_temp.contact(org, c, 'Roman Gil Ledesma', 'romangilledesma@gmail.com', 'Fundador', '+5491123680225', true);
  d := pg_temp.deal(org, c, 'Integración de IA (frases de práctica por nivel) y arquitectura backend de Lexicon', st_lead, '2026-08-26 08:57+02', 0, 0, 1500, src_outreach, me,
         'Pidió precios y forma de trabajar el 26/8 y no consta respuesta por correo. Responder por WhatsApp (+54 9 11 2368 0225) con orientación de precio y proponer llamada corta.', '2026-10-05');
  perform pg_temp.mail(org, c, d, me, 'outgoing', 'email', '2026-08-26 08:57+02', 'Propuesta de desarrollo e integración de IA para Lexicon', 'Vimos su publicación. Ofrecemos integración de la API (claves seguras, prompts, control de costes, calidad) y la parte lingüística (frases con sentido por nivel y vocabulario). Proponemos llamada corta viendo Lexicon y su código.', 'romangilledesma@gmail.com', null);
  perform pg_temp.mail(org, c, d, me, 'incoming', 'email', '2026-08-26 17:03+02', 'Le parece genial; pide precios y cómo trabajaríamos', 'Ya instaló una API de Gemini; le preocupan nivel de inglés, usuario e información. Tiene que revisar costes y aceptación por institutos de su zona. Prefiere WhatsApp: +54 9 11 2368 0225.', 'romangilledesma@gmail.com', null);

  -- 6.8 Approved Locals (PRE-RFQ sin contestar)
  c := pg_temp.client(org, 'Approved Locals (Stuart Pratt)', jsonb_build_object('sector', 'Plataforma de recomendación de negocios locales', 'owner', me, 'language', 'en', 'website', 'blue-square.es',
         'notes', 'Plataforma de descubrimiento y recomendación de negocios locales; lanzamiento inicial en Jávea/Xàbia, Moraira, Benissa y Calpe (Costa Blanca). Producto ya definido (estructura, user journeys, pantallas, reglas, modelo de confianza, arquitectura, contenido multilingüe, dirección visual). Buscan un partner de desarrollo para la V1, no un discovery. PRE-RFQ con 12 preguntas (equipo, enfoque técnico, propiedad, precio/plazo orientativo, QA/seguridad, soporte, experiencia). Pedían respuesta hacia el 25/9 antes de la fase de tender confidencial.'));
  perform pg_temp.contact(org, c, 'Stuart Pratt', 'stuart@blue-square.es', 'Fundador · Approved Locals', null, true);
  d := pg_temp.deal(org, c, 'Approved Locals V1: desarrollo de la plataforma (PRE-RFQ, 12 preguntas)', st_lead, '2026-09-16 20:39+02', 0, 0, 1500, src_web, me,
         'Ningún correo nuestro en el hilo. Responder al PRE-RFQ (formato breve, 12 preguntas, brief adjunto al correo del 16/9) o declinar con un correo corto: lo pidieron para el 25/9 y volvieron a escribir el 23/9.', '2026-10-05');
  perform pg_temp.mail(org, c, d, me, 'incoming', 'email', '2026-09-16 20:39+02', 'Approved Locals — V1 development introduction & PRE-RFQ (brief adjunto)', 'No buscan cotización vinculante ni trabajo de diseño gratuito: quieren saber si encajamos y una indicación de coste y plazo. Respuesta en unos cinco días laborables; después, llamada corta con los equipos que mejor encajen antes del tender detallado.', 'stuart@blue-square.es', null);
  perform pg_temp.mail(org, c, d, me, 'incoming', 'email', '2026-09-23 17:32+02', 'Follow-up: confirmar interés y responder antes del viernes 25/9', 'Están cerrando el grupo que pasa a la fase de tender confidencial; basta el formato breve del brief. Si no encaja, agradecen un correo diciéndolo.', 'stuart@blue-square.es', null);

  -- 6.9 WentApp (diagnósticos «hot» en la web sin seguimiento)
  c := pg_temp.client(org, 'WentApp (Sostres)', jsonb_build_object('sector', 'Servicios profesionales / restauración', 'owner', me, 'website', 'wentapp.com', 'manual_status', 'pending_contact',
         'notes', 'Dos diagnósticos en gnerai.com con sostres@wentapp.com: 3/5 (hot 76: restaurante/negocio local, 16–50 personas, Excel, «importante pero no crítico», reducir errores) y 8/6 (hot 87: servicios profesionales, solo él, todo manual, «muy urgente», ahorrar tiempo). No consta seguimiento.'));
  perform pg_temp.contact(org, c, 'Sostres (WentApp)', 'sostres@wentapp.com', null, null, true);
  d := pg_temp.deal(org, c, 'Diagnóstico web «hot» (8/6): automatizar tareas repetitivas, gestión de leads y seguimiento de ventas', st_lead, '2026-06-08 12:00+02', 0, 0, 1000, src_web, me,
         'Contactar: dos diagnósticos «hot» (3/5 y 8/6) sin seguimiento registrado. Proponer la sesión estratégica que recomendaba el informe.', '2026-10-06');
  perform pg_temp.act(org, c, d, me, 'note', '2026-05-03 15:12+02', 'Diagnóstico web (gnerai.com): hot (76)', 'Restaurante / negocio local, 16–50 personas. Fricciones: tareas repetitivas, datos desordenados, soporte o incidencias. Procesos en Excel/Sheets. Prioridad: importante, no crítico. Objetivo: reducir errores y olvidos. Informe enviado al cliente.');
  perform pg_temp.act(org, c, d, me, 'note', '2026-06-08 12:00+02', 'Diagnóstico web (gnerai.com): hot (87)', 'Servicios profesionales, solo él. Fricciones: tareas repetitivas, gestión de clientes o leads, seguimiento de ventas. Todo manual. Prioridad: muy urgente. Objetivo: ahorrar tiempo en el día a día. Siguiente paso recomendado: validar el plan (sesión estratégica).');

  -- =========================================================================
  -- 7. Leads que ya se dan por perdidos (sin respuesta), con el historial fechado
  -- =========================================================================
  -- 7.1 Iván Vega · MVP (Chile)
  c := pg_temp.client(org, 'Iván Vega (MVP plataforma interactiva)', jsonb_build_object('sector', 'Startup · plataforma interactiva', 'owner', me, 'country_code', 'CL', 'manual_status', 'discarded',
         'notes', 'Publicación buscando desarrollador full stack para un MVP con mucha interacción visual (imágenes y archivos, paneles, compra y pagos). Prefería alguien en Chile.'));
  perform pg_temp.contact(org, c, 'Iván Vega', 'ivanvega.chile@gmail.com', null, null, true);
  d := pg_temp.deal(org, c, 'Desarrollo full stack del MVP de plataforma interactiva', st_lead, '2026-08-26 09:04+02', 0, 0, 1000, src_outreach, me, null, null);
  perform pg_temp.mail(org, c, d, me, 'outgoing', 'email', '2026-08-26 09:04+02', 'Propuesta de colaboración para el MVP (remoto desde España)', 'Nos presentamos, enlazamos gnerai.com y proponemos una llamada para plantear cómo abordaríamos el MVP.', 'ivanvega.chile@gmail.com', null);
  perform pg_temp.lose(d, st_lost, loss_silence, 'Sin respuesta desde el 26/8 (prefería un desarrollador en Chile).', closed_at);

  -- 7.2 Alejandro Pérez · abogado en Las Palmas (presupuesto enviado en julio)
  c := pg_temp.client(org, 'Alejandro Pérez (abogado, Las Palmas)', jsonb_build_object('sector', 'Servicios jurídicos', 'owner', me, 'city', 'Las Palmas de Gran Canaria', 'manual_status', 'discarded',
         'notes', 'Abogado (Ilustre Colegio de Abogados de Las Palmas). Valoraba el rediseño completo de su web. Teléfono 670 679 584.'));
  perform pg_temp.contact(org, c, 'Alejandro Pérez', 'alejandrofranciscoperez@gmail.com', 'Abogado', '670679584', true);
  d := pg_temp.deal(org, c, 'Rediseño completo de la web del despacho (presupuesto cerrado)', st_lead, '2026-07-09 23:09+02', 0, 0, 1000, src_web, me, null, null);
  perform pg_temp.mail(org, c, d, me, 'incoming', 'email', '2026-07-09 23:09+02', 'Solicitud de propuesta para rediseño web', 'Rediseño completo de la web de su despacho.', 'alejandrofranciscoperez@gmail.com', null);
  perform set_config('app.stage_changed_at', '2026-07-10 12:00+02', true);
  update public.deals set stage_id = st_sent where id = d and stage_id = st_lead;
  perform set_config('app.stage_changed_at', '', true);
  perform pg_temp.mail(org, c, d, me, 'outgoing', 'email', '2026-07-10 12:00+02', 'Presupuesto cerrado enviado (PDF)', 'Presupuesto cerrado para la nueva web; a la espera de dudas. (Hora aproximada.)', 'alejandrofranciscoperez@gmail.com', null);
  perform pg_temp.lose(d, st_lost, loss_silence, 'Sin respuesta ni más correos tras el presupuesto del 10/7.', closed_at);

  -- 7.3 Prime Wheelers · diagnóstico de la web en mayo
  c := pg_temp.client(org, 'Prime Wheelers', jsonb_build_object('sector', 'Por confirmar', 'owner', me, 'manual_status', 'discarded',
         'notes', 'Completó el diagnóstico de gnerai.com en mayo; le propusimos una llamada el 26/5 y no consta respuesta.'));
  perform pg_temp.contact(org, c, 'Prime Wheelers', 'primewheelers@gmail.com', null, null, true);
  d := pg_temp.deal(org, c, 'Diagnóstico web: llamada de presentación', st_lead, '2026-05-26 10:00+02', 0, 0, 1000, src_web, me, null, null);
  perform pg_temp.mail(org, c, d, me, 'outgoing', 'email', '2026-05-26 10:00+02', 'Diagnóstico gratuito: proponemos una breve llamada esta semana', 'Para conocer el negocio y valorar cómo ayudar. (Hora aproximada.)', 'primewheelers@gmail.com', null);
  perform pg_temp.lose(d, st_lost, loss_silence, 'Sin respuesta desde el 26/5.', closed_at);

  -- 7.4 Prospección por correo del 24/8 (campañas de Google y Meta para negocios locales) y diseño:
  --     primer correo el 24/8, recordatorio el 27/8 a las 10:02. Solo contestó Aude (no interesados).
  for r in select * from (values
    ('Restaurante La Española', 'info@restaurantelaespanola.es', 'Restauración', 'Llenar más mesas entre semana (Google Business y campañas locales)', '2026-08-24 13:01+02', null, null),
    ('Studio Detail (Valladolid)', 'info@studiodetail.es', 'Detailing de vehículos', 'Atraer clientes a Studio Detail en Valladolid', '2026-08-24 13:02+02', 'Valladolid', null),
    ('Ultimate Detailing (Valencia)', 'contacto@ultimatedetailing.es', 'Detailing de vehículos', 'Más clientes de detailing en Valencia', '2026-08-24 13:02+02', 'Valencia', null),
    ('Aude Oposiciones', 'prepastac@gmail.com', 'Formación · oposiciones', 'Llenar plazas de la próxima convocatoria', '2026-08-24 13:02+02', null, null),
    ('Catering Pasión', 'info@cateringpasion.es', 'Catering', 'Más eventos y bodas para Catering Pasión', '2026-08-24 13:03+02', null, null),
    ('Hola Reformas', 'cuentame@holareformas.com', 'Reformas', 'Presupuestos de reforma cada semana', '2026-08-24 13:03+02', null, null),
    ('MM Fisioclinic (Pozuelo)', 'info@mmfisioclinic.es', 'Fisioterapia', 'Más pacientes en Pozuelo', '2026-08-24 13:03+02', 'Pozuelo de Alarcón', null),
    ('Medicina Estética Madrid', 'info@medicinaesteticamadrid.es', 'Medicina estética', 'Captar pacientes para los tratamientos estrella', '2026-08-24 13:03+02', 'Madrid', null),
    ('Academia EnglishPlus', 'info@academiaenglishplus.com', 'Educación · academia de inglés', 'Llenar las clases de la nueva temporada', '2026-08-24 13:03+02', null, null),
    ('Fit Patraix (Valencia)', 'info@fitpatraix.es', 'Fitness', 'Nuevas altas para Fit Patraix en el barrio', '2026-08-24 13:04+02', 'Valencia', null),
    ('Clínica Brainter', 'info@clinicabrainter.com', 'Fisioterapia', 'Nuevos pacientes para Clínica Brainter', '2026-08-24 13:04+02', null, null),
    ('Clínica Dental Velázquez (Madrid)', 'clinica@clinicadentalvelazquez.com', 'Odontología', 'Más pacientes de implantes y estética dental en la zona de Velázquez', '2026-08-24 13:03+02', 'Madrid', null),
    ('Jabonarium', 'info@jabonariumshop.com', 'Ecommerce · cosmética natural', 'Más ventas con Google Shopping y Meta Ads', '2026-08-24 13:04+02', null, null),
    ('Óptica Hispania (Oviedo)', 'opticahispania@opticahispania.es', 'Óptica', 'Atraer más clientes a Óptica Hispania en Oviedo', '2026-08-24 13:04+02', 'Oviedo', null),
    ('Doctores Dental (Madrid)', 'info@doctoresdental.com', 'Odontología', 'Nuevas primeras visitas para Doctores Dental', '2026-08-24 13:04+02', 'Madrid', null),
    ('NaturaOnline', 'info@naturaonline.es', 'Ecommerce · cosmética natural', 'Aumentar las ventas online (Shopping y remarketing en Meta)', '2026-08-24 13:04+02', null, null),
    ('Golden Estética (Madrid)', 'info@goldenestetica.es', 'Estética', 'Más citas para Golden Estética con campañas bien medidas', '2026-08-24 13:04+02', 'Madrid', null),
    ('Q Boutique Fitness', null, 'Fitness · entrenamiento personal', 'Llenar las plazas de entrenamiento personal', '2026-08-24 13:04+02', null, 'Email del buzón: info@qboutiquefitness.co… (truncado en el webmail; confirmar).'),
    ('Clínicas DELAMO (podología, Alicante)', 'info@delamopodologia.com', 'Podología', 'Nuevos pacientes para las clínicas DELAMO (una campaña por clínica)', '2026-08-24 13:05+02', 'Alicante', null),
    ('One More Innovation', null, 'Deporte · pádel', 'Restyling de marca premium y diseño de palas de pádel (buscaban diseñador gráfico)', '2026-08-24 09:39+02', null, 'Email del buzón: info@onemoreinnovation.c… (truncado en el webmail; confirmar). Les enviamos portfolio para valorar nuestro estilo.'),
    ('InOut Projects', 'info@inoutprojects.com', 'Diseño y branding', 'Colaboración de diseño y branding (oferta publicada en Workana)', '2026-08-24 09:49+02', null, null)
  ) v(name, email, sector, title, first_at, city, extra) loop
    c := pg_temp.client(org, r.name, jsonb_build_object('sector', r.sector, 'owner', me, 'city', r.city, 'manual_status', 'discarded',
           'notes', 'Prospección por correo del 24/8/2026 (campañas de Google y Meta para negocios locales / diseño). Recordatorio el 27/8.' || coalesce(' ' || r.extra, '')));
    perform pg_temp.contact(org, c, r.name, r.email, 'Buzón general', null, true);
    d := pg_temp.deal(org, c, r.title, st_lead, r.first_at::timestamptz, 0, 0, 500, src_outreach, me, null, null);
    perform pg_temp.mail(org, c, d, me, 'outgoing', 'email', r.first_at::timestamptz, 'Primer correo de prospección: ' || r.title, 'Presentación de GNERAI y propuesta de una llamada corta con una estimación para su negocio.', r.email, null);
    perform pg_temp.mail(org, c, d, me, 'outgoing', 'email', '2026-08-27 10:02+02', 'Recordatorio: «¿pudisteis leer el mensaje?»', 'Sin compromiso: lo hablamos y, si no encaja, lo dejamos.', r.email, null);
    if r.name = 'Aude Oposiciones' then
      perform pg_temp.mail(org, c, d, me, 'incoming', 'email', '2026-08-27 12:35+02', '«En principio no estamos interesados»', null, r.email, null);
      perform pg_temp.lose(d, st_lost, loss_nofit, 'Contestaron el 27/8: no interesados.', '2026-08-27 12:35+02');
    else
      perform pg_temp.lose(d, st_lost, loss_silence, 'Sin respuesta al correo del 24/8 ni al recordatorio del 27/8.', closed_at);
    end if;
  end loop;

  -- =========================================================================
  -- 8. Expediente de la sociedad: el DUE ya está presentado (CIRCE, 1/10)
  -- =========================================================================
  update public.org_documents set status = 'filed',
    description = coalesce(description, '') || E'\nPresentado por CIRCE el 1/10/2026 (DUE 098906957T). NIF provisional emitido y empresa inscrita en el Registro Mercantil Provincial el 2/10/2026 (avisos del Ministerio). Copia simple de la escritura enviada por la notaría de Mataró (Agata Roca, OR.02.26.02718) el 2/10.'
  where org_id = org and title like 'DUE · Documento Único Electrónico%' and status = 'pending_signature';
end $$;

-- Resumen de lo que queda abierto, para comprobar la carga
select c.display_name, s.name as etapa, d.next_action_on, left(d.next_action, 70) as proxima_accion,
       (select count(*) from public.activities a where a.deal_id = d.id) as actividades
from public.deals d join public.clients c on c.id = d.client_id join public.pipeline_stages s on s.id = d.stage_id
where d.org_id = 'b9d59f11-12c6-4e73-b4b8-b9d754d95faa' and d.archived_at is null and s.kind = 'open'
order by d.next_action_on nulls last, c.display_name;

select s.name as etapa, count(*) from public.deals d join public.pipeline_stages s on s.id = d.stage_id
where d.org_id = 'b9d59f11-12c6-4e73-b4b8-b9d754d95faa' and d.archived_at is null group by s.name, s.position order by s.position;

commit;
