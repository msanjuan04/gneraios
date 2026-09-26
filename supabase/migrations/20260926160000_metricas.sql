-- GNERAI OS · Hito 1.4 · Métricas
-- La foto mensual inmutable (metrics_snapshots), los agregados de ingresos del dashboard y el
-- estado de facturas, clientes y deals en una fecha de corte. Ver ARCHITECTURE.md §6.3, §6.4 y §7.8.
--
-- Reparto de responsabilidades:
-- - Las definiciones y la aritmética de las métricas (MRR y sus movimientos, sumas, redondeos)
--   viven en TS (src/domain/metrics), una sola implementación, versionada (definition_version).
-- - Aquí solo hay agregados por mes (sumas de ingresos, §7.8) y el estado de cada entidad en
--   una fecha, con las mismas reglas que las vistas de hoy (invoices_overview,
--   clients_overview, deals_board). Con la fecha de hoy dan lo mismo que ellas (test de
--   paridad); con el último día de un mes, lo que esas vistas habrían dicho ese día. Así la
--   foto de un mes es la de su cierre aunque se calcule más tarde (el seed simula 18 meses).
-- - Las funciones "_on" son security invoker: manda la RLS de quien consulta (un miembro) o,
--   para el servidor (service_role: cron y seed), el filtro explícito por org.

-- ---------------------------------------------------------------------------
-- Foto mensual: se escribe una vez (el día 1, la del mes anterior) y no se toca nunca
-- ---------------------------------------------------------------------------
create table public.metrics_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  -- Primer día del mes que describe.
  month date not null check (extract(day from month) = 1),
  mrr_cents bigint not null check (mrr_cents >= 0),
  arr_cents bigint not null,
  new_mrr_cents bigint not null check (new_mrr_cents >= 0),
  expansion_mrr_cents bigint not null check (expansion_mrr_cents >= 0),
  contraction_mrr_cents bigint not null check (contraction_mrr_cents >= 0),
  churn_mrr_cents bigint not null check (churn_mrr_cents >= 0),
  active_clients integer not null check (active_clients >= 0),
  -- Base imponible sin IVA; negativa en un mes en que las rectificativas pesan más.
  revenue_recurring_cents bigint not null,
  revenue_usage_cents bigint not null,
  revenue_one_off_cents bigint not null,
  -- Con IVA y neto de IRPF (lo que queda por cobrar).
  outstanding_cents bigint not null,
  overdue_cents bigint not null,
  weighted_pipeline_one_off_cents bigint not null check (weighted_pipeline_one_off_cents >= 0),
  weighted_pipeline_mrr_cents bigint not null check (weighted_pipeline_mrr_cents >= 0),
  definition_version smallint not null check (definition_version >= 1),
  -- Reconstruida después del cierre (no es la foto tomada al cerrar el mes).
  is_estimated boolean not null default false,
  -- Hace de created_at: una foto no tiene autor ni se actualiza.
  computed_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, month),
  check (arr_cents = mrr_cents * 12),
  -- MRR del mes anterior = MRR − (nuevo + expansión − contracción − churn), que no puede ser negativo.
  check (new_mrr_cents + expansion_mrr_cents - contraction_mrr_cents - churn_mrr_cents <= mrr_cents)
);

-- Inmutable también para service_role: una definición nueva sube definition_version, no reescribe.
create function private.metrics_snapshots_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Una foto mensual de métricas no se modifica ni se borra'
    using errcode = 'P0001', hint = 'snapshot_immutable';
end;
$$;

create trigger metrics_snapshots_guard before update or delete on public.metrics_snapshots
  for each row execute function private.metrics_snapshots_guard();
create trigger metrics_snapshots_no_truncate before truncate on public.metrics_snapshots
  for each statement execute function private.metrics_snapshots_guard();

-- La leen los miembros; la escribe solo el servidor (service_role).
alter table public.metrics_snapshots enable row level security;
create policy metrics_snapshots_select on public.metrics_snapshots for select to authenticated
  using (private.has_role(org_id, 'viewer'));
revoke insert, update, delete, truncate on public.metrics_snapshots from authenticated;

-- ---------------------------------------------------------------------------
-- Ingresos por mes (base sin IVA de las facturas emitidas, por mes de emisión): las
-- rectificativas restan en su mes. El desglose recurrente / uso / one-off lo hace TS.
-- ---------------------------------------------------------------------------
create view public.revenue_by_month with (security_invoker = true) as
select
  i.org_id,
  date_trunc('month', i.issued_on::timestamp)::date as month,
  l.billing_type,
  sum(l.base_cents)::bigint as base_cents
from public.invoices i
join public.invoice_lines l on l.invoice_id = i.id
where i.lifecycle = 'issued'
group by i.org_id, date_trunc('month', i.issued_on::timestamp), l.billing_type;

-- Facturación neta por cliente y mes (concentración). La cabecera es la suma de sus líneas.
create view public.revenue_by_client_month with (security_invoker = true) as
select
  i.org_id,
  i.client_id,
  date_trunc('month', i.issued_on::timestamp)::date as month,
  sum(i.subtotal_cents)::bigint as base_cents
from public.invoices i
where i.lifecycle = 'issued'
group by i.org_id, i.client_id, date_trunc('month', i.issued_on::timestamp);

revoke all on public.metrics_snapshots, public.revenue_by_month, public.revenue_by_client_month from anon;

-- ---------------------------------------------------------------------------
-- Estado en una fecha de corte (p_on, día civil en la zona de la org)
-- ---------------------------------------------------------------------------

-- Facturas emitidas no cobradas en p_on, con lo que les quedaba por cobrar: la regla de
-- invoices_overview con los cobros y las rectificativas hasta ese día.
create function public.open_invoices_on(p_org uuid, p_on date)
returns table (invoice_id uuid, client_id uuid, due_on date, outstanding_cents bigint, status public.invoice_status)
language sql
stable
security invoker
set search_path = ''
as $$
  select x.id, x.client_id, x.due_on, x.outstanding_cents, x.status
  from (
    select
      i.id,
      i.client_id,
      i.due_on,
      (i.total_cents + coalesce(r.cents, 0) - coalesce(p.cents, 0))::bigint as outstanding_cents,
      (case
        when i.total_cents + coalesce(r.cents, 0) = 0 then 'voided'
        when coalesce(p.cents, 0) >= i.total_cents + coalesce(r.cents, 0) then 'paid'
        when i.due_on < p_on then 'overdue'
        else 'issued'
      end)::public.invoice_status as status
    from public.invoices i
    left join lateral (
      select sum(pay.amount_cents) as cents
      from public.payments pay
      where pay.invoice_id = i.id and pay.paid_on <= p_on
    ) p on true
    left join lateral (
      select sum(rect.total_cents) as cents
      from public.invoices rect
      where rect.rectifies_invoice_id = i.id and rect.lifecycle = 'issued' and rect.issued_on <= p_on
    ) r on true
    where i.org_id = p_org and i.lifecycle = 'issued' and i.kind = 'ordinary' and i.issued_on <= p_on
  ) x
  where x.status in ('issued', 'overdue')
$$;

-- Estado en p_on de los clientes que han tenido líneas (los demás son leads): la regla de
-- clients_overview con los contratos firmados hasta ese día y archivados después.
create function public.client_statuses_on(p_org uuid, p_on date)
returns table (client_id uuid, status public.client_status)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    ct.client_id,
    (case
      when bool_or(s.status in ('active', 'scheduled')) then 'active'
      when bool_or(s.status = 'paused') then 'paused'
      else 'former'
    end)::public.client_status
  from public.contracts ct
  join public.orgs o on o.id = ct.org_id
  join public.contract_lines l on l.contract_id = ct.id
  cross join lateral (select private.line_status_on(l, p_on) as status) s
  where ct.org_id = p_org
    and ct.signed_on <= p_on
    and (ct.archived_at is null or ct.archived_at >= ((p_on + 1)::timestamp at time zone o.timezone))
  group by ct.client_id
$$;

-- Deals abiertos al final de p_on, con la etapa en la que estaban (historial) y su
-- probabilidad efectiva: la regla de deals_board en esa fecha. Los importes y la probabilidad
-- fijada a mano no tienen historial: son los de hoy.
create function public.open_deals_on(p_org uuid, p_on date)
returns table (
  deal_id uuid,
  stage_id uuid,
  stage_kind public.stage_kind,
  est_one_off_cents bigint,
  est_mrr_cents bigint,
  probability_bps integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select d.id, s.id, s.kind, d.est_one_off_cents, d.est_mrr_cents, coalesce(d.probability_bps, s.default_probability_bps)
  from public.deals d
  join public.orgs o on o.id = d.org_id
  cross join lateral (select ((p_on + 1)::timestamp at time zone o.timezone) as until_at) b
  left join lateral (
    select h.to_stage_id
    from public.deal_stage_history h
    where h.deal_id = d.id and h.changed_at < b.until_at
    order by h.changed_at desc, h.id desc
    limit 1
  ) h on true
  join public.pipeline_stages s on s.id = coalesce(h.to_stage_id, d.stage_id)
  where d.org_id = p_org
    and d.created_at < b.until_at
    and (d.archived_at is null or d.archived_at >= b.until_at)
    and s.kind = 'open'
$$;

-- El servidor (service_role) calcula las fotos con estas funciones y client_statuses_on usa
-- private.line_status_on: necesita poder resolver ese esquema. Las funciones sensibles de
-- private siguen sin EXECUTE para él (apply_draft, release_line_from_drafts), y sus tablas
-- no le dan ningún privilegio.
grant usage on schema private to service_role;

revoke all on function public.open_invoices_on(uuid, date) from public, anon;
revoke all on function public.client_statuses_on(uuid, date) from public, anon;
revoke all on function public.open_deals_on(uuid, date) from public, anon;
grant execute on function public.open_invoices_on(uuid, date) to authenticated, service_role;
grant execute on function public.client_statuses_on(uuid, date) to authenticated, service_role;
grant execute on function public.open_deals_on(uuid, date) to authenticated, service_role;
