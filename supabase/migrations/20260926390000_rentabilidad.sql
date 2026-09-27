-- GNERAI OS · Rentabilidad: coste interno por hora de cada miembro
-- Lo que cuesta una hora de cada persona (sueldo, cotizaciones, herramientas…) desde una fecha.
-- Con las horas (time_entries) y lo facturado (invoices), da el margen de cada cliente y de cada
-- proyecto: Finanzas → Rentabilidad. Ver src/domain/profitability.
--
-- Lo que se guarda es lo que decide un owner: cuánto cuesta la hora de alguien a partir de un día.
-- Todo lo demás se deriva y no se guarda (src/domain/profitability/costs.ts):
-- - el coste que se aplica a un registro de horas es el de la fecha más reciente que no pasa del
--   día trabajado; sin ninguna, el de la org (orgs.settings.profitability.default_hourly_cost_cents);
-- - cambiar el coste desde un día es añadir una fila: el historial queda y el pasado anterior a esa
--   fecha no cambia. Corregir una fila (o borrarla) sí recalcula lo que le tocaba: es una corrección.
-- Los umbrales de aviso (margen mínimo, €/hora mínimo) también viven en orgs.settings.profitability.
--
-- Es un dato sensible: lo leen los socios (partner u owner) y lo escribe solo un owner. Un viewer ve
-- las horas (time_entries), pero no lo que cuestan. La auditoría (audit_log) solo la leen los owners.

create table public.member_costs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  member_id uuid not null,
  -- Céntimos por hora (3500 = 35 €/h). 0 vale: alguien cuyo tiempo no le cuesta nada a la org.
  hourly_cost_cents integer not null check (hourly_cost_cents between 0 and 100000),
  -- Vigente desde este día (incluido) hasta el siguiente coste de la misma persona.
  valid_from date not null check (valid_from >= date '2000-01-01'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  -- Un coste por persona y día: guardar otro el mismo día lo corrige.
  unique (org_id, member_id, valid_from),
  foreign key (org_id, member_id) references public.members (org_id, id)
);

create trigger set_updated_at before update on public.member_costs
  for each row execute function private.set_updated_at();
create trigger audit after insert or update or delete on public.member_costs
  for each row execute function private.audit_row();

-- ---------------------------------------------------------------------------
-- RLS: lo leen los socios, lo escribe un owner
-- ---------------------------------------------------------------------------
alter table public.member_costs enable row level security;

create policy member_costs_select on public.member_costs for select to authenticated
  using (private.has_role(org_id, 'partner'));
create policy member_costs_insert on public.member_costs for insert to authenticated
  with check (private.has_role(org_id, 'owner'));
create policy member_costs_update on public.member_costs for update to authenticated
  using (private.has_role(org_id, 'owner')) with check (private.has_role(org_id, 'owner'));
create policy member_costs_delete on public.member_costs for delete to authenticated
  using (private.has_role(org_id, 'owner'));

revoke all on public.member_costs from anon;
