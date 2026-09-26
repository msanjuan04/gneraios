-- GNERAI OS · Hito 1.3 · Presupuestos
-- Presupuestos con líneas (las mismas condiciones económicas que las de un contrato), plan de
-- pagos, numeración correlativa por org y año (P2026-0001, no legal), envío por email y
-- aceptación en un clic: presupuesto → contrato (líneas, emisor e hitos) → deal ganado.
-- Ver ARCHITECTURE.md §6.3, §7.3 y §9.3.
--
-- Reparto de responsabilidades (como en facturación):
-- - La base de cada línea (cantidad × precio − descuento) la calcula TS al guardar, con la única
--   implementación del redondeo (src/domain). Aquí solo se suma, por tipo y sin mezclar.
-- - Lo que tiene que ser atómico vive aquí: guardar cabecera y líneas, numerar y, sobre todo,
--   aceptar (contrato, líneas, emisor, hitos, enlace y deal en una sola transacción).
-- - Se escribe solo con las RPC: authenticated no tiene insert/update sobre las tablas.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.quote_status as enum ('draft', 'sent', 'accepted', 'rejected');
-- Estado derivado (nunca se guarda): «caducado» es un enviado con la validez vencida.
create type public.quote_state as enum ('draft', 'sent', 'expired', 'accepted', 'rejected');

-- Los emails de un presupuesto van a la misma tabla que los de las facturas. El valor nuevo no
-- se usa en esta migración (Postgres no deja usarlo en la misma transacción que lo añade).
alter type public.email_template add value if not exists 'quote';

-- ---------------------------------------------------------------------------
-- Presupuestos
-- ---------------------------------------------------------------------------
create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  client_id uuid not null,
  deal_id uuid,
  issuer_id uuid not null,
  -- También es el título del contrato que nace al aceptarlo.
  title text not null check (char_length(btrim(title)) between 1 and 200),
  -- Correlativo por org y año (P2026-0001). No es legal: se asigna al enviarlo por primera vez.
  number text,
  status public.quote_status not null default 'draft',
  -- Vacías en un borrador: al enviarlo, la fecha de ese día y la validez de la org.
  issued_on date,
  valid_until date,
  language public.app_locale not null default 'es',
  notes text,
  -- [{ label, percent_bps, when: on_accept | on_delivery | date, planned_on? }]. Con líneas
  -- puntuales tiene que sumar el 100 % (lo comprueban las RPC con private.quote_plan_error).
  payment_plan jsonb not null default '[]'::jsonb check (jsonb_typeof(payment_plan) = 'array'),
  accepted_at timestamptz,
  rejected_at timestamptz,
  rejection_reason text check (rejection_reason is null or char_length(rejection_reason) <= 500),
  -- El contrato que nació al aceptarlo.
  contract_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  unique (contract_id),
  foreign key (org_id, client_id) references public.clients (org_id, id),
  -- El deal y el contrato tienen que ser del mismo cliente.
  foreign key (org_id, deal_id, client_id) references public.deals (org_id, id, client_id),
  foreign key (org_id, issuer_id) references public.issuers (org_id, id),
  foreign key (org_id, contract_id, client_id) references public.contracts (org_id, id, client_id),
  check ((status = 'draft') = (number is null)),
  check (status = 'draft' or (issued_on is not null and valid_until is not null)),
  check (valid_until is null or issued_on is null or valid_until >= issued_on),
  check ((status = 'accepted') = (accepted_at is not null)),
  check ((status = 'accepted') = (contract_id is not null)),
  check ((status = 'rejected') = (rejected_at is not null)),
  check (rejection_reason is null or status = 'rejected')
);
create unique index quotes_org_number_idx on public.quotes (org_id, number) where number is not null;
create index quotes_org_created_idx on public.quotes (org_id, created_at desc);
create index quotes_client_idx on public.quotes (client_id);
create index quotes_deal_idx on public.quotes (deal_id) where deal_id is not null;

-- Las mismas condiciones que contract_lines. `base_cents` es la base de un ciclo (o de un uso)
-- ya redondeada en TS: el listado suma las bases por tipo sin volver a calcular nada.
create table public.quote_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  quote_id uuid not null,
  position smallint not null default 0,
  description text not null check (char_length(btrim(description)) between 1 and 500),
  billing_type public.billing_type not null,
  quantity numeric(12, 3) not null default 1 check (quantity > 0),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  discount_bps integer not null default 0 check (discount_bps between 0 and 10000),
  tax_rate_id uuid not null,
  irpf_applies boolean not null default true,
  -- Vacío: empieza con el contrato (el día que se acepta).
  starts_on date,
  ends_on date,
  -- Vacío: el día de facturación de la org (orgs.settings.billing_day).
  billing_day smallint check (billing_day between 1 and 31),
  prorate_first boolean not null default true,
  base_cents bigint not null check (base_cents >= 0),
  -- La línea de contrato que nació de esta al aceptar (el origen de cada línea, §7.3).
  contract_line_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  unique (contract_line_id),
  foreign key (org_id, quote_id) references public.quotes (org_id, id) on delete cascade,
  foreign key (org_id, tax_rate_id) references public.tax_rates (org_id, id),
  -- Una línea de contrato sin facturar se puede borrar: el presupuesto solo pierde el enlace.
  foreign key (org_id, contract_line_id) references public.contract_lines (org_id, id) on delete set null (contract_line_id),
  check (billing_type <> 'one_off' or (starts_on is null and ends_on is null)),
  check (billing_type = 'monthly' or billing_day is null),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create index quote_lines_quote_idx on public.quote_lines (quote_id, position);

-- Último número usado por org y año. Se incrementa con UPSERT dentro de la transacción que
-- numera: si algo falla después, el incremento se deshace y no queda hueco.
create table private.quote_counters (
  org_id uuid not null references public.orgs (id) on delete cascade,
  year smallint not null check (year between 2000 and 2999),
  last_number integer not null default 0 check (last_number >= 0),
  updated_at timestamptz not null default now(),
  primary key (org_id, year)
);

-- Un email enviado lleva su factura o su presupuesto (nunca los dos).
alter table public.outbound_emails
  add column quote_id uuid,
  add constraint outbound_emails_quote_fkey foreign key (org_id, quote_id) references public.quotes (org_id, id),
  add constraint outbound_emails_one_document_check check (invoice_id is null or quote_id is null);
create index outbound_emails_quote_idx on public.outbound_emails (quote_id) where quote_id is not null;

-- ---------------------------------------------------------------------------
-- Funciones auxiliares
-- ---------------------------------------------------------------------------

-- Una fecha ISO (YYYY-MM-DD) que existe, o null.
create function private.quote_plan_date(p_value text) returns date
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or p_value !~ '^\d{4}-\d{2}-\d{2}$' then
    return null;
  end if;
  return p_value::date;
exception
  when others then
    return null;
end;
$$;

-- Gemela SQL de paymentPlanError (src/app/[org]/quotes/summary.ts): null si el plan vale o el
-- hint del motivo. Cada pago lleva etiqueta, porcentaje entero (1-10 000 pb) y cuándo: a la
-- aceptación (solo puede ser el primero), a la entrega o en una fecha. Con líneas puntuales
-- hace falta un plan, y cualquier plan suma exactamente el 100 %.
create function private.quote_plan_error(p_plan jsonb, p_has_one_off boolean) returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_item jsonb;
  v_when text;
  v_percent numeric;
  v_count integer := 0;
  v_total integer := 0;
begin
  if p_plan is null or jsonb_typeof(p_plan) <> 'array' or jsonb_array_length(p_plan) > 20 then
    return 'payment_plan_invalid';
  end if;
  for v_item in select e.value from jsonb_array_elements(p_plan) as e loop
    v_count := v_count + 1;
    if jsonb_typeof(v_item) <> 'object' or jsonb_typeof(v_item -> 'percent_bps') is distinct from 'number' then
      return 'payment_plan_invalid';
    end if;
    v_when := v_item ->> 'when';
    v_percent := (v_item ->> 'percent_bps')::numeric;
    if char_length(btrim(coalesce(v_item ->> 'label', ''))) not between 1 and 120
       or v_when is null
       or v_when not in ('on_accept', 'on_delivery', 'date')
       or v_percent <> trunc(v_percent)
       or v_percent not between 1 and 10000
       or (v_when = 'date' and private.quote_plan_date(v_item ->> 'planned_on') is null)
       or (v_when <> 'date' and nullif(v_item ->> 'planned_on', '') is not null) then
      return 'payment_plan_invalid';
    end if;
    if v_when = 'on_accept' and v_count > 1 then
      return 'payment_plan_order';
    end if;
    v_total := v_total + v_percent::integer;
  end loop;
  if v_count = 0 then
    return case when p_has_one_off then 'payment_plan_required' end;
  end if;
  if v_total <> 10000 then
    return 'payment_plan_total';
  end if;
  return null;
end;
$$;

-- ¿Se puede enviar o aceptar? null si sí; si no, el hint del motivo.
create function private.quote_ready_error(p_quote public.quotes) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not exists (select 1 from public.quote_lines l where l.quote_id = p_quote.id) then 'quote_no_lines'
    else private.quote_plan_error(
      p_quote.payment_plan,
      exists (select 1 from public.quote_lines l where l.quote_id = p_quote.id and l.billing_type = 'one_off')
    )
  end
$$;

-- Días de validez por defecto: orgs.settings.quote_validity_days (30 si no está).
create function private.quote_validity_days(p_org uuid) returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when jsonb_typeof(o.settings -> 'quote_validity_days') = 'number'
       and (o.settings ->> 'quote_validity_days')::numeric between 1 and 365
      then round((o.settings ->> 'quote_validity_days')::numeric)::integer
    end
    from public.orgs o
    where o.id = p_org
  ), 30)
$$;

-- Siguiente número de la org en el año de la fecha (P2026-0001).
create function private.next_quote_number(p_org uuid, p_on date) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year smallint := extract(year from p_on)::smallint;
  v_seq integer;
begin
  insert into private.quote_counters as c (org_id, year, last_number)
  values (p_org, v_year, 1)
  on conflict (org_id, year) do update set last_number = c.last_number + 1, updated_at = now()
  returning c.last_number into v_seq;
  return private.format_invoice_number('P{yyyy}-{n:4}', v_year, v_seq);
end;
$$;

-- Borrador → enviado: número, fecha (hoy si no tenía) y validez (la de la org si no tenía).
-- Al aceptar un borrador directamente no se mira la validez: el cliente ya ha dicho que sí.
create function private.finalize_quote_row(p_quote public.quotes, p_check_validity boolean) returns public.quotes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := private.org_today(p_quote.org_id);
  v_on date := coalesce(p_quote.issued_on, v_today);
  v_valid date := coalesce(p_quote.valid_until, v_on + private.quote_validity_days(p_quote.org_id));
  v_row public.quotes;
begin
  if v_on > v_today then
    raise exception 'Un presupuesto no puede llevar fecha futura' using errcode = 'P0001', hint = 'quote_future_date';
  end if;
  if p_check_validity and v_valid < v_today then
    raise exception 'La validez del presupuesto ya ha pasado' using errcode = 'P0001', hint = 'quote_validity_past';
  end if;
  update public.quotes
     set status = 'sent',
         number = private.next_quote_number(p_quote.org_id, v_on),
         issued_on = v_on,
         valid_until = greatest(v_valid, v_on)
   where id = p_quote.id
  returning * into v_row;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Guardas: un presupuesto aceptado queda congelado, también para service_role
-- ---------------------------------------------------------------------------
create function private.quotes_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Solo se borran los presupuestos en borrador' using errcode = 'P0001', hint = 'quote_not_draft';
    end if;
    return old;
  end if;
  if old.status = 'accepted' then
    raise exception 'Un presupuesto aceptado no se modifica' using errcode = 'P0001', hint = 'quote_frozen';
  end if;
  if old.number is not null and new.number is distinct from old.number then
    raise exception 'El número de un presupuesto no cambia' using errcode = 'P0001', hint = 'quote_number_fixed';
  end if;
  if old.status <> 'draft' and new.status = 'draft' then
    raise exception 'Un presupuesto enviado no vuelve a borrador' using errcode = 'P0001', hint = 'quote_status_invalid';
  end if;
  return new;
end;
$$;

create trigger quotes_guard before update or delete on public.quotes
  for each row execute function private.quotes_guard();

create function private.quote_lines_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.quote_status;
begin
  if tg_op = 'UPDATE' and new.quote_id <> old.quote_id then
    raise exception 'Una línea no cambia de presupuesto' using errcode = 'P0001', hint = 'line_foreign';
  end if;
  -- Sin presupuesto: se está borrando un borrador entero (cascada).
  select q.status into v_status from public.quotes q where q.id = coalesce(new.quote_id, old.quote_id);
  if v_status = 'accepted' then
    -- Lo único que cambia en un aceptado: perder el enlace a una línea de contrato que se borra.
    if tg_op = 'UPDATE' and new.contract_line_id is null and old.contract_line_id is not null
       and (to_jsonb(new) - 'contract_line_id' - 'updated_at') = (to_jsonb(old) - 'contract_line_id' - 'updated_at') then
      return new;
    end if;
    raise exception 'Un presupuesto aceptado no se modifica' using errcode = 'P0001', hint = 'quote_frozen';
  end if;
  if tg_op <> 'DELETE' and not exists (select 1 from public.tax_rates t where t.id = new.tax_rate_id and t.kind = 'vat') then
    raise exception 'El impuesto de una línea tiene que ser un tipo de IVA' using errcode = 'P0001', hint = 'vat_rate_required';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger quote_lines_guard before insert or update or delete on public.quote_lines
  for each row execute function private.quote_lines_guard();

-- ---------------------------------------------------------------------------
-- Triggers comunes
-- ---------------------------------------------------------------------------
create trigger set_updated_at before update on public.quotes for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.quote_lines for each row execute function private.set_updated_at();

-- Auditoría de la cabecera. Las líneas se guardan siempre como conjunto completo (como las de
-- una factura) y no llenan el log.
create trigger audit after insert or update or delete on public.quotes for each row execute function private.audit_row();

-- ---------------------------------------------------------------------------
-- RLS y privilegios
-- ---------------------------------------------------------------------------
alter table public.quotes enable row level security;
alter table public.quote_lines enable row level security;

-- Los ve cualquier miembro; se escriben solo con las RPC. Un socio puede borrar un borrador.
create policy quotes_select on public.quotes for select to authenticated using (private.has_role(org_id, 'viewer'));
create policy quotes_delete on public.quotes for delete to authenticated using (private.has_role(org_id, 'partner') and status = 'draft');
create policy quote_lines_select on public.quote_lines for select to authenticated using (private.has_role(org_id, 'viewer'));
revoke insert, update on public.quotes from authenticated;
revoke insert, update, delete on public.quote_lines from authenticated;

-- ---------------------------------------------------------------------------
-- Vista derivada (security_invoker: respeta la RLS de quien consulta)
-- ---------------------------------------------------------------------------

-- Presupuestos con su estado derivado (caducado) y sus totales por tipo, nunca mezclados:
-- lo puntual, lo mensual y lo anual van en columnas distintas (bases, sin IVA).
create view public.quotes_overview with (security_invoker = true) as
select
  q.id,
  q.org_id,
  q.client_id,
  c.display_name as client_name,
  q.deal_id,
  d.title as deal_title,
  q.issuer_id,
  coalesce(iss.trade_name, iss.legal_name) as issuer_name,
  q.number,
  q.title,
  q.status,
  case
    when q.status = 'sent' and q.valid_until < (now() at time zone o.timezone)::date then 'expired'
    else q.status::text
  end::public.quote_state as state,
  q.issued_on,
  q.valid_until,
  q.language,
  q.accepted_at,
  q.rejected_at,
  q.contract_id,
  q.created_at,
  q.updated_at,
  coalesce(t.lines_count, 0)::integer as lines_count,
  coalesce(t.one_off_cents, 0)::bigint as one_off_cents,
  coalesce(t.monthly_cents, 0)::bigint as monthly_cents,
  coalesce(t.yearly_cents, 0)::bigint as yearly_cents,
  coalesce(t.usage_lines_count, 0)::integer as usage_lines_count
from public.quotes q
join public.orgs o on o.id = q.org_id
join public.clients c on c.id = q.client_id
join public.issuers iss on iss.id = q.issuer_id
left join public.deals d on d.id = q.deal_id
left join lateral (
  select
    count(*) as lines_count,
    sum(l.base_cents) filter (where l.billing_type = 'one_off') as one_off_cents,
    sum(l.base_cents) filter (where l.billing_type = 'monthly') as monthly_cents,
    sum(l.base_cents) filter (where l.billing_type = 'yearly') as yearly_cents,
    count(*) filter (where l.billing_type = 'usage') as usage_lines_count
  from public.quote_lines l
  where l.quote_id = q.id
) t on true;

revoke all on public.quotes_overview from anon;

-- ---------------------------------------------------------------------------
-- RPC
-- ---------------------------------------------------------------------------

-- Guarda un presupuesto (o lo crea si no hay id) con todas sus líneas: conjunto completo, lo que
-- no viene se borra. Las bases vienen calculadas de TS. Solo se editan borradores y enviados.
-- Contrato del JSON (p):
--   quote_id?, expected_updated_at?,
--   header: { client_id, deal_id?, issuer_id, title, issued_on?, valid_until?, language, notes?,
--             payment_plan: [{ label, percent_bps, when, planned_on? }] },
--   lines: [{ id (obligatorio), position, description, billing_type, quantity, unit_price_cents,
--             discount_bps, tax_rate_id, irpf_applies, starts_on?, ends_on?, billing_day?,
--             prorate_first, base_cents }]
create function public.save_quote(p jsonb) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  h jsonb := coalesce(p -> 'header', '{}'::jsonb);
  v_lines jsonb := coalesce(p -> 'lines', '[]'::jsonb);
  v_plan jsonb := coalesce(h -> 'payment_plan', '[]'::jsonb);
  v_id uuid := nullif(p ->> 'quote_id', '')::uuid;
  v_issued date := nullif(h ->> 'issued_on', '')::date;
  v_valid date := nullif(h ->> 'valid_until', '')::date;
  v_quote public.quotes;
  v_org uuid;
  v_error text;
begin
  if jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) > 200 then
    raise exception 'Las líneas tienen que ser una lista de 200 como mucho' using errcode = '22023';
  end if;

  if v_id is not null then
    select * into v_quote from public.quotes where id = v_id for update;
    if not found or not private.has_role(v_quote.org_id, 'partner') then
      raise exception 'Sin permiso sobre este presupuesto' using errcode = '42501';
    end if;
    if v_quote.status = 'accepted' then
      raise exception 'Un presupuesto aceptado no se modifica' using errcode = 'P0001', hint = 'quote_frozen';
    end if;
    if v_quote.status = 'rejected' then
      raise exception 'Un presupuesto rechazado no se modifica: duplícalo' using errcode = 'P0001', hint = 'quote_not_editable';
    end if;
    if nullif(p ->> 'expected_updated_at', '') is not null
       and (p ->> 'expected_updated_at')::timestamptz <> v_quote.updated_at then
      raise exception 'El presupuesto ha cambiado mientras lo editabas' using errcode = 'P0001', hint = 'quote_changed';
    end if;
    v_org := v_quote.org_id;
    -- Uno ya enviado conserva sus fechas si no llegan otras.
    if v_quote.status <> 'draft' then
      v_issued := coalesce(v_issued, v_quote.issued_on);
      v_valid := coalesce(v_valid, v_quote.valid_until);
    end if;
  else
    select c.org_id into v_org from public.clients c where c.id = nullif(h ->> 'client_id', '')::uuid;
    if v_org is null or not private.has_role(v_org, 'partner') then
      raise exception 'Sin permiso para presupuestar en esta organización' using errcode = '42501';
    end if;
  end if;

  if v_issued is not null and v_issued > private.org_today(v_org) then
    raise exception 'Un presupuesto no puede llevar fecha futura' using errcode = 'P0001', hint = 'quote_future_date';
  end if;

  if v_id is not null then
    update public.quotes set
      client_id = (h ->> 'client_id')::uuid,
      deal_id = nullif(h ->> 'deal_id', '')::uuid,
      issuer_id = (h ->> 'issuer_id')::uuid,
      title = btrim(h ->> 'title'),
      issued_on = v_issued,
      valid_until = v_valid,
      language = coalesce(nullif(h ->> 'language', '')::public.app_locale, language),
      notes = nullif(btrim(h ->> 'notes'), ''),
      payment_plan = v_plan
    where id = v_id;
  else
    insert into public.quotes (org_id, client_id, deal_id, issuer_id, title, issued_on, valid_until, language, notes, payment_plan)
    values (
      v_org,
      (h ->> 'client_id')::uuid,
      nullif(h ->> 'deal_id', '')::uuid,
      (h ->> 'issuer_id')::uuid,
      btrim(h ->> 'title'),
      v_issued,
      v_valid,
      coalesce(nullif(h ->> 'language', '')::public.app_locale, 'es'),
      nullif(btrim(h ->> 'notes'), ''),
      v_plan
    )
    returning id into v_id;
  end if;

  if exists (select 1 from jsonb_array_elements(v_lines) x where nullif(x ->> 'id', '') is null) then
    raise exception 'Cada línea necesita su id' using errcode = '22023', hint = 'line_id_required';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_lines) x
    join public.quote_lines l on l.id = (x ->> 'id')::uuid
    where l.quote_id <> v_id
  ) then
    raise exception 'Una línea de otro presupuesto no se puede mover aquí' using errcode = 'P0001', hint = 'line_foreign';
  end if;

  delete from public.quote_lines l
  where l.quote_id = v_id
    and l.id not in (select (x ->> 'id')::uuid from jsonb_array_elements(v_lines) x);

  insert into public.quote_lines (
    id, org_id, quote_id, position, description, billing_type, quantity, unit_price_cents, discount_bps,
    tax_rate_id, irpf_applies, starts_on, ends_on, billing_day, prorate_first, base_cents
  )
  select
    x.id, v_org, v_id, coalesce(x.position, 0), btrim(x.description), x.billing_type, coalesce(x.quantity, 1),
    x.unit_price_cents, coalesce(x.discount_bps, 0), x.tax_rate_id, coalesce(x.irpf_applies, true),
    x.starts_on, x.ends_on, x.billing_day, coalesce(x.prorate_first, true), x.base_cents
  from jsonb_to_recordset(v_lines) as x (
    id uuid, position smallint, description text, billing_type public.billing_type, quantity numeric,
    unit_price_cents bigint, discount_bps integer, tax_rate_id uuid, irpf_applies boolean, starts_on date,
    ends_on date, billing_day smallint, prorate_first boolean, base_cents bigint
  )
  on conflict (id) do update set
    position = excluded.position,
    description = excluded.description,
    billing_type = excluded.billing_type,
    quantity = excluded.quantity,
    unit_price_cents = excluded.unit_price_cents,
    discount_bps = excluded.discount_bps,
    tax_rate_id = excluded.tax_rate_id,
    irpf_applies = excluded.irpf_applies,
    starts_on = excluded.starts_on,
    ends_on = excluded.ends_on,
    billing_day = excluded.billing_day,
    prorate_first = excluded.prorate_first,
    base_cents = excluded.base_cents
  where (quote_lines.position, quote_lines.description, quote_lines.billing_type, quote_lines.quantity,
         quote_lines.unit_price_cents, quote_lines.discount_bps, quote_lines.tax_rate_id, quote_lines.irpf_applies,
         quote_lines.starts_on, quote_lines.ends_on, quote_lines.billing_day, quote_lines.prorate_first,
         quote_lines.base_cents)
        is distinct from
        (excluded.position, excluded.description, excluded.billing_type, excluded.quantity,
         excluded.unit_price_cents, excluded.discount_bps, excluded.tax_rate_id, excluded.irpf_applies,
         excluded.starts_on, excluded.ends_on, excluded.billing_day, excluded.prorate_first,
         excluded.base_cents);

  v_error := private.quote_plan_error(
    v_plan,
    exists (select 1 from public.quote_lines l where l.quote_id = v_id and l.billing_type = 'one_off')
  );
  if v_error is not null then
    raise exception 'El plan de pagos no es válido' using errcode = 'P0001', hint = v_error;
  end if;

  -- Cualquier cambio en las líneas cuenta como cambio del presupuesto (bloqueo optimista).
  update public.quotes set updated_at = now() where id = v_id;
  return v_id;
end;
$$;

-- Primer envío (o «marcar como enviado»): borrador → enviado, con su número. Si ya estaba
-- enviado (o aceptado, o rechazado), devuelve lo que tiene: se puede reenviar.
create function public.finalize_quote(p_quote_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote public.quotes;
  v_error text;
begin
  select * into v_quote from public.quotes where id = p_quote_id for update;
  if not found or not private.has_role(v_quote.org_id, 'partner') then
    raise exception 'Sin permiso sobre este presupuesto' using errcode = '42501';
  end if;
  if v_quote.status = 'draft' then
    v_error := private.quote_ready_error(v_quote);
    if v_error is not null then
      raise exception 'El presupuesto no está listo para enviarse' using errcode = 'P0001', hint = v_error;
    end if;
    v_quote := private.finalize_quote_row(v_quote, true);
  end if;
  return jsonb_build_object(
    'quote_id', v_quote.id,
    'number', v_quote.number,
    'status', v_quote.status,
    'issued_on', v_quote.issued_on,
    'valid_until', v_quote.valid_until
  );
end;
$$;

-- Aceptar en un clic (§7.3), en una sola transacción: el presupuesto queda aceptado (y
-- congelado); nace el contrato firmado hoy, con el emisor del presupuesto, una línea por cada
-- línea (enlazadas) y los hitos del plan de pagos (a la aceptación: hoy y automático; en una
-- fecha: esa y automático; a la entrega: sin fecha); y el deal pasa a la primera etapa ganada
-- (el trigger del deal escribe el historial). Devuelve el contrato.
create function public.accept_quote(p_quote_id uuid) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote public.quotes;
  v_error text;
  v_today date;
  v_billing_day smallint;
  v_contract uuid;
  v_line uuid;
  v_stage uuid;
  l public.quote_lines;
begin
  select * into v_quote from public.quotes where id = p_quote_id for update;
  if not found or not private.has_role(v_quote.org_id, 'partner') then
    raise exception 'Sin permiso sobre este presupuesto' using errcode = '42501';
  end if;
  if v_quote.status = 'accepted' then
    raise exception 'Este presupuesto ya está aceptado' using errcode = 'P0001', hint = 'quote_already_accepted';
  end if;
  v_error := private.quote_ready_error(v_quote);
  if v_error is not null then
    raise exception 'El presupuesto no está listo para aceptarse' using errcode = 'P0001', hint = v_error;
  end if;

  v_today := private.org_today(v_quote.org_id);
  if exists (
    select 1 from public.quote_lines ql
    where ql.quote_id = v_quote.id
      and ql.ends_on is not null
      and ql.ends_on < coalesce(ql.starts_on, v_today)
  ) then
    raise exception 'Alguna línea termina antes de empezar el contrato' using errcode = 'P0001', hint = 'quote_line_dates';
  end if;

  if v_quote.status = 'draft' then
    v_quote := private.finalize_quote_row(v_quote, false);
  end if;

  select case
    when jsonb_typeof(o.settings -> 'billing_day') = 'number'
     and (o.settings ->> 'billing_day')::numeric between 1 and 31
    then round((o.settings ->> 'billing_day')::numeric)::smallint
    else 1::smallint
  end
  into v_billing_day
  from public.orgs o
  where o.id = v_quote.org_id;

  insert into public.contracts (org_id, client_id, deal_id, title, signed_on)
  values (v_quote.org_id, v_quote.client_id, v_quote.deal_id, v_quote.title, v_today)
  returning id into v_contract;

  insert into public.contract_issuers (org_id, contract_id, issuer_id, valid_from)
  values (v_quote.org_id, v_contract, v_quote.issuer_id, v_today);

  for l in select * from public.quote_lines ql where ql.quote_id = v_quote.id order by ql.position, ql.created_at, ql.id loop
    insert into public.contract_lines (
      org_id, contract_id, position, description, billing_type, quantity, unit_price_cents, discount_bps,
      tax_rate_id, irpf_applies, starts_on, ends_on, billing_day, prorate_first
    )
    values (
      v_quote.org_id, v_contract, l.position, l.description, l.billing_type, l.quantity, l.unit_price_cents,
      l.discount_bps, l.tax_rate_id, l.irpf_applies,
      case when l.billing_type = 'one_off' then null else coalesce(l.starts_on, v_today) end,
      case when l.billing_type = 'one_off' then null else l.ends_on end,
      case when l.billing_type = 'monthly' then coalesce(l.billing_day, v_billing_day) end,
      l.prorate_first
    )
    returning id into v_line;
    update public.quote_lines set contract_line_id = v_line where id = l.id;
  end loop;

  if exists (select 1 from public.quote_lines ql where ql.quote_id = v_quote.id and ql.billing_type = 'one_off') then
    insert into public.contract_milestones (org_id, contract_id, position, label, percent_bps, planned_on, auto)
    select
      v_quote.org_id,
      v_contract,
      (x.ord - 1)::smallint,
      btrim(x.item ->> 'label'),
      (x.item ->> 'percent_bps')::integer,
      case x.item ->> 'when' when 'on_accept' then v_today when 'date' then (x.item ->> 'planned_on')::date end,
      (x.item ->> 'when') in ('on_accept', 'date')
    from jsonb_array_elements(v_quote.payment_plan) with ordinality as x (item, ord);
  end if;

  update public.quotes
     set status = 'accepted',
         accepted_at = now(),
         rejected_at = null,
         rejection_reason = null,
         contract_id = v_contract
   where id = v_quote.id;

  -- Un deal ya ganado (Ganado, Activo…) no retrocede.
  if v_quote.deal_id is not null then
    select s.id into v_stage
    from public.pipeline_stages s
    where s.org_id = v_quote.org_id and s.kind = 'won' and s.archived_at is null
    order by s.position, s.created_at
    limit 1;
    update public.deals d
       set stage_id = v_stage
     where d.id = v_quote.deal_id
       and v_stage is not null
       and not exists (select 1 from public.pipeline_stages cur where cur.id = d.stage_id and cur.kind = 'won');
  end if;

  return v_contract;
end;
$$;

-- El cliente ha dicho que no. Solo un enviado; un borrador se borra.
create function public.reject_quote(p_quote_id uuid, p_reason text default null) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote public.quotes;
begin
  select * into v_quote from public.quotes where id = p_quote_id for update;
  if not found or not private.has_role(v_quote.org_id, 'partner') then
    raise exception 'Sin permiso sobre este presupuesto' using errcode = '42501';
  end if;
  if v_quote.status = 'rejected' then
    return;
  end if;
  if v_quote.status = 'accepted' then
    raise exception 'Un presupuesto aceptado no se modifica' using errcode = 'P0001', hint = 'quote_frozen';
  end if;
  if v_quote.status = 'draft' then
    raise exception 'Un borrador no se rechaza: bórralo o envíalo' using errcode = 'P0001', hint = 'quote_not_sent';
  end if;
  update public.quotes
     set status = 'rejected',
         rejected_at = now(),
         rejection_reason = nullif(left(btrim(coalesce(p_reason, '')), 500), '')
   where id = v_quote.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privilegios de funciones
-- ---------------------------------------------------------------------------
revoke all on function private.quote_plan_date(text) from public;
revoke all on function private.quote_plan_error(jsonb, boolean) from public;
revoke all on function private.quote_ready_error(public.quotes) from public;
revoke all on function private.quote_validity_days(uuid) from public;
revoke all on function private.next_quote_number(uuid, date) from public;
revoke all on function private.finalize_quote_row(public.quotes, boolean) from public;

revoke all on function public.save_quote(jsonb) from public, anon;
revoke all on function public.finalize_quote(uuid) from public, anon;
revoke all on function public.accept_quote(uuid) from public, anon;
revoke all on function public.reject_quote(uuid, text) from public, anon;

grant execute on function public.save_quote(jsonb) to authenticated;
grant execute on function public.finalize_quote(uuid) to authenticated;
grant execute on function public.accept_quote(uuid) to authenticated;
grant execute on function public.reject_quote(uuid, text) to authenticated;

revoke all on all tables in schema public from anon;
