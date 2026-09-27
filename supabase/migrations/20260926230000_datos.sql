-- GNERAI OS · Hito 1.5 · Datos y gestoría
-- Importaciones CSV con simulación previa (import_jobs + import_job_rows) y la RPC que da de alta
-- una factura histórica ya emitida en otra herramienta (import_historical_invoice): conserva su
-- número y el contador de su serie continúa después del último importado.
-- Ver ARCHITECTURE.md §6.1 (importaciones idempotentes), §6.3 (import_jobs), §7.4 (numeración) y §13.
--
-- Reparto de responsabilidades:
-- - Leer el fichero, mapear columnas, validar, clasificar las líneas (recurrente / puntual / uso) y
--   cuadrar los importes con los que imprimía la factura es TS puro (src/domain/dataio). Aquí solo
--   se comprueban invariantes baratos: cabecera = Σ líneas, total = base + IVA − IRPF y número =
--   formato de la serie con esa secuencia.
-- - Lo que tiene que ser atómico vive aquí: la factura con sus líneas, su cobro y su contador.
--
-- Regla de fechas no decrecientes con históricos (§7.4). Dentro de una serie y un año (el del
-- número, si la serie se reinicia cada año), el orden de los números y el de las fechas no puede
-- contradecir lo que GNERAI OS ya ha emitido:
-- - un histórico con número menor que una factura emitida desde GNERAI OS no puede llevar una
--   fecha posterior a ella, y uno con número mayor no puede llevar una fecha anterior;
-- - si GNERAI OS ya ha emitido en esa serie y año sin secuencia propia (numeración de un
--   proveedor externo), no se importa en ella: no hay orden que comprobar.
-- Entre históricos no se bloquea: un desorden de fechas ya emitido es un hecho que no se puede
-- corregir, y la simulación lo enseña como aviso.
--
-- El contador de una serie nunca queda por debajo de la secuencia más alta que ya tiene (un
-- trigger lo garantiza para cualquier camino, incluido set_series_last_number): importar solo lo
-- sube y fijar a mano un número menor que el último importado se rechaza.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.import_kind as enum ('clients', 'invoices');
create type public.import_status as enum ('draft', 'simulated', 'committed', 'failed');
create type public.import_row_action as enum ('create', 'update', 'skip', 'error');

-- ---------------------------------------------------------------------------
-- Importaciones
-- ---------------------------------------------------------------------------
create table public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  kind public.import_kind not null,
  file_name text not null check (char_length(btrim(file_name)) between 1 and 255),
  -- SHA-256 del fichero: avisa si se vuelve a subir uno que ya se importó.
  file_hash text check (file_hash is null or file_hash ~ '^[0-9a-f]{64}$'),
  -- Cómo se leyó: formato, codificación, separador, tamaño, número de filas.
  file_meta jsonb not null default '{}'::jsonb check (jsonb_typeof(file_meta) = 'object'),
  headers text[] not null default '{}' check (cardinality(headers) <= 200),
  -- Columna del fichero de cada campo y opciones (emisor, cobro, IVA por defecto, tipos de línea corregidos).
  mapping jsonb not null default '{}'::jsonb check (jsonb_typeof(mapping) = 'object'),
  status public.import_status not null default 'draft',
  -- Recuento por acción y totales de la última simulación o del resultado.
  summary jsonb check (summary is null or jsonb_typeof(summary) = 'object'),
  error text,
  simulated_at timestamptz,
  committed_at timestamptz,
  committed_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  check ((status = 'committed') = (committed_at is not null))
);
create index import_jobs_org_idx on public.import_jobs (org_id, created_at desc);
create index import_jobs_hash_idx on public.import_jobs (org_id, file_hash) where file_hash is not null;

-- Una fila del fichero, tal cual, con lo que se hizo (o se haría) con ella.
create table public.import_job_rows (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  job_id uuid not null,
  -- Fila de la hoja de cálculo (la cabecera es la 1).
  row_number integer not null check (row_number >= 2),
  -- Celdas tal y como venían, en el orden de import_jobs.headers.
  raw jsonb not null check (jsonb_typeof(raw) = 'array'),
  action public.import_row_action,
  -- Código del motivo principal (dataio.issues.* en i18n) y todos los motivos con sus parámetros.
  message text check (message is null or message ~ '^[a-z_]{1,60}$'),
  issues jsonb not null default '[]'::jsonb check (jsonb_typeof(issues) = 'array'),
  -- El cliente o la factura creados, completados o saltados.
  entity_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  unique (job_id, row_number),
  foreign key (org_id, job_id) references public.import_jobs (org_id, id) on delete cascade
);
create index import_job_rows_entity_idx on public.import_job_rows (entity_id) where entity_id is not null;

-- Lo que se subió no se reescribe: el fichero y sus filas son la prueba de lo importado. El mapeo
-- se puede cambiar hasta confirmar; después, no.
create function private.import_jobs_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.org_id, new.kind, new.file_name, new.file_hash, new.file_meta, new.headers)
     is distinct from (old.org_id, old.kind, old.file_name, old.file_hash, old.file_meta, old.headers) then
    raise exception 'El fichero de una importación no se cambia: sube otro' using errcode = 'P0001', hint = 'import_file_fixed';
  end if;
  if old.status = 'committed' and new.mapping is distinct from old.mapping then
    raise exception 'Una importación confirmada no cambia de mapeo' using errcode = 'P0001', hint = 'import_committed';
  end if;
  return new;
end;
$$;

create trigger import_jobs_guard before update on public.import_jobs
  for each row execute function private.import_jobs_guard();

create function private.import_job_rows_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.org_id, new.job_id, new.row_number, new.raw) is distinct from (old.org_id, old.job_id, old.row_number, old.raw) then
    raise exception 'Las filas de un fichero importado no se cambian' using errcode = 'P0001', hint = 'import_file_fixed';
  end if;
  return new;
end;
$$;

create trigger import_job_rows_guard before update on public.import_job_rows
  for each row execute function private.import_job_rows_guard();

create trigger set_updated_at before update on public.import_jobs for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.import_job_rows for each row execute function private.set_updated_at();
-- Las filas no llenan la auditoría: lo que crean (clientes, facturas) ya se audita en su tabla.
create trigger audit after insert or update or delete on public.import_jobs for each row execute function private.audit_row();

-- ---------------------------------------------------------------------------
-- RLS: las ve cualquier miembro; las lleva un socio. Una confirmada se queda como historial.
-- ---------------------------------------------------------------------------
alter table public.import_jobs enable row level security;
alter table public.import_job_rows enable row level security;

create policy import_jobs_select on public.import_jobs for select to authenticated using (private.has_role(org_id, 'viewer'));
create policy import_jobs_insert on public.import_jobs for insert to authenticated with check (private.has_role(org_id, 'partner'));
create policy import_jobs_update on public.import_jobs for update to authenticated
  using (private.has_role(org_id, 'partner')) with check (private.has_role(org_id, 'partner'));
create policy import_jobs_delete on public.import_jobs for delete to authenticated
  using (private.has_role(org_id, 'partner') and status <> 'committed');

create policy import_job_rows_select on public.import_job_rows for select to authenticated using (private.has_role(org_id, 'viewer'));
create policy import_job_rows_insert on public.import_job_rows for insert to authenticated with check (private.has_role(org_id, 'partner'));
create policy import_job_rows_update on public.import_job_rows for update to authenticated
  using (private.has_role(org_id, 'partner')) with check (private.has_role(org_id, 'partner'));
create policy import_job_rows_delete on public.import_job_rows for delete to authenticated using (private.has_role(org_id, 'partner'));

-- ---------------------------------------------------------------------------
-- El contador de una serie nunca por debajo de lo ya numerado en ella
-- ---------------------------------------------------------------------------
create function private.invoice_series_counters_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max integer;
begin
  select max(i.sequence) into v_max
  from public.invoices i
  where i.series_id = new.series_id and i.fiscal_year = new.year and i.sequence is not null;
  if v_max is not null and new.last_number < v_max then
    raise exception 'El contador no puede quedar por debajo de la última factura de la serie (%)', v_max
      using errcode = 'P0001', hint = 'counter_below_used', detail = v_max::text;
  end if;
  return new;
end;
$$;

-- Solo al actualizar: en un INSERT … ON CONFLICT el trigger BEFORE INSERT ve la fila propuesta (el
-- 1 de la emisión) antes de que el conflicto la convierta en actualización, y una serie sin fila de
-- contador no tiene facturas numeradas.
create trigger invoice_series_counters_guard before update of last_number on private.invoice_series_counters
  for each row execute function private.invoice_series_counters_guard();

-- ---------------------------------------------------------------------------
-- RPC: factura histórica
-- ---------------------------------------------------------------------------

-- Da de alta una factura ya emitida en otra herramienta, con su número, sus líneas (importes ya
-- calculados en TS), la copia de los datos del cliente tal y como salían en ella y, si se indica,
-- su cobro. Entra directamente como emitida (source = 'import': es lo único que el trigger de
-- facturas deja pasar de borrador a emitida sin «emitiendo») y sube el contador de su serie hasta
-- su secuencia como mínimo, nunca a la baja. Idempotente: si ya existe una importada con ese
-- external_id, devuelve su id sin tocar nada (una factura emitida no se modifica).
-- Contrato del JSON (p):
--   external_id, issuer_id, series_id, client_id, number, sequence, number_year,
--   kind? ('ordinary' | 'rectifying'), rectifies_number?, rectification_reason?,
--   issued_on, operation_on?, due_on?, language?, irpf_bps?, payment_method?, notes?,
--   client_party?: { legal_name, tax_id, tax_id_kind, address_line, postal_code, city, province, country_code },
--   totals: { subtotal_cents, vat_cents, irpf_cents, total_cents },
--   lines: [{ position, description, quantity, unit_price_cents, discount_bps, base_cents, tax_rate_id?,
--             vat_bps, vat_regime, vat_cents, irpf_applies, irpf_cents, legal_note?, billing_type,
--             period_start?, period_end? }],
--   payment?: { paid_on, amount_cents?, method?, reference? }   (solo ordinarias)
create function public.import_historical_invoice(p jsonb) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_issuer public.issuers;
  v_series public.invoice_series;
  v_client public.clients;
  v_conflict public.invoices;
  v_org uuid;
  v_id uuid;
  v_external text := nullif(btrim(p ->> 'external_id'), '');
  v_number text := nullif(btrim(p ->> 'number'), '');
  v_seq integer := nullif(p ->> 'sequence', '')::integer;
  v_number_year integer := nullif(p ->> 'number_year', '')::integer;
  v_on date := nullif(p ->> 'issued_on', '')::date;
  v_kind public.series_kind := coalesce(nullif(p ->> 'kind', ''), 'ordinary')::public.series_kind;
  v_lines jsonb := coalesce(p -> 'lines', '[]'::jsonb);
  v_totals jsonb := coalesce(p -> 'totals', '{}'::jsonb);
  v_party jsonb := case when jsonb_typeof(p -> 'client_party') = 'object' then p -> 'client_party' else '{}'::jsonb end;
  v_payment jsonb := case when jsonb_typeof(p -> 'payment') = 'object' then p -> 'payment' else null end;
  v_today date;
  v_fiscal_year smallint;
  v_rectifies uuid;
  v_terms integer;
  v_due date;
  v_paid_on date;
  v_method public.payment_method;
  v_base bigint;
  v_vat bigint;
  v_irpf bigint;
begin
  select * into v_issuer from public.issuers where id = nullif(p ->> 'issuer_id', '')::uuid;
  if not found or not private.has_role(v_issuer.org_id, 'partner') then
    raise exception 'Sin permiso para importar facturas en esta organización' using errcode = '42501';
  end if;
  v_org := v_issuer.org_id;

  if v_external is null or v_number is null or v_seq is null or v_seq < 1 or v_on is null
     or v_number_year is null or v_number_year not between 2000 and 2999 then
    raise exception 'Faltan datos de la factura importada (número, secuencia, año o fecha)'
      using errcode = '22023', hint = 'import_invalid';
  end if;

  -- Dos importaciones de la misma factura a la vez se ordenan: la segunda ve la primera.
  perform pg_advisory_xact_lock(hashtextextended('import:' || v_org::text || ':' || v_external, 0));
  select i.id into v_id from public.invoices i
  where i.org_id = v_org and i.external_id = v_external and i.source = 'import';
  if v_id is not null then
    return v_id;
  end if;
  if exists (select 1 from public.invoices i where i.org_id = v_org and i.external_id = v_external) then
    raise exception 'Ya hay una factura con este identificador de importación' using errcode = 'P0001', hint = 'number_taken';
  end if;

  v_today := private.org_today(v_org);
  if v_on > v_today then
    raise exception 'Una factura no puede llevar fecha futura' using errcode = 'P0001', hint = 'future_date';
  end if;

  -- Un emisor histórico puede estar archivado (un autónomo ya traspasado a la SL), pero tenía que
  -- estar de alta en la fecha de la factura: la misma regla que al emitir.
  if (v_issuer.active_from is null and v_issuer.kind = 'company')
     or (v_issuer.active_from is not null and v_on < v_issuer.active_from)
     or (v_issuer.active_until is not null and v_on > v_issuer.active_until) then
    raise exception 'El emisor no estaba activo en la fecha de la factura' using errcode = 'P0001', hint = 'issuer_inactive';
  end if;

  select * into v_series from public.invoice_series where id = nullif(p ->> 'series_id', '')::uuid;
  if not found or v_series.issuer_id <> v_issuer.id or v_series.kind <> v_kind then
    raise exception 'La serie no es de este emisor o de este tipo de factura' using errcode = 'P0001', hint = 'series_invalid';
  end if;
  -- El número tiene que ser exactamente el de la serie con esa secuencia: así el contador y los
  -- números que vengan después son coherentes con los importados.
  if private.format_invoice_number(v_series.format, v_number_year, v_seq) <> v_number then
    raise exception 'El número % no sigue el formato de la serie (%)', v_number, v_series.format
      using errcode = 'P0001', hint = 'number_format_mismatch';
  end if;
  v_fiscal_year := case when v_series.reset_yearly then v_number_year::smallint else 0 end;

  if exists (select 1 from public.invoices i where i.issuer_id = v_issuer.id and i.number = v_number)
     or exists (
       select 1 from public.invoices i
       where i.series_id = v_series.id and i.fiscal_year = v_fiscal_year and i.sequence = v_seq
     ) then
    raise exception 'El número % ya existe en este emisor', v_number using errcode = 'P0001', hint = 'number_taken';
  end if;

  select * into v_client from public.clients where id = nullif(p ->> 'client_id', '')::uuid and org_id = v_org;
  if not found then
    raise exception 'Cliente no encontrado' using errcode = 'P0002', hint = 'client_not_found';
  end if;

  if v_kind = 'rectifying' then
    select i.id into v_rectifies from public.invoices i
    where i.issuer_id = v_issuer.id
      and i.number = nullif(btrim(p ->> 'rectifies_number'), '')
      and i.lifecycle = 'issued'
      and i.kind = 'ordinary'
      and i.client_id = v_client.id;
    if v_rectifies is null then
      raise exception 'La factura rectificada no existe o no es de este emisor y cliente'
        using errcode = 'P0001', hint = 'rectified_invalid';
    end if;
    if char_length(btrim(coalesce(p ->> 'rectification_reason', ''))) = 0 then
      raise exception 'Hay que indicar el motivo de la rectificación' using errcode = 'P0001', hint = 'rectification_reason_required';
    end if;
  end if;

  -- Cabecera = Σ líneas y total = base + IVA − IRPF (los importes de cada línea vienen de TS).
  if jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) = 0 then
    raise exception 'La factura no tiene líneas' using errcode = 'P0001', hint = 'no_lines';
  end if;
  select coalesce(sum((x ->> 'base_cents')::bigint), 0),
         coalesce(sum((x ->> 'vat_cents')::bigint), 0),
         coalesce(sum(coalesce((x ->> 'irpf_cents')::bigint, 0)), 0)
    into v_base, v_vat, v_irpf
  from jsonb_array_elements(v_lines) x;
  if (v_base, v_vat, v_irpf) is distinct from
       (nullif(v_totals ->> 'subtotal_cents', '')::bigint, nullif(v_totals ->> 'vat_cents', '')::bigint, nullif(v_totals ->> 'irpf_cents', '')::bigint)
     or nullif(v_totals ->> 'total_cents', '')::bigint is distinct from v_base + v_vat - v_irpf then
    raise exception 'Los totales no cuadran con las líneas (base + IVA − IRPF)' using errcode = 'P0001', hint = 'totals_mismatch';
  end if;

  -- Contador: como mínimo esta secuencia, nunca a la baja. Bloquear su fila antes de mirar el
  -- orden de fechas ordena esta importación con una emisión simultánea en la misma serie.
  insert into private.invoice_series_counters as c (series_id, year, last_number)
  values (v_series.id, v_fiscal_year, v_seq)
  on conflict (series_id, year) do update
    set last_number = greatest(c.last_number, excluded.last_number),
        updated_at = case when excluded.last_number > c.last_number then now() else c.updated_at end;

  -- Fechas no decrecientes frente a lo emitido desde GNERAI OS en la serie y el año (ver arriba).
  select * into v_conflict from public.invoices i
  where i.series_id = v_series.id
    and i.fiscal_year = v_fiscal_year
    and i.source = 'app'
    and i.lifecycle <> 'draft'
    and (i.sequence is null
         or (i.sequence < v_seq and i.issued_on > v_on)
         or (i.sequence > v_seq and i.issued_on < v_on))
  order by i.sequence nulls first, i.issued_on
  limit 1;
  if found then
    if v_conflict.sequence is null then
      raise exception 'Esta serie ya tiene facturas de GNERAI OS numeradas por un proveedor externo: no se importan históricos en ella'
        using errcode = 'P0001', hint = 'series_external_numbering';
    end if;
    raise exception 'La factura % (%) de GNERAI OS rompería el orden de fechas de la serie',
      v_conflict.number, to_char(v_conflict.issued_on, 'DD/MM/YYYY')
      using errcode = 'P0001', hint = 'series_order_conflict', detail = v_conflict.number;
  end if;

  select coalesce((o.settings ->> 'payment_terms_days')::integer, 30) into v_terms from public.orgs o where o.id = v_org;
  v_due := coalesce(nullif(p ->> 'due_on', '')::date, v_on + coalesce(v_client.payment_terms_days, v_terms));
  v_method := coalesce(nullif(p ->> 'payment_method', '')::public.payment_method, 'transfer');

  -- Entra como borrador para poder añadir las líneas (el trigger mantiene la cabecera = Σ líneas)
  -- y en la misma transacción pasa a emitida.
  insert into public.invoices (
    org_id, issuer_id, client_id, series_id, kind, rectifies_invoice_id, rectification_reason,
    lifecycle, number, sequence, fiscal_year, issued_on, operation_on, due_on, language, irpf_bps,
    payment_method, notes, fiscal_provider, source, external_id, issuer_snapshot, client_snapshot
  )
  values (
    v_org, v_issuer.id, v_client.id, v_series.id, v_kind, v_rectifies,
    case when v_kind = 'rectifying' then btrim(p ->> 'rectification_reason') end,
    'draft', v_number, v_seq, v_fiscal_year, v_on, nullif(p ->> 'operation_on', '')::date, v_due,
    coalesce(nullif(p ->> 'language', '')::public.app_locale, v_client.preferred_language),
    coalesce(nullif(p ->> 'irpf_bps', '')::integer, 0),
    v_method,
    nullif(btrim(p ->> 'notes'), ''),
    v_issuer.fiscal_provider,
    'import',
    v_external,
    jsonb_build_object(
      'kind', v_issuer.kind,
      'legal_name', v_issuer.legal_name,
      'trade_name', v_issuer.trade_name,
      'tax_id', v_issuer.tax_id,
      'address_line', v_issuer.address_line,
      'postal_code', v_issuer.postal_code,
      'city', v_issuer.city,
      'province', v_issuer.province,
      'country_code', v_issuer.country_code,
      'email', v_issuer.email,
      'phone', v_issuer.phone,
      'iban', v_issuer.iban,
      'registry_info', v_issuer.registry_info
    ),
    -- Los datos del cliente tal y como salían en la factura; lo que no venga, los de su ficha.
    jsonb_build_object(
      'legal_name', coalesce(nullif(btrim(v_party ->> 'legal_name'), ''), v_client.legal_name, v_client.display_name),
      'display_name', v_client.display_name,
      'tax_id', coalesce(nullif(btrim(v_party ->> 'tax_id'), ''), v_client.tax_id),
      'tax_id_kind', coalesce(nullif(v_party ->> 'tax_id_kind', ''), v_client.tax_id_kind::text),
      'address_line', coalesce(nullif(btrim(v_party ->> 'address_line'), ''), v_client.address_line),
      'postal_code', coalesce(nullif(btrim(v_party ->> 'postal_code'), ''), v_client.postal_code),
      'city', coalesce(nullif(btrim(v_party ->> 'city'), ''), v_client.city),
      'province', coalesce(nullif(btrim(v_party ->> 'province'), ''), v_client.province),
      'country_code', coalesce(nullif(btrim(v_party ->> 'country_code'), ''), v_client.country_code),
      'is_business', v_client.is_business
    )
  )
  returning id into v_id;

  insert into public.invoice_lines (
    org_id, invoice_id, position, description, quantity, unit_price_cents, discount_bps, base_cents,
    tax_rate_id, vat_bps, vat_regime, vat_cents, irpf_applies, irpf_cents, legal_note, billing_type,
    period_start, period_end
  )
  select
    v_org, v_id, coalesce(x.position, 0), btrim(x.description), x.quantity, x.unit_price_cents,
    coalesce(x.discount_bps, 0), x.base_cents, x.tax_rate_id, x.vat_bps, coalesce(x.vat_regime, 'general'),
    x.vat_cents, coalesce(x.irpf_applies, false), coalesce(x.irpf_cents, 0), nullif(btrim(x.legal_note), ''),
    x.billing_type, x.period_start, x.period_end
  from jsonb_to_recordset(v_lines) as x (
    position smallint, description text, quantity numeric, unit_price_cents bigint, discount_bps integer,
    base_cents bigint, tax_rate_id uuid, vat_bps integer, vat_regime public.vat_regime, vat_cents bigint,
    irpf_applies boolean, irpf_cents bigint, legal_note text, billing_type public.billing_type,
    period_start date, period_end date
  );

  update public.invoices set lifecycle = 'issued' where id = v_id;

  -- Cobro de una ordinaria (lo que el cliente pagó; por defecto, el total). Una factura a cero no se cobra.
  if v_payment is not null and v_kind = 'ordinary'
     and coalesce(nullif(v_payment ->> 'amount_cents', '')::bigint, v_base + v_vat - v_irpf) <> 0 then
    v_paid_on := coalesce(nullif(v_payment ->> 'paid_on', '')::date, v_due);
    if v_paid_on > v_today then
      raise exception 'Un cobro no puede llevar fecha futura' using errcode = 'P0001', hint = 'future_date';
    end if;
    insert into public.payments (org_id, invoice_id, amount_cents, paid_on, method, reference)
    values (
      v_org,
      v_id,
      coalesce(nullif(v_payment ->> 'amount_cents', '')::bigint, v_base + v_vat - v_irpf),
      v_paid_on,
      coalesce(nullif(v_payment ->> 'method', '')::public.payment_method, v_method),
      nullif(btrim(v_payment ->> 'reference'), '')
    );
  end if;

  return v_id;
end;
$$;

revoke all on function public.import_historical_invoice(jsonb) from public, anon;
grant execute on function public.import_historical_invoice(jsonb) to authenticated;

revoke all on all tables in schema public from anon;
