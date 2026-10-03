-- GNERAI OS · propuesta de medición y Google Ads enviada a Nadia Pedraza el 3 de octubre de 2026
-- (PDF «Propuesta_GNERAI_Nadia_Medicion_GoogleAds.pdf», dos opciones con precio cerrado), y las dos
-- plantillas reutilizables que salen de ella.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f scripts/cargar-propuesta-nadia-2026-10-03.sql

begin;
select set_config('request.jwt.claim.sub', '0658fe85-fe43-4e55-b85b-e9190a25718b', true);
select set_config('request.jwt.claims', '{"sub":"0658fe85-fe43-4e55-b85b-e9190a25718b","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  org uuid := 'b9d59f11-12c6-4e73-b4b8-b9d754d95faa';
  issuer uuid := 'b895a7cc-b4df-476b-8b22-06c10038eaa6';  -- el emisor con el que se facturó hasta ahora
  vat uuid := '7008d6f0-a346-43ba-ba7a-635fb0e0667e';     -- IVA 21 %
  c uuid; d uuid; q uuid;
  -- El plan de pago del PDF: 50 % al aceptar y 50 % a la entrega.
  plan jsonb := jsonb_build_array(
    jsonb_build_object('label', 'Al aceptar la propuesta', 'percent_bps', 5000, 'when', 'on_accept', 'planned_on', null),
    jsonb_build_object('label', 'A la entrega', 'percent_bps', 5000, 'when', 'on_delivery', 'planned_on', null)
  );
begin
  select id into c from public.clients where org_id = org and display_name = 'Nadia Pedraza (carpas profesionales)';
  select id into d from public.deals where client_id = c and archived_at is null order by created_at limit 1;

  -- Opción A · Auditoría y medición en la web actual (Squarespace): 690 € + IVA.
  if not exists (select 1 from public.quotes where org_id = org and client_id = c and title like '%Opción A%') then
    q := public.save_quote(jsonb_build_object(
      'quote_id', null, 'expected_updated_at', null,
      'header', jsonb_build_object(
        'client_id', c, 'deal_id', d, 'issuer_id', issuer,
        'title', 'Medición de conversiones y Google Ads · Opción A: auditoría y medición en Squarespace',
        'issued_on', '2026-10-03', 'valid_until', '2026-11-02', 'language', 'es',
        'notes', 'Opción A del PDF enviado el 3/10/2026. Plazo: 5–7 días laborables desde que tengamos los accesos; mantiene su web actual. Incluye auditoría de la cuenta de Google Ads, diagnóstico técnico (Google Tag, GA4, Tag Manager, Squarespace y banner de cookies), implementación de la medición (GTM con Consent Mode v2, conversión por clic en WhatsApp y por envío de formulario, conexión con GA4 hasta que Ads las marque activas), revisión de la estructura de campañas, cuenta lista para que la gestione ella, documentación y videollamada de 1 hora. Condición: si su plan de Squarespace no permite insertar código, hay que pasar al plan Core o superior, a cargo de su empresa. No incluye la inversión en anuncios ni la gestión mensual. Las cuentas y accesos quedan a nombre de su empresa.',
        'payment_plan', plan
      ),
      'lines', jsonb_build_array(
        jsonb_build_object('id', gen_random_uuid(), 'position', 0, 'description', 'Auditoría de Google Ads y medición de conversiones en Squarespace (GTM, Consent Mode v2, WhatsApp y formularios, GA4), revisión de campañas, documentación y traspaso', 'billing_type', 'one_off', 'quantity', '1', 'unit_price_cents', 69000, 'discount_bps', 0, 'tax_rate_id', vat, 'irpf_applies', true, 'starts_on', null, 'ends_on', null, 'billing_day', null, 'prorate_first', true, 'base_cents', 69000)
      )
    ));
    perform public.finalize_quote(q);
    raise notice 'Opción A creada: %', q;
  end if;

  -- Opción B · Web nueva con la medición integrada: 1.990 € + IVA (1.300 web + 690 medición).
  if not exists (select 1 from public.quotes where org_id = org and client_id = c and title like '%Opción B%') then
    q := public.save_quote(jsonb_build_object(
      'quote_id', null, 'expected_updated_at', null,
      'header', jsonb_build_object(
        'client_id', c, 'deal_id', d, 'issuer_id', issuer,
        'title', 'Medición de conversiones y Google Ads · Opción B: web nueva con medición integrada',
        'issued_on', '2026-10-03', 'valid_until', '2026-11-02', 'language', 'es',
        'notes', 'Opción B del PDF enviado el 3/10/2026: 1.300 € la web + 690 € la medición. Plazo: 2–3 semanas. Incluye todo lo de la opción A más web a medida (Next.js) rápida y en tres idiomas, catálogo de carpas con ficha por modelo, formulario de presupuesto en cada ficha, botón de WhatsApp con mensaje según el origen, páginas de aterrizaje para las campañas, medición integrada en el código, SEO técnico y migración con redirecciones, y todo a nombre de su empresa (desaparece la suscripción de Squarespace). Servidor, hosting y base de datos: 20 €/mes + IVA, obligatorio para que la web funcione. Opcionales: paquete SEO mensual 200 €/mes y conversiones offline 250 € pago único. Si contrata la A y pasa a la B en 60 días, se le descuentan 345 €.',
        'payment_plan', plan
      ),
      'lines', jsonb_build_array(
        jsonb_build_object('id', gen_random_uuid(), 'position', 0, 'description', 'Web nueva a medida (Next.js, 3 idiomas, catálogo con ficha por modelo, formularios de presupuesto, páginas de campaña, SEO técnico y migración)', 'billing_type', 'one_off', 'quantity', '1', 'unit_price_cents', 130000, 'discount_bps', 0, 'tax_rate_id', vat, 'irpf_applies', true, 'starts_on', null, 'ends_on', null, 'billing_day', null, 'prorate_first', true, 'base_cents', 130000),
        jsonb_build_object('id', gen_random_uuid(), 'position', 1, 'description', 'Medición integrada: auditoría de Google Ads, GTM con Consent Mode v2, conversiones de WhatsApp, formulario y llamada, GA4, documentación y traspaso', 'billing_type', 'one_off', 'quantity', '1', 'unit_price_cents', 69000, 'discount_bps', 0, 'tax_rate_id', vat, 'irpf_applies', true, 'starts_on', null, 'ends_on', null, 'billing_day', null, 'prorate_first', true, 'base_cents', 69000),
        jsonb_build_object('id', gen_random_uuid(), 'position', 2, 'description', 'Servidor, hosting y base de datos (mínimo para que la web funcione)', 'billing_type', 'monthly', 'quantity', '1', 'unit_price_cents', 2000, 'discount_bps', 0, 'tax_rate_id', vat, 'irpf_applies', true, 'starts_on', null, 'ends_on', null, 'billing_day', 1, 'prorate_first', true, 'base_cents', 2000)
      )
    ));
    perform public.finalize_quote(q);
    raise notice 'Opción B creada: %', q;
  end if;

  -- El deal vale lo de la opción A (la más probable); la B queda apuntada en la próxima acción.
  update public.deals set est_one_off_cents = 69000, est_mrr_cents = 0,
    next_action = 'Propuesta enviada el 3/10 en PDF: opción A 690 € (medición en su Squarespace) u opción B 1.990 € + 20 €/mes (web nueva con medición). Si el martes 7 no contesta, llamar.',
    next_action_on = '2026-10-07'
  where id = d;
end $$;

-- ---------------------------------------------------------------------------
-- Las mismas dos propuestas, como plantillas reutilizables (Presupuestos → Plantillas)
-- ---------------------------------------------------------------------------
insert into public.quote_templates (org_id, name, category, summary, title, language, notes, lines, payment_plan)
select 'b9d59f11-12c6-4e73-b4b8-b9d754d95faa', t.name, t.category::public.catalog_category, t.summary, t.title, 'es'::public.app_locale, t.notes, t.lines, p.plan
from (values
  (
    'Medición de conversiones y Google Ads (web actual)',
    'ads',
    'Precio cerrado para arreglar la medición de un Google Ads que gasta sin conversiones fiables: auditoría, GTM con Consent Mode v2, WhatsApp y formularios, GA4, revisión de campañas y traspaso. 690 € + IVA, 5–7 días laborables.',
    'Medición de conversiones y Google Ads',
    'Plazo: 5–7 días laborables desde que tengamos los accesos. Las cuentas, propiedades y accesos quedan a nombre del cliente. No incluye la inversión en anuncios ni la gestión mensual de las campañas. Si el gestor de contenidos no permite insertar código, el cambio de plan va a cargo del cliente. Extra opcional: importación de ventas reales a Google Ads (conversiones offline), 250 € + IVA.',
    jsonb_build_array(jsonb_build_object(
      'description', 'Auditoría de Google Ads y medición de conversiones (GTM, Consent Mode v2, WhatsApp y formularios, GA4), revisión de campañas, documentación y traspaso',
      'billing_type', 'one_off', 'quantity', '1', 'unit_price_cents', 69000, 'discount_bps', 0,
      'tax_rate_id', '7008d6f0-a346-43ba-ba7a-635fb0e0667e', 'irpf_applies', true, 'billing_day', null
    ))
  ),
  (
    'Web nueva con medición integrada',
    'web',
    'Web a medida (Next.js, varios idiomas, catálogo con ficha por producto y formularios) con la medición integrada desde el principio y SEO técnico. 1.990 € + IVA y 20 €/mes de servidor.',
    'Web nueva con medición integrada',
    'Plazo: 2–3 semanas. Incluye la auditoría y la medición completas, páginas de aterrizaje para las campañas, migración con redirecciones y todo a nombre del cliente (dominio, hosting, código y cuentas). El servidor, el hosting y la base de datos son la única cuota obligatoria. Opcionales: paquete SEO mensual 200 €/mes y conversiones offline 250 € pago único.',
    jsonb_build_array(
      jsonb_build_object('description', 'Web nueva a medida (Next.js, varios idiomas, catálogo con ficha por producto, formularios de presupuesto, páginas de campaña, SEO técnico y migración)', 'billing_type', 'one_off', 'quantity', '1', 'unit_price_cents', 130000, 'discount_bps', 0, 'tax_rate_id', '7008d6f0-a346-43ba-ba7a-635fb0e0667e', 'irpf_applies', true, 'billing_day', null),
      jsonb_build_object('description', 'Medición integrada: auditoría de Google Ads, GTM con Consent Mode v2, conversiones de WhatsApp, formulario y llamada, GA4, documentación y traspaso', 'billing_type', 'one_off', 'quantity', '1', 'unit_price_cents', 69000, 'discount_bps', 0, 'tax_rate_id', '7008d6f0-a346-43ba-ba7a-635fb0e0667e', 'irpf_applies', true, 'billing_day', null),
      jsonb_build_object('description', 'Servidor, hosting y base de datos', 'billing_type', 'monthly', 'quantity', '1', 'unit_price_cents', 2000, 'discount_bps', 0, 'tax_rate_id', '7008d6f0-a346-43ba-ba7a-635fb0e0667e', 'irpf_applies', true, 'billing_day', 1)
    )
  )
) as t(name, category, summary, title, notes, lines),
lateral (select jsonb_build_array(
  jsonb_build_object('label', 'Al aceptar la propuesta', 'percent_bps', 5000, 'when', 'on_accept', 'planned_on', null),
  jsonb_build_object('label', 'A la entrega', 'percent_bps', 5000, 'when', 'on_delivery', 'planned_on', null)
) as plan) p
where not exists (
  select 1 from public.quote_templates existing
  where existing.org_id = 'b9d59f11-12c6-4e73-b4b8-b9d754d95faa' and existing.name = t.name
);

commit;

select number, title, status from public.quotes
where org_id = 'b9d59f11-12c6-4e73-b4b8-b9d754d95faa' order by number;
select name, category, archived_at is null as activa from public.quote_templates
where org_id = 'b9d59f11-12c6-4e73-b4b8-b9d754d95faa' order by name;
