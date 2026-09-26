-- GNERAI OS · Hito 1.2 · Contratos y facturación
-- Contratos con líneas (puntual, mensual, anual y por uso), pausas, hitos y emisor por
-- fecha; pendiente de facturar; facturas con numeración sin huecos, inmutables al emitir,
-- rectificativas y cobros; emails por aprobar, avisos y ejecuciones del cron.
-- Ver ARCHITECTURE.md §6.3, §6.4 y §7.1-§7.10.
--
-- Reparto de responsabilidades:
-- - Los importes de cada línea (redondeo por línea) los calcula TS, una sola implementación
--   (src/domain/tax). Aquí solo se comprueban invariantes baratos: cabecera = Σ líneas y
--   total = base + IVA − IRPF.
-- - Lo que tiene que ser atómico vive aquí: guardar un borrador con sus líneas, aplicar una
--   ejecución del cron y, sobre todo, emitir (contador sin huecos en la misma transacción).

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.billing_type as enum ('one_off', 'monthly', 'yearly', 'usage');
create type public.invoice_grouping as enum ('client', 'contract');
create type public.payment_method as enum ('transfer', 'sepa_debit', 'card', 'cash', 'other');
create type public.billable_source as enum ('recurring', 'usage', 'milestone');
create type public.invoice_lifecycle as enum ('draft', 'issuing', 'issued');
create type public.invoice_source as enum ('app', 'import');
create type public.email_template as enum ('invoice', 'payment_reminder');
create type public.email_status as enum ('pending_approval', 'sent', 'failed', 'cancelled');
create type public.notification_kind as enum ('renewal', 'reminder_ready', 'job_failed', 'verifactu_deadline');
create type public.job_status as enum ('running', 'succeeded', 'failed');
-- Estados derivados: salen de las vistas y nunca se guardan.
create type public.invoice_status as enum ('draft', 'issuing', 'issued', 'overdue', 'paid', 'voided');
create type public.line_status as enum ('scheduled', 'active', 'paused', 'ended');
create type public.contract_status as enum ('draft', 'scheduled', 'active', 'paused', 'ended');
create type public.billable_state as enum ('pending', 'drafted', 'invoiced', 'waived');

-- Un contrato o una factura con deal/contrato tiene que ser del mismo cliente.
alter table public.deals add constraint deals_org_id_id_client_id_key unique (org_id, id, client_id);

-- ---------------------------------------------------------------------------
-- Contratos
-- ---------------------------------------------------------------------------
create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  client_id uuid not null,
  deal_id uuid,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  -- Solo se factura un contrato firmado.
  signed_on date,
  -- Vacío: el del cliente o, si tampoco lo tiene, el de la org.
  payment_terms_days smallint check (payment_terms_days is null or payment_terms_days between 0 and 365),
  payment_method public.payment_method not null default 'transfer',
  invoice_grouping public.invoice_grouping not null default 'client',
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  unique (org_id, id, client_id),
  foreign key (org_id, client_id) references public.clients (org_id, id),
  foreign key (org_id, deal_id, client_id) references public.deals (org_id, id, client_id)
);
create index contracts_client_idx on public.contracts (client_id);
create index contracts_deal_idx on public.contracts (deal_id) where deal_id is not null;

create table public.issuer_transfers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  from_issuer_id uuid not null,
  to_issuer_id uuid not null,
  effective_on date not null,
  executed_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  foreign key (org_id, from_issuer_id) references public.issuers (org_id, id),
  foreign key (org_id, to_issuer_id) references public.issuers (org_id, id),
  check (from_issuer_id <> to_issuer_id)
);

-- Qué emisor factura el contrato en cada fecha. El traspaso a la SL inserta filas.
create table public.contract_issuers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  contract_id uuid not null,
  issuer_id uuid not null,
  -- La primera fila cubre también lo anterior a su fecha.
  valid_from date not null,
  transfer_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  unique (contract_id, valid_from),
  foreign key (org_id, contract_id) references public.contracts (org_id, id),
  foreign key (org_id, issuer_id) references public.issuers (org_id, id),
  foreign key (org_id, transfer_id) references public.issuer_transfers (org_id, id)
);

-- Condiciones económicas con vigencia. Una vez facturadas no se editan: un cambio de
-- precio cierra la línea y abre otra desde una fecha (replaces_line_id).
create table public.contract_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  contract_id uuid not null,
  position smallint not null default 0,
  description text not null check (char_length(btrim(description)) between 1 and 500),
  billing_type public.billing_type not null,
  quantity numeric(12, 3) not null default 1 check (quantity > 0),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  discount_bps integer not null default 0 check (discount_bps between 0 and 10000),
  tax_rate_id uuid not null,
  irpf_applies boolean not null default true,
  starts_on date,
  ends_on date,
  billing_day smallint check (billing_day between 1 and 31),
  prorate_first boolean not null default true,
  cancelled_on date,
  cancel_reason text,
  replaces_line_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  foreign key (org_id, contract_id) references public.contracts (org_id, id),
  foreign key (org_id, tax_rate_id) references public.tax_rates (org_id, id),
  foreign key (org_id, replaces_line_id) references public.contract_lines (org_id, id),
  check (billing_type not in ('monthly', 'yearly') or starts_on is not null),
  check ((billing_type = 'monthly') = (billing_day is not null)),
  check (ends_on is null or starts_on is null or ends_on >= starts_on),
  -- Dar de baja es fijar el fin: cancelled_on es cuándo se decidió.
  check (cancelled_on is null or ends_on is not null),
  check (cancel_reason is null or cancelled_on is not null)
);
create index contract_lines_contract_idx on public.contract_lines (contract_id, position);

create table public.contract_line_pauses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  line_id uuid not null,
  starts_on date not null,
  ends_on date,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  foreign key (org_id, line_id) references public.contract_lines (org_id, id) on delete cascade,
  check (ends_on is null or ends_on >= starts_on)
);
create index contract_line_pauses_line_idx on public.contract_line_pauses (line_id);

-- Hitos de los one-off (50/50, 40/30/30…). El último factura el resto, para cuadrar al céntimo.
create table public.contract_milestones (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  contract_id uuid not null,
  position smallint not null,
  label text not null check (char_length(btrim(label)) between 1 and 120),
  percent_bps integer not null check (percent_bps between 1 and 10000),
  planned_on date,
  -- Con fecha y auto, el cron lo prepara ese día.
  auto boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  constraint contract_milestones_position_key unique (contract_id, position) deferrable initially deferred,
  foreign key (org_id, contract_id) references public.contracts (org_id, id),
  check (not auto or planned_on is not null)
);

-- ---------------------------------------------------------------------------
-- Facturas
-- ---------------------------------------------------------------------------
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  issuer_id uuid not null,
  client_id uuid not null,
  -- Solo cuando el contrato agrupa sus propias facturas.
  contract_id uuid,
  series_id uuid,
  kind public.series_kind not null default 'ordinary',
  rectifies_invoice_id uuid,
  rectification_reason text,
  -- Solo se guarda el ciclo de vida: emitida, vencida, cobrada y anulada se derivan.
  lifecycle public.invoice_lifecycle not null default 'draft',
  number text,
  sequence integer check (sequence is null or sequence > 0),
  fiscal_year smallint,
  -- En borrador puede ir vacía: se emite con la fecha de ese día.
  issued_on date,
  operation_on date,
  due_on date,
  payment_terms_days smallint check (payment_terms_days is null or payment_terms_days between 0 and 365),
  language public.app_locale not null default 'es',
  -- Tipo de IRPF de la factura: las líneas sujetas lo aplican.
  irpf_bps integer not null default 0 check (irpf_bps between 0 and 10000),
  payment_method public.payment_method not null default 'transfer',
  notes text,
  -- Copia congelada al emitir: la dirección del cliente puede cambiar, la factura no.
  issuer_snapshot jsonb,
  client_snapshot jsonb,
  -- Suma de las líneas, mantenida por trigger mientras es borrador.
  subtotal_cents bigint not null default 0,
  vat_cents bigint not null default 0,
  irpf_cents bigint not null default 0,
  total_cents bigint not null default 0,
  fiscal_provider public.fiscal_provider not null default 'internal',
  provider_ref text,
  provider_payload jsonb,
  pdf_path text,
  source public.invoice_source not null default 'app',
  external_id text,
  -- Grupo del cron ('client' o 'contract:<id>'): un solo borrador automático abierto por grupo.
  grouping_key text,
  issuing_started_at timestamptz,
  issued_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  foreign key (org_id, issuer_id) references public.issuers (org_id, id),
  foreign key (org_id, client_id) references public.clients (org_id, id),
  foreign key (org_id, contract_id, client_id) references public.contracts (org_id, id, client_id),
  foreign key (org_id, series_id) references public.invoice_series (org_id, id),
  foreign key (org_id, rectifies_invoice_id) references public.invoices (org_id, id),
  check ((kind = 'rectifying') = (rectifies_invoice_id is not null)),
  check (kind = 'ordinary' or char_length(btrim(coalesce(rectification_reason, ''))) > 0),
  check (lifecycle <> 'draft' or source = 'import' or (number is null and sequence is null)),
  check (lifecycle = 'draft' or (issued_on is not null and series_id is not null
                                 and issuer_snapshot is not null and client_snapshot is not null)),
  check (lifecycle <> 'issued' or (number is not null and (pdf_path is not null or source = 'import'))),
  check (total_cents = subtotal_cents + vat_cents - irpf_cents)
);
-- El número es único por emisor, lo asigne quien lo asigne.
create unique index invoices_issuer_number_idx on public.invoices (issuer_id, number) where number is not null;
create unique index invoices_series_sequence_idx on public.invoices (series_id, fiscal_year, sequence) where sequence is not null;
create unique index invoices_open_group_idx
  on public.invoices (org_id, issuer_id, client_id, grouping_key) where lifecycle = 'draft' and grouping_key is not null;
create unique index invoices_open_rectification_idx
  on public.invoices (rectifies_invoice_id) where lifecycle = 'draft' and rectifies_invoice_id is not null;
create unique index invoices_external_id_idx on public.invoices (org_id, external_id) where external_id is not null;
create index invoices_org_issued_idx on public.invoices (org_id, issued_on desc);
create index invoices_client_idx on public.invoices (client_id);
create index invoices_rectifies_idx on public.invoices (rectifies_invoice_id) where rectifies_invoice_id is not null;

-- Cada línea guarda sus importes ya redondeados: el redondeo por línea convertido en dato.
create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  invoice_id uuid not null,
  position smallint not null default 0,
  description text not null check (char_length(btrim(description)) between 1 and 500),
  quantity numeric(12, 3) not null check (quantity > 0),
  -- Negativo en las rectificativas.
  unit_price_cents bigint not null,
  discount_bps integer not null default 0 check (discount_bps between 0 and 10000),
  base_cents bigint not null,
  tax_rate_id uuid,
  vat_bps integer not null check (vat_bps between 0 and 10000),
  vat_regime public.vat_regime not null default 'general',
  vat_cents bigint not null,
  irpf_applies boolean not null default false,
  irpf_cents bigint not null default 0,
  -- Mención legal del régimen, congelada con la línea.
  legal_note text,
  billing_type public.billing_type not null,
  period_start date,
  period_end date,
  contract_line_id uuid,
  rectifies_line_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  foreign key (org_id, invoice_id) references public.invoices (org_id, id) on delete cascade,
  foreign key (org_id, tax_rate_id) references public.tax_rates (org_id, id),
  foreign key (org_id, contract_line_id) references public.contract_lines (org_id, id),
  foreign key (org_id, rectifies_line_id) references public.invoice_lines (org_id, id),
  check (vat_regime = 'general' or vat_bps = 0),
  check ((period_start is null) = (period_end is null)),
  check (period_end is null or period_end >= period_start),
  check (irpf_applies or irpf_cents = 0)
);
create index invoice_lines_invoice_idx on public.invoice_lines (invoice_id, position);
create index invoice_lines_contract_line_idx on public.invoice_lines (contract_line_id) where contract_line_id is not null;

-- Pendiente de facturar. Estado: facturado si tiene línea, condonado si tiene waived_at,
-- pendiente si no. Los periodos recurrentes son únicos por línea: el cron es idempotente.
create table public.billable_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  contract_line_id uuid not null,
  source public.billable_source not null,
  period_start date,
  period_end date,
  milestone_id uuid,
  description text not null check (char_length(btrim(description)) between 1 and 500),
  quantity numeric(12, 3) not null check (quantity > 0),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  discount_bps integer not null default 0 check (discount_bps between 0 and 10000),
  -- Base imponible ya calculada en TS.
  amount_cents bigint not null check (amount_cents >= 0),
  billable_on date not null,
  invoice_line_id uuid,
  waived_at timestamptz,
  waive_reason text,
  waived_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  unique (contract_line_id, period_start),
  unique (contract_line_id, milestone_id),
  unique (invoice_line_id),
  foreign key (org_id, contract_line_id) references public.contract_lines (org_id, id),
  foreign key (org_id, milestone_id) references public.contract_milestones (org_id, id),
  -- Borrar un borrador (o una de sus líneas) devuelve el item a pendiente.
  foreign key (org_id, invoice_line_id) references public.invoice_lines (org_id, id) on delete set null (invoice_line_id),
  check ((source = 'recurring') = (period_start is not null)),
  check ((period_start is null) = (period_end is null)),
  check (period_end is null or period_end >= period_start),
  check ((source = 'milestone') = (milestone_id is not null)),
  check (invoice_line_id is null or waived_at is null)
);
create index billable_items_pending_idx
  on public.billable_items (org_id, billable_on) where invoice_line_id is null and waived_at is null;

-- Fuente única de "cobrada", fecha y método. Admite cobros parciales y devoluciones (negativos).
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  invoice_id uuid not null,
  amount_cents bigint not null check (amount_cents <> 0),
  paid_on date not null,
  method public.payment_method not null default 'transfer',
  reference text,
  provider_ref text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  foreign key (org_id, invoice_id) references public.invoices (org_id, id)
);
create index payments_invoice_idx on public.payments (invoice_id);

-- ---------------------------------------------------------------------------
-- Emails, avisos y ejecuciones del cron
-- ---------------------------------------------------------------------------
-- Los recordatorios nacen en pending_approval: los envía un socio al confirmar.
create table public.outbound_emails (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  invoice_id uuid,
  client_id uuid,
  template public.email_template not null,
  language public.app_locale not null default 'es',
  to_emails text[] not null default '{}' check (cardinality(to_emails) <= 10),
  subject text not null,
  body text not null,
  attach_pdf boolean not null default true,
  status public.email_status not null default 'pending_approval',
  dedupe_key text,
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  unique (org_id, dedupe_key),
  foreign key (org_id, invoice_id) references public.invoices (org_id, id),
  foreign key (org_id, client_id) references public.clients (org_id, id),
  check (status <> 'sent' or (cardinality(to_emails) >= 1 and sent_at is not null))
);
create index outbound_emails_status_idx on public.outbound_emails (org_id, status, created_at desc);

-- Avisos in-app. El texto sale de i18n con `kind` + `params`; dedupe_key evita duplicados.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  -- Vacío: para todos los miembros.
  member_id uuid,
  kind public.notification_kind not null,
  params jsonb not null default '{}'::jsonb,
  -- Ruta dentro de la org, p. ej. /contracts/<id>.
  href text,
  due_on date,
  read_at timestamptz,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  unique (org_id, dedupe_key),
  foreign key (org_id, member_id) references public.members (org_id, id)
);
create index notifications_org_idx on public.notifications (org_id, created_at desc);

create table public.job_runs (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs (id) on delete cascade,
  job text not null check (job ~ '^[a-z_]{1,40}$'),
  run_on date not null,
  status public.job_status not null default 'running',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  summary jsonb,
  error text
);
create index job_runs_org_idx on public.job_runs (org_id, job, started_at desc);
-- Una sola ejecución en curso por org y trabajo.
create unique index job_runs_one_running_idx on public.job_runs (org_id, job) where status = 'running';

-- ---------------------------------------------------------------------------
-- Funciones auxiliares
-- ---------------------------------------------------------------------------
-- "Hoy" en la zona horaria de la org.
create function private.org_today(p_org uuid) returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone o.timezone)::date from public.orgs o where o.id = p_org
$$;

-- Gemela SQL de formatInvoiceNumber (src/domain/invoicing): un test comprueba la paridad.
create function private.format_invoice_number(p_format text, p_year integer, p_sequence integer) returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_result text := replace(replace(p_format, '{yyyy}', p_year::text), '{yy}', right(p_year::text, 2));
  v_digits text := p_sequence::text;
  v_match text[];
begin
  loop
    v_match := regexp_match(v_result, '\{n(?::([1-9]))?\}');
    exit when v_match is null;
    v_result := regexp_replace(
      v_result,
      '\{n(?::([1-9]))?\}',
      lpad(v_digits, greatest(coalesce(v_match[1]::integer, 0), length(v_digits)), '0')
    );
  end loop;
  return v_result;
end;
$$;

-- Emisor vigente de un contrato en una fecha: la fila con el mayor valid_from que no la
-- supere; si la fecha es anterior a todas, la primera. Misma regla que issuerOn() en TS.
create function private.contract_issuer_on(p_contract uuid, p_date date) returns uuid
language sql
stable
set search_path = ''
as $$
  select ci.issuer_id
  from public.contract_issuers ci
  where ci.contract_id = p_contract
  order by (ci.valid_from <= p_date) desc,
           case when ci.valid_from <= p_date then ci.valid_from end desc nulls last,
           ci.valid_from
  limit 1
$$;

-- Estado de una línea en una fecha. Para las recurrentes es la gemela de isLineActiveOn()
-- (src/domain/billing): activa si la fecha cae entre inicio y fin y fuera de toda pausa.
create function private.line_status_on(p_line public.contract_lines, p_date date) returns public.line_status
language sql
stable
set search_path = ''
as $$
  select case
    when p_line.starts_on is not null and p_line.starts_on > p_date then 'scheduled'
    when p_line.ends_on is not null and p_line.ends_on < p_date then 'ended'
    -- Un one-off termina cuando todos los hitos del contrato lo han facturado.
    when p_line.billing_type = 'one_off' then
      case
        when exists (select 1 from public.contract_milestones m where m.contract_id = p_line.contract_id)
         and not exists (
           select 1 from public.contract_milestones m
           where m.contract_id = p_line.contract_id
             and not exists (
               select 1 from public.billable_items b where b.milestone_id = m.id and b.contract_line_id = p_line.id
             )
         )
        then 'ended'
        else 'active'
      end
    when p_line.billing_type in ('monthly', 'yearly') and exists (
      select 1 from public.contract_line_pauses p
      where p.line_id = p_line.id and p.starts_on <= p_date and (p.ends_on is null or p.ends_on >= p_date)
    ) then 'paused'
    else 'active'
  end::public.line_status
$$;

-- Anulada: el neto (original + rectificativas emitidas) es 0.
create function private.invoice_is_voided(p_invoice uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select i.total_cents + coalesce((
      select sum(r.total_cents) from public.invoices r
      where r.rectifies_invoice_id = i.id and r.lifecycle = 'issued'
    ), 0) = 0
    from public.invoices i
    where i.id = p_invoice and i.lifecycle = 'issued'
  ), false)
$$;

-- Saca de los borradores los periodos recurrentes de una línea y borra sus pendientes, para
-- que el cron los regenere con las condiciones, pausas y fechas actuales. Nunca toca nada emitido.
create function private.release_line_from_drafts(p_line uuid) returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.invoice_lines il
  using public.billable_items b, public.invoices i
  where b.contract_line_id = p_line
    and b.source = 'recurring'
    and il.id = b.invoice_line_id
    and i.id = il.invoice_id
    and i.lifecycle = 'draft';
  delete from public.billable_items b
  where b.contract_line_id = p_line
    and b.source = 'recurring'
    and b.invoice_line_id is null
    and b.waived_at is null;
$$;

-- ---------------------------------------------------------------------------
-- Guardas de contratos
-- ---------------------------------------------------------------------------
create function private.contracts_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.signed_on is null and old.signed_on is not null and exists (
    select 1 from public.billable_items b
    join public.contract_lines l on l.id = b.contract_line_id
    where l.contract_id = old.id
  ) then
    raise exception 'Este contrato ya ha generado facturación: no se puede quitar la firma'
      using errcode = 'P0001', hint = 'contract_billed';
  end if;
  return new;
end;
$$;

create trigger contracts_guard before update on public.contracts
  for each row execute function private.contracts_guard();

create function private.contract_lines_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.tax_rates t where t.id = new.tax_rate_id and t.kind = 'vat') then
    raise exception 'El impuesto de una línea tiene que ser un tipo de IVA'
      using errcode = 'P0001', hint = 'vat_rate_required';
  end if;

  if tg_op = 'INSERT' then
    if new.billing_type = 'one_off' and exists (
      select 1 from public.billable_items b
      join public.contract_milestones m on m.id = b.milestone_id
      where m.contract_id = new.contract_id
    ) then
      raise exception 'Este contrato ya ha empezado a facturar sus hitos: el trabajo nuevo va en otro contrato'
        using errcode = 'P0001', hint = 'milestones_started';
    end if;
    return new;
  end if;

  if new.contract_id <> old.contract_id then
    raise exception 'Una línea no cambia de contrato' using errcode = 'P0001', hint = 'line_contract_fixed';
  end if;

  if (new.billing_type, new.quantity, new.unit_price_cents, new.discount_bps, new.tax_rate_id,
      new.irpf_applies, new.starts_on, new.billing_day, new.prorate_first)
     is distinct from
     (old.billing_type, old.quantity, old.unit_price_cents, old.discount_bps, old.tax_rate_id,
      old.irpf_applies, old.starts_on, old.billing_day, old.prorate_first)
     and exists (
       select 1 from public.billable_items b
       join public.invoice_lines il on il.id = b.invoice_line_id
       join public.invoices i on i.id = il.invoice_id
       where b.contract_line_id = old.id and i.lifecycle <> 'draft'
     ) then
    raise exception 'La línea ya se ha facturado: para cambiar sus condiciones, crea una versión nueva desde una fecha'
      using errcode = 'P0001', hint = 'line_billed';
  end if;
  return new;
end;
$$;

create trigger contract_lines_guard before insert or update on public.contract_lines
  for each row execute function private.contract_lines_guard();

-- Cambiar condiciones, fechas o pausas saca esos periodos de los borradores: el cron los rehace.
create function private.contract_lines_after_change() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.billing_type, new.quantity, new.unit_price_cents, new.discount_bps, new.tax_rate_id,
      new.irpf_applies, new.starts_on, new.ends_on, new.billing_day, new.prorate_first)
     is distinct from
     (old.billing_type, old.quantity, old.unit_price_cents, old.discount_bps, old.tax_rate_id,
      old.irpf_applies, old.starts_on, old.ends_on, old.billing_day, old.prorate_first) then
    perform private.release_line_from_drafts(new.id);
  end if;
  return null;
end;
$$;

create trigger contract_lines_after_change after update on public.contract_lines
  for each row execute function private.contract_lines_after_change();

create function private.contract_line_pauses_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.contract_lines l where l.id = new.line_id and l.billing_type in ('monthly', 'yearly')
  ) then
    raise exception 'Solo se pausan las líneas mensuales o anuales' using errcode = 'P0001', hint = 'pause_recurring_only';
  end if;
  return new;
end;
$$;

create trigger contract_line_pauses_guard before insert or update on public.contract_line_pauses
  for each row execute function private.contract_line_pauses_guard();

create function private.contract_line_pauses_after_change() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.release_line_from_drafts(coalesce(new.line_id, old.line_id));
  if tg_op = 'UPDATE' and new.line_id <> old.line_id then
    perform private.release_line_from_drafts(old.line_id);
  end if;
  return null;
end;
$$;

create trigger contract_line_pauses_after_change after insert or update or delete on public.contract_line_pauses
  for each row execute function private.contract_line_pauses_after_change();

-- Un hito ya facturado conserva su porcentaje y su orden (el último factura el resto).
create function private.contract_milestones_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.contract_id, new.position, new.percent_bps) is distinct from (old.contract_id, old.position, old.percent_bps)
     and exists (select 1 from public.billable_items b where b.milestone_id = old.id) then
    raise exception 'Este hito ya se ha facturado: no se puede cambiar su porcentaje ni su orden'
      using errcode = 'P0001', hint = 'milestone_billed';
  end if;
  return new;
end;
$$;

create trigger contract_milestones_guard before update on public.contract_milestones
  for each row execute function private.contract_milestones_guard();

-- Diferido: se comprueba al confirmar, así que se pueden reescribir todos los hitos a la vez.
create function private.ensure_milestones_total() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_contract uuid := coalesce(new.contract_id, old.contract_id);
  v_total bigint;
begin
  select sum(m.percent_bps) into v_total from public.contract_milestones m where m.contract_id = v_contract;
  if v_total is not null and v_total <> 10000 then
    raise exception 'Los hitos de un contrato tienen que sumar el 100 %%' using errcode = 'P0001', hint = 'milestones_total';
  end if;
  return null;
end;
$$;

create constraint trigger contract_milestones_total
  after insert or update or delete on public.contract_milestones
  deferrable initially deferred
  for each row execute function private.ensure_milestones_total();

-- ---------------------------------------------------------------------------
-- Guardas de facturas: inmutables al emitir, también para service_role
-- ---------------------------------------------------------------------------
create function private.invoices_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_mutable_while_issuing constant text[] := array[
    'lifecycle', 'number', 'pdf_path', 'provider_ref', 'provider_payload', 'issued_at', 'updated_at'
  ];
begin
  if tg_op = 'DELETE' then
    if old.lifecycle <> 'draft' then
      raise exception 'Una factura emitida no se borra: se anula con una rectificativa'
        using errcode = 'P0001', hint = 'invoice_immutable';
    end if;
    return old;
  end if;

  if old.lifecycle = 'issued' then
    raise exception 'Una factura emitida no se modifica: se corrige con una rectificativa'
      using errcode = 'P0001', hint = 'invoice_immutable';
  end if;

  if old.lifecycle = 'issuing' then
    -- Solo se completa lo que aportan el proveedor y el PDF; el número, si ya lo tenía, no cambia.
    if new.lifecycle = 'draft'
       or (to_jsonb(new) - v_mutable_while_issuing) <> (to_jsonb(old) - v_mutable_while_issuing)
       or (old.number is not null and new.number is distinct from old.number) then
      raise exception 'Una factura en emisión solo se puede completar'
        using errcode = 'P0001', hint = 'invoice_immutable';
    end if;
    return new;
  end if;

  -- Borrador: pasa por «emitiendo» (salvo los históricos importados, que llegan ya emitidos).
  if new.lifecycle = 'issued' and new.source <> 'import' then
    raise exception 'Una factura pasa por «emitiendo» antes de quedar emitida'
      using errcode = 'P0001', hint = 'invoice_lifecycle';
  end if;
  return new;
end;
$$;

create trigger invoices_guard before update or delete on public.invoices
  for each row execute function private.invoices_guard();

create function private.invoice_lines_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lifecycle public.invoice_lifecycle;
begin
  if tg_op = 'UPDATE' and new.invoice_id <> old.invoice_id then
    raise exception 'Una línea no cambia de factura' using errcode = 'P0001', hint = 'invoice_immutable';
  end if;
  select i.lifecycle into v_lifecycle from public.invoices i where i.id = coalesce(new.invoice_id, old.invoice_id);
  -- Sin factura: se está borrando un borrador entero (cascada).
  if v_lifecycle is null or v_lifecycle = 'draft' then
    return coalesce(new, old);
  end if;
  raise exception 'Las líneas de una factura emitida no se modifican'
    using errcode = 'P0001', hint = 'invoice_immutable';
end;
$$;

create trigger invoice_lines_guard before insert or update or delete on public.invoice_lines
  for each row execute function private.invoice_lines_guard();

-- La cabecera de un borrador es siempre la suma de sus líneas (una vez por sentencia).
create function private.refresh_invoice_totals() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  if tg_op = 'INSERT' then
    select array_agg(distinct n.invoice_id) into v_ids from new_rows n;
  elsif tg_op = 'DELETE' then
    select array_agg(distinct o.invoice_id) into v_ids from old_rows o;
  else
    select array_agg(distinct x.invoice_id) into v_ids
    from (select n.invoice_id from new_rows n union select o.invoice_id from old_rows o) x;
  end if;

  update public.invoices i
     set subtotal_cents = t.base,
         vat_cents = t.vat,
         irpf_cents = t.irpf,
         total_cents = t.base + t.vat - t.irpf
    from (
      select ids.id,
             coalesce(sum(l.base_cents), 0) as base,
             coalesce(sum(l.vat_cents), 0) as vat,
             coalesce(sum(l.irpf_cents), 0) as irpf
      from unnest(v_ids) as ids (id)
      left join public.invoice_lines l on l.invoice_id = ids.id
      group by ids.id
    ) t
   where i.id = t.id
     and i.lifecycle = 'draft'
     and (i.subtotal_cents, i.vat_cents, i.irpf_cents) is distinct from (t.base, t.vat, t.irpf);
  return null;
end;
$$;

create trigger invoice_lines_totals_insert after insert on public.invoice_lines
  referencing new table as new_rows
  for each statement execute function private.refresh_invoice_totals();
create trigger invoice_lines_totals_update after update on public.invoice_lines
  referencing old table as old_rows new table as new_rows
  for each statement execute function private.refresh_invoice_totals();
create trigger invoice_lines_totals_delete after delete on public.invoice_lines
  referencing old table as old_rows
  for each statement execute function private.refresh_invoice_totals();

create function private.payments_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.invoice_id <> old.invoice_id then
    raise exception 'Un cobro no cambia de factura' using errcode = 'P0001', hint = 'payment_invoice_fixed';
  end if;
  if not exists (select 1 from public.invoices i where i.id = new.invoice_id and i.lifecycle = 'issued') then
    raise exception 'Solo se registran cobros de facturas emitidas' using errcode = 'P0001', hint = 'payment_not_issued';
  end if;
  return new;
end;
$$;

create trigger payments_guard before insert or update on public.payments
  for each row execute function private.payments_guard();

-- Lo que ya está en una factura emitida no se toca, salvo para volver a facturarlo o
-- condonarlo cuando esa factura se ha anulado. Condonar lo firma quien lo hace.
create function private.billable_items_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lifecycle public.invoice_lifecycle;
  v_invoice uuid;
begin
  if old.invoice_line_id is not null
     and (new.contract_line_id, new.source, new.period_start, new.period_end, new.milestone_id,
          new.quantity, new.unit_price_cents, new.discount_bps, new.amount_cents)
         is distinct from
         (old.contract_line_id, old.source, old.period_start, old.period_end, old.milestone_id,
          old.quantity, old.unit_price_cents, old.discount_bps, old.amount_cents) then
    raise exception 'Este concepto ya está facturado' using errcode = 'P0001', hint = 'item_invoiced';
  end if;

  if old.invoice_line_id is not null and new.invoice_line_id is distinct from old.invoice_line_id then
    select i.lifecycle, i.id into v_lifecycle, v_invoice
    from public.invoice_lines l
    join public.invoices i on i.id = l.invoice_id
    where l.id = old.invoice_line_id;
    if v_lifecycle is not null and v_lifecycle <> 'draft' and not private.invoice_is_voided(v_invoice) then
      raise exception 'Este concepto ya está en una factura emitida' using errcode = 'P0001', hint = 'item_invoiced';
    end if;
  end if;

  if new.waived_at is distinct from old.waived_at then
    new.waived_by := case when new.waived_at is not null then auth.uid() end;
    if new.waived_at is null then
      new.waive_reason := null;
    end if;
  end if;
  return new;
end;
$$;

create trigger billable_items_guard before update on public.billable_items
  for each row execute function private.billable_items_guard();

-- ---------------------------------------------------------------------------
-- Triggers comunes
-- ---------------------------------------------------------------------------
create trigger set_updated_at before update on public.contracts for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.issuer_transfers for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.contract_issuers for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.contract_lines for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.contract_line_pauses for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.contract_milestones for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.invoices for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.invoice_lines for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.billable_items for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.payments for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.outbound_emails for each row execute function private.set_updated_at();

-- Auditoría de lo que decide una persona. Las líneas de factura y los pendientes se
-- reconstruyen desde la cabecera y el motor, así que no llenan el log.
create trigger audit after insert or update or delete on public.contracts for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.issuer_transfers for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.contract_issuers for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.contract_lines for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.contract_line_pauses for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.contract_milestones for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.invoices for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.payments for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.outbound_emails for each row execute function private.audit_row();

-- ---------------------------------------------------------------------------
-- RLS y privilegios
-- ---------------------------------------------------------------------------
alter table public.contracts enable row level security;
alter table public.issuer_transfers enable row level security;
alter table public.contract_issuers enable row level security;
alter table public.contract_lines enable row level security;
alter table public.contract_line_pauses enable row level security;
alter table public.contract_milestones enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_lines enable row level security;
alter table public.billable_items enable row level security;
alter table public.payments enable row level security;
alter table public.outbound_emails enable row level security;
alter table public.notifications enable row level security;
alter table public.job_runs enable row level security;

-- Contratos: los ve cualquier miembro y los lleva un socio. Se archivan, no se borran.
create policy contracts_select on public.contracts for select to authenticated using (private.has_role(org_id, 'viewer'));
create policy contracts_insert on public.contracts for insert to authenticated with check (private.has_role(org_id, 'partner'));
create policy contracts_update on public.contracts for update to authenticated using (private.has_role(org_id, 'partner')) with check (private.has_role(org_id, 'partner'));

create policy contract_issuers_select on public.contract_issuers for select to authenticated using (private.has_role(org_id, 'viewer'));
create policy contract_issuers_insert on public.contract_issuers for insert to authenticated with check (private.has_role(org_id, 'partner'));
create policy contract_issuers_update on public.contract_issuers for update to authenticated using (private.has_role(org_id, 'partner')) with check (private.has_role(org_id, 'partner'));
create policy contract_issuers_delete on public.contract_issuers for delete to authenticated using (private.has_role(org_id, 'partner'));

-- Un traspaso de emisor es configuración fiscal: lo hace un owner.
create policy issuer_transfers_select on public.issuer_transfers for select to authenticated using (private.has_role(org_id, 'viewer'));
create policy issuer_transfers_insert on public.issuer_transfers for insert to authenticated with check (private.has_role(org_id, 'owner'));
create policy issuer_transfers_update on public.issuer_transfers for update to authenticated using (private.has_role(org_id, 'owner')) with check (private.has_role(org_id, 'owner'));

-- Una línea sin nada facturado se puede borrar (la FK de billable_items lo impide si lo hay).
create policy contract_lines_select on public.contract_lines for select to authenticated using (private.has_role(org_id, 'viewer'));
create policy contract_lines_insert on public.contract_lines for insert to authenticated with check (private.has_role(org_id, 'partner'));
create policy contract_lines_update on public.contract_lines for update to authenticated using (private.has_role(org_id, 'partner')) with check (private.has_role(org_id, 'partner'));
create policy contract_lines_delete on public.contract_lines for delete to authenticated using (private.has_role(org_id, 'partner'));

create policy contract_line_pauses_select on public.contract_line_pauses for select to authenticated using (private.has_role(org_id, 'viewer'));
create policy contract_line_pauses_insert on public.contract_line_pauses for insert to authenticated with check (private.has_role(org_id, 'partner'));
create policy contract_line_pauses_update on public.contract_line_pauses for update to authenticated using (private.has_role(org_id, 'partner')) with check (private.has_role(org_id, 'partner'));
create policy contract_line_pauses_delete on public.contract_line_pauses for delete to authenticated using (private.has_role(org_id, 'partner'));

create policy contract_milestones_select on public.contract_milestones for select to authenticated using (private.has_role(org_id, 'viewer'));
create policy contract_milestones_insert on public.contract_milestones for insert to authenticated with check (private.has_role(org_id, 'partner'));
create policy contract_milestones_update on public.contract_milestones for update to authenticated using (private.has_role(org_id, 'partner')) with check (private.has_role(org_id, 'partner'));
create policy contract_milestones_delete on public.contract_milestones for delete to authenticated using (private.has_role(org_id, 'partner'));

-- Facturas: se leen con RLS; se escriben solo con las RPC (borrador, emisión, rectificativa).
-- Un socio puede borrar un borrador; el trigger impide borrar lo emitido.
create policy invoices_select on public.invoices for select to authenticated using (private.has_role(org_id, 'viewer'));
create policy invoices_delete on public.invoices for delete to authenticated using (private.has_role(org_id, 'partner') and lifecycle = 'draft');
create policy invoice_lines_select on public.invoice_lines for select to authenticated using (private.has_role(org_id, 'viewer'));
revoke insert, update on public.invoices, public.invoice_lines from authenticated;
revoke delete on public.invoice_lines from authenticated;

-- Pendiente: un socio registra usos, los borra mientras están pendientes y los condona.
create policy billable_items_select on public.billable_items for select to authenticated using (private.has_role(org_id, 'viewer'));
create policy billable_items_insert on public.billable_items for insert to authenticated
  with check (private.has_role(org_id, 'partner') and source = 'usage' and invoice_line_id is null and waived_at is null);
create policy billable_items_update on public.billable_items for update to authenticated
  using (private.has_role(org_id, 'partner')) with check (private.has_role(org_id, 'partner'));
create policy billable_items_delete on public.billable_items for delete to authenticated
  using (private.has_role(org_id, 'partner') and invoice_line_id is null);
revoke update on public.billable_items from authenticated;
grant update (waived_at, waive_reason) on public.billable_items to authenticated;

create policy payments_select on public.payments for select to authenticated using (private.has_role(org_id, 'viewer'));
create policy payments_insert on public.payments for insert to authenticated with check (private.has_role(org_id, 'partner'));
create policy payments_update on public.payments for update to authenticated using (private.has_role(org_id, 'partner')) with check (private.has_role(org_id, 'partner'));
create policy payments_delete on public.payments for delete to authenticated using (private.has_role(org_id, 'partner'));

create policy outbound_emails_select on public.outbound_emails for select to authenticated using (private.has_role(org_id, 'viewer'));
create policy outbound_emails_insert on public.outbound_emails for insert to authenticated with check (private.has_role(org_id, 'partner'));
create policy outbound_emails_update on public.outbound_emails for update to authenticated using (private.has_role(org_id, 'partner')) with check (private.has_role(org_id, 'partner'));

-- Avisos: los de todos y los propios. Lo único que cambia un miembro es marcarlos leídos.
create policy notifications_select on public.notifications for select to authenticated
  using (private.has_role(org_id, 'viewer') and (member_id is null or exists (
    select 1 from public.members m where m.id = member_id and m.user_id = (select auth.uid())
  )));
create policy notifications_update on public.notifications for update to authenticated
  using (private.has_role(org_id, 'viewer') and (member_id is null or exists (
    select 1 from public.members m where m.id = member_id and m.user_id = (select auth.uid())
  )))
  with check (private.has_role(org_id, 'viewer'));
revoke insert, update, delete on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

-- Las ejecuciones del cron las escribe el servidor (service_role); los miembros las leen.
create policy job_runs_select on public.job_runs for select to authenticated using (private.has_role(org_id, 'viewer'));
revoke insert, update, delete on public.job_runs from authenticated;

-- ---------------------------------------------------------------------------
-- Vistas derivadas (security_invoker: respetan la RLS de quien consulta)
-- ---------------------------------------------------------------------------

-- Facturas con su estado derivado: anulada (neto 0), cobrada, vencida o emitida.
create view public.invoices_overview with (security_invoker = true) as
select
  i.id,
  i.org_id,
  i.issuer_id,
  i.client_id,
  i.contract_id,
  i.series_id,
  i.kind,
  i.rectifies_invoice_id,
  i.lifecycle,
  i.number,
  i.issued_on,
  i.due_on,
  i.language,
  i.subtotal_cents,
  i.vat_cents,
  i.irpf_cents,
  i.total_cents,
  i.irpf_bps,
  i.source,
  i.grouping_key,
  i.pdf_path,
  i.created_at,
  i.updated_at,
  i.issued_at,
  c.display_name as client_name,
  coalesce(iss.trade_name, iss.legal_name) as issuer_name,
  s.code as series_code,
  (select count(*) from public.invoice_lines l where l.invoice_id = i.id)::integer as lines_count,
  coalesce(pay.paid_cents, 0)::bigint as paid_cents,
  pay.last_paid_on,
  coalesce(rect.rectified_cents, 0)::bigint as rectified_cents,
  (i.total_cents + coalesce(rect.rectified_cents, 0))::bigint as net_total_cents,
  case when i.lifecycle = 'issued' and i.kind = 'ordinary'
    then (i.total_cents + coalesce(rect.rectified_cents, 0) - coalesce(pay.paid_cents, 0))::bigint
    else 0::bigint
  end as outstanding_cents,
  case
    when i.lifecycle = 'draft' then 'draft'
    when i.lifecycle = 'issuing' then 'issuing'
    when i.kind = 'rectifying' then 'issued'
    when i.total_cents + coalesce(rect.rectified_cents, 0) = 0 then 'voided'
    when coalesce(pay.paid_cents, 0) >= i.total_cents + coalesce(rect.rectified_cents, 0) then 'paid'
    when i.due_on < (now() at time zone o.timezone)::date then 'overdue'
    else 'issued'
  end::public.invoice_status as status
from public.invoices i
join public.orgs o on o.id = i.org_id
join public.clients c on c.id = i.client_id
join public.issuers iss on iss.id = i.issuer_id
left join public.invoice_series s on s.id = i.series_id
left join lateral (
  select sum(p.amount_cents) as paid_cents, max(p.paid_on) as last_paid_on
  from public.payments p
  where p.invoice_id = i.id
) pay on true
left join lateral (
  select sum(r.total_cents) as rectified_cents
  from public.invoices r
  where r.rectifies_invoice_id = i.id and r.lifecycle = 'issued'
) rect on true;

-- Pendiente de facturar con su estado y de quién es.
create view public.billable_items_overview with (security_invoker = true) as
select
  b.id,
  b.org_id,
  b.contract_line_id,
  b.source,
  b.period_start,
  b.period_end,
  b.milestone_id,
  b.description,
  b.quantity,
  b.unit_price_cents,
  b.discount_bps,
  b.amount_cents,
  b.billable_on,
  b.invoice_line_id,
  b.waived_at,
  b.waive_reason,
  b.created_at,
  cl.billing_type,
  cl.contract_id,
  ct.title as contract_title,
  ct.client_id,
  c.display_name as client_name,
  il.invoice_id,
  i.number as invoice_number,
  case
    when b.waived_at is not null then 'waived'
    when b.invoice_line_id is null then 'pending'
    when i.lifecycle = 'draft' then 'drafted'
    else 'invoiced'
  end::public.billable_state as state
from public.billable_items b
join public.contract_lines cl on cl.id = b.contract_line_id
join public.contracts ct on ct.id = cl.contract_id
join public.clients c on c.id = ct.client_id
left join public.invoice_lines il on il.id = b.invoice_line_id
left join public.invoices i on i.id = il.invoice_id;

-- Líneas de contrato con su estado de hoy y hasta dónde están facturadas.
create view public.contract_lines_overview with (security_invoker = true) as
select
  l.id,
  l.org_id,
  l.contract_id,
  ct.client_id,
  l.position,
  l.description,
  l.billing_type,
  l.quantity,
  l.unit_price_cents,
  l.discount_bps,
  l.tax_rate_id,
  l.irpf_applies,
  l.starts_on,
  l.ends_on,
  l.billing_day,
  l.prorate_first,
  l.cancelled_on,
  l.cancel_reason,
  l.replaces_line_id,
  l.created_at,
  private.line_status_on(l, (now() at time zone o.timezone)::date) as status,
  billed.last_period_end as billed_until,
  coalesce(billed.items_count, 0)::integer as billed_items_count
from public.contract_lines l
join public.contracts ct on ct.id = l.contract_id
join public.orgs o on o.id = l.org_id
left join lateral (
  select max(b.period_end) as last_period_end, count(*) as items_count
  from public.billable_items b
  where b.contract_line_id = l.id and (b.invoice_line_id is not null or b.waived_at is not null)
) billed on true;

-- Contratos con su estado (derivado de las líneas) y su emisor vigente hoy.
create view public.contracts_overview with (security_invoker = true) as
select
  ct.id,
  ct.org_id,
  ct.client_id,
  c.display_name as client_name,
  ct.deal_id,
  ct.title,
  ct.signed_on,
  ct.payment_terms_days,
  ct.payment_method,
  ct.invoice_grouping,
  ct.notes,
  ct.archived_at,
  ct.created_at,
  ct.updated_at,
  private.contract_issuer_on(ct.id, (now() at time zone o.timezone)::date) as issuer_id,
  case
    when ct.signed_on is null or coalesce(st.lines_count, 0) = 0 then 'draft'
    when st.any_active then 'active'
    when st.any_paused then 'paused'
    when st.any_scheduled then 'scheduled'
    else 'ended'
  end::public.contract_status as status,
  coalesce(st.lines_count, 0)::integer as lines_count,
  st.starts_on,
  st.ends_on
from public.contracts ct
join public.clients c on c.id = ct.client_id
join public.orgs o on o.id = ct.org_id
left join lateral (
  select
    count(*) as lines_count,
    bool_or(s.status = 'active') as any_active,
    bool_or(s.status = 'paused') as any_paused,
    bool_or(s.status = 'scheduled') as any_scheduled,
    min(l.starts_on) as starts_on,
    case when bool_and(l.ends_on is not null) then max(l.ends_on) end as ends_on
  from public.contract_lines l
  cross join lateral (select private.line_status_on(l, (now() at time zone o.timezone)::date) as status) s
  where l.contract_id = ct.id
) st on true;

-- El estado del cliente pasa a salir de sus contratos firmados (ARCHITECTURE §6.4):
-- activo con alguna línea viva, pausado si todas las vivas están en pausa, ex-cliente si
-- tuvo y ya no tiene, lead si nunca tuvo. Se añaden la facturación neta y la primera factura.
create or replace view public.clients_overview with (security_invoker = true) as
select
  c.id,
  c.org_id,
  c.display_name,
  c.legal_name,
  c.tax_id,
  c.city,
  c.sector,
  c.owner_member_id,
  m.initials as owner_initials,
  c.archived_at,
  c.created_at,
  case
    when st.any_live then 'active'
    when st.any_paused then 'paused'
    when st.any_line then 'former'
    else 'lead'
  end::public.client_status as status,
  coalesce(first_deal.source_id, c.imported_source_id) as acquisition_source_id,
  (select count(*) from public.deals d where d.client_id = c.id and d.archived_at is null)::integer as deals_count,
  (select max(a.occurred_at) from public.activities a where a.client_id = c.id) as last_activity_at,
  coalesce(inv.billed_cents, 0)::bigint as billed_net_cents,
  inv.first_invoice_on
from public.clients c
join public.orgs o on o.id = c.org_id
left join public.members m on m.id = c.owner_member_id
left join lateral (
  select d.source_id
  from public.deals d
  where d.client_id = c.id
  order by d.created_at
  limit 1
) first_deal on true
left join lateral (
  select
    bool_or(s.status in ('active', 'scheduled')) as any_live,
    bool_or(s.status = 'paused') as any_paused,
    count(*) > 0 as any_line
  from public.contracts ct
  join public.contract_lines l on l.contract_id = ct.id
  cross join lateral (select private.line_status_on(l, (now() at time zone o.timezone)::date) as status) s
  where ct.client_id = c.id and ct.signed_on is not null and ct.archived_at is null
) st on true
left join lateral (
  select sum(i.subtotal_cents) as billed_cents, min(i.issued_on) as first_invoice_on
  from public.invoices i
  where i.client_id = c.id and i.lifecycle = 'issued'
) inv on true;

-- Timeline 360: se suman facturas emitidas, cobros y contratos firmados.
create or replace view public.client_timeline with (security_invoker = true) as
select
  a.org_id,
  a.client_id,
  a.deal_id,
  a.id::text as event_id,
  a.kind::text as kind,
  a.title,
  a.body,
  a.occurred_at as at,
  a.member_id,
  null::jsonb as meta
from public.activities a
union all
select
  h.org_id,
  d.client_id,
  d.id,
  'stage-' || h.id::text,
  case when h.from_stage_id is null then 'deal_created' else 'stage_change' end,
  d.title,
  null,
  h.changed_at,
  m.id,
  jsonb_build_object('from', fs.name, 'to', ts.name, 'to_kind', ts.kind)
from public.deal_stage_history h
join public.deals d on d.id = h.deal_id
join public.pipeline_stages ts on ts.id = h.to_stage_id
left join public.pipeline_stages fs on fs.id = h.from_stage_id
left join public.members m on m.org_id = h.org_id and m.user_id = h.changed_by
union all
select
  ct.org_id,
  ct.client_id,
  ct.deal_id,
  'contract-' || ct.id::text,
  'contract_signed',
  ct.title,
  null,
  ct.signed_on::timestamptz,
  null::uuid,
  jsonb_build_object('contract_id', ct.id)
from public.contracts ct
where ct.signed_on is not null
union all
select
  i.org_id,
  i.client_id,
  null::uuid,
  'invoice-' || i.id::text,
  case when i.kind = 'rectifying' then 'invoice_rectifying' else 'invoice_issued' end,
  i.number,
  null,
  coalesce(i.issued_at, i.issued_on::timestamptz),
  m.id,
  jsonb_build_object('invoice_id', i.id, 'total_cents', i.total_cents)
from public.invoices i
left join public.members m on m.org_id = i.org_id and m.user_id = i.created_by
where i.lifecycle = 'issued'
union all
select
  p.org_id,
  i.client_id,
  null::uuid,
  'payment-' || p.id::text,
  'payment',
  i.number,
  null,
  p.paid_on::timestamptz,
  m.id,
  jsonb_build_object('invoice_id', i.id, 'amount_cents', p.amount_cents, 'method', p.method)
from public.payments p
join public.invoices i on i.id = p.invoice_id
left join public.members m on m.org_id = p.org_id and m.user_id = p.created_by;

revoke all on public.invoices_overview, public.billable_items_overview, public.contract_lines_overview,
  public.contracts_overview, public.clients_overview, public.client_timeline from anon;

-- ---------------------------------------------------------------------------
-- RPC: contratos
-- ---------------------------------------------------------------------------

-- Alta de un contrato con su emisor, sus líneas y sus hitos en una sola transacción.
-- security invoker: manda la RLS de quien lo crea.
create function public.create_contract(p jsonb) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid;
  v_contract uuid;
begin
  select c.org_id into v_org from public.clients c where c.id = (p ->> 'client_id')::uuid;
  if v_org is null then
    raise exception 'Cliente no encontrado' using errcode = 'P0002', hint = 'client_not_found';
  end if;

  insert into public.contracts (org_id, client_id, deal_id, title, signed_on, payment_terms_days, payment_method, invoice_grouping, notes)
  values (
    v_org,
    (p ->> 'client_id')::uuid,
    nullif(p ->> 'deal_id', '')::uuid,
    btrim(p ->> 'title'),
    nullif(p ->> 'signed_on', '')::date,
    nullif(p ->> 'payment_terms_days', '')::smallint,
    coalesce(nullif(p ->> 'payment_method', '')::public.payment_method, 'transfer'),
    coalesce(nullif(p ->> 'invoice_grouping', '')::public.invoice_grouping, 'client'),
    nullif(btrim(p ->> 'notes'), '')
  )
  returning id into v_contract;

  insert into public.contract_issuers (org_id, contract_id, issuer_id, valid_from)
  values (
    v_org,
    v_contract,
    (p ->> 'issuer_id')::uuid,
    coalesce(nullif(p ->> 'signed_on', '')::date, private.org_today(v_org))
  );

  insert into public.contract_lines (
    org_id, contract_id, position, description, billing_type, quantity, unit_price_cents, discount_bps,
    tax_rate_id, irpf_applies, starts_on, ends_on, billing_day, prorate_first
  )
  select
    v_org, v_contract, coalesce(x.position, 0), btrim(x.description), x.billing_type,
    coalesce(x.quantity, 1), x.unit_price_cents, coalesce(x.discount_bps, 0), x.tax_rate_id,
    coalesce(x.irpf_applies, true), x.starts_on, x.ends_on, x.billing_day, coalesce(x.prorate_first, true)
  from jsonb_to_recordset(coalesce(p -> 'lines', '[]'::jsonb)) as x (
    position smallint, description text, billing_type public.billing_type, quantity numeric,
    unit_price_cents bigint, discount_bps integer, tax_rate_id uuid, irpf_applies boolean,
    starts_on date, ends_on date, billing_day smallint, prorate_first boolean
  );

  insert into public.contract_milestones (org_id, contract_id, position, label, percent_bps, planned_on, auto)
  select v_org, v_contract, coalesce(x.position, 0), btrim(x.label), x.percent_bps, x.planned_on, coalesce(x.auto, false)
  from jsonb_to_recordset(coalesce(p -> 'milestones', '[]'::jsonb)) as x (
    position smallint, label text, percent_bps integer, planned_on date, auto boolean
  );

  return v_contract;
end;
$$;

-- Cambio de condiciones de una línea ya facturada: la cierra el día antes y abre otra desde
-- p_from con las condiciones nuevas. No puede empezar dentro de un periodo ya facturado.
create function public.new_line_version(p_line_id uuid, p_from date, p jsonb) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  l public.contract_lines;
  v_billed_until date;
  v_new uuid;
begin
  select * into l from public.contract_lines where id = p_line_id for update;
  if not found then
    raise exception 'Línea no encontrada' using errcode = 'P0002', hint = 'line_not_found';
  end if;
  if l.billing_type = 'one_off' then
    raise exception 'Un one-off no tiene versiones: se ajusta en su propio contrato'
      using errcode = 'P0001', hint = 'version_not_recurring';
  end if;
  select max(b.period_end) into v_billed_until
  from public.billable_items b
  where b.contract_line_id = l.id and (b.invoice_line_id is not null or b.waived_at is not null);
  if (l.starts_on is not null and p_from <= l.starts_on)
     or (l.ends_on is not null and p_from > l.ends_on)
     or (v_billed_until is not null and p_from <= v_billed_until) then
    raise exception 'La versión nueva tiene que empezar después de lo ya facturado y dentro de la vigencia'
      using errcode = 'P0001', hint = 'version_date_invalid';
  end if;

  update public.contract_lines set ends_on = p_from - 1 where id = l.id;

  insert into public.contract_lines (
    org_id, contract_id, position, description, billing_type, quantity, unit_price_cents, discount_bps,
    tax_rate_id, irpf_applies, starts_on, ends_on, billing_day, prorate_first, replaces_line_id
  )
  values (
    l.org_id, l.contract_id, l.position,
    coalesce(nullif(btrim(p ->> 'description'), ''), l.description),
    l.billing_type,
    coalesce((p ->> 'quantity')::numeric, l.quantity),
    coalesce((p ->> 'unit_price_cents')::bigint, l.unit_price_cents),
    coalesce((p ->> 'discount_bps')::integer, l.discount_bps),
    coalesce((p ->> 'tax_rate_id')::uuid, l.tax_rate_id),
    coalesce((p ->> 'irpf_applies')::boolean, l.irpf_applies),
    p_from,
    l.ends_on,
    l.billing_day,
    true,
    l.id
  )
  returning id into v_new;
  return v_new;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: borradores
-- ---------------------------------------------------------------------------

-- Crea o actualiza un borrador con todas sus líneas (conjunto completo: lo que no viene se
-- borra y su pendiente vuelve a pendiente). Los importes de cada línea vienen calculados de TS.
-- Contrato del JSON (d):
--   invoice_id?, expected_updated_at?, grouping_key? (solo el cron),
--   header: { issuer_id, client_id, contract_id?, series_id?, issued_on?, operation_on?, due_on?,
--             payment_terms_days?, language?, irpf_bps?, payment_method?, notes? },
--   new_items?: [billable_items nuevos, con id],
--   lines: [{ id (obligatorio), position, description, quantity, unit_price_cents, discount_bps,
--             base_cents, tax_rate_id?, vat_bps, vat_regime, vat_cents, irpf_applies, irpf_cents,
--             legal_note?, billing_type, period_start?, period_end?, contract_line_id?,
--             rectifies_line_id?, billable_item_id? }],
--   waive_item_ids?: [uuid], waive_reason?
create function private.apply_draft(p_org uuid, d jsonb, p_system boolean) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  h jsonb := coalesce(d -> 'header', '{}'::jsonb);
  v_id uuid := nullif(d ->> 'invoice_id', '')::uuid;
  v_inv public.invoices;
  v_lines jsonb := coalesce(d -> 'lines', '[]'::jsonb);
  v_expected integer;
  v_found integer;
begin
  if v_id is not null then
    select * into v_inv from public.invoices where id = v_id and org_id = p_org for update;
    if not found then
      raise exception 'Borrador no encontrado' using errcode = 'P0002', hint = 'draft_not_found';
    end if;
    if v_inv.lifecycle <> 'draft' then
      raise exception 'Solo se editan borradores' using errcode = 'P0001', hint = 'invoice_immutable';
    end if;
    if nullif(d ->> 'expected_updated_at', '') is not null
       and (d ->> 'expected_updated_at')::timestamptz <> v_inv.updated_at then
      raise exception 'El borrador ha cambiado mientras lo editabas' using errcode = 'P0001', hint = 'draft_changed';
    end if;
    update public.invoices set
      issuer_id = coalesce(nullif(h ->> 'issuer_id', '')::uuid, issuer_id),
      client_id = coalesce(nullif(h ->> 'client_id', '')::uuid, client_id),
      contract_id = case when h ? 'contract_id' then nullif(h ->> 'contract_id', '')::uuid else contract_id end,
      series_id = case when h ? 'series_id' then nullif(h ->> 'series_id', '')::uuid else series_id end,
      issued_on = case when h ? 'issued_on' then nullif(h ->> 'issued_on', '')::date else issued_on end,
      operation_on = case when h ? 'operation_on' then nullif(h ->> 'operation_on', '')::date else operation_on end,
      due_on = case when h ? 'due_on' then nullif(h ->> 'due_on', '')::date else due_on end,
      payment_terms_days = case when h ? 'payment_terms_days' then nullif(h ->> 'payment_terms_days', '')::smallint else payment_terms_days end,
      language = coalesce(nullif(h ->> 'language', '')::public.app_locale, language),
      irpf_bps = coalesce(nullif(h ->> 'irpf_bps', '')::integer, irpf_bps),
      payment_method = coalesce(nullif(h ->> 'payment_method', '')::public.payment_method, payment_method),
      notes = case when h ? 'notes' then nullif(btrim(h ->> 'notes'), '') else notes end,
      rectification_reason = case when kind = 'rectifying' and h ? 'rectification_reason'
        then btrim(h ->> 'rectification_reason') else rectification_reason end
    where id = v_id;
  else
    insert into public.invoices (
      org_id, issuer_id, client_id, contract_id, series_id, issued_on, operation_on, due_on,
      payment_terms_days, language, irpf_bps, payment_method, notes, grouping_key
    )
    values (
      p_org,
      (h ->> 'issuer_id')::uuid,
      (h ->> 'client_id')::uuid,
      nullif(h ->> 'contract_id', '')::uuid,
      nullif(h ->> 'series_id', '')::uuid,
      nullif(h ->> 'issued_on', '')::date,
      nullif(h ->> 'operation_on', '')::date,
      nullif(h ->> 'due_on', '')::date,
      nullif(h ->> 'payment_terms_days', '')::smallint,
      coalesce(nullif(h ->> 'language', '')::public.app_locale, 'es'),
      coalesce(nullif(h ->> 'irpf_bps', '')::integer, 0),
      coalesce(nullif(h ->> 'payment_method', '')::public.payment_method, 'transfer'),
      nullif(btrim(h ->> 'notes'), ''),
      case when p_system then nullif(d ->> 'grouping_key', '') end
    )
    on conflict (org_id, issuer_id, client_id, grouping_key) where lifecycle = 'draft' and grouping_key is not null
    do nothing
    returning id into v_id;
    if v_id is null then
      raise exception 'Ya hay un borrador abierto para este cliente: vuelve a calcular'
        using errcode = 'P0001', hint = 'draft_changed';
    end if;
  end if;

  -- Pendientes nuevos (usos e hitos desde la app; cualquiera desde el cron).
  insert into public.billable_items (
    id, org_id, contract_line_id, source, period_start, period_end, milestone_id, description,
    quantity, unit_price_cents, discount_bps, amount_cents, billable_on
  )
  select
    x.id, p_org, x.contract_line_id, x.source, x.period_start, x.period_end, x.milestone_id, btrim(x.description),
    x.quantity, x.unit_price_cents, coalesce(x.discount_bps, 0), x.amount_cents, x.billable_on
  from jsonb_to_recordset(coalesce(d -> 'new_items', '[]'::jsonb)) as x (
    id uuid, contract_line_id uuid, source public.billable_source, period_start date, period_end date,
    milestone_id uuid, description text, quantity numeric, unit_price_cents bigint, discount_bps integer,
    amount_cents bigint, billable_on date
  )
  where p_system or x.source in ('usage', 'milestone');

  if exists (select 1 from jsonb_array_elements(v_lines) x where nullif(x ->> 'id', '') is null) then
    raise exception 'Cada línea necesita su id' using errcode = '22023', hint = 'line_id_required';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_lines) x
    join public.invoice_lines l on l.id = (x ->> 'id')::uuid
    where l.invoice_id <> v_id
  ) then
    raise exception 'Una línea de otra factura no se puede mover aquí' using errcode = 'P0001', hint = 'line_foreign';
  end if;

  -- Lo que no viene se borra (su pendiente, por la FK, vuelve a pendiente).
  delete from public.invoice_lines l
  where l.invoice_id = v_id
    and l.id not in (select (x ->> 'id')::uuid from jsonb_array_elements(v_lines) x);

  insert into public.invoice_lines (
    id, org_id, invoice_id, position, description, quantity, unit_price_cents, discount_bps, base_cents,
    tax_rate_id, vat_bps, vat_regime, vat_cents, irpf_applies, irpf_cents, legal_note, billing_type,
    period_start, period_end, contract_line_id, rectifies_line_id
  )
  select
    x.id, p_org, v_id, coalesce(x.position, 0), btrim(x.description), x.quantity,
    x.unit_price_cents, coalesce(x.discount_bps, 0), x.base_cents, x.tax_rate_id, x.vat_bps,
    coalesce(x.vat_regime, 'general'), x.vat_cents, coalesce(x.irpf_applies, false), coalesce(x.irpf_cents, 0),
    nullif(btrim(x.legal_note), ''), x.billing_type, x.period_start, x.period_end, x.contract_line_id,
    x.rectifies_line_id
  from jsonb_to_recordset(v_lines) as x (
    id uuid, position smallint, description text, quantity numeric, unit_price_cents bigint,
    discount_bps integer, base_cents bigint, tax_rate_id uuid, vat_bps integer,
    vat_regime public.vat_regime, vat_cents bigint, irpf_applies boolean, irpf_cents bigint,
    legal_note text, billing_type public.billing_type, period_start date, period_end date,
    contract_line_id uuid, rectifies_line_id uuid
  )
  on conflict (id) do update set
    position = excluded.position,
    description = excluded.description,
    quantity = excluded.quantity,
    unit_price_cents = excluded.unit_price_cents,
    discount_bps = excluded.discount_bps,
    base_cents = excluded.base_cents,
    tax_rate_id = excluded.tax_rate_id,
    vat_bps = excluded.vat_bps,
    vat_regime = excluded.vat_regime,
    vat_cents = excluded.vat_cents,
    irpf_applies = excluded.irpf_applies,
    irpf_cents = excluded.irpf_cents,
    legal_note = excluded.legal_note,
    billing_type = excluded.billing_type,
    period_start = excluded.period_start,
    period_end = excluded.period_end,
    contract_line_id = excluded.contract_line_id,
    rectifies_line_id = excluded.rectifies_line_id
  where (invoice_lines.position, invoice_lines.description, invoice_lines.quantity, invoice_lines.unit_price_cents,
         invoice_lines.discount_bps, invoice_lines.base_cents, invoice_lines.tax_rate_id, invoice_lines.vat_bps,
         invoice_lines.vat_regime, invoice_lines.vat_cents, invoice_lines.irpf_applies, invoice_lines.irpf_cents,
         invoice_lines.legal_note, invoice_lines.billing_type, invoice_lines.period_start, invoice_lines.period_end,
         invoice_lines.contract_line_id, invoice_lines.rectifies_line_id)
        is distinct from
        (excluded.position, excluded.description, excluded.quantity, excluded.unit_price_cents,
         excluded.discount_bps, excluded.base_cents, excluded.tax_rate_id, excluded.vat_bps,
         excluded.vat_regime, excluded.vat_cents, excluded.irpf_applies, excluded.irpf_cents,
         excluded.legal_note, excluded.billing_type, excluded.period_start, excluded.period_end,
         excluded.contract_line_id, excluded.rectifies_line_id);

  -- Enlaza cada línea con su pendiente: tiene que estar libre (o ya en esa misma línea).
  select count(*) into v_expected
  from jsonb_array_elements(v_lines) x where nullif(x ->> 'billable_item_id', '') is not null;
  if v_expected > 0 then
    select count(*) into v_found
    from jsonb_array_elements(v_lines) x
    join public.billable_items b on b.id = (x ->> 'billable_item_id')::uuid
    where nullif(x ->> 'billable_item_id', '') is not null
      and b.org_id = p_org
      and b.waived_at is null
      and (b.invoice_line_id is null or b.invoice_line_id = (x ->> 'id')::uuid);
    if v_found <> v_expected then
      raise exception 'Algún concepto ya no está pendiente de facturar' using errcode = 'P0001', hint = 'item_taken';
    end if;
    update public.billable_items b
       set invoice_line_id = (x ->> 'id')::uuid
      from jsonb_array_elements(v_lines) x
     where nullif(x ->> 'billable_item_id', '') is not null
       and b.id = (x ->> 'billable_item_id')::uuid
       and b.invoice_line_id is distinct from (x ->> 'id')::uuid;
  end if;

  -- Condonar lo que se ha quitado a propósito.
  update public.billable_items b
     set waived_at = now(), waive_reason = nullif(btrim(d ->> 'waive_reason'), '')
   where b.org_id = p_org
     and b.id in (select jsonb_array_elements_text(coalesce(d -> 'waive_item_ids', '[]'::jsonb))::uuid)
     and b.invoice_line_id is null
     and b.waived_at is null;

  -- Cualquier cambio en las líneas cuenta como cambio del borrador (bloqueo optimista).
  update public.invoices set updated_at = now() where id = v_id;
  return v_id;
end;
$$;

-- Borrador desde la app (editor, factura manual, facturar un hito, rectificativa parcial).
create function public.save_invoice_draft(p jsonb) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if nullif(p ->> 'invoice_id', '') is not null then
    select i.org_id into v_org from public.invoices i where i.id = (p ->> 'invoice_id')::uuid;
  else
    select c.org_id into v_org from public.clients c where c.id = (p #>> '{header,client_id}')::uuid;
  end if;
  if v_org is null or not private.has_role(v_org, 'partner') then
    raise exception 'Sin permiso para facturar en esta organización' using errcode = '42501';
  end if;
  return private.apply_draft(v_org, p, false);
end;
$$;

-- Aplica en una transacción lo que el cron ha calculado en TS para una org y un día:
-- 1) rehace los pendientes recurrentes (siempre con las condiciones actuales), 2) crea los
-- pendientes nuevos, 3) monta los borradores, 4) avisos, 5) recordatorios por aprobar y
-- 6) deals que pasan a Activo. Solo lo ejecuta el servidor (service_role).
create function public.apply_billing_run(p jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (p ->> 'org_id')::uuid;
  v_deleted integer := 0;
  v_items integer := 0;
  v_notifications integer := 0;
  v_emails integer := 0;
  v_moves integer := 0;
  v_drafts uuid[] := '{}';
  d jsonb;
begin
  -- Dos ejecuciones de la misma org nunca se pisan.
  perform pg_advisory_xact_lock(hashtextextended('billing:' || v_org::text, 0));

  delete from public.billable_items b
   where b.org_id = v_org and b.source = 'recurring' and b.invoice_line_id is null and b.waived_at is null;
  get diagnostics v_deleted = row_count;

  insert into public.billable_items (
    id, org_id, contract_line_id, source, period_start, period_end, milestone_id, description,
    quantity, unit_price_cents, discount_bps, amount_cents, billable_on
  )
  select
    x.id, v_org, x.contract_line_id, x.source, x.period_start, x.period_end, x.milestone_id, btrim(x.description),
    x.quantity, x.unit_price_cents, coalesce(x.discount_bps, 0), x.amount_cents, x.billable_on
  from jsonb_to_recordset(coalesce(p -> 'items', '[]'::jsonb)) as x (
    id uuid, contract_line_id uuid, source public.billable_source, period_start date, period_end date,
    milestone_id uuid, description text, quantity numeric, unit_price_cents bigint, discount_bps integer,
    amount_cents bigint, billable_on date
  )
  on conflict do nothing;
  get diagnostics v_items = row_count;

  for d in select * from jsonb_array_elements(coalesce(p -> 'drafts', '[]'::jsonb)) loop
    v_drafts := v_drafts || private.apply_draft(v_org, d, true);
  end loop;

  insert into public.notifications (org_id, member_id, kind, params, href, due_on, dedupe_key)
  select v_org, x.member_id, x.kind, coalesce(x.params, '{}'::jsonb), x.href, x.due_on, x.dedupe_key
  from jsonb_to_recordset(coalesce(p -> 'notifications', '[]'::jsonb)) as x (
    member_id uuid, kind public.notification_kind, params jsonb, href text, due_on date, dedupe_key text
  )
  on conflict (org_id, dedupe_key) do nothing;
  get diagnostics v_notifications = row_count;

  insert into public.outbound_emails (org_id, invoice_id, client_id, template, language, to_emails, subject, body, attach_pdf, dedupe_key)
  select v_org, x.invoice_id, x.client_id, x.template, x.language, coalesce(x.to_emails, '{}'), x.subject, x.body,
         coalesce(x.attach_pdf, true), x.dedupe_key
  from jsonb_to_recordset(coalesce(p -> 'emails', '[]'::jsonb)) as x (
    invoice_id uuid, client_id uuid, template public.email_template, language public.app_locale,
    to_emails text[], subject text, body text, attach_pdf boolean, dedupe_key text
  )
  on conflict (org_id, dedupe_key) do nothing;
  get diagnostics v_emails = row_count;

  update public.deals dl
     set stage_id = x.stage_id
    from jsonb_to_recordset(coalesce(p -> 'deal_moves', '[]'::jsonb)) as x (deal_id uuid, stage_id uuid)
   where dl.id = x.deal_id and dl.org_id = v_org and dl.stage_id <> x.stage_id;
  get diagnostics v_moves = row_count;

  return jsonb_build_object(
    'items_deleted', v_deleted,
    'items_created', v_items,
    'drafts', to_jsonb(v_drafts),
    'notifications_created', v_notifications,
    'emails_created', v_emails,
    'deals_moved', v_moves
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: emisión
-- ---------------------------------------------------------------------------

-- Primer paso de la emisión (borrador → emitiendo), en una transacción: valida, congela los
-- datos de emisor y cliente y, con el proveedor interno, asigna el número sin huecos. Si la
-- factura ya estaba en emisión o emitida, devuelve lo que tiene (idempotente: se reintenta).
create function public.issue_invoice_begin(p_invoice_id uuid, p_issued_on date default null) returns jsonb
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
  if not found or not private.has_role(v.org_id, 'partner') then
    raise exception 'Sin permiso sobre esta factura' using errcode = '42501';
  end if;
  if v.lifecycle <> 'draft' then
    return jsonb_build_object(
      'invoice_id', v.id, 'lifecycle', v.lifecycle, 'number', v.number, 'issued_on', v.issued_on,
      'series_id', v.series_id, 'fiscal_provider', v.fiscal_provider
    );
  end if;

  v_today := private.org_today(v.org_id);
  v_on := coalesce(p_issued_on, v.issued_on, v_today);
  if v_on > v_today then
    raise exception 'Una factura no puede llevar fecha futura' using errcode = 'P0001', hint = 'future_date';
  end if;

  select * into v_issuer from public.issuers where id = v.issuer_id;
  select * into v_client from public.clients where id = v.client_id;
  select coalesce((o.settings ->> 'payment_terms_days')::integer, 30) into v_org_terms
  from public.orgs o where o.id = v.org_id;

  -- La SL sin fecha de alta aún no está constituida; un autónomo sin fecha, sí factura.
  if v_issuer.archived_at is not null
     or (v_issuer.active_from is null and v_issuer.kind = 'company')
     or (v_issuer.active_from is not null and v_on < v_issuer.active_from)
     or (v_issuer.active_until is not null and v_on > v_issuer.active_until) then
    raise exception 'El emisor no está activo en la fecha de la factura' using errcode = 'P0001', hint = 'issuer_inactive';
  end if;

  -- Verifactu (RDL 15/2025): desde su fecha, el proveedor interno no puede emitir.
  if v_issuer.fiscal_provider = 'internal' and v_on >= v_issuer.verifactu_from then
    raise exception 'Desde el % este emisor tiene que emitir con un proveedor Verifactu',
      to_char(v_issuer.verifactu_from, 'DD/MM/YYYY')
      using errcode = 'P0001', hint = 'verifactu_required';
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
  if cardinality(v_missing) > 0 then
    raise exception 'Faltan datos fiscales: %', array_to_string(v_missing, ', ')
      using errcode = 'P0001', hint = 'fiscal_data_missing', detail = array_to_string(v_missing, ',');
  end if;

  select count(*), coalesce(sum(l.base_cents), 0), coalesce(sum(l.vat_cents), 0), coalesce(sum(l.irpf_cents), 0)
    into v_lines, v_base, v_vat, v_irpf
  from public.invoice_lines l where l.invoice_id = v.id;
  if v_lines = 0 then
    raise exception 'La factura no tiene líneas' using errcode = 'P0001', hint = 'no_lines';
  end if;
  if (v_base, v_vat, v_irpf) <> (v.subtotal_cents, v.vat_cents, v.irpf_cents)
     or v.total_cents <> v.subtotal_cents + v.vat_cents - v.irpf_cents then
    raise exception 'Los totales no cuadran con las líneas' using errcode = 'P0001', hint = 'totals_mismatch';
  end if;

  if v.kind = 'rectifying' and not exists (
    select 1 from public.invoices o
    where o.id = v.rectifies_invoice_id and o.lifecycle = 'issued' and o.kind = 'ordinary'
      and o.issuer_id = v.issuer_id and o.client_id = v.client_id
  ) then
    raise exception 'La factura rectificada no es válida' using errcode = 'P0001', hint = 'rectified_invalid';
  end if;

  if v.series_id is not null then
    select * into v_series from public.invoice_series where id = v.series_id;
  else
    select * into v_series from public.invoice_series s
    where s.issuer_id = v.issuer_id and s.kind = v.kind and s.is_default and s.archived_at is null;
  end if;
  if v_series.id is null or v_series.issuer_id <> v.issuer_id or v_series.kind <> v.kind or v_series.archived_at is not null then
    raise exception 'El emisor no tiene una serie válida para este tipo de factura'
      using errcode = 'P0001', hint = 'series_invalid';
  end if;

  v_year := case when v_series.reset_yearly then extract(year from v_on)::smallint else 0 end;

  -- Número: UPSERT del contador dentro de esta transacción. Si algo falla después, el
  -- incremento se deshace y no queda hueco. La fila bloqueada ordena las emisiones simultáneas.
  if v_issuer.fiscal_provider = 'internal' then
    insert into private.invoice_series_counters as c (series_id, year, last_number)
    values (v_series.id, v_year, 1)
    on conflict (series_id, year) do update set last_number = c.last_number + 1, updated_at = now()
    returning c.last_number into v_seq;
    v_number := private.format_invoice_number(v_series.format, extract(year from v_on)::integer, v_seq);
  end if;

  -- Fechas no decrecientes en la serie. Va después del contador: con la fila bloqueada, esta
  -- consulta ya ve la emisión concurrente que se confirmó antes.
  select max(i.issued_on) into v_prev
  from public.invoices i
  where i.series_id = v_series.id
    and i.lifecycle <> 'draft'
    and i.id <> v.id
    and (not v_series.reset_yearly or extract(year from i.issued_on) = extract(year from v_on));
  if v_prev is not null and v_on < v_prev then
    raise exception 'La serie ya tiene una factura del %: esta no puede llevar una fecha anterior',
      to_char(v_prev, 'DD/MM/YYYY')
      using errcode = 'P0001', hint = 'date_before_previous', detail = v_prev::text;
  end if;

  update public.invoices set
    lifecycle = 'issuing',
    series_id = v_series.id,
    number = v_number,
    sequence = v_seq,
    fiscal_year = v_year,
    issued_on = v_on,
    due_on = coalesce(due_on, v_on + coalesce(payment_terms_days, v_client.payment_terms_days, v_org_terms)),
    fiscal_provider = v_issuer.fiscal_provider,
    issuing_started_at = now(),
    issuer_snapshot = jsonb_build_object(
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
    client_snapshot = jsonb_build_object(
      'legal_name', coalesce(v_client.legal_name, v_client.display_name),
      'display_name', v_client.display_name,
      'tax_id', v_client.tax_id,
      'tax_id_kind', v_client.tax_id_kind,
      'address_line', v_client.address_line,
      'postal_code', v_client.postal_code,
      'city', v_client.city,
      'province', v_client.province,
      'country_code', v_client.country_code,
      'is_business', v_client.is_business
    )
  where id = v.id
  returning * into v;

  return jsonb_build_object(
    'invoice_id', v.id, 'lifecycle', v.lifecycle, 'number', v.number, 'issued_on', v.issued_on,
    'series_id', v.series_id, 'fiscal_provider', v.fiscal_provider
  );
end;
$$;

-- Segundo paso (emitiendo → emitida): guarda lo que devuelve el proveedor (número si lo
-- asigna él, referencia, QR…) y la ruta del PDF. Idempotente.
create function public.issue_invoice_complete(p_invoice_id uuid, p jsonb) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.invoices;
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
  update public.invoices set
    number = coalesce(number, nullif(p ->> 'number', '')),
    provider_ref = coalesce(nullif(p ->> 'provider_ref', ''), provider_ref),
    provider_payload = coalesce(p -> 'provider_payload', provider_payload),
    pdf_path = coalesce(nullif(p ->> 'pdf_path', ''), pdf_path),
    lifecycle = 'issued',
    issued_at = now()
  where id = v.id;
end;
$$;

-- Rectificativa: borrador en la serie rectificativa del emisor. `p_full` copia las líneas en
-- negativo (anular); la negación es exacta porque el redondeo es simétrico. Si ya hay un
-- borrador rectificativo de esa factura, devuelve ese.
create function public.create_rectification(p_invoice_id uuid, p_reason text, p_full boolean default true) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.invoices;
  v_series uuid;
  v_id uuid;
begin
  select * into o from public.invoices where id = p_invoice_id;
  if not found or not private.has_role(o.org_id, 'partner') then
    raise exception 'Sin permiso sobre esta factura' using errcode = '42501';
  end if;
  if o.lifecycle <> 'issued' or o.kind <> 'ordinary' then
    raise exception 'Solo se rectifica una factura ordinaria emitida' using errcode = 'P0001', hint = 'rectify_invalid';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Hay que indicar el motivo de la rectificación' using errcode = 'P0001', hint = 'rectification_reason_required';
  end if;

  select i.id into v_id from public.invoices i where i.rectifies_invoice_id = o.id and i.lifecycle = 'draft';
  if v_id is not null then
    return v_id;
  end if;

  if p_full and exists (select 1 from public.invoices r where r.rectifies_invoice_id = o.id and r.lifecycle <> 'draft') then
    raise exception 'Esta factura ya tiene rectificativas: la siguiente se hace por diferencias'
      using errcode = 'P0001', hint = 'already_rectified';
  end if;

  select s.id into v_series from public.invoice_series s
  where s.issuer_id = o.issuer_id and s.kind = 'rectifying' and s.is_default and s.archived_at is null;
  if v_series is null then
    raise exception 'El emisor no tiene serie rectificativa' using errcode = 'P0001', hint = 'rectifying_series_missing';
  end if;

  insert into public.invoices (
    org_id, issuer_id, client_id, contract_id, series_id, kind, rectifies_invoice_id, rectification_reason,
    language, irpf_bps, payment_method
  )
  values (
    o.org_id, o.issuer_id, o.client_id, o.contract_id, v_series, 'rectifying', o.id, btrim(p_reason),
    o.language, o.irpf_bps, o.payment_method
  )
  returning id into v_id;

  if p_full then
    insert into public.invoice_lines (
      org_id, invoice_id, position, description, quantity, unit_price_cents, discount_bps, base_cents,
      tax_rate_id, vat_bps, vat_regime, vat_cents, irpf_applies, irpf_cents, legal_note, billing_type,
      period_start, period_end, contract_line_id, rectifies_line_id
    )
    select
      l.org_id, v_id, l.position, l.description, l.quantity, -l.unit_price_cents, l.discount_bps, -l.base_cents,
      l.tax_rate_id, l.vat_bps, l.vat_regime, -l.vat_cents, l.irpf_applies, -l.irpf_cents, l.legal_note,
      l.billing_type, l.period_start, l.period_end, l.contract_line_id, l.id
    from public.invoice_lines l
    where l.invoice_id = o.id;
  end if;
  return v_id;
end;
$$;

-- Tras anular una factura: sus conceptos vuelven a pendiente (se refacturan) o se condonan.
create function public.release_invoice_items(p_invoice_id uuid, p_waive boolean, p_reason text default null) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_count integer;
begin
  select i.org_id into v_org from public.invoices i where i.id = p_invoice_id;
  if v_org is null or not private.has_role(v_org, 'partner') then
    raise exception 'Sin permiso sobre esta factura' using errcode = '42501';
  end if;
  if not private.invoice_is_voided(p_invoice_id) then
    raise exception 'Solo se liberan los conceptos de una factura anulada' using errcode = 'P0001', hint = 'invoice_not_voided';
  end if;
  update public.billable_items b
     set invoice_line_id = null,
         waived_at = case when p_waive then now() end,
         waive_reason = case when p_waive then nullif(btrim(p_reason), '') end
    from public.invoice_lines l
   where l.invoice_id = p_invoice_id and b.invoice_line_id = l.id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Número que llevaría un borrador si se emitiera ahora (vista previa; no reserva nada).
create function public.invoice_next_number(p_invoice_id uuid, p_issued_on date default null) returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.invoices;
  v_series public.invoice_series;
  v_provider public.fiscal_provider;
  v_on date;
  v_last integer;
begin
  select * into v from public.invoices where id = p_invoice_id;
  if not found or not private.has_role(v.org_id, 'viewer') then
    return null;
  end if;
  if v.lifecycle <> 'draft' then
    return v.number;
  end if;
  select i.fiscal_provider into v_provider from public.issuers i where i.id = v.issuer_id;
  if v_provider <> 'internal' then
    return null;
  end if;
  if v.series_id is not null then
    select * into v_series from public.invoice_series where id = v.series_id;
  else
    select * into v_series from public.invoice_series s
    where s.issuer_id = v.issuer_id and s.kind = v.kind and s.is_default and s.archived_at is null;
  end if;
  if v_series.id is null then
    return null;
  end if;
  v_on := coalesce(p_issued_on, v.issued_on, private.org_today(v.org_id));
  select c.last_number into v_last from private.invoice_series_counters c
  where c.series_id = v_series.id and c.year = case when v_series.reset_yearly then extract(year from v_on)::smallint else 0 end;
  return private.format_invoice_number(v_series.format, extract(year from v_on)::integer, coalesce(v_last, 0) + 1);
end;
$$;

-- El último número de una serie ya no se puede tocar si GNERAI OS ha emitido en ella ese año.
create or replace function public.set_series_last_number(p_series_id uuid, p_year integer, p_last_number integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_reset boolean;
begin
  select s.org_id, s.reset_yearly into v_org, v_reset
  from public.invoice_series s
  where s.id = p_series_id;

  if v_org is null or not private.has_role(v_org, 'owner') then
    raise exception 'Sin permiso sobre esta serie' using errcode = '42501';
  end if;
  if p_last_number < 0 then
    raise exception 'El último número no puede ser negativo' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.invoices i
    where i.series_id = p_series_id
      and i.source = 'app'
      and i.lifecycle <> 'draft'
      and i.fiscal_year = case when v_reset then p_year::smallint else 0 end
  ) then
    raise exception 'Esta serie ya tiene facturas emitidas desde GNERAI OS ese año: su numeración continúa sola'
      using errcode = 'P0001', hint = 'series_in_use';
  end if;

  insert into private.invoice_series_counters (series_id, year, last_number)
  values (p_series_id, case when v_reset then p_year::smallint else 0 end, p_last_number)
  on conflict (series_id, year)
  do update set last_number = excluded.last_number, updated_at = now();
end;
$$;

-- ⌘K busca también contratos (por título) y facturas (por número).
create or replace function public.search_org(p_org uuid, p_query text, p_limit integer default 6)
returns table (kind text, id uuid, client_id uuid, title text, subtitle text)
language sql
stable
security invoker
set search_path = ''
as $$
  with q as (
    select '%' || private.search_text(btrim(p_query)) || '%' as pattern
  )
  (select 'client', c.id, c.id, c.display_name, coalesce(c.legal_name, c.tax_id, c.city)
   from public.clients c, q
   where c.org_id = p_org and c.archived_at is null
     and (private.search_text(c.display_name) like q.pattern
          or private.search_text(c.legal_name) like q.pattern
          or lower(coalesce(c.tax_id, '')) like q.pattern)
   order by c.display_name
   limit p_limit)
  union all
  (select 'contact', ct.id, ct.client_id, ct.full_name, coalesce(ct.email, cl.display_name)
   from public.contacts ct
   join public.clients cl on cl.id = ct.client_id, q
   where ct.org_id = p_org and ct.archived_at is null
     and (private.search_text(ct.full_name) like q.pattern or lower(coalesce(ct.email, '')) like q.pattern)
   order by ct.full_name
   limit p_limit)
  union all
  (select 'deal', d.id, d.client_id, d.title, cl.display_name
   from public.deals d
   join public.clients cl on cl.id = d.client_id, q
   where d.org_id = p_org and d.archived_at is null
     and (private.search_text(d.title) like q.pattern or private.search_text(cl.display_name) like q.pattern)
   order by d.updated_at desc
   limit p_limit)
  union all
  (select 'contract', k.id, k.client_id, k.title, cl.display_name
   from public.contracts k
   join public.clients cl on cl.id = k.client_id, q
   where k.org_id = p_org and k.archived_at is null
     and private.search_text(k.title) like q.pattern
   order by k.updated_at desc
   limit p_limit)
  union all
  (select 'invoice', i.id, i.client_id, i.number, cl.display_name
   from public.invoices i
   join public.clients cl on cl.id = i.client_id, q
   where i.org_id = p_org and i.number is not null
     and lower(i.number) like q.pattern
   order by i.issued_on desc
   limit p_limit)
$$;

-- ---------------------------------------------------------------------------
-- Privilegios de funciones
-- ---------------------------------------------------------------------------
revoke all on function private.apply_draft(uuid, jsonb, boolean) from public;
revoke all on function private.release_line_from_drafts(uuid) from public;

revoke all on function public.create_contract(jsonb) from public, anon;
revoke all on function public.new_line_version(uuid, date, jsonb) from public, anon;
revoke all on function public.save_invoice_draft(jsonb) from public, anon;
revoke all on function public.apply_billing_run(jsonb) from public, anon, authenticated;
revoke all on function public.issue_invoice_begin(uuid, date) from public, anon;
revoke all on function public.issue_invoice_complete(uuid, jsonb) from public, anon;
revoke all on function public.create_rectification(uuid, text, boolean) from public, anon;
revoke all on function public.release_invoice_items(uuid, boolean, text) from public, anon;
revoke all on function public.invoice_next_number(uuid, date) from public, anon;

grant execute on function public.create_contract(jsonb) to authenticated;
grant execute on function public.new_line_version(uuid, date, jsonb) to authenticated;
grant execute on function public.save_invoice_draft(jsonb) to authenticated;
grant execute on function public.apply_billing_run(jsonb) to service_role;
grant execute on function public.issue_invoice_begin(uuid, date) to authenticated;
grant execute on function public.issue_invoice_complete(uuid, jsonb) to authenticated;
grant execute on function public.create_rectification(uuid, text, boolean) to authenticated;
grant execute on function public.release_invoice_items(uuid, boolean, text) to authenticated;
grant execute on function public.invoice_next_number(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: PDFs emitidos (copia legal exacta). Privado: solo el servidor lee y escribe.
-- En PGlite (tests) no existe el esquema storage y esto se salta.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is not null then
    execute $sql$
      insert into storage.buckets (id, name, public)
      values ('invoices', 'invoices', false)
      on conflict (id) do nothing
    $sql$;
  end if;
end;
$$;

revoke all on all tables in schema public from anon;
