-- GNERAI OS · SEO: Search Console, GA4 y su relación con el CRM
-- Integraciones OAuth por org (el token de refresco va cifrado y ningún miembro puede leerlo),
-- propiedades (la web propia y las de los clientes), hechos diarios que escribe la
-- sincronización y las consultas agregadas que pinta la pantalla.
-- Ver ARCHITECTURE.md §5 (secretos de integraciones) y §10 (Search Console + GA4).
--
-- Reparto de responsabilidades:
-- - El servidor (service_role) sincroniza: descifra el token, llama a Google y hace upsert de
--   los hechos por su clave natural. Repetir un día no duplica nada.
-- - Los miembros leen con RLS. Conectar y desconectar Google pasa por RPC y es cosa de owners.
-- - Lo que se puede calcular se calcula: el CTR es una columna generada y los totales de un
--   periodo se agregan al consultar (la posición, ponderada por impresiones).

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.integration_provider as enum ('google');
create type public.integration_status as enum ('connected', 'error', 'disconnected');
-- De dónde sale cada hecho: la API de Google o el seed de la demo.
create type public.seo_source as enum ('gsc', 'ga4', 'demo');
-- Canal de GA4: todo el tráfico o solo la búsqueda orgánica (sessionDefaultChannelGroup).
create type public.web_channel as enum ('all', 'organic_search');

-- ---------------------------------------------------------------------------
-- Integraciones: una por org y proveedor
-- ---------------------------------------------------------------------------
create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  provider public.integration_provider not null,
  -- Lo que se sabe del otro lado: conectada, con error de credenciales (hay que reconectar)
  -- o desconectada a propósito. No se deriva de nada nuestro.
  status public.integration_status not null default 'connected',
  account_email text check (account_email is null or account_email = lower(btrim(account_email))),
  scopes text[] not null default '{}',
  connected_by uuid references auth.users (id) on delete set null,
  connected_at timestamptz,
  -- Token de refresco cifrado con AES-256-GCM (clave del servidor, INTEGRATIONS_ENCRYPTION_KEY).
  -- Ningún miembro puede leer esta columna: solo service_role (privilegios más abajo).
  refresh_token_encrypted text,
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  unique (org_id, provider),
  check (status <> 'connected' or refresh_token_encrypted is not null),
  check (status <> 'disconnected' or refresh_token_encrypted is null)
);

-- ---------------------------------------------------------------------------
-- Propiedades: la web propia de la org y las webs que lleva a sus clientes
-- ---------------------------------------------------------------------------
create table public.seo_properties (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  label text not null check (char_length(label) between 1 and 120),
  -- Vacío: la web de la propia org. Con cliente: una web que la org le lleva.
  client_id uuid,
  -- Search Console: "https://www.ejemplo.com/" (prefijo de URL) o "sc-domain:ejemplo.com".
  gsc_site_url text check (gsc_site_url is null or gsc_site_url ~ '^(sc-domain:[^[:space:]/]+|https?://[^[:space:]]+)$'),
  -- GA4: el id numérico de la propiedad (properties/123456789 → 123456789).
  ga4_property_id text check (ga4_property_id is null or ga4_property_id ~ '^[0-9]{1,20}$'),
  -- La que se abre por defecto: una para la org y una por cliente.
  is_primary boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  foreign key (org_id, client_id) references public.clients (org_id, id),
  check (gsc_site_url is not null or ga4_property_id is not null)
);
create index seo_properties_org_idx on public.seo_properties (org_id) where archived_at is null;
create index seo_properties_client_idx on public.seo_properties (client_id) where client_id is not null;
create unique index seo_properties_gsc_idx on public.seo_properties (org_id, gsc_site_url)
  where gsc_site_url is not null and archived_at is null;
create unique index seo_properties_ga4_idx on public.seo_properties (org_id, ga4_property_id)
  where ga4_property_id is not null and archived_at is null;
create unique index seo_properties_one_primary_idx on public.seo_properties (org_id, client_id) nulls not distinct
  where is_primary and archived_at is null;

create function private.seo_properties_normalize() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.label := btrim(new.label);
  new.gsc_site_url := nullif(btrim(coalesce(new.gsc_site_url, '')), '');
  new.ga4_property_id := nullif(regexp_replace(coalesce(new.ga4_property_id, ''), '^\s*(properties/)?|\s+$', '', 'g'), '');
  return new;
end;
$$;

create trigger seo_properties_normalize before insert or update on public.seo_properties
  for each row execute function private.seo_properties_normalize();

-- Marcar una principal desmarca la anterior del mismo dueño; archivar deja de ser principal.
-- Sin security definer: la actualización de las demás pasa por la misma RLS que la de esta.
create function private.seo_properties_single_primary() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.archived_at is not null then
    new.is_primary := false;
  elsif new.is_primary then
    update public.seo_properties p
       set is_primary = false
     where p.org_id = new.org_id
       and p.client_id is not distinct from new.client_id
       and p.id <> new.id
       and p.is_primary
       and p.archived_at is null;
  end if;
  return new;
end;
$$;

create trigger seo_properties_single_primary
  before insert or update of is_primary, client_id, archived_at on public.seo_properties
  for each row execute function private.seo_properties_single_primary();

-- ---------------------------------------------------------------------------
-- Hechos diarios (los escribe la sincronización con upsert por la clave primaria)
-- ---------------------------------------------------------------------------

-- Totales del día de Search Console (incluyen las consultas anonimizadas).
create table public.seo_daily_metrics (
  org_id uuid not null,
  property_id uuid not null,
  metric_on date not null,
  clicks integer not null check (clicks >= 0),
  impressions integer not null check (impressions >= 0),
  -- CTR en puntos básicos (345 = 3,45 %). Se deriva de clics e impresiones: nunca se escribe.
  ctr_bps integer generated always as (
    case when impressions > 0 then round(clicks * 10000.0 / impressions)::integer end
  ) stored,
  -- Posición media del día, ponderada por impresiones (como la da Search Console).
  position numeric(6, 2) check (position is null or position >= 1),
  source public.seo_source not null check (source in ('gsc', 'demo')),
  primary key (property_id, metric_on),
  foreign key (org_id, property_id) references public.seo_properties (org_id, id)
);

-- Consulta × página × día. Solo las filas que Search Console devuelve (sin anonimizadas).
create table public.seo_query_daily (
  org_id uuid not null,
  property_id uuid not null,
  metric_on date not null,
  query text not null check (char_length(query) <= 2048),
  page text not null check (char_length(page) <= 4096),
  -- Clave compacta de (consulta, página) para la clave primaria: los textos pueden ser largos.
  key_hash uuid generated always as (md5(query || chr(31) || page)::uuid) stored,
  clicks integer not null check (clicks >= 0),
  impressions integer not null check (impressions >= 0),
  position numeric(6, 2) check (position is null or position >= 1),
  source public.seo_source not null check (source in ('gsc', 'demo')),
  primary key (property_id, metric_on, key_hash),
  foreign key (org_id, property_id) references public.seo_properties (org_id, id)
);

-- Tráfico del día según GA4: todo el tráfico y solo el de búsqueda orgánica.
create table public.web_analytics_daily (
  org_id uuid not null,
  property_id uuid not null,
  metric_on date not null,
  channel public.web_channel not null,
  sessions integer not null check (sessions >= 0),
  -- Usuarios activos del día. No se suman entre días: la misma persona vuelve.
  users integer not null check (users >= 0),
  engaged_sessions integer not null check (engaged_sessions >= 0),
  -- Eventos clave de GA4 (lo que antes se llamaba conversiones).
  conversions integer not null check (conversions >= 0),
  source public.seo_source not null check (source in ('ga4', 'demo')),
  primary key (property_id, metric_on, channel),
  foreign key (org_id, property_id) references public.seo_properties (org_id, id)
);

-- Qué tramo de fechas tiene ya cada propiedad de cada proveedor. La primera carga va hacia
-- atrás (16 meses) y la diaria hacia delante; si una ejecución se corta, la siguiente sigue.
create table public.seo_sync_state (
  org_id uuid not null,
  property_id uuid not null,
  provider public.seo_source not null check (provider in ('gsc', 'ga4')),
  synced_from date,
  synced_to date,
  last_run_at timestamptz,
  last_error text,
  primary key (property_id, provider),
  foreign key (org_id, property_id) references public.seo_properties (org_id, id),
  check ((synced_from is null) = (synced_to is null)),
  check (synced_to is null or synced_to >= synced_from)
);

-- ---------------------------------------------------------------------------
-- Triggers comunes y auditoría
-- ---------------------------------------------------------------------------
create trigger set_updated_at before update on public.integrations for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.seo_properties for each row execute function private.set_updated_at();

create trigger audit after insert or update or delete on public.seo_properties for each row execute function private.audit_row();

-- La auditoría de las integraciones nunca guarda el secreto (el log lo leen los owners), y la
-- sincronización diaria, que solo toca last_sync_at y last_error, no llena el log.
create function private.audit_integrations() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) - 'refresh_token_encrypted' end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) - 'refresh_token_encrypted' end;
  v_row jsonb := coalesce(v_new, v_old);
  v_noise text[] := array['updated_at', 'last_sync_at', 'last_error'];
begin
  if tg_op = 'UPDATE' and (v_old - v_noise) = (v_new - v_noise) then
    return null;
  end if;
  insert into public.audit_log (org_id, table_name, record_id, action, actor_id, old_data, new_data)
  values ((v_row ->> 'org_id')::uuid, tg_table_name, (v_row ->> 'id')::uuid, lower(tg_op), auth.uid(), v_old, v_new);
  return null;
end;
$$;

create trigger audit after insert or update or delete on public.integrations
  for each row execute function private.audit_integrations();

-- ---------------------------------------------------------------------------
-- RLS y privilegios
-- ---------------------------------------------------------------------------
alter table public.integrations enable row level security;
alter table public.seo_properties enable row level security;
alter table public.seo_daily_metrics enable row level security;
alter table public.seo_query_daily enable row level security;
alter table public.web_analytics_daily enable row level security;
alter table public.seo_sync_state enable row level security;

-- Integraciones: cualquier miembro ve si Google está conectado y con qué cuenta, pero nadie
-- lee el token. Sin privilegio de columna, ni siquiera un `select *` llega a él: la app pide
-- siempre las columnas por su nombre. Se escriben solo con las RPC de abajo y desde el servidor.
create policy integrations_select on public.integrations for select to authenticated
  using (private.has_role(org_id, 'viewer'));
revoke all on public.integrations from authenticated;
grant select (id, org_id, provider, status, account_email, scopes, connected_by, connected_at, last_sync_at,
              last_error, created_at, updated_at, created_by)
  on public.integrations to authenticated;

-- Propiedades: las ve cualquier miembro y las lleva un socio. Se archivan, no se borran.
create policy seo_properties_select on public.seo_properties for select to authenticated using (private.has_role(org_id, 'viewer'));
create policy seo_properties_insert on public.seo_properties for insert to authenticated with check (private.has_role(org_id, 'partner'));
create policy seo_properties_update on public.seo_properties for update to authenticated using (private.has_role(org_id, 'partner')) with check (private.has_role(org_id, 'partner'));

-- Los hechos y el estado de la sincronización los escribe el servidor; los miembros los leen.
create policy seo_daily_metrics_select on public.seo_daily_metrics for select to authenticated using (private.has_role(org_id, 'viewer'));
create policy seo_query_daily_select on public.seo_query_daily for select to authenticated using (private.has_role(org_id, 'viewer'));
create policy web_analytics_daily_select on public.web_analytics_daily for select to authenticated using (private.has_role(org_id, 'viewer'));
create policy seo_sync_state_select on public.seo_sync_state for select to authenticated using (private.has_role(org_id, 'viewer'));
revoke insert, update, delete, truncate
  on public.seo_daily_metrics, public.seo_query_daily, public.web_analytics_daily, public.seo_sync_state
  from authenticated;

-- ---------------------------------------------------------------------------
-- Vistas derivadas (security_invoker: respetan la RLS de quien consulta)
-- ---------------------------------------------------------------------------

-- Cada propiedad con su cliente, el tramo de datos que tiene y cómo fue su última sincronización.
create view public.seo_properties_overview with (security_invoker = true) as
select
  p.id,
  p.org_id,
  p.label,
  p.client_id,
  c.display_name as client_name,
  p.gsc_site_url,
  p.ga4_property_id,
  p.is_primary,
  p.archived_at,
  p.created_at,
  m.first_on as first_metric_on,
  m.last_on as last_metric_on,
  (select d.source from public.seo_daily_metrics d where d.property_id = p.id order by d.metric_on desc limit 1) as metric_source,
  w.first_on as first_web_on,
  w.last_on as last_web_on,
  (select a.source from public.web_analytics_daily a where a.property_id = p.id order by a.metric_on desc limit 1) as web_source,
  gsc.synced_from as gsc_synced_from,
  gsc.synced_to as gsc_synced_to,
  gsc.last_run_at as gsc_last_run_at,
  gsc.last_error as gsc_last_error,
  ga4.synced_from as ga4_synced_from,
  ga4.synced_to as ga4_synced_to,
  ga4.last_run_at as ga4_last_run_at,
  ga4.last_error as ga4_last_error
from public.seo_properties p
left join public.clients c on c.id = p.client_id
left join lateral (
  select min(d.metric_on) as first_on, max(d.metric_on) as last_on
  from public.seo_daily_metrics d
  where d.property_id = p.id
) m on true
left join lateral (
  select min(a.metric_on) as first_on, max(a.metric_on) as last_on
  from public.web_analytics_daily a
  where a.property_id = p.id
) w on true
left join public.seo_sync_state gsc on gsc.property_id = p.id and gsc.provider = 'gsc'
left join public.seo_sync_state ga4 on ga4.property_id = p.id and ga4.provider = 'ga4';

revoke all on public.seo_properties_overview from anon;

-- ---------------------------------------------------------------------------
-- RPC
-- ---------------------------------------------------------------------------

-- Guarda (o renueva) la conexión con Google de la org. La llama el callback de OAuth con la
-- sesión del owner; el servidor ya ha cifrado el token con una clave que la base no conoce.
create function public.connect_integration(
  p_org uuid,
  p_provider public.integration_provider,
  p_account_email text,
  p_scopes text[],
  p_secret text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.has_role(p_org, 'owner') then
    raise exception 'Solo un owner puede conectar integraciones' using errcode = '42501', hint = 'owner_required';
  end if;
  if coalesce(btrim(p_secret), '') = '' then
    raise exception 'Falta el token de la integración' using errcode = '22023', hint = 'secret_required';
  end if;

  insert into public.integrations (org_id, provider, status, account_email, scopes, connected_by, connected_at,
                                   refresh_token_encrypted, last_error, created_by)
  values (p_org, p_provider, 'connected', nullif(lower(btrim(coalesce(p_account_email, ''))), ''),
          coalesce(p_scopes, '{}'), auth.uid(), now(), p_secret, null, auth.uid())
  on conflict (org_id, provider) do update set
    status = 'connected',
    account_email = excluded.account_email,
    scopes = excluded.scopes,
    connected_by = excluded.connected_by,
    connected_at = excluded.connected_at,
    refresh_token_encrypted = excluded.refresh_token_encrypted,
    last_error = null
  returning id into v_id;
  return v_id;
end;
$$;

-- Desconecta: borra el token (el servidor lo revoca antes en Google). Los datos se quedan.
create function public.disconnect_integration(p_org uuid, p_provider public.integration_provider) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_role(p_org, 'owner') then
    raise exception 'Solo un owner puede desconectar integraciones' using errcode = '42501', hint = 'owner_required';
  end if;
  update public.integrations
     set status = 'disconnected', refresh_token_encrypted = null, last_error = null
   where org_id = p_org and provider = p_provider;
end;
$$;

-- Consultas o páginas de una propiedad agregadas en un periodo y, si se pide, en otro de
-- comparación: clics, impresiones y posición media ponderada por impresiones. `p_order`:
-- clicks | impressions | gain (más clics ganados) | loss (más clics perdidos). La pantalla
-- decide umbrales y oportunidades (src/domain/seo); aquí solo se agrega y se ordena.
-- security definer con el permiso comprobado una sola vez: con RLS, has_role() se evaluaría
-- en cada una de las decenas de miles de filas que se agregan.
create function public.seo_query_stats(
  p_property_id uuid,
  p_dimension text,
  p_from date,
  p_to date,
  p_compare_from date default null,
  p_compare_to date default null,
  p_order text default 'clicks',
  p_min_position numeric default null,
  p_max_position numeric default null,
  p_min_impressions integer default null,
  p_limit integer default 50
)
returns table (
  key text,
  clicks bigint,
  impressions bigint,
  avg_position numeric,
  compare_clicks bigint,
  compare_impressions bigint,
  compare_avg_position numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with facts as (
    select
      case when p_dimension = 'page' then q.page else q.query end as k,
      q.metric_on between p_from and p_to as cur,
      q.clicks as c,
      q.impressions as i,
      q.position as pos
    from public.seo_query_daily q
    where q.property_id = p_property_id
      and p_dimension in ('query', 'page')
      and exists (
        select 1 from public.seo_properties p
        where p.id = p_property_id and private.has_role(p.org_id, 'viewer')
      )
      and (q.metric_on between p_from and p_to
           or (p_compare_from is not null and p_compare_to is not null
               and q.metric_on between p_compare_from and p_compare_to))
  ),
  agg as (
    select
      f.k,
      coalesce(sum(f.c) filter (where f.cur), 0)::bigint as cur_clicks,
      coalesce(sum(f.i) filter (where f.cur), 0)::bigint as cur_impressions,
      round(sum(f.pos * f.i) filter (where f.cur) / nullif(sum(f.i) filter (where f.cur), 0), 2) as cur_position,
      coalesce(sum(f.c) filter (where not f.cur), 0)::bigint as cmp_clicks,
      coalesce(sum(f.i) filter (where not f.cur), 0)::bigint as cmp_impressions,
      round(sum(f.pos * f.i) filter (where not f.cur) / nullif(sum(f.i) filter (where not f.cur), 0), 2) as cmp_position
    from facts f
    group by f.k
  )
  select a.k, a.cur_clicks, a.cur_impressions, a.cur_position, a.cmp_clicks, a.cmp_impressions, a.cmp_position
  from agg a
  where (p_order in ('gain', 'loss') or a.cur_impressions > 0)
    and (p_order <> 'gain' or a.cur_clicks > a.cmp_clicks)
    and (p_order <> 'loss' or a.cmp_clicks > a.cur_clicks)
    and (p_min_position is null or a.cur_position >= p_min_position)
    and (p_max_position is null or a.cur_position <= p_max_position)
    and (p_min_impressions is null or a.cur_impressions >= p_min_impressions)
  order by
    case p_order
      when 'impressions' then a.cur_impressions
      when 'gain' then a.cur_clicks - a.cmp_clicks
      when 'loss' then a.cmp_clicks - a.cur_clicks
      else a.cur_clicks
    end desc,
    a.cur_impressions desc,
    a.k
  limit least(greatest(coalesce(p_limit, 50), 1), 500)
$$;

revoke all on function public.connect_integration(uuid, public.integration_provider, text, text[], text) from public, anon;
revoke all on function public.disconnect_integration(uuid, public.integration_provider) from public, anon;
revoke all on function public.seo_query_stats(uuid, text, date, date, date, date, text, numeric, numeric, integer, integer) from public, anon;
grant execute on function public.connect_integration(uuid, public.integration_provider, text, text[], text) to authenticated;
grant execute on function public.disconnect_integration(uuid, public.integration_provider) to authenticated;
grant execute on function public.seo_query_stats(uuid, text, date, date, date, date, text, numeric, numeric, integer, integer) to authenticated;

-- anon no necesita nada de este esquema.
revoke all on all tables in schema public from anon;
