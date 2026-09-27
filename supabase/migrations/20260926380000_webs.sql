-- GNERAI OS · Webs: uptime, certificados SSL y dominios de las webs de los clientes
-- GNERAI aloja las webs de sus clientes en su propio servidor. Esta migración guarda qué webs se
-- vigilan (sites) y lo que se ve al comprobarlas (site_checks); el cron las comprueba cada 5
-- minutos (docs/CRON.md, src/server/sites) y avisa a los socios en la bandeja y por push.
--
-- Lo que se guarda:
-- - sites: lo que decide una persona (la URL, de qué cliente es, si la alojamos, cuándo caduca el
--   dominio, si se vigila).
-- - site_checks: lo que vio el servidor en cada comprobación (código HTTP, tiempo de respuesta,
--   qué falló y la caducidad del certificado). Son hechos: no se corrigen. Se guardan 30 días (la
--   ventana de uptime más larga); el cron poda las más antiguas.
-- Todo lo demás se deriva y no se guarda (vista sites_overview y src/domain/sites): el estado
-- (funciona, lenta, caída, sin datos, en pausa), el uptime de 24 h, 7 y 30 días, la racha de fallos
-- en curso, los días que le quedan al certificado y al dominio, y cuándo hay que avisar.
-- Los umbrales (días de aviso del SSL y del dominio, lentitud, fallos seguidos antes de avisar)
-- viven en orgs.settings.sites (src/app/[org]/settings/schema.ts).
--
-- Seguridad: org_id y RLS con private.has_role en las dos tablas; FKs compuestas (org_id, x_id).
-- Las lee cualquier miembro y las escribe un socio. Las comprobaciones no se editan ni se borran a
-- mano (las borra la poda del cron, con service_role, o el borrado de su web).

-- ---------------------------------------------------------------------------
-- Webs
-- ---------------------------------------------------------------------------
create table public.sites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  -- Vacío: una web propia o de nadie en concreto.
  client_id uuid,
  -- Normalizada por la app (normalizeSiteUrl, src/domain/sites/url.ts, con la misma forma):
  -- https, host en minúsculas con un dominio de verdad (nada de IPs ni "localhost"), sin la
  -- barra de la raíz ni fragmento. Así la misma web no se da de alta dos veces.
  url text not null check (
    char_length(url) <= 2048
    and url ~ '^https://([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?(:[0-9]{1,5})?([/?][^[:space:]#]*)?$'
    and url !~ '^https://[^/?]+/$'
  ),
  -- Vacío: se enseña el dominio.
  label text check (label is null or char_length(btrim(label)) between 1 and 120),
  -- La alojamos nosotros (en nuestro servidor) o solo la vigilamos.
  hosted_by_us boolean not null default true,
  -- Lo escribe una persona (no se consulta el WHOIS): hasta cuándo está pagado el dominio.
  domain_expires_on date,
  notes text check (notes is null or char_length(notes) <= 5000),
  -- En pausa: no se comprueba ni avisa.
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  unique (org_id, url),
  foreign key (org_id, client_id) references public.clients (org_id, id)
);
create index sites_client_idx on public.sites (client_id) where client_id is not null;

-- ---------------------------------------------------------------------------
-- Comprobaciones
-- ---------------------------------------------------------------------------
create table public.site_checks (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs (id) on delete cascade,
  site_id uuid not null,
  checked_at timestamptz not null default now(),
  -- Respondió sin error (código < 400) dentro del tiempo límite.
  ok boolean not null,
  -- El código HTTP final (después de seguir las redirecciones); vacío si no hubo respuesta.
  status_code smallint check (status_code is null or status_code between 100 and 599),
  -- Lo que tardó en llegar la respuesta; vacío si no llegó.
  response_ms integer check (response_ms is null or response_ms between 0 and 600000),
  -- Qué falló, como clave (timeout, dns, refused, reset, tls_expired, tls_invalid, redirects,
  -- http, network): la etiqueta sale de i18n (sites.errors.*).
  error text check (error is null or error ~ '^[a-z][a-z_]{0,39}$'),
  -- Caducidad del certificado que presentó el servidor (aunque no fuera válido); vacía si no se
  -- pudo leer.
  tls_expires_at timestamptz,
  foreign key (org_id, site_id) references public.sites (org_id, id) on delete cascade,
  -- Una comprobación o va bien o dice por qué no.
  check (ok = (error is null))
);
-- Las últimas de cada web (estado, racha, uptime): `ok` incluido para contar sin leer la tabla.
create index site_checks_site_idx on public.site_checks (site_id, checked_at desc) include (ok);
-- La poda de las de más de 30 días.
create index site_checks_checked_idx on public.site_checks (checked_at);

-- ---------------------------------------------------------------------------
-- Triggers comunes y auditoría (las comprobaciones no se auditan: son del servidor y se podan)
-- ---------------------------------------------------------------------------
create trigger set_updated_at before update on public.sites for each row execute function private.set_updated_at();
create trigger audit after insert or update or delete on public.sites for each row execute function private.audit_row();

-- ---------------------------------------------------------------------------
-- RLS y privilegios
-- ---------------------------------------------------------------------------
alter table public.sites enable row level security;
alter table public.site_checks enable row level security;

-- Webs: las ve cualquier miembro y las lleva un socio (darlas de alta, editarlas, pausarlas o
-- quitarlas; al quitar una web se van sus comprobaciones).
create policy sites_select on public.sites for select to authenticated using (private.has_role(org_id, 'viewer'));
create policy sites_insert on public.sites for insert to authenticated with check (private.has_role(org_id, 'partner'));
create policy sites_update on public.sites for update to authenticated
  using (private.has_role(org_id, 'partner')) with check (private.has_role(org_id, 'partner'));
create policy sites_delete on public.sites for delete to authenticated using (private.has_role(org_id, 'partner'));

-- Comprobaciones: las ve cualquier miembro; un socio registra una («Comprobar ahora»). El cron
-- las escribe y las poda con service_role.
create policy site_checks_select on public.site_checks for select to authenticated using (private.has_role(org_id, 'viewer'));
create policy site_checks_insert on public.site_checks for insert to authenticated with check (private.has_role(org_id, 'partner'));

revoke all on public.sites, public.site_checks from anon;
revoke update, delete, truncate on public.site_checks from authenticated;

-- ---------------------------------------------------------------------------
-- Vista derivada (security_invoker: respeta la RLS de quien consulta)
-- ---------------------------------------------------------------------------
-- Cada web con su última comprobación, la caducidad del último certificado leído, la racha de
-- fallos en curso y los recuentos de las ventanas de uptime. Una comprobación cuenta en una
-- ventana si se hizo en (ahora − ventana, ahora]; las ventanas van en horas (24, 168 y 720), que no
-- cambian con el horario de verano de la sesión. Gemelas de windowCounts (src/domain/sites/uptime.ts)
-- y de currentStreak (src/domain/sites/incidents.ts): un test comprueba la paridad.
create view public.sites_overview with (security_invoker = true) as
select
  s.id,
  s.org_id,
  s.client_id,
  c.display_name as client_name,
  s.url,
  s.label,
  s.hosted_by_us,
  s.domain_expires_on,
  s.notes,
  s.is_active,
  s.created_at,
  s.updated_at,
  l.checked_at as last_checked_at,
  l.ok as last_ok,
  l.status_code as last_status_code,
  l.response_ms as last_response_ms,
  l.error as last_error,
  tls.tls_expires_at,
  lok.at as last_ok_at,
  -- Fallos seguidos desde la última que fue bien (todas, si ninguna fue bien) y desde cuándo.
  coalesce(run.failures, 0)::integer as consecutive_failures,
  run.since as failing_since,
  coalesce(w.checks_24h, 0)::integer as checks_24h,
  coalesce(w.ok_24h, 0)::integer as ok_24h,
  coalesce(w.checks_7d, 0)::integer as checks_7d,
  coalesce(w.ok_7d, 0)::integer as ok_7d,
  coalesce(w.checks_30d, 0)::integer as checks_30d,
  coalesce(w.ok_30d, 0)::integer as ok_30d
from public.sites s
left join public.clients c on c.id = s.client_id
left join lateral (
  select k.checked_at, k.ok, k.status_code, k.response_ms, k.error
  from public.site_checks k
  where k.site_id = s.id
  order by k.checked_at desc
  limit 1
) l on true
left join lateral (
  select k.tls_expires_at
  from public.site_checks k
  where k.site_id = s.id and k.tls_expires_at is not null
  order by k.checked_at desc
  limit 1
) tls on true
left join lateral (
  select max(k.checked_at) as at
  from public.site_checks k
  where k.site_id = s.id and k.ok
) lok on true
left join lateral (
  select count(*) as failures, min(k.checked_at) as since
  from public.site_checks k
  where k.site_id = s.id and not k.ok and (lok.at is null or k.checked_at > lok.at)
) run on true
left join lateral (
  select
    count(*) filter (where k.checked_at > now() - interval '24 hours') as checks_24h,
    count(*) filter (where k.checked_at > now() - interval '24 hours' and k.ok) as ok_24h,
    count(*) filter (where k.checked_at > now() - interval '168 hours') as checks_7d,
    count(*) filter (where k.checked_at > now() - interval '168 hours' and k.ok) as ok_7d,
    count(*) as checks_30d,
    count(*) filter (where k.ok) as ok_30d
  from public.site_checks k
  where k.site_id = s.id and k.checked_at > now() - interval '720 hours' and k.checked_at <= now()
) w on true;

revoke all on public.sites_overview from anon;

-- ---------------------------------------------------------------------------
-- Avisos (bandeja y push). No se usan en esta migración: Postgres no deja usar un valor nuevo de
-- un enum en la misma transacción que lo añade. Los crea el cron (src/server/sites/engine.ts).
-- ---------------------------------------------------------------------------
alter type public.notification_kind add value if not exists 'site_down';
alter type public.notification_kind add value if not exists 'site_up';
alter type public.notification_kind add value if not exists 'ssl_expiring';
alter type public.notification_kind add value if not exists 'domain_expiring';
