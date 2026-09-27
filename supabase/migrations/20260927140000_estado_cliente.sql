-- GNERAI OS · Estado del cliente elegido a mano
-- El estado que calcula la app (lead, activo, en pausa, antiguo) sale de los contratos y es el que
-- usan las métricas (MRR, bajas…), así que no cambia. Además, un socio puede marcar a mano en qué
-- punto está la relación: contacto pendiente, lead, activo, en pausa, finalizado o descartado. Si
-- lo marca, es el que se ve en la lista y en la ficha (con el calculado al lado); si lo quita
-- («Automático»), vuelve a verse el calculado.

create type public.client_manual_status as enum (
  'pending_contact', -- hay que contactarle (o volver a hacerlo)
  'lead',
  'active',
  'paused',
  'finished',        -- se acabó la relación
  'discarded'        -- no era para nosotros
);

alter table public.clients
  add column manual_status public.client_manual_status,
  -- Cuándo se marcó: «Contacto pendiente desde hace 5 días». Lo pone el trigger, no el cliente.
  add column manual_status_at timestamptz;

create function private.clients_manual_status_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.manual_status is distinct from old.manual_status then
    new.manual_status_at := case when new.manual_status is null then null else now() end;
  else
    new.manual_status_at := old.manual_status_at;
  end if;
  return new;
end;
$$;
create trigger clients_manual_status_at before insert or update on public.clients
  for each row execute function private.clients_manual_status_at();

-- La vista de clientes lleva también el estado a mano (al final: la vista no cambia de forma).
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
  inv.first_invoice_on,
  c.manual_status,
  c.manual_status_at
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
