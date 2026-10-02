-- GNERAI OS · carga comercial del 2 de octubre de 2026 (una sola transacción, como el socio Marc Sanjuan).
-- Leads con propuesta enviada: Little Forest, BAKoffice, Metrickal, Maher Homes.
-- Clientes con contrato mensual desde octubre: UDB Sports, Terrazea.
-- Idempotente a nivel de cliente: si el cliente/deal ya existe con ese nombre, se salta.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f scripts/cargar-comercial-2026-10-02.sql

begin;
select set_config('request.jwt.claim.sub', '0658fe85-fe43-4e55-b85b-e9190a25718b', true);
select set_config('request.jwt.claims', '{"sub":"0658fe85-fe43-4e55-b85b-e9190a25718b","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  v_org uuid := 'b9d59f11-12c6-4e73-b4b8-b9d754d95faa';
  v_issuer uuid := 'b895a7cc-b4df-476b-8b22-06c10038eaa6';      -- Marc Sanjuan Sardanyes (autónomo)
  v_vat uuid := '7008d6f0-a346-43ba-ba7a-635fb0e0667e';         -- IVA 21 %
  v_stage uuid := '828c2a25-d70a-48a0-9896-a607f789d52b';       -- Propuesta enviada
  v_member uuid := 'c58fa402-06fa-4eed-808f-440d4fb6bb51';      -- Marc Sanjuan (member)
  v_client uuid;
  v_deal uuid;
  v_quote uuid;
  v_contract uuid;

  function_lines jsonb;
begin
  -- -------------------------------------------------------------------------
  -- 1. Little Forest · Pack 03 (branding + web + software + app): 9.600 € + 550 €/mes
  -- -------------------------------------------------------------------------
  select id into v_client from public.clients where org_id = v_org and display_name = 'Little Forest';
  if v_client is null then
    insert into public.clients (org_id, display_name, preferred_language, manual_status, owner_member_id)
    values (v_org, 'Little Forest', 'es', 'lead', v_member) returning id into v_client;
    insert into public.deals (org_id, client_id, title, stage_id, est_one_off_cents, est_mrr_cents, probability_bps, owner_member_id, next_action, next_action_on)
    values (v_org, v_client, 'Ludoteca: branding, web, software y app (Pack 03)', v_stage, 960000, 55000, 8000, v_member, 'Confirmar aceptación de la propuesta y fijar kick-off', '2026-10-06')
    returning id into v_deal;
    v_quote := public.save_quote(jsonb_build_object(
      'quote_id', null, 'expected_updated_at', null,
      'header', jsonb_build_object(
        'client_id', v_client, 'deal_id', v_deal, 'issuer_id', v_issuer,
        'title', 'Little Forest · Pack 03: branding, web, software y app',
        'issued_on', '2026-09-29', 'valid_until', '2026-10-29', 'language', 'es',
        'notes', 'Propuesta completa en https://littleforest.gnerai.com/propuesta/ (PDF v2 del 29/09). Pack 03 recomendado: branding (A1–A3), web a medida en tres idiomas (B1), software MVP (C1–C6: cuatro portales, Holded, GTiQ, reservas) y app iOS/Android (C7). Cuota mensual con app mantenida; 12 meses de permanencia desde la apertura. Marketing (Google Ads 250 €/mes, Meta Ads 375 €/mes) aparte. Holded, Stripe y hardware a cargo de Little Forest.',
        'payment_plan', jsonb_build_array(
          jsonb_build_object('label', 'A la firma', 'percent_bps', 4000, 'when', 'on_accept', 'planned_on', null),
          jsonb_build_object('label', 'Branding y web entregados', 'percent_bps', 3000, 'when', 'on_delivery', 'planned_on', null),
          jsonb_build_object('label', 'Puesta en marcha en el local', 'percent_bps', 3000, 'when', 'on_delivery', 'planned_on', null)
        )
      ),
      'lines', jsonb_build_array(
        jsonb_build_object('id', gen_random_uuid(), 'position', 0, 'description', 'Pack 03 · Branding + Web + Software + App (A1–A3, B1, C1–C7)', 'billing_type', 'one_off', 'quantity', '1', 'unit_price_cents', 960000, 'discount_bps', 0, 'tax_rate_id', v_vat, 'irpf_applies', true, 'starts_on', null, 'ends_on', null, 'billing_day', null, 'prorate_first', true, 'base_cents', 960000),
        jsonb_build_object('id', gen_random_uuid(), 'position', 1, 'description', 'Plan 02 · Software, web y app: plataforma, hosting UE, soporte, 4 h/mes de mejoras, SEO, informe mensual y app en las tiendas', 'billing_type', 'monthly', 'quantity', '1', 'unit_price_cents', 55000, 'discount_bps', 0, 'tax_rate_id', v_vat, 'irpf_applies', true, 'starts_on', null, 'ends_on', null, 'billing_day', null, 'prorate_first', true, 'base_cents', 55000)
      )
    ));
    perform public.finalize_quote(v_quote);
    insert into public.activities (org_id, client_id, deal_id, kind, title, body, occurred_at, member_id, direction, channel, external_reference)
    values (v_org, v_client, v_deal, 'email', 'Propuesta enviada: Pack 03 (9.600 € + 550 €/mes)', 'Propuesta navegable con demos de web y portales, resumen en PDF (5 páginas) y propuesta completa en PDF. Están a punto de aceptar.', '2026-09-29 17:30+02', v_member, 'outgoing', 'email', 'https://littleforest.gnerai.com/');
    raise notice 'Little Forest: cliente %, deal %, presupuesto %', v_client, v_deal, v_quote;
  else
    raise notice 'Little Forest ya existía: se salta';
  end if;

  -- -------------------------------------------------------------------------
  -- 2. BAKoffice · web + SEO + captación: 1.000 € + 950 €/mes (propuesta conjunta bakmet.gnerai.com)
  -- -------------------------------------------------------------------------
  select id into v_client from public.clients where org_id = v_org and display_name = 'BAKoffice';
  if v_client is null then
    insert into public.clients (org_id, display_name, preferred_language, manual_status, owner_member_id)
    values (v_org, 'BAKoffice', 'ca', 'lead', v_member) returning id into v_client;
    insert into public.deals (org_id, client_id, title, stage_id, est_one_off_cents, est_mrr_cents, probability_bps, owner_member_id, next_action, next_action_on)
    values (v_org, v_client, 'Web completa, SEO y captación (colaboración mensual)', v_stage, 100000, 95000, 5000, v_member, 'Seguimiento de la propuesta conjunta BAKoffice + Metrickal', '2026-10-08')
    returning id into v_deal;
    v_quote := public.save_quote(jsonb_build_object(
      'quote_id', null, 'expected_updated_at', null,
      'header', jsonb_build_object(
        'client_id', v_client, 'deal_id', v_deal, 'issuer_id', v_issuer,
        'title', 'BAKoffice · Estratègia de creixement: web, SEO i captació',
        'issued_on', '2026-10-01', 'valid_until', '2026-10-31', 'language', 'ca',
        'notes', 'Proposta conjunta per a BAKoffice i Metrickal: https://bakmet.gnerai.com/. Posada en marxa: web completa i configuració del mesurament. Quota mensual: estratègia, SEO i contingut (Semrush inclòs i gestionat per GNERAI), pàgines de campanya i gestió d''anuncis. La inversió en anuncis s''acorda a part abans de cada prova.',
        'payment_plan', jsonb_build_array(jsonb_build_object('label', 'Posada en marxa', 'percent_bps', 10000, 'when', 'on_accept', 'planned_on', null))
      ),
      'lines', jsonb_build_array(
        jsonb_build_object('id', gen_random_uuid(), 'position', 0, 'description', 'Posada en marxa: web completa i configuració inicial del mesurament', 'billing_type', 'one_off', 'quantity', '1', 'unit_price_cents', 100000, 'discount_bps', 0, 'tax_rate_id', v_vat, 'irpf_applies', true, 'starts_on', null, 'ends_on', null, 'billing_day', null, 'prorate_first', true, 'base_cents', 100000),
        jsonb_build_object('id', gen_random_uuid(), 'position', 1, 'description', 'Col·laboració mensual: estratègia, SEO i contingut (Semrush inclòs), pàgines de campanya i gestió d''anuncis', 'billing_type', 'monthly', 'quantity', '1', 'unit_price_cents', 95000, 'discount_bps', 0, 'tax_rate_id', v_vat, 'irpf_applies', true, 'starts_on', null, 'ends_on', null, 'billing_day', null, 'prorate_first', true, 'base_cents', 95000)
      )
    ));
    perform public.finalize_quote(v_quote);
    insert into public.activities (org_id, client_id, deal_id, kind, title, body, occurred_at, member_id, direction, channel, external_reference)
    values (v_org, v_client, v_deal, 'email', 'Proposta enviada: 1.000 € + 950 €/mes', 'Proposta conjunta BAKoffice + Metrickal publicada a bakmet.gnerai.com (1 d''octubre de 2026).', '2026-10-01 12:00+02', v_member, 'outgoing', 'email', 'https://bakmet.gnerai.com/#bakoffice');
    raise notice 'BAKoffice: cliente %, deal %, presupuesto %', v_client, v_deal, v_quote;
  else
    raise notice 'BAKoffice ya existía: se salta';
  end if;

  -- -------------------------------------------------------------------------
  -- 3. Metrickal · campañas y páginas de campaña: 400 € + 750 €/mes
  -- -------------------------------------------------------------------------
  select id into v_client from public.clients where org_id = v_org and display_name = 'Metrickal';
  if v_client is null then
    insert into public.clients (org_id, display_name, legal_name, preferred_language, manual_status, owner_member_id)
    values (v_org, 'Metrickal', 'Avantris', 'ca', 'lead', v_member) returning id into v_client;
    insert into public.deals (org_id, client_id, title, stage_id, est_one_off_cents, est_mrr_cents, probability_bps, owner_member_id, next_action, next_action_on)
    values (v_org, v_client, 'Captación B2B: campañas y páginas de campaña', v_stage, 40000, 75000, 5000, v_member, 'Seguimiento de la propuesta conjunta BAKoffice + Metrickal', '2026-10-08')
    returning id into v_deal;
    v_quote := public.save_quote(jsonb_build_object(
      'quote_id', null, 'expected_updated_at', null,
      'header', jsonb_build_object(
        'client_id', v_client, 'deal_id', v_deal, 'issuer_id', v_issuer,
        'title', 'Metrickal · Captació: campanyes i pàgines de campanya',
        'issued_on', '2026-10-01', 'valid_until', '2026-10-31', 'language', 'ca',
        'notes', 'Proposta conjunta per a BAKoffice i Metrickal: https://bakmet.gnerai.com/#metrickal. Posada en marxa: recerca inicial, mesurament i primera pàgina de campanya. Quota mensual de captació (Google, LinkedIn…). La web actual (WordPress, altre equip) queda fora: ni SEO ni canvis. Alternativa per campanyes soltes: Google Search 250/150 €/mes, YouTube 300/200, Meta 375/225, LinkedIn 375/225, ChatGPT Ads 250/150 (primera/addicional).',
        'payment_plan', jsonb_build_array(jsonb_build_object('label', 'Posada en marxa', 'percent_bps', 10000, 'when', 'on_accept', 'planned_on', null))
      ),
      'lines', jsonb_build_array(
        jsonb_build_object('id', gen_random_uuid(), 'position', 0, 'description', 'Posada en marxa: recerca inicial, mesurament i primera pàgina de campanya', 'billing_type', 'one_off', 'quantity', '1', 'unit_price_cents', 40000, 'discount_bps', 0, 'tax_rate_id', v_vat, 'irpf_applies', true, 'starts_on', null, 'ends_on', null, 'billing_day', null, 'prorate_first', true, 'base_cents', 40000),
        jsonb_build_object('id', gen_random_uuid(), 'position', 1, 'description', 'Col·laboració mensual de captació: campanyes, pàgines de campanya i seguiment de les oportunitats', 'billing_type', 'monthly', 'quantity', '1', 'unit_price_cents', 75000, 'discount_bps', 0, 'tax_rate_id', v_vat, 'irpf_applies', true, 'starts_on', null, 'ends_on', null, 'billing_day', null, 'prorate_first', true, 'base_cents', 75000)
      )
    ));
    perform public.finalize_quote(v_quote);
    insert into public.activities (org_id, client_id, deal_id, kind, title, body, occurred_at, member_id, direction, channel, external_reference)
    values (v_org, v_client, v_deal, 'email', 'Proposta enviada: 400 € + 750 €/mes', 'Proposta conjunta BAKoffice + Metrickal publicada a bakmet.gnerai.com (1 d''octubre de 2026).', '2026-10-01 12:00+02', v_member, 'outgoing', 'email', 'https://bakmet.gnerai.com/#metrickal');
    raise notice 'Metrickal: cliente %, deal %, presupuesto %', v_client, v_deal, v_quote;
  else
    raise notice 'Metrickal ya existía: se salta';
  end if;

  -- -------------------------------------------------------------------------
  -- 4. Maher Homes · 1.200 € de set up + 950 €/mes
  -- -------------------------------------------------------------------------
  select id into v_client from public.clients where org_id = v_org and display_name = 'Maher Homes';
  if v_client is null then
    insert into public.clients (org_id, display_name, preferred_language, manual_status, owner_member_id)
    values (v_org, 'Maher Homes', 'es', 'lead', v_member) returning id into v_client;
    insert into public.deals (org_id, client_id, title, stage_id, est_one_off_cents, est_mrr_cents, probability_bps, owner_member_id, next_action, next_action_on)
    values (v_org, v_client, 'Set up y colaboración mensual', v_stage, 120000, 95000, 5000, v_member, 'Seguimiento de la propuesta', '2026-10-08')
    returning id into v_deal;
    v_quote := public.save_quote(jsonb_build_object(
      'quote_id', null, 'expected_updated_at', null,
      'header', jsonb_build_object(
        'client_id', v_client, 'deal_id', v_deal, 'issuer_id', v_issuer,
        'title', 'Maher Homes · Set up y colaboración mensual',
        'issued_on', '2026-09-30', 'valid_until', '2026-10-30', 'language', 'es',
        'notes', 'Propuesta enviada: 1.200 € de set up y 950 €/mes de colaboración. Detalle del alcance pendiente de incorporar al presupuesto.',
        'payment_plan', jsonb_build_array(jsonb_build_object('label', 'Set up', 'percent_bps', 10000, 'when', 'on_accept', 'planned_on', null))
      ),
      'lines', jsonb_build_array(
        jsonb_build_object('id', gen_random_uuid(), 'position', 0, 'description', 'Set up', 'billing_type', 'one_off', 'quantity', '1', 'unit_price_cents', 120000, 'discount_bps', 0, 'tax_rate_id', v_vat, 'irpf_applies', true, 'starts_on', null, 'ends_on', null, 'billing_day', null, 'prorate_first', true, 'base_cents', 120000),
        jsonb_build_object('id', gen_random_uuid(), 'position', 1, 'description', 'Colaboración mensual', 'billing_type', 'monthly', 'quantity', '1', 'unit_price_cents', 95000, 'discount_bps', 0, 'tax_rate_id', v_vat, 'irpf_applies', true, 'starts_on', null, 'ends_on', null, 'billing_day', null, 'prorate_first', true, 'base_cents', 95000)
      )
    ));
    perform public.finalize_quote(v_quote);
    insert into public.activities (org_id, client_id, deal_id, kind, title, body, occurred_at, member_id, direction, channel)
    values (v_org, v_client, v_deal, 'email', 'Propuesta enviada: 1.200 € de set up + 950 €/mes', 'Propuesta enviada al cliente; a la espera de respuesta.', '2026-09-30 12:00+02', v_member, 'outgoing', 'email');
    raise notice 'Maher Homes: cliente %, deal %, presupuesto %', v_client, v_deal, v_quote;
  else
    raise notice 'Maher Homes ya existía: se salta';
  end if;

  -- -------------------------------------------------------------------------
  -- 5. UDB Sports · cliente fijo: 1.175 €/mes (1.050 por 16 h/semana + 95 Semrush + 30 servidor)
  -- -------------------------------------------------------------------------
  v_client := 'dc3eb5c4-c111-4412-86ed-191288b5582b';
  if not exists (select 1 from public.contracts where org_id = v_org and client_id = v_client and archived_at is null) then
    v_contract := public.create_contract(jsonb_build_object(
      'client_id', v_client, 'deal_id', null, 'issuer_id', v_issuer,
      'title', 'Mantenimiento integral y desarrollo (16 h/semana), Semrush y servidor',
      'signed_on', '2026-10-01', 'payment_terms_days', null, 'payment_method', 'transfer', 'invoice_grouping', 'client',
      'notes', 'Cliente fijo mensual. 1.175 €/mes: 1.050 € por 16 horas semanales de desarrollo y mantenimiento, 95 € de Semrush y 30 € de servidor.',
      'lines', jsonb_build_array(
        jsonb_build_object('position', 0, 'description', 'Desarrollo y mantenimiento · 16 horas semanales', 'billing_type', 'monthly', 'quantity', 1, 'unit_price_cents', 105000, 'discount_bps', 0, 'tax_rate_id', v_vat, 'irpf_applies', true, 'starts_on', '2026-10-01', 'ends_on', null, 'billing_day', 1, 'prorate_first', true),
        jsonb_build_object('position', 1, 'description', 'Semrush', 'billing_type', 'monthly', 'quantity', 1, 'unit_price_cents', 9500, 'discount_bps', 0, 'tax_rate_id', v_vat, 'irpf_applies', true, 'starts_on', '2026-10-01', 'ends_on', null, 'billing_day', 1, 'prorate_first', true),
        jsonb_build_object('position', 2, 'description', 'Servidor', 'billing_type', 'monthly', 'quantity', 1, 'unit_price_cents', 3000, 'discount_bps', 0, 'tax_rate_id', v_vat, 'irpf_applies', true, 'starts_on', '2026-10-01', 'ends_on', null, 'billing_day', 1, 'prorate_first', true)
      ),
      'milestones', '[]'::jsonb
    ));
    update public.clients set manual_status = 'active' where id = v_client and org_id = v_org;
    raise notice 'UDB Sports: contrato %', v_contract;
  else
    raise notice 'UDB Sports ya tenía contrato: se salta';
  end if;

  -- -------------------------------------------------------------------------
  -- 6. Terrazea · empieza en octubre: 1.000 € de set up + 600 €/mes
  -- -------------------------------------------------------------------------
  v_client := '4e57bdaa-9f27-44e6-a24b-8dc867aff418';
  if not exists (select 1 from public.contracts where org_id = v_org and client_id = v_client and archived_at is null) then
    v_contract := public.create_contract(jsonb_build_object(
      'client_id', v_client, 'deal_id', null, 'issuer_id', v_issuer,
      'title', 'Set up y colaboración mensual',
      'signed_on', '2026-10-01', 'payment_terms_days', null, 'payment_method', 'transfer', 'invoice_grouping', 'client',
      'notes', 'Cliente confirmado; empieza en octubre de 2026. 1.000 € de set up y 600 €/mes.',
      'lines', jsonb_build_array(
        jsonb_build_object('position', 0, 'description', 'Set up', 'billing_type', 'one_off', 'quantity', 1, 'unit_price_cents', 100000, 'discount_bps', 0, 'tax_rate_id', v_vat, 'irpf_applies', true, 'starts_on', null, 'ends_on', null, 'billing_day', null, 'prorate_first', true),
        jsonb_build_object('position', 1, 'description', 'Colaboración mensual', 'billing_type', 'monthly', 'quantity', 1, 'unit_price_cents', 60000, 'discount_bps', 0, 'tax_rate_id', v_vat, 'irpf_applies', true, 'starts_on', '2026-10-01', 'ends_on', null, 'billing_day', 1, 'prorate_first', true)
      ),
      'milestones', jsonb_build_array(jsonb_build_object('position', 0, 'label', 'Set up', 'percent_bps', 10000, 'planned_on', '2026-10-01', 'auto', false))
    ));
    update public.clients set manual_status = 'active' where id = v_client and org_id = v_org;
    raise notice 'Terrazea: contrato %', v_contract;
  else
    raise notice 'Terrazea ya tenía contrato: se salta';
  end if;
end $$;

commit;
