-- GNERAI OS · Control 0 · Gastos, caja y socios
-- Proveedores, categorías de gasto (sembradas por org), gastos con IVA soportado y retenciones
-- practicadas, suscripciones que generan gastos, cuentas y saldos de caja, y participaciones de
-- los socios. Es lo que el agente CFO necesita y todavía no había (CONSEJO.md §3).
-- Ver ARCHITECTURE.md §6 (convenciones) y §13 (fase 2).
--
-- Reparto de responsabilidades (como en facturación):
-- - Los importes de un gasto (IVA e IRPF redondeados) los calcula TS con la única implementación
--   del redondeo (src/domain/finance → src/domain/tax). Aquí solo se comprueban invariantes
--   baratos: total = base + IVA − IRPF.
-- - El estado de un gasto (pendiente, pagado, vencido) se deriva en expenses_overview: solo se
--   guarda la fecha de pago.
-- - Qué periodos de una suscripción tocan lo calcula TS (el mismo calendario que factura,
--   periodsDue). Aquí (suscripción, periodo) es único: generar dos veces no duplica nada.
-- - Caja: se guardan saldos con fecha (manuales o importados); la posición y la previsión se
--   derivan (cash_position y src/domain/finance).

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
-- Para qué es un gasto: separa lo operativo de las nóminas, la retribución de los socios, el
-- coste directo de lo que se vende, los impuestos y lo financiero.
create type public.expense_group as enum (
  'operating', 'payroll', 'partner_compensation', 'cost_of_sales', 'taxes', 'financial', 'other'
);
create type public.expense_source as enum ('manual', 'import', 'subscription');
create type public.subscription_interval as enum ('monthly', 'yearly');
create type public.cash_balance_source as enum ('manual', 'import');
-- Estado derivado (nunca se guarda): sale de expenses_overview.
create type public.expense_status as enum ('pending', 'paid', 'overdue');

-- ---------------------------------------------------------------------------
-- Categorías de gasto (lista que edita cada org)
-- ---------------------------------------------------------------------------
create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  expense_group public.expense_group not null default 'operating',
  -- Coste fijo: lo que se paga aunque no se venda nada. Es lo que cubre el runway.
  is_fixed boolean not null default false,
  position smallint not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id)
);
create index expense_categories_org_position_idx on public.expense_categories (org_id, position);
-- La misma categoría dos veces es la misma categoría escrita dos veces.
create unique index expense_categories_name_idx
  on public.expense_categories (org_id, lower(btrim(name))) where archived_at is null;

-- Valores por defecto de toda org nueva (y relleno para las que ya existen). Son datos, no
-- código: cada org los edita en Ajustes → Gastos.
create function private.seed_org_expense_categories(p_org uuid) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.expense_categories (org_id, name, expense_group, is_fixed, position) values
    (p_org, 'Software y suscripciones', 'operating', true, 1),
    (p_org, 'Freelances y colaboradores', 'cost_of_sales', false, 2),
    (p_org, 'Compras para clientes', 'cost_of_sales', false, 3),
    (p_org, 'Publicidad propia', 'operating', false, 4),
    (p_org, 'Oficina y coworking', 'operating', true, 5),
    (p_org, 'Gestoría y asesoría', 'operating', true, 6),
    (p_org, 'Seguros', 'operating', true, 7),
    (p_org, 'Formación', 'operating', false, 8),
    (p_org, 'Equipos y material', 'operating', false, 9),
    (p_org, 'Viajes y dietas', 'operating', false, 10),
    (p_org, 'Bancos y comisiones', 'financial', true, 11),
    (p_org, 'Nóminas y Seguridad Social', 'payroll', true, 12),
    (p_org, 'Retribución de socios', 'partner_compensation', true, 13),
    (p_org, 'Cuotas de autónomos', 'partner_compensation', true, 14),
    (p_org, 'Impuestos y tasas', 'taxes', false, 15),
    (p_org, 'Otros gastos', 'other', false, 16);
$$;
revoke all on function private.seed_org_expense_categories(uuid) from public;

create function private.orgs_seed_expense_categories() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_org_expense_categories(new.id);
  return null;
end;
$$;

create trigger orgs_seed_expense_categories after insert on public.orgs
  for each row execute function private.orgs_seed_expense_categories();

select private.seed_org_expense_categories(o.id)
from public.orgs o
where not exists (select 1 from public.expense_categories c where c.org_id = o.id);

-- ---------------------------------------------------------------------------
-- Proveedores
-- ---------------------------------------------------------------------------
create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  -- NIF o VAT normalizado (solo letras y números, en mayúsculas), también de fuera de España.
  tax_id text check (tax_id is null or tax_id ~ '^[A-Z0-9]{2,20}$'),
  country_code char(2) not null default 'ES' check (country_code ~ '^[A-Z]{2}$'),
  -- La que se propone al registrar un gasto suyo.
  default_category_id uuid,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  foreign key (org_id, default_category_id) references public.expense_categories (org_id, id)
);
create index vendors_org_name_idx on public.vendors (org_id, name);
-- El mismo NIF dos veces es el mismo proveedor escrito dos veces.
create unique index vendors_tax_id_idx on public.vendors (org_id, tax_id) where tax_id is not null and archived_at is null;

create function private.vendors_normalize() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name := btrim(new.name);
  new.tax_id := nullif(upper(regexp_replace(coalesce(new.tax_id, ''), '[^A-Za-z0-9]', '', 'g')), '');
  new.country_code := upper(new.country_code);
  return new;
end;
$$;

create trigger vendors_normalize before insert or update on public.vendors
  for each row execute function private.vendors_normalize();

-- ---------------------------------------------------------------------------
-- Suscripciones: gastos que se repiten (software, alquiler, gestoría, retribución de socios…)
-- ---------------------------------------------------------------------------
create table public.expense_subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  -- Quién la paga: la SL o un socio autónomo.
  issuer_id uuid not null,
  vendor_id uuid,
  category_id uuid not null,
  -- Retribución de un socio (o lo que adelanta él): pasa a cada gasto generado.
  member_id uuid,
  description text not null check (char_length(btrim(description)) between 1 and 500),
  base_cents bigint not null check (base_cents >= 0),
  vat_bps integer not null default 0 check (vat_bps between 0 and 10000),
  vat_deductible boolean not null default true,
  -- Retención que practicamos al pagar (alquiler, profesional, nómina).
  irpf_bps integer not null default 0 check (irpf_bps between 0 and 10000),
  billing_interval public.subscription_interval not null default 'monthly',
  -- Primer cargo que se registra (y aniversario de las anuales).
  starts_on date not null,
  -- Último día de servicio: no se generan cargos que empiecen después.
  ends_on date,
  -- Mensuales: día del cargo (el último del mes en los meses más cortos, sin deriva).
  billing_day smallint check (billing_day between 1 and 31),
  -- Con tarjeta o domiciliación se cobra sola: el gasto nace pagado el día del cargo.
  payment_method public.payment_method not null default 'card',
  -- Apagada no genera gastos; al volver a encenderla se generan los periodos que falten.
  is_active boolean not null default true,
  notes text check (notes is null or char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  foreign key (org_id, issuer_id) references public.issuers (org_id, id),
  foreign key (org_id, vendor_id) references public.vendors (org_id, id),
  foreign key (org_id, category_id) references public.expense_categories (org_id, id),
  foreign key (org_id, member_id) references public.members (org_id, id),
  check (ends_on is null or ends_on >= starts_on),
  check ((billing_interval = 'monthly') = (billing_day is not null))
);
create index expense_subscriptions_org_idx on public.expense_subscriptions (org_id);

-- ---------------------------------------------------------------------------
-- Gastos
-- ---------------------------------------------------------------------------
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  -- Quién lo paga: la SL o un socio autónomo (cada uno declara su IVA y sus retenciones).
  issuer_id uuid not null,
  vendor_id uuid,
  category_id uuid not null,
  description text not null check (char_length(btrim(description)) between 1 and 500),
  vendor_invoice_number text check (vendor_invoice_number is null or char_length(btrim(vendor_invoice_number)) between 1 and 60),
  -- Fecha de la factura del proveedor (devengo): manda en el mes, en el trimestre del IVA y en
  -- el de las retenciones.
  issued_on date not null,
  -- Vacía: se paga el mismo día de la factura.
  due_on date,
  -- Negativa en un abono del proveedor.
  base_cents bigint not null,
  vat_bps integer not null default 0 check (vat_bps between 0 and 10000),
  -- IVA soportado, ya redondeado en TS.
  vat_cents bigint not null default 0,
  -- Si no es deducible, el IVA es coste y no resta en la liquidación.
  vat_deductible boolean not null default true,
  irpf_bps integer not null default 0 check (irpf_bps between 0 and 10000),
  -- Retención que practicamos al pagar: se ingresa en Hacienda (modelos 111 y 115).
  irpf_cents bigint not null default 0,
  -- Lo que se paga al proveedor: base + IVA − IRPF.
  total_cents bigint not null,
  -- Vacía = pendiente. Pagado y vencido se derivan (expenses_overview).
  paid_on date,
  payment_method public.payment_method,
  -- Retribución de un socio o reembolso de lo que adelantó.
  member_id uuid,
  -- Generado por una suscripción: (suscripción, periodo) es único, así que generar es idempotente.
  subscription_id uuid,
  period_start date,
  -- Justificante en Storage (bucket privado 'expenses'): <org>/<gasto>.<ext>.
  attachment_path text,
  source public.expense_source not null default 'manual',
  external_id text check (external_id is null or char_length(external_id) between 1 and 200),
  notes text check (notes is null or char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  unique (subscription_id, period_start),
  foreign key (org_id, issuer_id) references public.issuers (org_id, id),
  foreign key (org_id, vendor_id) references public.vendors (org_id, id),
  foreign key (org_id, category_id) references public.expense_categories (org_id, id),
  foreign key (org_id, member_id) references public.members (org_id, id),
  foreign key (org_id, subscription_id) references public.expense_subscriptions (org_id, id),
  check (total_cents = base_cents + vat_cents - irpf_cents),
  check (vat_bps > 0 or vat_cents = 0),
  check (irpf_bps > 0 or irpf_cents = 0),
  check ((subscription_id is null) = (period_start is null)),
  check ((source = 'subscription') = (subscription_id is not null)),
  check (due_on is null or due_on >= issued_on),
  check (attachment_path is null or starts_with(attachment_path, org_id::text || '/'))
);
create index expenses_org_issued_idx on public.expenses (org_id, issued_on desc);
create index expenses_org_pending_idx on public.expenses (org_id, due_on) where paid_on is null;
create index expenses_category_idx on public.expenses (category_id);
create index expenses_vendor_idx on public.expenses (vendor_id) where vendor_id is not null;
create index expenses_member_idx on public.expenses (member_id) where member_id is not null;
-- Importaciones idempotentes: reimportar el mismo movimiento no lo duplica.
create unique index expenses_external_id_idx on public.expenses (org_id, external_id) where external_id is not null;

-- ---------------------------------------------------------------------------
-- Caja: cuentas y saldos con fecha
-- ---------------------------------------------------------------------------
create table public.cash_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  -- De quién es la cuenta: la SL o un socio autónomo.
  issuer_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  iban text check (iban is null or iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'),
  -- Cerrada: deja de contar en la caja; su histórico se conserva.
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  foreign key (org_id, issuer_id) references public.issuers (org_id, id)
);
create unique index cash_accounts_iban_idx on public.cash_accounts (org_id, iban) where iban is not null;

create function private.cash_accounts_normalize() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name := btrim(new.name);
  new.iban := nullif(upper(regexp_replace(coalesce(new.iban, ''), '[^A-Za-z0-9]', '', 'g')), '');
  return new;
end;
$$;

create trigger cash_accounts_normalize before insert or update on public.cash_accounts
  for each row execute function private.cash_accounts_normalize();

create table public.cash_balances (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  account_id uuid not null,
  -- Saldo al cierre de ese día (lo que se mueve ese mismo día ya está dentro).
  balance_on date not null,
  -- Negativo en un descubierto.
  balance_cents bigint not null,
  source public.cash_balance_source not null default 'manual',
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  unique (account_id, balance_on),
  foreign key (org_id, account_id) references public.cash_accounts (org_id, id)
);
create index cash_balances_account_idx on public.cash_balances (account_id, balance_on desc);

-- ---------------------------------------------------------------------------
-- Participaciones de los socios en la SL
-- ---------------------------------------------------------------------------
-- Cada fecha es un reparto completo, vigente hasta el siguiente: sus filas suman el 100 %.
create table public.shareholdings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  member_id uuid not null,
  percent_bps integer not null check (percent_bps between 1 and 10000),
  valid_from date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  unique (org_id, valid_from, member_id),
  foreign key (org_id, member_id) references public.members (org_id, id)
);

-- Diferido: se comprueba al confirmar, así que se puede reescribir un reparto entero a la vez.
-- security definer: la suma cuenta todas las filas de esa fecha, las vea o no quien escribe.
create function private.ensure_shareholdings_total() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total bigint;
begin
  if tg_op in ('INSERT', 'UPDATE') then
    select sum(s.percent_bps) into v_total
    from public.shareholdings s
    where s.org_id = new.org_id and s.valid_from = new.valid_from;
    if v_total is not null and v_total <> 10000 then
      raise exception 'Las participaciones de una fecha tienen que sumar el 100 %%'
        using errcode = 'P0001', hint = 'shareholdings_total';
    end if;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    select sum(s.percent_bps) into v_total
    from public.shareholdings s
    where s.org_id = old.org_id and s.valid_from = old.valid_from;
    if v_total is not null and v_total <> 10000 then
      raise exception 'Las participaciones de una fecha tienen que sumar el 100 %%'
        using errcode = 'P0001', hint = 'shareholdings_total';
    end if;
  end if;
  return null;
end;
$$;

create constraint trigger shareholdings_total
  after insert or update or delete on public.shareholdings
  deferrable initially deferred
  for each row execute function private.ensure_shareholdings_total();

-- ---------------------------------------------------------------------------
-- Guardas
-- ---------------------------------------------------------------------------

-- Una categoría archivada ya no se elige; lo que ya la tenía la conserva. Los gastos que genera
-- una suscripción heredan su categoría (el cron nunca falla por esto).
create function private.expense_category_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- to_jsonb: la misma función sirve para gastos (con suscripción) y para suscripciones (sin ella).
  if (tg_op = 'INSERT' or new.category_id is distinct from old.category_id)
     and (to_jsonb(new) ->> 'subscription_id') is null
     and exists (select 1 from public.expense_categories c where c.id = new.category_id and c.archived_at is not null) then
    raise exception 'Esa categoría está archivada: elige otra' using errcode = 'P0001', hint = 'category_archived';
  end if;
  return new;
end;
$$;

create trigger expense_category_guard before insert or update of category_id on public.expenses
  for each row execute function private.expense_category_guard();
create trigger expense_category_guard before insert or update of category_id on public.expense_subscriptions
  for each row execute function private.expense_category_guard();

-- La clave de la generación (suscripción, periodo) y el origen no cambian. Lo que una
-- suscripción activa volvería a generar no se borra: se corrige su importe, o antes se apaga la
-- suscripción o se cambian sus fechas.
create function private.expenses_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.subscription_id is not null and exists (
      select 1 from public.expense_subscriptions s
      where s.id = old.subscription_id
        and s.is_active
        and old.period_start >= s.starts_on
        and (s.ends_on is null or old.period_start <= s.ends_on)
    ) then
      raise exception 'Este gasto lo genera una suscripción activa: corrige su importe o apaga antes la suscripción'
        using errcode = 'P0001', hint = 'expense_generated';
    end if;
    return old;
  end if;
  if (new.subscription_id, new.period_start, new.source) is distinct from (old.subscription_id, old.period_start, old.source) then
    raise exception 'El origen de un gasto no cambia' using errcode = 'P0001', hint = 'expense_origin_fixed';
  end if;
  return new;
end;
$$;

create trigger expenses_guard before update or delete on public.expenses
  for each row execute function private.expenses_guard();

-- Una suscripción que ya ha generado gastos no cambia de calendario (se duplicarían meses): se
-- termina con una fecha de fin y se crea otra. El importe, la categoría o el pagador sí cambian
-- (solo para lo que se genere a partir de ahora).
create function private.expense_subscriptions_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.billing_interval, new.billing_day, new.starts_on) is distinct from (old.billing_interval, old.billing_day, old.starts_on)
     and exists (select 1 from public.expenses e where e.subscription_id = old.id) then
    raise exception 'Esta suscripción ya ha generado gastos: para cambiar su calendario, termínala y crea otra'
      using errcode = 'P0001', hint = 'subscription_schedule_locked';
  end if;
  return new;
end;
$$;

create trigger expense_subscriptions_guard before update on public.expense_subscriptions
  for each row execute function private.expense_subscriptions_guard();

-- ---------------------------------------------------------------------------
-- Triggers comunes
-- ---------------------------------------------------------------------------
create trigger set_updated_at before update on public.expense_categories for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.vendors for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.expense_subscriptions for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.expenses for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.cash_accounts for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.cash_balances for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.shareholdings for each row execute function private.set_updated_at();

create trigger audit after insert or update or delete on public.expense_categories for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.vendors for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.expense_subscriptions for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.expenses for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.cash_accounts for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.cash_balances for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.shareholdings for each row execute function private.audit_row();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.expense_categories enable row level security;
alter table public.vendors enable row level security;
alter table public.expense_subscriptions enable row level security;
alter table public.expenses enable row level security;
alter table public.cash_accounts enable row level security;
alter table public.cash_balances enable row level security;
alter table public.shareholdings enable row level security;

-- Categorías: configuración. La ve cualquier miembro y la cambia un owner. Se archivan, no se borran.
create policy expense_categories_select on public.expense_categories for select to authenticated using (private.has_role(org_id, 'viewer'));
create policy expense_categories_insert on public.expense_categories for insert to authenticated with check (private.has_role(org_id, 'owner'));
create policy expense_categories_update on public.expense_categories for update to authenticated using (private.has_role(org_id, 'owner')) with check (private.has_role(org_id, 'owner'));

-- Proveedores: los ve cualquier miembro y los lleva un socio. Se archivan, no se borran.
create policy vendors_select on public.vendors for select to authenticated using (private.has_role(org_id, 'viewer'));
create policy vendors_insert on public.vendors for insert to authenticated with check (private.has_role(org_id, 'partner'));
create policy vendors_update on public.vendors for update to authenticated using (private.has_role(org_id, 'partner')) with check (private.has_role(org_id, 'partner'));

-- Suscripciones y gastos: los ve cualquier miembro y los lleva un socio. Una suscripción con
-- gastos no se borra (la FK lo impide; delete_expense_subscription borra las dos cosas).
create policy expense_subscriptions_select on public.expense_subscriptions for select to authenticated using (private.has_role(org_id, 'viewer'));
create policy expense_subscriptions_insert on public.expense_subscriptions for insert to authenticated with check (private.has_role(org_id, 'partner'));
create policy expense_subscriptions_update on public.expense_subscriptions for update to authenticated using (private.has_role(org_id, 'partner')) with check (private.has_role(org_id, 'partner'));
create policy expense_subscriptions_delete on public.expense_subscriptions for delete to authenticated using (private.has_role(org_id, 'partner'));

create policy expenses_select on public.expenses for select to authenticated using (private.has_role(org_id, 'viewer'));
create policy expenses_insert on public.expenses for insert to authenticated with check (private.has_role(org_id, 'partner'));
create policy expenses_update on public.expenses for update to authenticated using (private.has_role(org_id, 'partner')) with check (private.has_role(org_id, 'partner'));
create policy expenses_delete on public.expenses for delete to authenticated using (private.has_role(org_id, 'partner'));

-- Caja: las cuentas se cierran (no se borran); un saldo mal apuntado se corrige o se borra.
create policy cash_accounts_select on public.cash_accounts for select to authenticated using (private.has_role(org_id, 'viewer'));
create policy cash_accounts_insert on public.cash_accounts for insert to authenticated with check (private.has_role(org_id, 'partner'));
create policy cash_accounts_update on public.cash_accounts for update to authenticated using (private.has_role(org_id, 'partner')) with check (private.has_role(org_id, 'partner'));

create policy cash_balances_select on public.cash_balances for select to authenticated using (private.has_role(org_id, 'viewer'));
create policy cash_balances_insert on public.cash_balances for insert to authenticated with check (private.has_role(org_id, 'partner'));
create policy cash_balances_update on public.cash_balances for update to authenticated using (private.has_role(org_id, 'partner')) with check (private.has_role(org_id, 'partner'));
create policy cash_balances_delete on public.cash_balances for delete to authenticated using (private.has_role(org_id, 'partner'));

-- Participaciones: las ve cualquier miembro y las cambia un owner (save_shareholdings).
create policy shareholdings_select on public.shareholdings for select to authenticated using (private.has_role(org_id, 'viewer'));
create policy shareholdings_insert on public.shareholdings for insert to authenticated with check (private.has_role(org_id, 'owner'));
create policy shareholdings_update on public.shareholdings for update to authenticated using (private.has_role(org_id, 'owner')) with check (private.has_role(org_id, 'owner'));
create policy shareholdings_delete on public.shareholdings for delete to authenticated using (private.has_role(org_id, 'owner'));

-- ---------------------------------------------------------------------------
-- Vistas derivadas (security_invoker: respetan la RLS de quien consulta)
-- ---------------------------------------------------------------------------

-- Gastos con su estado derivado (pagado, vencido o pendiente), su categoría y su grupo, el
-- proveedor, el pagador y lo que cuesta de verdad (la base y, si no se deduce, también el IVA).
create view public.expenses_overview with (security_invoker = true) as
select
  e.id,
  e.org_id,
  e.issuer_id,
  coalesce(iss.trade_name, iss.legal_name) as issuer_name,
  e.vendor_id,
  v.name as vendor_name,
  e.category_id,
  c.name as category_name,
  c.expense_group,
  c.is_fixed,
  e.description,
  e.vendor_invoice_number,
  e.issued_on,
  e.due_on,
  coalesce(e.due_on, e.issued_on) as payable_on,
  date_trunc('month', e.issued_on::timestamp)::date as month,
  date_trunc('quarter', e.issued_on::timestamp)::date as quarter,
  e.base_cents,
  e.vat_bps,
  e.vat_cents,
  e.vat_deductible,
  (case when e.vat_deductible then e.vat_cents else 0 end)::bigint as deductible_vat_cents,
  (e.base_cents + case when e.vat_deductible then 0 else e.vat_cents end)::bigint as cost_cents,
  e.irpf_bps,
  e.irpf_cents,
  e.total_cents,
  e.paid_on,
  e.payment_method,
  e.member_id,
  m.full_name as member_name,
  m.initials as member_initials,
  e.subscription_id,
  e.period_start,
  e.attachment_path,
  e.source,
  e.external_id,
  e.notes,
  e.created_at,
  e.updated_at,
  case
    when e.paid_on is not null then 'paid'
    when coalesce(e.due_on, e.issued_on) < (now() at time zone o.timezone)::date then 'overdue'
    else 'pending'
  end::public.expense_status as status
from public.expenses e
join public.orgs o on o.id = e.org_id
join public.issuers iss on iss.id = e.issuer_id
join public.expense_categories c on c.id = e.category_id
left join public.vendors v on v.id = e.vendor_id
left join public.members m on m.id = e.member_id;

-- El último saldo de cada cuenta y la caja de la org: la suma del último saldo de cada cuenta
-- activa (pueden ser de días distintos; las fechas extremas dicen cuánto de vieja es la foto).
create view public.cash_position with (security_invoker = true) as
select
  a.id as account_id,
  a.org_id,
  a.issuer_id,
  coalesce(iss.trade_name, iss.legal_name) as issuer_name,
  a.name,
  a.iban,
  a.is_active,
  lb.balance_on,
  lb.balance_cents,
  lb.source,
  coalesce(sum(lb.balance_cents) filter (where a.is_active) over (partition by a.org_id), 0)::bigint as org_total_cents,
  min(lb.balance_on) filter (where a.is_active) over (partition by a.org_id) as org_oldest_balance_on,
  max(lb.balance_on) filter (where a.is_active) over (partition by a.org_id) as org_latest_balance_on
from public.cash_accounts a
join public.issuers iss on iss.id = a.issuer_id
left join lateral (
  select b.balance_on, b.balance_cents, b.source
  from public.cash_balances b
  where b.account_id = a.id
  order by b.balance_on desc
  limit 1
) lb on true;

-- Gastos por pagador, mes y categoría (con su grupo y si es fijo), por la fecha de la factura.
-- La columna del trimestre da el IVA soportado deducible y las retenciones de cada trimestre.
create view public.expenses_by_month with (security_invoker = true) as
select
  e.org_id,
  e.issuer_id,
  date_trunc('month', e.issued_on::timestamp)::date as month,
  date_trunc('quarter', e.issued_on::timestamp)::date as quarter,
  e.category_id,
  c.expense_group,
  c.is_fixed,
  count(*)::integer as expenses_count,
  sum(e.base_cents)::bigint as base_cents,
  sum(e.vat_cents)::bigint as vat_cents,
  sum(case when e.vat_deductible then e.vat_cents else 0 end)::bigint as deductible_vat_cents,
  sum(e.base_cents + case when e.vat_deductible then 0 else e.vat_cents end)::bigint as cost_cents,
  sum(e.irpf_cents)::bigint as irpf_cents,
  sum(e.total_cents)::bigint as total_cents
from public.expenses e
join public.expense_categories c on c.id = e.category_id
group by e.org_id, e.issuer_id, date_trunc('month', e.issued_on::timestamp), date_trunc('quarter', e.issued_on::timestamp),
  e.category_id, c.expense_group, c.is_fixed;

-- Impuestos de las facturas emitidas por emisor y mes (las rectificativas restan en el suyo):
-- el IVA repercutido de cada trimestre para la estimación del 303.
create view public.invoice_taxes_by_month with (security_invoker = true) as
select
  i.org_id,
  i.issuer_id,
  date_trunc('month', i.issued_on::timestamp)::date as month,
  date_trunc('quarter', i.issued_on::timestamp)::date as quarter,
  count(*)::integer as invoices_count,
  sum(i.subtotal_cents)::bigint as base_cents,
  sum(i.vat_cents)::bigint as vat_cents,
  sum(i.irpf_cents)::bigint as irpf_cents
from public.invoices i
where i.lifecycle = 'issued'
group by i.org_id, i.issuer_id, date_trunc('month', i.issued_on::timestamp), date_trunc('quarter', i.issued_on::timestamp);

revoke all on public.expenses_overview, public.cash_position, public.expenses_by_month, public.invoice_taxes_by_month from anon;

-- ---------------------------------------------------------------------------
-- RPC
-- ---------------------------------------------------------------------------

-- Reescribe de una vez el reparto de una fecha (y, si se ha movido de fecha, borra el de la
-- anterior). El 100 % se comprueba al confirmar (trigger diferido). Un reparto vacío lo borra.
-- security invoker: manda la RLS de quien lo guarda (owner).
create function public.save_shareholdings(p_org uuid, p_valid_from date, p jsonb, p_previous_valid_from date default null)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not private.has_role(p_org, 'owner') then
    raise exception 'Solo un owner puede cambiar las participaciones' using errcode = '42501';
  end if;
  delete from public.shareholdings s
  where s.org_id = p_org
    and s.valid_from in (p_valid_from, coalesce(p_previous_valid_from, p_valid_from));
  insert into public.shareholdings (org_id, member_id, percent_bps, valid_from)
  select p_org, x.member_id, x.percent_bps, p_valid_from
  from jsonb_to_recordset(coalesce(p, '[]'::jsonb)) as x (member_id uuid, percent_bps integer);
end;
$$;

-- Borra una suscripción. Con p_with_expenses, también sus gastos generados (se apaga antes,
-- así que dejan de estar protegidos), en la misma transacción. Devuelve cuántos gastos borra.
-- security invoker: manda la RLS de quien lo hace (socio).
create function public.delete_expense_subscription(p_id uuid, p_with_expenses boolean default false)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  if p_with_expenses then
    update public.expense_subscriptions set is_active = false where id = p_id;
    delete from public.expenses where subscription_id = p_id;
    get diagnostics v_count = row_count;
  end if;
  delete from public.expense_subscriptions where id = p_id;
  if not found then
    raise exception 'Suscripción no encontrada' using errcode = 'P0002', hint = 'subscription_not_found';
  end if;
  return v_count;
end;
$$;

revoke all on function public.save_shareholdings(uuid, date, jsonb, date) from public, anon;
revoke all on function public.delete_expense_subscription(uuid, boolean) from public, anon;
grant execute on function public.save_shareholdings(uuid, date, jsonb, date) to authenticated;
grant execute on function public.delete_expense_subscription(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: justificantes de gastos. Privado: solo el servidor lee y escribe, después de
-- comprobar con RLS que el gasto es de la org de quien lo pide.
-- En PGlite (tests) no existe el esquema storage y esto se salta.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is not null then
    execute $sql$
      insert into storage.buckets (id, name, public)
      values ('expenses', 'expenses', false)
      on conflict (id) do nothing
    $sql$;
  end if;
end;
$$;

revoke all on all tables in schema public from anon;
