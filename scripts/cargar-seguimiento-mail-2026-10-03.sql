-- GNERAI OS · novedades del buzón info@gnerai.com del 3 de octubre de 2026 (y lo del 2 por la tarde).
-- Idempotente: lo que ya está no se repite.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f scripts/cargar-seguimiento-mail-2026-10-03.sql

begin;

create function pg_temp.mail(p_org uuid, p_client uuid, p_deal uuid, p_member uuid, p_dir text, p_channel text, p_at timestamptz, p_title text, p_body text, p_counterpart text, p_ref text) returns void
language plpgsql as $$
begin
  if exists (select 1 from public.activities where client_id = p_client and title = p_title and occurred_at = p_at) then return; end if;
  insert into public.activities (org_id, client_id, deal_id, kind, title, body, occurred_at, member_id, direction, channel, counterpart, external_reference)
  values (p_org, p_client, p_deal, 'email', p_title, p_body, p_at, p_member, p_dir, p_channel, p_counterpart, p_ref);
end $$;

select set_config('request.jwt.claim.sub', '0658fe85-fe43-4e55-b85b-e9190a25718b', true);
select set_config('request.jwt.claims', '{"sub":"0658fe85-fe43-4e55-b85b-e9190a25718b","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  org uuid := 'b9d59f11-12c6-4e73-b4b8-b9d754d95faa';
  me uuid := 'c58fa402-06fa-4eed-808f-440d4fb6bb51';
  st_sent uuid := '828c2a25-d70a-48a0-9896-a607f789d52b';
  c uuid; d uuid;
begin
  -- 1. Little Forest: el contrato ya está redactado; falta decidir el branding.
  select id into c from public.clients where org_id = org and display_name = 'Little Forest';
  select id into d from public.deals where client_id = c and archived_at is null order by created_at limit 1;
  perform pg_temp.mail(org, c, d, me, 'outgoing', 'email', '2026-10-02 19:42+02', 'Contrato redactado; falta saber quién lleva el branding',
    'El contrato está listo con la propiedad del software y del código. Solo falta saber si el branding lo llevamos nosotros o la otra agencia, porque la parte de propiedad intelectual cambia según el caso. En cuanto lo digan, se lo pasamos.', 'karina2692@gmail.com', null);
  update public.deals set
    next_action = 'Esperando que digan quién lleva el branding (cambia la propiedad intelectual del contrato) y la confirmación definitiva con el pago. Si el lunes no han escrito, llamar a Karina.',
    next_action_on = '2026-10-06'
  where id = d;

  -- 2. Nadia Pedraza: las dos propuestas con precio cerrado salieron hoy en PDF.
  select id into c from public.clients where org_id = org and display_name = 'Nadia Pedraza (carpas profesionales)';
  select id into d from public.deals where client_id = c and archived_at is null order by created_at limit 1;
  perform pg_temp.mail(org, c, d, me, 'outgoing', 'email', '2026-10-03 12:13+02', 'Dos propuestas con precio cerrado enviadas (PDF)',
    'El mensaje de ayer se quedó en borradores; hoy se envían las dos propuestas en un PDF adjunto para que las revise con calma. Importes: los del PDF (pendientes de apuntar aquí como presupuesto).', 'nadiapedraza@outlook.es', null);
  perform set_config('app.stage_changed_at', '2026-10-03 12:13+02', true);
  update public.deals set stage_id = st_sent, probability_bps = 4000,
    next_action = 'Propuesta enviada hoy en PDF (dos opciones con precio cerrado). Si el martes 7 no ha contestado, llamar o escribir.',
    next_action_on = '2026-10-07'
  where id = d and stage_id <> st_sent;
  perform set_config('app.stage_changed_at', '', true);
end $$;

commit;

-- 3. La sociedad ya tiene NIF definitivo (B05704580, visto en el correo al BBVA del 3/10) y está
--    inscrita en el Registro Mercantil desde el 2/10: el emisor pasa a estar activo.
update public.issuers
set tax_id = 'B05704580',
    active_from = coalesce(active_from, date '2026-10-02')
where org_id = 'b9d59f11-12c6-4e73-b4b8-b9d754d95faa'
  and legal_name = 'GNERAI PARTNERS, S.L.'
  and (tax_id is null or tax_id = '');

select legal_name, tax_id, active_from from public.issuers
where org_id = 'b9d59f11-12c6-4e73-b4b8-b9d754d95faa' order by legal_name;
