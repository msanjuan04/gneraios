-- GNERAI OS · Hito 1.1 · CRM
-- Clientes, contactos, configuración del pipeline, deals con historial de etapas,
-- actividades, vistas derivadas (tablero, estado del cliente, timeline 360) y búsqueda.
-- Ver ARCHITECTURE.md §6.3 (CRM) y §7.9.

create extension if not exists unaccent with schema extensions;

create type public.stage_kind as enum ('open', 'won', 'lost');
create type public.tax_id_kind as enum ('es', 'eu_vat', 'foreign');
create type public.activity_kind as enum ('call', 'meeting', 'email', 'note');
-- Estado derivado del cliente (nunca se guarda). En el hito 1.2 lo calcularán los contratos.
create type public.client_status as enum ('lead', 'active', 'paused', 'former');

-- ---------------------------------------------------------------------------
-- Configuración del pipeline (listas que edita cada org)
-- ---------------------------------------------------------------------------
create table public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  position smallint not null,
  kind public.stage_kind not null default 'open',
  default_probability_bps integer not null default 0 check (default_probability_bps between 0 and 10000),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id)
);
create index pipeline_stages_org_position_idx on public.pipeline_stages (org_id, position);

create table public.acquisition_sources (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  position smallint not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id)
);

create table public.loss_reasons (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  position smallint not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id)
);

-- Valores por defecto de toda org nueva (y relleno para las que ya existen).
-- Son datos, no código: cada org los edita en Ajustes → Pipeline.
create function private.seed_org_crm_defaults(p_org uuid) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.pipeline_stages (org_id, name, position, kind, default_probability_bps) values
    (p_org, 'Lead', 1, 'open', 1000),
    (p_org, 'Reunión', 2, 'open', 2500),
    (p_org, 'Propuesta enviada', 3, 'open', 5000),
    (p_org, 'Negociación', 4, 'open', 7500),
    (p_org, 'Ganado', 5, 'won', 10000),
    (p_org, 'Perdido', 6, 'lost', 0),
    (p_org, 'Activo', 7, 'won', 10000);
  insert into public.acquisition_sources (org_id, name, position) values
    (p_org, 'Web', 1), (p_org, 'SEO', 2), (p_org, 'Meta Ads', 3),
    (p_org, 'Outreach', 4), (p_org, 'Referido', 5), (p_org, 'Networking', 6);
  insert into public.loss_reasons (org_id, name, position) values
    (p_org, 'Precio', 1), (p_org, 'Timing', 2), (p_org, 'Competencia', 3),
    (p_org, 'Sin respuesta', 4), (p_org, 'No encaja', 5), (p_org, 'Otro', 6);
$$;

create function private.orgs_seed_crm() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_org_crm_defaults(new.id);
  return null;
end;
$$;

create trigger orgs_seed_crm after insert on public.orgs
  for each row execute function private.orgs_seed_crm();

select private.seed_org_crm_defaults(o.id)
from public.orgs o
where not exists (select 1 from public.pipeline_stages s where s.org_id = o.id);

-- ---------------------------------------------------------------------------
-- Clientes y contactos
-- ---------------------------------------------------------------------------
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 200),
  legal_name text,
  tax_id text check (tax_id is null or tax_id ~ '^[A-Z0-9]{2,20}$'),
  tax_id_kind public.tax_id_kind not null default 'es',
  address_line text,
  postal_code text,
  city text,
  province text,
  country_code char(2) not null default 'ES' check (country_code ~ '^[A-Z]{2}$'),
  sector text,
  website text,
  owner_member_id uuid,
  is_business boolean not null default true,
  preferred_language public.app_locale not null default 'es',
  payment_terms_days smallint check (payment_terms_days is null or payment_terms_days between 0 and 365),
  -- Fuente de adquisición solo para históricos importados sin deal; si no, es la del primer deal.
  imported_source_id uuid,
  notes text,
  external_id text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  foreign key (org_id, owner_member_id) references public.members (org_id, id),
  foreign key (org_id, imported_source_id) references public.acquisition_sources (org_id, id)
);
create index clients_org_name_idx on public.clients (org_id, display_name);
-- El mismo NIF dos veces es el mismo cliente escrito dos veces.
create unique index clients_tax_id_idx on public.clients (org_id, tax_id) where tax_id is not null and archived_at is null;
create unique index clients_external_id_idx on public.clients (org_id, external_id) where external_id is not null;

create function private.clients_normalize() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.tax_id := nullif(upper(regexp_replace(coalesce(new.tax_id, ''), '[^A-Za-z0-9]', '', 'g')), '');
  return new;
end;
$$;

create trigger clients_normalize before insert or update on public.clients
  for each row execute function private.clients_normalize();

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  client_id uuid not null,
  full_name text not null check (char_length(btrim(full_name)) between 1 and 120),
  role text,
  email text check (email is null or (email = lower(btrim(email)) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  phone text,
  is_primary boolean not null default false,
  is_billing boolean not null default false,
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  foreign key (org_id, client_id) references public.clients (org_id, id)
);
create index contacts_client_idx on public.contacts (client_id);
create unique index contacts_one_primary_idx on public.contacts (client_id) where is_primary and archived_at is null;

-- ---------------------------------------------------------------------------
-- Deals (un lead es un deal en la primera etapa)
-- ---------------------------------------------------------------------------
create table public.deals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  client_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  stage_id uuid not null,
  -- Importe estimado separado: nunca se mezcla lo puntual con lo recurrente.
  est_one_off_cents bigint not null default 0 check (est_one_off_cents >= 0),
  est_mrr_cents bigint not null default 0 check (est_mrr_cents >= 0),
  probability_bps integer check (probability_bps is null or probability_bps between 0 and 10000),
  source_id uuid,
  brought_by_member_id uuid,
  owner_member_id uuid,
  next_action text,
  next_action_on date,
  loss_reason_id uuid,
  loss_note text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  foreign key (org_id, client_id) references public.clients (org_id, id),
  foreign key (org_id, stage_id) references public.pipeline_stages (org_id, id),
  foreign key (org_id, source_id) references public.acquisition_sources (org_id, id),
  foreign key (org_id, brought_by_member_id) references public.members (org_id, id),
  foreign key (org_id, owner_member_id) references public.members (org_id, id),
  foreign key (org_id, loss_reason_id) references public.loss_reasons (org_id, id)
);
create index deals_org_stage_idx on public.deals (org_id, stage_id) where archived_at is null;
create index deals_client_idx on public.deals (client_id);

-- Perder exige motivo; salir de una etapa perdida lo limpia (el motivo era de esa pérdida).
create function private.deals_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_kind public.stage_kind;
begin
  select s.kind into v_kind from public.pipeline_stages s where s.id = new.stage_id;
  if v_kind = 'lost' and new.loss_reason_id is null then
    raise exception 'Para marcar un deal como perdido hay que indicar el motivo'
      using errcode = 'P0001', hint = 'loss_reason_required';
  end if;
  if v_kind <> 'lost' then
    new.loss_reason_id := null;
    new.loss_note := null;
  end if;
  return new;
end;
$$;

create trigger deals_guard before insert or update on public.deals
  for each row execute function private.deals_guard();

-- Historial de etapas: lo escribe solo este trigger. `app.stage_changed_at` permite
-- fechar hacia atrás al importar históricos o al sembrar datos de demo.
create table public.deal_stage_history (
  id bigint generated always as identity primary key,
  org_id uuid not null,
  deal_id uuid not null,
  from_stage_id uuid,
  to_stage_id uuid not null,
  changed_at timestamptz not null default now(),
  changed_by uuid references auth.users (id) on delete set null,
  foreign key (org_id, deal_id) references public.deals (org_id, id) on delete cascade,
  foreign key (org_id, from_stage_id) references public.pipeline_stages (org_id, id),
  foreign key (org_id, to_stage_id) references public.pipeline_stages (org_id, id)
);
create index deal_stage_history_deal_idx on public.deal_stage_history (deal_id, changed_at);
create index deal_stage_history_org_idx on public.deal_stage_history (org_id, changed_at);

create function private.deals_record_stage() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id then
    insert into public.deal_stage_history (org_id, deal_id, from_stage_id, to_stage_id, changed_at, changed_by)
    values (
      new.org_id,
      new.id,
      case when tg_op = 'UPDATE' then old.stage_id end,
      new.stage_id,
      coalesce(nullif(current_setting('app.stage_changed_at', true), '')::timestamptz, now()),
      auth.uid()
    );
  end if;
  return null;
end;
$$;

create trigger deals_record_stage after insert or update of stage_id on public.deals
  for each row execute function private.deals_record_stage();

-- ---------------------------------------------------------------------------
-- Actividades (solo lo que escribe una persona; el resto del timeline se deriva)
-- ---------------------------------------------------------------------------
create table public.activities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  client_id uuid not null,
  deal_id uuid,
  contact_id uuid,
  kind public.activity_kind not null,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  body text,
  occurred_at timestamptz not null default now(),
  member_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  foreign key (org_id, client_id) references public.clients (org_id, id),
  foreign key (org_id, deal_id) references public.deals (org_id, id),
  foreign key (org_id, contact_id) references public.contacts (org_id, id),
  foreign key (org_id, member_id) references public.members (org_id, id)
);
create index activities_client_idx on public.activities (client_id, occurred_at desc);
create index activities_deal_idx on public.activities (deal_id) where deal_id is not null;

-- ---------------------------------------------------------------------------
-- Triggers comunes
-- ---------------------------------------------------------------------------
create trigger set_updated_at before update on public.pipeline_stages for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.acquisition_sources for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.loss_reasons for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.clients for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.contacts for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.deals for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.activities for each row execute function private.set_updated_at();

create trigger audit after insert or update or delete on public.pipeline_stages for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.acquisition_sources for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.loss_reasons for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.clients for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.contacts for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.deals for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.activities for each row execute function private.audit_row();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.pipeline_stages enable row level security;
alter table public.acquisition_sources enable row level security;
alter table public.loss_reasons enable row level security;
alter table public.clients enable row level security;
alter table public.contacts enable row level security;
alter table public.deals enable row level security;
alter table public.deal_stage_history enable row level security;
alter table public.activities enable row level security;

-- Configuración: la ve cualquier miembro y la cambia un owner. Se archiva, no se borra.
create policy pipeline_stages_select on public.pipeline_stages for select to authenticated using (private.has_role(org_id, 'viewer'));
create policy pipeline_stages_insert on public.pipeline_stages for insert to authenticated with check (private.has_role(org_id, 'owner'));
create policy pipeline_stages_update on public.pipeline_stages for update to authenticated using (private.has_role(org_id, 'owner')) with check (private.has_role(org_id, 'owner'));

create policy acquisition_sources_select on public.acquisition_sources for select to authenticated using (private.has_role(org_id, 'viewer'));
create policy acquisition_sources_insert on public.acquisition_sources for insert to authenticated with check (private.has_role(org_id, 'owner'));
create policy acquisition_sources_update on public.acquisition_sources for update to authenticated using (private.has_role(org_id, 'owner')) with check (private.has_role(org_id, 'owner'));

create policy loss_reasons_select on public.loss_reasons for select to authenticated using (private.has_role(org_id, 'viewer'));
create policy loss_reasons_insert on public.loss_reasons for insert to authenticated with check (private.has_role(org_id, 'owner'));
create policy loss_reasons_update on public.loss_reasons for update to authenticated using (private.has_role(org_id, 'owner')) with check (private.has_role(org_id, 'owner'));

-- Operativa: la ve cualquier miembro y la lleva un socio (partner u owner).
create policy clients_select on public.clients for select to authenticated using (private.has_role(org_id, 'viewer'));
create policy clients_insert on public.clients for insert to authenticated with check (private.has_role(org_id, 'partner'));
create policy clients_update on public.clients for update to authenticated using (private.has_role(org_id, 'partner')) with check (private.has_role(org_id, 'partner'));

create policy contacts_select on public.contacts for select to authenticated using (private.has_role(org_id, 'viewer'));
create policy contacts_insert on public.contacts for insert to authenticated with check (private.has_role(org_id, 'partner'));
create policy contacts_update on public.contacts for update to authenticated using (private.has_role(org_id, 'partner')) with check (private.has_role(org_id, 'partner'));

create policy deals_select on public.deals for select to authenticated using (private.has_role(org_id, 'viewer'));
create policy deals_insert on public.deals for insert to authenticated with check (private.has_role(org_id, 'partner'));
create policy deals_update on public.deals for update to authenticated using (private.has_role(org_id, 'partner')) with check (private.has_role(org_id, 'partner'));

create policy deal_stage_history_select on public.deal_stage_history for select to authenticated using (private.has_role(org_id, 'viewer'));

-- Las actividades sí se pueden borrar: son notas, no documentos.
create policy activities_select on public.activities for select to authenticated using (private.has_role(org_id, 'viewer'));
create policy activities_insert on public.activities for insert to authenticated with check (private.has_role(org_id, 'partner'));
create policy activities_update on public.activities for update to authenticated using (private.has_role(org_id, 'partner')) with check (private.has_role(org_id, 'partner'));
create policy activities_delete on public.activities for delete to authenticated using (private.has_role(org_id, 'partner'));

-- ---------------------------------------------------------------------------
-- Vistas derivadas (security_invoker: respetan la RLS de quien consulta)
-- ---------------------------------------------------------------------------

-- Tablero: cada deal con su etapa, la probabilidad efectiva y desde cuándo está ahí.
create view public.deals_board with (security_invoker = true) as
select
  d.id,
  d.org_id,
  d.client_id,
  c.display_name as client_name,
  d.title,
  d.stage_id,
  s.kind as stage_kind,
  s.position as stage_position,
  d.est_one_off_cents,
  d.est_mrr_cents,
  coalesce(d.probability_bps, s.default_probability_bps) as probability_bps,
  d.source_id,
  d.brought_by_member_id,
  d.owner_member_id,
  m.initials as owner_initials,
  d.next_action,
  d.next_action_on,
  d.loss_reason_id,
  d.loss_note,
  d.created_at,
  entered.changed_at as stage_entered_at,
  case when s.kind in ('won', 'lost') then entered.changed_at end as closed_at
from public.deals d
join public.pipeline_stages s on s.id = d.stage_id
join public.clients c on c.id = d.client_id
left join public.members m on m.id = d.owner_member_id
left join lateral (
  select h.changed_at
  from public.deal_stage_history h
  where h.deal_id = d.id and h.to_stage_id = d.stage_id
  order by h.changed_at desc
  limit 1
) entered on true
where d.archived_at is null;

-- Clientes con su estado y su fuente de adquisición, derivados.
-- Hasta que existan contratos (hito 1.2), "activo" = tiene algún deal ganado.
create view public.clients_overview with (security_invoker = true) as
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
    when exists (
      select 1
      from public.deals d
      join public.pipeline_stages s on s.id = d.stage_id
      where d.client_id = c.id and d.archived_at is null and s.kind = 'won'
    ) then 'active'::public.client_status
    else 'lead'::public.client_status
  end as status,
  coalesce(first_deal.source_id, c.imported_source_id) as acquisition_source_id,
  (select count(*) from public.deals d where d.client_id = c.id and d.archived_at is null)::integer as deals_count,
  (select max(a.occurred_at) from public.activities a where a.client_id = c.id) as last_activity_at
from public.clients c
left join public.members m on m.id = c.owner_member_id
left join lateral (
  select d.source_id
  from public.deals d
  where d.client_id = c.id
  order by d.created_at
  limit 1
) first_deal on true;

-- Timeline 360: actividades humanas + eventos que ya existen. Nada se escribe dos veces.
create view public.client_timeline with (security_invoker = true) as
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
left join public.members m on m.org_id = h.org_id and m.user_id = h.changed_by;

revoke all on public.deals_board, public.clients_overview, public.client_timeline from anon;

-- ---------------------------------------------------------------------------
-- Búsqueda para ⌘K: sin acentos ni mayúsculas ("mataro" encuentra "Mataró")
-- ---------------------------------------------------------------------------
-- Minúsculas y sin acentos. Con el diccionario explícito: con search_path vacío,
-- unaccent(text) de un argumento no encuentra su diccionario.
create function private.search_text(p_value text) returns text
language sql
stable
set search_path = ''
as $$
  select extensions.unaccent('extensions.unaccent'::regdictionary, lower(coalesce(p_value, '')))
$$;
grant execute on function private.search_text(text) to authenticated;

create function public.search_org(p_org uuid, p_query text, p_limit integer default 6)
returns table (kind text, id uuid, title text, subtitle text)
language sql
stable
security invoker
set search_path = ''
as $$
  with q as (
    select '%' || private.search_text(btrim(p_query)) || '%' as pattern
  )
  (select 'client', c.id, c.display_name, coalesce(c.legal_name, c.tax_id, c.city)
   from public.clients c, q
   where c.org_id = p_org and c.archived_at is null
     and (private.search_text(c.display_name) like q.pattern
          or private.search_text(c.legal_name) like q.pattern
          or lower(coalesce(c.tax_id, '')) like q.pattern)
   order by c.display_name
   limit p_limit)
  union all
  (select 'contact', ct.id, ct.full_name, coalesce(ct.email, cl.display_name)
   from public.contacts ct
   join public.clients cl on cl.id = ct.client_id, q
   where ct.org_id = p_org and ct.archived_at is null
     and (private.search_text(ct.full_name) like q.pattern or lower(coalesce(ct.email, '')) like q.pattern)
   order by ct.full_name
   limit p_limit)
  union all
  (select 'deal', d.id, d.title, cl.display_name
   from public.deals d
   join public.clients cl on cl.id = d.client_id, q
   where d.org_id = p_org and d.archived_at is null
     and (private.search_text(d.title) like q.pattern or private.search_text(cl.display_name) like q.pattern)
   order by d.updated_at desc
   limit p_limit)
$$;

revoke all on function public.search_org(uuid, text, integer) from public, anon;
grant execute on function public.search_org(uuid, text, integer) to authenticated;

revoke all on all tables in schema public from anon;
