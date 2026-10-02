-- GNERAI OS · Plantillas de presupuesto
-- Los presupuestos genéricos de la agencia (web corporativa «desde», gestión de Meta Ads, software a
-- medida…) con sus líneas, su texto y su plan de pagos, para arrancar un presupuesto nuevo en
-- segundos. Una plantilla es una copia, no una referencia: al usarla, sus líneas se copian al
-- presupuesto nuevo y se editan allí; cambiarla después no toca nada ya presupuestado. Los importes
-- de cada línea los calcula el dominio al guardar el presupuesto (src/domain/tax), no aquí.

create table public.quote_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  -- Misma clasificación que el catálogo de servicios (i18n: catalog.categories).
  category public.catalog_category not null default 'other',
  -- Qué incluye y para quién: se lee en el listado, no sale en el PDF.
  summary text check (summary is null or char_length(summary) <= 1000),
  -- Título con el que arranca el presupuesto (vacío: el nombre de la plantilla).
  title text check (title is null or char_length(btrim(title)) between 1 and 200),
  language public.app_locale not null default 'es',
  notes text check (notes is null or char_length(notes) <= 10000),
  -- [{ description, billing_type, quantity, unit_price_cents, discount_bps, tax_rate_id, irpf_applies, billing_day }]
  lines jsonb not null check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) between 1 and 100),
  -- Como quotes.payment_plan.
  payment_plan jsonb not null default '[]'::jsonb check (jsonb_typeof(payment_plan) = 'array'),
  -- El presupuesto del que se guardó, si fue así (informativo).
  source_quote_id uuid,
  uses_count integer not null default 0 check (uses_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  archived_at timestamptz,
  unique (org_id, id),
  foreign key (org_id, source_quote_id) references public.quotes (org_id, id) on delete set null (source_quote_id)
);
create unique index quote_templates_name_idx on public.quote_templates (org_id, lower(btrim(name))) where archived_at is null;
create index quote_templates_org_idx on public.quote_templates (org_id, category, name) where archived_at is null;

create trigger quote_templates_updated_at before update on public.quote_templates
  for each row execute function private.set_updated_at();
create trigger quote_templates_audit after insert or update or delete on public.quote_templates
  for each row execute function private.audit_row();

-- Lo lee cualquier miembro; lo crea y cambia un socio. Se archiva, no se borra (el borrado queda para
-- limpiar una plantilla recién creada por error).
alter table public.quote_templates enable row level security;
create policy quote_templates_select on public.quote_templates for select to authenticated
  using (private.has_role(org_id, 'viewer'));
create policy quote_templates_insert on public.quote_templates for insert to authenticated
  with check (private.has_role(org_id, 'partner'));
create policy quote_templates_update on public.quote_templates for update to authenticated
  using (private.has_role(org_id, 'partner')) with check (private.has_role(org_id, 'partner'));
create policy quote_templates_delete on public.quote_templates for delete to authenticated
  using (private.has_role(org_id, 'partner') and uses_count = 0);

-- Cada uso suma uno (lo llama el servidor al crear un presupuesto desde la plantilla).
create function public.quote_template_used(p_template_id uuid) returns void
language sql
security definer
set search_path = ''
as $$
  update public.quote_templates t set uses_count = t.uses_count + 1
  where t.id = p_template_id and private.has_role(t.org_id, 'partner');
$$;
revoke all on function public.quote_template_used(uuid) from public, anon;
grant execute on function public.quote_template_used(uuid) to authenticated;
