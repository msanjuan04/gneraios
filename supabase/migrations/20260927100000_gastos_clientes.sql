-- GNERAI OS · Gastos por cliente: infraestructura, reparto y repercusión
-- Los servidores, bases de datos, dominios y el software que paga GNERAI dejan de ser solo un
-- gasto de la empresa: cada gasto (y cada suscripción) es de la empresa, de un cliente concreto o
-- se reparte entre las webs que alojamos (módulo Webs, `sites.hosted_by_us`). Así la rentabilidad
-- de cada cliente cuenta lo que cuesta de verdad, y lo repercutible acaba en su factura.
--
-- Nada se guarda dos veces: el reparto entre webs se calcula (cuántas webs alojadas activas tiene
-- cada cliente en el periodo), la próxima renovación se deriva de la suscripción y «repercutido»
-- es tener la línea de factura enlazada.

-- 1. Categorías de infraestructura: las agrupa el panel de Finanzas → Infraestructura.
alter table public.expense_categories add column is_infrastructure boolean not null default false;

-- 2. A quién sirve cada gasto.
create type public.cost_allocation as enum (
  'company',      -- de la empresa (lo de siempre)
  'client',       -- de un cliente concreto (client_id)
  'hosted_sites'  -- compartido: se reparte entre las webs que alojamos, según las de cada cliente
);

alter table public.expense_subscriptions
  add column allocation public.cost_allocation not null default 'company',
  add column client_id uuid,
  -- Repercutir al cliente: cada cargo de la suscripción se le factura (con un margen opcional).
  add column rebill boolean not null default false,
  add column rebill_markup_bps integer not null default 0,
  add constraint expense_subscriptions_client_fk foreign key (org_id, client_id) references public.clients (org_id, id),
  add constraint expense_subscriptions_allocation_client check ((allocation = 'client') = (client_id is not null)),
  add constraint expense_subscriptions_rebill_client check (not rebill or allocation = 'client'),
  add constraint expense_subscriptions_markup check (rebill_markup_bps between 0 and 100000);

alter table public.expenses
  add column allocation public.cost_allocation not null default 'company',
  add column client_id uuid,
  add column rebill boolean not null default false,
  add column rebill_markup_bps integer not null default 0,
  -- La línea de factura con la que se repercutió. Vacía = pendiente de repercutir. Si se borra el
  -- borrador de la factura, vuelve a estar pendiente.
  add column rebill_invoice_line_id uuid,
  add constraint expenses_client_fk foreign key (org_id, client_id) references public.clients (org_id, id),
  add constraint expenses_rebill_line_fk foreign key (org_id, rebill_invoice_line_id)
    references public.invoice_lines (org_id, id) on delete set null (rebill_invoice_line_id),
  add constraint expenses_allocation_client check ((allocation = 'client') = (client_id is not null)),
  add constraint expenses_rebill_client check (not rebill or allocation = 'client'),
  add constraint expenses_rebill_line check (rebill_invoice_line_id is null or rebill),
  add constraint expenses_markup check (rebill_markup_bps between 0 and 100000);

create index expenses_client_idx on public.expenses (org_id, client_id) where client_id is not null;
create index expenses_rebill_pending_idx on public.expenses (org_id, client_id) where rebill and rebill_invoice_line_id is null;
create unique index expenses_rebill_line_idx on public.expenses (rebill_invoice_line_id) where rebill_invoice_line_id is not null;
create index expense_subscriptions_client_idx on public.expense_subscriptions (org_id, client_id) where client_id is not null;

-- 3. Las categorías de infraestructura por defecto: en las orgs nuevas y en las que ya existen.
create or replace function private.seed_org_expense_categories(p_org uuid) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.expense_categories (org_id, name, expense_group, is_fixed, position, is_infrastructure) values
    (p_org, 'Software y suscripciones', 'operating', true, 1, false),
    (p_org, 'Servidores y hosting', 'operating', true, 2, true),
    (p_org, 'Bases de datos y APIs', 'operating', true, 3, true),
    (p_org, 'Dominios', 'operating', true, 4, true),
    (p_org, 'Freelances y colaboradores', 'cost_of_sales', false, 5, false),
    (p_org, 'Compras para clientes', 'cost_of_sales', false, 6, false),
    (p_org, 'Publicidad propia', 'operating', false, 7, false),
    (p_org, 'Oficina y coworking', 'operating', true, 8, false),
    (p_org, 'Gestoría y asesoría', 'operating', true, 9, false),
    (p_org, 'Seguros', 'operating', true, 10, false),
    (p_org, 'Formación', 'operating', false, 11, false),
    (p_org, 'Equipos y material', 'operating', false, 12, false),
    (p_org, 'Viajes y dietas', 'operating', false, 13, false),
    (p_org, 'Bancos y comisiones', 'financial', true, 14, false),
    (p_org, 'Nóminas y Seguridad Social', 'payroll', true, 15, false),
    (p_org, 'Retribución de socios', 'partner_compensation', true, 16, false),
    (p_org, 'Cuotas de autónomos', 'partner_compensation', true, 17, false),
    (p_org, 'Impuestos y tasas', 'taxes', false, 18, false),
    (p_org, 'Otros gastos', 'other', false, 19, false);
$$;
revoke all on function private.seed_org_expense_categories(uuid) from public;

insert into public.expense_categories (org_id, name, expense_group, is_fixed, position, is_infrastructure)
select o.id, v.name, 'operating', true, v.position, true
from public.orgs o
cross join (values ('Servidores y hosting', 2), ('Bases de datos y APIs', 3), ('Dominios', 4)) as v (name, position)
where not exists (
  select 1 from public.expense_categories c
  where c.org_id = o.id and lower(btrim(c.name)) = lower(v.name) and c.archived_at is null
);

-- 4. Aviso antes de que se renueve una suscripción (dominios, servidores anuales…).
alter type public.notification_kind add value if not exists 'subscription_renewal';
