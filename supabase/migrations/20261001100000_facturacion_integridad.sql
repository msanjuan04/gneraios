-- Refuerza la emisión en la frontera de la base de datos.
-- Los importes de línea se recalculan desde los datos fiscales y comerciales; nunca
-- se confía en los importes calculados por el navegador o por una llamada RPC directa.

create or replace function private.invoice_lines_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lifecycle public.invoice_lifecycle;
  v_invoice_irpf integer;
  v_gross numeric;
  v_discount numeric;
  v_base numeric;
  v_vat numeric;
  v_irpf numeric;
begin
  if tg_op = 'DELETE' then
    select i.lifecycle into v_lifecycle from public.invoices i where i.id = old.invoice_id;
    if v_lifecycle is null or v_lifecycle = 'draft' then return old; end if;
    raise exception 'Las líneas de una factura emitida no se modifican' using errcode = 'P0001', hint = 'invoice_immutable';
  end if;
  if tg_op = 'UPDATE' and new.invoice_id <> old.invoice_id then
    raise exception 'Una línea no cambia de factura' using errcode = 'P0001', hint = 'invoice_immutable';
  end if;

  select i.lifecycle, i.irpf_bps into v_lifecycle, v_invoice_irpf
  from public.invoices i where i.id = coalesce(new.invoice_id, old.invoice_id);
  -- Sin factura: se está borrando un borrador entero (cascada).
  if v_lifecycle is null or v_lifecycle = 'draft' then
    if tg_op <> 'DELETE' then
      -- PostgreSQL numeric round() es half away from zero, igual que el dominio TS.
      v_gross := round(new.unit_price_cents * new.quantity);
      v_discount := round(v_gross * new.discount_bps / 10000);
      v_base := v_gross - v_discount;
      v_vat := round(v_base * new.vat_bps / 10000);
      v_irpf := case when new.irpf_applies then round(v_base * v_invoice_irpf / 10000) else 0 end;
      if tg_op = 'INSERT' and (new.base_cents, new.vat_cents, new.irpf_cents) is distinct from (v_base::bigint, v_vat::bigint, v_irpf::bigint) then
        raise exception 'Los importes de la línea no coinciden con su base imponible y tipos fiscales'
          using errcode = 'P0001', hint = 'line_amounts_mismatch';
      end if;
      if tg_op = 'UPDATE' and (new.unit_price_cents, new.quantity, new.discount_bps, new.vat_bps, new.irpf_applies)
          is distinct from (old.unit_price_cents, old.quantity, old.discount_bps, old.vat_bps, old.irpf_applies) then
        new.base_cents := v_base::bigint;
        new.vat_cents := v_vat::bigint;
        new.irpf_cents := v_irpf::bigint;
      end if;
    end if;
    return coalesce(new, old);
  end if;
  raise exception 'Las líneas de una factura emitida no se modifican'
    using errcode = 'P0001', hint = 'invoice_immutable';
end;
$$;

create or replace function public.issue_invoice_begin(p_invoice_id uuid, p_issued_on date default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.invoices;
  v_issuer public.issuers;
  v_client public.clients;
  v_series public.invoice_series;
  v_org_terms integer;
  v_today date;
  v_on date;
  v_year smallint;
  v_seq integer;
  v_number text;
  v_prev date;
  v_lines integer;
  v_base bigint;
  v_vat bigint;
  v_irpf bigint;
  v_missing text[];
begin
  select * into v from public.invoices where id = p_invoice_id for update;
  if not found or not private.has_role(v.org_id, 'partner') then raise exception 'Sin permiso sobre esta factura' using errcode = '42501'; end if;
  if v.lifecycle <> 'draft' then
    return jsonb_build_object('invoice_id', v.id, 'lifecycle', v.lifecycle, 'number', v.number, 'issued_on', v.issued_on, 'series_id', v.series_id, 'fiscal_provider', v.fiscal_provider);
  end if;
  v_today := private.org_today(v.org_id);
  v_on := coalesce(p_issued_on, v.issued_on, v_today);
  if v_on > v_today then raise exception 'Una factura no puede llevar fecha futura' using errcode = 'P0001', hint = 'future_date'; end if;
  select * into v_issuer from public.issuers where id = v.issuer_id;
  select * into v_client from public.clients where id = v.client_id;
  select coalesce((o.settings ->> 'payment_terms_days')::integer, 30) into v_org_terms from public.orgs o where o.id = v.org_id;
  if v_issuer.archived_at is not null or (v_issuer.active_from is null and v_issuer.kind = 'company')
     or (v_issuer.active_from is not null and v_on < v_issuer.active_from) or (v_issuer.active_until is not null and v_on > v_issuer.active_until) then
    raise exception 'El emisor no está activo en la fecha de la factura' using errcode = 'P0001', hint = 'issuer_inactive';
  end if;
  if v_issuer.fiscal_provider = 'internal' and v_on >= v_issuer.verifactu_from then
    raise exception 'Desde el % este emisor tiene que emitir con un proveedor Verifactu', to_char(v_issuer.verifactu_from, 'DD/MM/YYYY') using errcode = 'P0001', hint = 'verifactu_required';
  end if;
  v_missing := array_remove(array[
    case when v_issuer.tax_id is null then 'issuer.tax_id' end,
    case when v_issuer.address_line is null then 'issuer.address_line' end,
    case when v_issuer.postal_code is null then 'issuer.postal_code' end,
    case when v_issuer.city is null then 'issuer.city' end,
    case when v_client.tax_id is null and v_client.tax_id_kind <> 'foreign' then 'client.tax_id' end,
    case when v_client.address_line is null then 'client.address_line' end,
    case when v_client.postal_code is null and v_client.country_code = 'ES' then 'client.postal_code' end,
    case when v_client.city is null then 'client.city' end
  ], null);
  if cardinality(v_missing) > 0 then raise exception 'Faltan datos fiscales: %', array_to_string(v_missing, ', ') using errcode = 'P0001', hint = 'fiscal_data_missing', detail = array_to_string(v_missing, ','); end if;
  select count(*), coalesce(sum(l.base_cents), 0), coalesce(sum(l.vat_cents), 0), coalesce(sum(l.irpf_cents), 0)
    into v_lines, v_base, v_vat, v_irpf from public.invoice_lines l where l.invoice_id = v.id;
  if v_lines = 0 then raise exception 'La factura no tiene líneas' using errcode = 'P0001', hint = 'no_lines'; end if;
  if (v_base, v_vat, v_irpf) <> (v.subtotal_cents, v.vat_cents, v.irpf_cents)
     or v.total_cents <> v.subtotal_cents + v.vat_cents - v.irpf_cents then
    raise exception 'Los totales no cuadran con las líneas' using errcode = 'P0001', hint = 'totals_mismatch';
  end if;
  if v.kind = 'rectifying' and not exists (select 1 from public.invoices o where o.id = v.rectifies_invoice_id and o.lifecycle = 'issued' and o.kind = 'ordinary' and o.issuer_id = v.issuer_id and o.client_id = v.client_id) then
    raise exception 'La factura rectificada no es válida' using errcode = 'P0001', hint = 'rectified_invalid';
  end if;
  if v.series_id is not null then select * into v_series from public.invoice_series where id = v.series_id;
  else select * into v_series from public.invoice_series s where s.issuer_id = v.issuer_id and s.kind = v.kind and s.is_default and s.archived_at is null; end if;
  if v_series.id is null or v_series.issuer_id <> v.issuer_id or v_series.kind <> v.kind or v_series.archived_at is not null then
    raise exception 'El emisor no tiene una serie válida para este tipo de factura' using errcode = 'P0001', hint = 'series_invalid';
  end if;
  v_year := case when v_series.reset_yearly then extract(year from v_on)::smallint else 0 end;
  if v_issuer.fiscal_provider = 'internal' then
    insert into private.invoice_series_counters as c (series_id, year, last_number) values (v_series.id, v_year, 1)
    on conflict (series_id, year) do update set last_number = c.last_number + 1, updated_at = now() returning c.last_number into v_seq;
    v_number := private.format_invoice_number(v_series.format, extract(year from v_on)::integer, v_seq);
  end if;
  select max(i.issued_on) into v_prev from public.invoices i where i.series_id = v_series.id and i.lifecycle <> 'draft' and i.id <> v.id and (not v_series.reset_yearly or extract(year from i.issued_on) = extract(year from v_on));
  if v_prev is not null and v_on < v_prev then raise exception 'La serie ya tiene una factura del %: esta no puede llevar una fecha anterior', to_char(v_prev, 'DD/MM/YYYY') using errcode = 'P0001', hint = 'date_before_previous', detail = v_prev::text; end if;
  update public.invoices set lifecycle = 'issuing', series_id = v_series.id, number = v_number, sequence = v_seq, fiscal_year = v_year,
    issued_on = v_on, due_on = coalesce(due_on, v_on + coalesce(payment_terms_days, v_client.payment_terms_days, v_org_terms)),
    fiscal_provider = v_issuer.fiscal_provider, issuing_started_at = now(),
    issuer_snapshot = jsonb_build_object('kind', v_issuer.kind, 'legal_name', v_issuer.legal_name, 'trade_name', v_issuer.trade_name, 'tax_id', v_issuer.tax_id,
      'address_line', v_issuer.address_line, 'postal_code', v_issuer.postal_code, 'city', v_issuer.city, 'province', v_issuer.province,
      'country_code', v_issuer.country_code, 'email', v_issuer.email, 'phone', v_issuer.phone, 'iban', v_issuer.iban, 'registry_info', v_issuer.registry_info),
    client_snapshot = jsonb_build_object('legal_name', coalesce(v_client.legal_name, v_client.display_name), 'display_name', v_client.display_name,
      'tax_id', v_client.tax_id, 'tax_id_kind', v_client.tax_id_kind, 'address_line', v_client.address_line, 'postal_code', v_client.postal_code,
      'city', v_client.city, 'province', v_client.province, 'country_code', v_client.country_code, 'is_business', v_client.is_business)
  where id = v.id returning * into v;
  return jsonb_build_object('invoice_id', v.id, 'lifecycle', v.lifecycle, 'number', v.number, 'issued_on', v.issued_on, 'series_id', v.series_id, 'fiscal_provider', v.fiscal_provider);
end;
$$;

create or replace function public.issue_invoice_complete(p_invoice_id uuid, p jsonb) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.invoices;
  v_expected_path text;
  v_requested_path text;
begin
  select * into v from public.invoices where id = p_invoice_id for update;
  if not found or not private.has_role(v.org_id, 'partner') then
    raise exception 'Sin permiso sobre esta factura' using errcode = '42501';
  end if;
  if v.lifecycle = 'issued' then
    return;
  end if;
  if v.lifecycle <> 'issuing' then
    raise exception 'La factura no está en emisión' using errcode = 'P0001', hint = 'invoice_not_issuing';
  end if;

  v_expected_path := v.org_id::text || '/' || v.id::text || '.pdf';
  v_requested_path := nullif(p ->> 'pdf_path', '');
  if v_requested_path is not null and v_requested_path <> v_expected_path then
    raise exception 'La ruta del PDF no corresponde a esta factura' using errcode = '22023', hint = 'invoice_pdf_path_invalid';
  end if;
  update public.invoices set
    number = coalesce(number, nullif(p ->> 'number', '')),
    provider_ref = coalesce(nullif(p ->> 'provider_ref', ''), provider_ref),
    provider_payload = coalesce(p -> 'provider_payload', provider_payload),
    pdf_path = coalesce(v_requested_path, pdf_path),
    lifecycle = 'issued',
    issued_at = now()
  where id = v.id;
end;
$$;
