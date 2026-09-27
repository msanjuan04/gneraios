-- GNERAI OS · Proveedores y freelancers
-- Finanzas → Proveedores: cada proveedor (una empresa o un freelance) con sus datos de contacto y
-- de pago, y lo que nos cuesta: cuánto este año y en total, lo que falta pagarle y para quién ha
-- trabajado (la empresa, cada cliente o las webs que alojamos). Completa `vendors`
-- (20260926210000_control.sql) y el reparto de los gastos (20260927100000_gastos_clientes.sql).
--
-- Nada de lo que cuesta un proveedor se guarda: sale de sus gastos en dos vistas.
-- - vendors_overview: el proveedor y sus cifras (gastos, coste total y del año en curso en la zona
--   de la org, lo pendiente de pagar y lo vencido, el último gasto y cuántos clientes ha servido).
-- - vendor_costs_by_allocation: lo mismo por destino (empresa, cada cliente, webs alojadas). Es el
--   «¿Para quién?» de la ficha del proveedor y la tarjeta de proveedores de la ficha del cliente.
--
-- Coste = base + IVA no deducible: la misma regla que expenses_overview.cost_cents, la
-- rentabilidad y la infraestructura (src/domain/finance/expense.ts, expenseCostCents). Con el IVA
-- deducible, es la base. Pendiente = el total (base + IVA − IRPF) de lo que aún no se ha pagado:
-- lo que hay que transferirle.

-- ---------------------------------------------------------------------------
-- 1. Tipo de proveedor y datos de contacto y de pago
-- ---------------------------------------------------------------------------
create type public.vendor_kind as enum (
  'company',    -- una empresa (SaaS, gestoría, hosting, una agencia…)
  'freelancer'  -- una persona que nos factura por su trabajo
);

-- Los checks miran el valor ya normalizado: el trigger BEFORE va antes que ellos. Son los mismos
-- que el formulario (src/app/[org]/finance/vendors/schema.ts).
alter table public.vendors
  add column kind public.vendor_kind not null default 'company',
  add column contact_name text check (contact_name is null or char_length(contact_name) between 1 and 200),
  add column email text check (
    email is null or (char_length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
  ),
  add column phone text check (phone is null or phone ~ '^\+?[0-9[:space:]().-]{6,25}$'),
  -- A dónde se le transfiere. Formato electrónico (sin espacios); el dígito de control lo valida TS.
  add column iban text check (iban is null or iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'),
  -- "estudi.cat", "www.estudi.cat/portfolio" o "https://estudi.cat".
  add column website text check (
    website is null or (char_length(website) <= 300 and website ~ '^(https?://)?[^[:space:]/?#@]+\.[^[:space:]]+$')
  ),
  add column notes text check (notes is null or char_length(notes) <= 2000);

create index vendors_org_kind_idx on public.vendors (org_id, kind);

-- La misma normalización que antes (nombre, NIF y país) y la de los datos nuevos: sin espacios
-- en los extremos, vacío = null, el email en minúsculas y el IBAN en formato electrónico.
create or replace function private.vendors_normalize() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name := btrim(new.name);
  new.tax_id := nullif(upper(regexp_replace(coalesce(new.tax_id, ''), '[^A-Za-z0-9]', '', 'g')), '');
  new.country_code := upper(new.country_code);
  new.contact_name := nullif(btrim(coalesce(new.contact_name, '')), '');
  new.email := nullif(lower(btrim(coalesce(new.email, ''))), '');
  new.phone := nullif(btrim(coalesce(new.phone, '')), '');
  new.iban := nullif(upper(regexp_replace(coalesce(new.iban, ''), '[^A-Za-z0-9]', '', 'g')), '');
  new.website := nullif(btrim(coalesce(new.website, '')), '');
  new.notes := nullif(btrim(coalesce(new.notes, '')), '');
  return new;
end;
$$;

-- La RLS de `vendors` no cambia (control.sql): los ve cualquier miembro y los lleva un socio. Se
-- archivan, no se borran (no hay política de borrado).

-- ---------------------------------------------------------------------------
-- 2. El proveedor y lo que nos cuesta
-- ---------------------------------------------------------------------------
-- security_invoker: las cifras salen de los gastos que la RLS deja ver a quien consulta.
create view public.vendors_overview with (security_invoker = true) as
select
  v.id,
  v.org_id,
  v.name,
  v.kind,
  v.tax_id,
  v.country_code,
  v.contact_name,
  v.email,
  v.phone,
  v.iban,
  v.website,
  v.notes,
  v.default_category_id,
  v.archived_at,
  v.created_at,
  v.updated_at,
  coalesce(s.expenses_count, 0)::integer as expenses_count,
  coalesce(s.base_cents, 0)::bigint as base_cents,
  coalesce(s.cost_cents, 0)::bigint as cost_cents,
  coalesce(s.year_expenses_count, 0)::integer as year_expenses_count,
  coalesce(s.year_cost_cents, 0)::bigint as year_cost_cents,
  coalesce(s.pending_cents, 0)::bigint as pending_cents,
  coalesce(s.pending_count, 0)::integer as pending_count,
  coalesce(s.overdue_cents, 0)::bigint as overdue_cents,
  coalesce(s.overdue_count, 0)::integer as overdue_count,
  s.first_expense_on,
  s.last_expense_on,
  coalesce(s.clients_count, 0)::integer as clients_count
from public.vendors v
join public.orgs o on o.id = v.org_id
-- Hoy y el año en curso en la zona de la org (lo mismo que el vencido de expenses_overview).
cross join lateral (
  select
    (now() at time zone o.timezone)::date as today,
    date_trunc('year', now() at time zone o.timezone)::date as year_start
) d
left join lateral (
  select
    count(*) as expenses_count,
    sum(e.base_cents) as base_cents,
    sum(e.base_cents + case when e.vat_deductible then 0 else e.vat_cents end) as cost_cents,
    count(*) filter (where e.issued_on >= d.year_start and e.issued_on < (d.year_start + interval '1 year')::date) as year_expenses_count,
    sum(e.base_cents + case when e.vat_deductible then 0 else e.vat_cents end)
      filter (where e.issued_on >= d.year_start and e.issued_on < (d.year_start + interval '1 year')::date) as year_cost_cents,
    sum(e.total_cents) filter (where e.paid_on is null) as pending_cents,
    count(*) filter (where e.paid_on is null) as pending_count,
    sum(e.total_cents) filter (where e.paid_on is null and coalesce(e.due_on, e.issued_on) < d.today) as overdue_cents,
    count(*) filter (where e.paid_on is null and coalesce(e.due_on, e.issued_on) < d.today) as overdue_count,
    min(e.issued_on) as first_expense_on,
    max(e.issued_on) as last_expense_on,
    count(distinct e.client_id) filter (where e.allocation = 'client') as clients_count
  from public.expenses e
  where e.vendor_id = v.id
) s on true;

-- ---------------------------------------------------------------------------
-- 3. Lo que nos cuesta un proveedor para cada destino
-- ---------------------------------------------------------------------------
-- Una fila por proveedor y destino: la empresa, cada cliente (con su nombre) o las webs alojadas.
-- Filtrada por proveedor es su «¿Para quién?»; filtrada por cliente, quién ha trabajado para él.
create view public.vendor_costs_by_allocation with (security_invoker = true) as
select
  e.org_id,
  e.vendor_id,
  v.name as vendor_name,
  v.kind as vendor_kind,
  v.archived_at as vendor_archived_at,
  e.allocation,
  e.client_id,
  cl.display_name as client_name,
  count(*)::integer as expenses_count,
  sum(e.base_cents)::bigint as base_cents,
  sum(e.base_cents + case when e.vat_deductible then 0 else e.vat_cents end)::bigint as cost_cents,
  count(*) filter (where e.issued_on >= d.year_start and e.issued_on < (d.year_start + interval '1 year')::date)::integer as year_expenses_count,
  coalesce(
    sum(e.base_cents + case when e.vat_deductible then 0 else e.vat_cents end)
      filter (where e.issued_on >= d.year_start and e.issued_on < (d.year_start + interval '1 year')::date),
    0
  )::bigint as year_cost_cents,
  coalesce(sum(e.total_cents) filter (where e.paid_on is null), 0)::bigint as pending_cents,
  min(e.issued_on) as first_expense_on,
  max(e.issued_on) as last_expense_on
from public.expenses e
join public.orgs o on o.id = e.org_id
join public.vendors v on v.id = e.vendor_id
left join public.clients cl on cl.id = e.client_id
cross join lateral (select date_trunc('year', now() at time zone o.timezone)::date as year_start) d
group by e.org_id, e.vendor_id, v.name, v.kind, v.archived_at, e.allocation, e.client_id, cl.display_name;

revoke all on public.vendors_overview, public.vendor_costs_by_allocation from anon;
