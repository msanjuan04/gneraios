-- GNERAI OS · Portal del cliente y aceptación online de presupuestos
-- Los clientes nunca inician sesión: un socio comparte un enlace secreto.
-- - /p/q/<token>: un presupuesto para verlo, descargarlo y aceptarlo (o rechazarlo) online.
-- - /p/c/<token>: «Tu espacio GNERAI», el espacio del cliente: fases de su proyecto, el trabajo
--   que el socio marca como visible, entregables, servicios, documentos (facturas con cómo
--   pagarlas, presupuestos para aceptar y contratos) y un formulario para pedir algo. Cada
--   sección se enciende o se apaga por cliente.
--
-- Seguridad (ARCHITECTURE.md §5):
-- - El token son 32 bytes aleatorios (base64url) que solo existen en el enlace: aquí se guarda
--   su SHA-256 en hex. Ningún miembro puede leer ni el hash (sin privilegio de columna).
-- - Los miembros ven los enlaces; los socios los crean, revocan y renuevan con RPC.
-- - Lo público nunca pasa por PostgREST con la clave anónima: lo sirve el servidor con la clave
--   secreta después de comprobar el hash, a través de las RPC portal_* (solo service_role), que
--   vuelven a validar el enlace en cada llamada y filtran siempre por su org.
-- - Aceptar desde un enlace ejecuta la misma accept_quote (y save_invoice_draft para el primer
--   hito) con la autoridad del socio que compartió el enlace: su rol se vuelve a comprobar
--   dentro. La evidencia (quién, cuándo, IP, navegador y la huella del PDF aceptado) es inmutable.
--
-- Materializado a propósito (ARCHITECTURE.md §1): public_links.expires_at de un presupuesto es
-- valid_until + gracia; lo mantiene un trigger cuando cambia la validez.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.public_link_kind as enum ('quote', 'client');
create type public.client_file_kind as enum ('file', 'link');

-- Avisos nuevos. No se usan en SQL plano de esta migración (Postgres no deja usar un valor en la
-- misma transacción que lo añade): solo dentro de funciones plpgsql, que los resuelven al ejecutarse.
alter type public.notification_kind add value if not exists 'quote_accepted';
alter type public.notification_kind add value if not exists 'quote_rejected';
alter type public.notification_kind add value if not exists 'portal_request';

-- ---------------------------------------------------------------------------
-- Actividades visibles para el cliente («Lo que hemos hecho»)
-- ---------------------------------------------------------------------------
-- Por defecto nada es visible: el socio marca a propósito lo que el cliente puede leer.
alter table public.activities add column client_visible boolean not null default false;
create index activities_client_visible_idx on public.activities (client_id, occurred_at desc) where client_visible;

-- ---------------------------------------------------------------------------
-- Enlaces públicos
-- ---------------------------------------------------------------------------
create table public.public_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  kind public.public_link_kind not null,
  -- Destino: un presupuesto (quote) o un cliente (client), nunca los dos. El cliente de un
  -- enlace de presupuesto es el del presupuesto: no se guarda dos veces.
  quote_id uuid,
  client_id uuid,
  -- SHA-256 (hex) del token. El token no se guarda nunca.
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  -- Presupuesto: valid_until + gracia (trigger). Portal: un año desde que se crea o se renueva.
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  view_count integer not null default 0 check (view_count >= 0),
  last_viewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  unique (token_hash),
  foreign key (org_id, quote_id) references public.quotes (org_id, id) on delete cascade,
  foreign key (org_id, client_id) references public.clients (org_id, id),
  check ((kind = 'quote') = (quote_id is not null)),
  check ((kind = 'client') = (client_id is not null))
);
-- Un enlace vivo por destino: crear otro revoca el anterior.
create unique index public_links_one_quote_idx on public.public_links (quote_id) where revoked_at is null and kind = 'quote';
create unique index public_links_one_client_idx on public.public_links (client_id) where revoked_at is null and kind = 'client';
create index public_links_org_idx on public.public_links (org_id, created_at desc);

-- Intentos de las acciones públicas por enlace y ventana (límite de peticiones). Privado: solo
-- lo tocan las funciones de este fichero.
create table private.public_link_hits (
  link_id uuid not null references public.public_links (id) on delete cascade,
  action text not null check (action ~ '^[a-z_]{1,20}$'),
  window_started_at timestamptz not null,
  hits integer not null check (hits >= 0),
  primary key (link_id, action)
);

-- ---------------------------------------------------------------------------
-- Evidencia de las aceptaciones online (inmutable)
-- ---------------------------------------------------------------------------
create table public.quote_acceptances (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  quote_id uuid not null,
  -- El enlace desde el que se aceptó (el del presupuesto o el portal del cliente).
  link_id uuid not null,
  accepted_at timestamptz not null default now(),
  signer_name text not null check (char_length(btrim(signer_name)) between 1 and 120),
  signer_email text not null
    check (signer_email = lower(btrim(signer_email)))
    check (char_length(signer_email) <= 254 and signer_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  -- Firma tecleada (opcional): el nombre tal cual lo escribió.
  signature text check (signature is null or char_length(btrim(signature)) between 1 and 120),
  -- La frase exacta que marcó («He leído y acepto…»), en el idioma en que la vio.
  consent_text text not null check (char_length(btrim(consent_text)) between 1 and 500),
  locale public.app_locale not null,
  ip_address text check (ip_address is null or char_length(ip_address) <= 64),
  forwarded_for text check (forwarded_for is null or char_length(forwarded_for) <= 500),
  user_agent text check (user_agent is null or char_length(user_agent) <= 500),
  -- Qué se aceptó: el número y la versión (updated_at) del presupuesto, y la huella del PDF
  -- generado en ese momento, cuya copia exacta queda en Storage (bucket quote-acceptances).
  quote_number text not null,
  quote_version timestamptz not null,
  pdf_sha256 text not null check (pdf_sha256 ~ '^[0-9a-f]{64}$'),
  pdf_path text check (pdf_path is null or pdf_path like (org_id::text || '/%')),
  created_at timestamptz not null default now(),
  unique (org_id, id),
  unique (quote_id),
  foreign key (org_id, quote_id) references public.quotes (org_id, id),
  foreign key (org_id, link_id) references public.public_links (org_id, id)
);
create index quote_acceptances_org_idx on public.quote_acceptances (org_id, accepted_at desc);

-- ---------------------------------------------------------------------------
-- Ajustes del portal de cada cliente
-- ---------------------------------------------------------------------------
create table public.client_portal_settings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  client_id uuid not null,
  -- Secciones encendidas o apagadas ({ "progress": true, "web_data": false… }). Las que no están
  -- toman su valor por defecto (src/domain/portal/sections.ts): añadir una sección no toca la base.
  sections jsonb not null default '{}'::jsonb
    check (jsonb_typeof(sections) = 'object')
    check (not jsonb_path_exists(sections, '$.* ? (@.type() != "boolean")')),
  -- «Próximos pasos» de la sección «En qué estamos», en texto plano.
  next_steps text check (next_steps is null or char_length(next_steps) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  unique (org_id, client_id),
  foreign key (org_id, client_id) references public.clients (org_id, id)
);

-- ---------------------------------------------------------------------------
-- Entregables y material del cliente
-- ---------------------------------------------------------------------------
create table public.client_files (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  client_id uuid not null,
  contract_id uuid,
  kind public.client_file_kind not null,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  -- Fichero: ruta en el bucket privado client-files, <org>/<cliente>/<id>/<nombre>.
  storage_path text,
  file_name text check (file_name is null or char_length(file_name) between 1 and 200),
  content_type text check (content_type is null or char_length(content_type) <= 200),
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  -- Enlace: una URL http(s) (Drive, Figma, la web en staging…).
  url text check (url is null or (char_length(url) <= 2000 and url ~* '^https?://[^[:space:]]+$')),
  -- Un fichero no se enseña hasta que su subida se confirma.
  uploaded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  foreign key (org_id, client_id) references public.clients (org_id, id),
  foreign key (org_id, contract_id, client_id) references public.contracts (org_id, id, client_id),
  check ((kind = 'file') = (storage_path is not null)),
  check ((kind = 'file') = (file_name is not null)),
  check ((kind = 'link') = (url is not null)),
  check (kind = 'file' or uploaded_at is null),
  check (storage_path is null or storage_path like (org_id::text || '/' || client_id::text || '/%'))
);
create index client_files_client_idx on public.client_files (client_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Funciones auxiliares
-- ---------------------------------------------------------------------------

-- Un ajuste numérico de la org (orgs.settings) dentro de sus límites, o el valor por defecto.
create function private.portal_setting_days(p_org uuid, p_key text, p_default integer, p_max integer) returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when jsonb_typeof(o.settings -> p_key) = 'number' and (o.settings ->> p_key)::numeric between 1 and p_max
      then round((o.settings ->> p_key)::numeric)::integer
    end
    from public.orgs o
    where o.id = p_org
  ), p_default)
$$;

-- Caducidad del enlace de un presupuesto: el final del día valid_until + gracia
-- (orgs.settings.portal_quote_grace_days, 30 si no está), en la zona de la org.
create function private.portal_quote_link_expiry(p_org uuid, p_valid_until date) returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select ((p_valid_until + private.portal_setting_days(p_org, 'portal_quote_grace_days', 30, 365) + 1)::timestamp
          at time zone o.timezone)
  from public.orgs o
  where o.id = p_org
$$;

-- Caducidad del portal de un cliente desde ahora (orgs.settings.portal_link_days, 365 si no está).
create function private.portal_client_link_expiry(p_org uuid) returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select now() + make_interval(days => private.portal_setting_days(p_org, 'portal_link_days', 365, 1095))
$$;

-- El enlace vivo (ni revocado ni caducado) de un hash, bloqueado para la transacción.
create function private.portal_live_link(p_token_hash text) returns public.public_links
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.public_links;
begin
  select * into v_link from public.public_links l where l.token_hash = p_token_hash for update;
  if not found or v_link.revoked_at is not null or v_link.expires_at <= now() then
    raise exception 'El enlace no es válido' using errcode = 'P0002', hint = 'portal_link_invalid';
  end if;
  return v_link;
end;
$$;

-- ¿Da acceso el enlace a este presupuesto? El suyo, o cualquiera de su cliente desde el portal.
create function private.portal_link_covers(p_link public.public_links, p_quote public.quotes) returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_link.org_id = p_quote.org_id
     and ((p_link.kind = 'quote' and p_link.quote_id = p_quote.id)
          or (p_link.kind = 'client' and p_link.client_id = p_quote.client_id))
$$;

-- Actuar con la autoridad de un usuario (el socio que compartió el enlace) durante el resto de la
-- transacción: auth.uid() lo devuelve y las RPC de socio comprueban su rol como siempre.
-- Devuelve lo que había, para restaurarlo con portal_end_act.
create function private.portal_act_as(p_user uuid) returns text[]
language plpgsql
set search_path = ''
as $$
declare
  v_prev text[] := array[current_setting('request.jwt.claim.sub', true), current_setting('request.jwt.claims', true)];
begin
  if p_user is null then
    raise exception 'El socio que compartió el enlace ya no existe' using errcode = '42501', hint = 'portal_link_orphaned';
  end if;
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config(
    'request.jwt.claims',
    (coalesce(nullif(v_prev[2], ''), '{}')::jsonb || jsonb_build_object('sub', p_user, 'role', 'authenticated'))::text,
    true
  );
  return v_prev;
end;
$$;

create function private.portal_end_act(p_prev text[]) returns void
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_prev[1], ''), true);
  perform set_config('request.jwt.claims', coalesce(p_prev[2], ''), true);
end;
$$;

-- Aviso para los socios y owners activos de la org (cada uno con su estado de leído).
create function private.portal_notify_partners(
  p_org uuid,
  p_kind text,
  p_params jsonb,
  p_href text,
  p_dedupe text,
  p_member uuid default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (org_id, member_id, kind, params, href, dedupe_key)
  select p_org, m.id, p_kind::public.notification_kind, p_params, p_href, p_dedupe || ':' || m.id::text
  from public.members m
  where m.org_id = p_org
    and m.is_active
    and m.role >= 'partner'
    -- Con destinatario: solo él, si sigue activo (si no, todos los socios).
    and (p_member is null
         or m.id = p_member
         or not exists (select 1 from public.members x where x.id = p_member and x.org_id = p_org and x.is_active))
  on conflict (org_id, dedupe_key) do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- Guardas y triggers
-- ---------------------------------------------------------------------------

-- La evidencia de una aceptación no se toca (tampoco con service_role).
create function private.quote_acceptances_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'La evidencia de una aceptación no se modifica' using errcode = 'P0001', hint = 'acceptance_immutable';
end;
$$;

create trigger quote_acceptances_guard before update or delete on public.quote_acceptances
  for each row execute function private.quote_acceptances_guard();

-- Si cambia la validez de un presupuesto, su enlace caduca con ella.
create function private.quotes_sync_link_expiry() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.valid_until is not null and new.valid_until is distinct from old.valid_until then
    update public.public_links l
       set expires_at = private.portal_quote_link_expiry(new.org_id, new.valid_until)
     where l.quote_id = new.id and l.kind = 'quote' and l.revoked_at is null;
  end if;
  return null;
end;
$$;

create trigger quotes_sync_link_expiry after update of valid_until on public.quotes
  for each row execute function private.quotes_sync_link_expiry();

-- La auditoría (que leen los owners) nunca guarda el hash, y las visitas no llenan el log.
create function private.audit_public_links() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) - 'token_hash' end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) - 'token_hash' end;
  v_row jsonb := coalesce(v_new, v_old);
  v_noise text[] := array['updated_at', 'view_count', 'last_viewed_at'];
begin
  if tg_op = 'UPDATE' and (v_old - v_noise) = (v_new - v_noise) then
    return null;
  end if;
  insert into public.audit_log (org_id, table_name, record_id, action, actor_id, old_data, new_data)
  values ((v_row ->> 'org_id')::uuid, tg_table_name, (v_row ->> 'id')::uuid, lower(tg_op), auth.uid(), v_old, v_new);
  return null;
end;
$$;

create trigger audit after insert or update or delete on public.public_links
  for each row execute function private.audit_public_links();
create trigger audit after insert or update or delete on public.client_portal_settings
  for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.client_files
  for each row execute function private.audit_row();

create trigger set_updated_at before update on public.public_links for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.client_portal_settings for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.client_files for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS y privilegios
-- ---------------------------------------------------------------------------
alter table public.public_links enable row level security;
alter table public.quote_acceptances enable row level security;
alter table public.client_portal_settings enable row level security;
alter table public.client_files enable row level security;

-- Enlaces: los ve cualquier miembro, sin el hash (sin privilegio de columna, ni un select * llega
-- a él). Se crean, revocan y renuevan solo con las RPC de abajo.
create policy public_links_select on public.public_links for select to authenticated using (private.has_role(org_id, 'viewer'));
revoke all on public.public_links from authenticated;
grant select (id, org_id, kind, quote_id, client_id, expires_at, revoked_at, revoked_by, view_count, last_viewed_at,
              created_at, updated_at, created_by)
  on public.public_links to authenticated;

-- Evidencia: la ven los miembros; solo la escribe portal_accept_quote.
create policy quote_acceptances_select on public.quote_acceptances for select to authenticated using (private.has_role(org_id, 'viewer'));
revoke insert, update, delete on public.quote_acceptances from authenticated;

create policy client_portal_settings_select on public.client_portal_settings for select to authenticated
  using (private.has_role(org_id, 'viewer'));
create policy client_portal_settings_insert on public.client_portal_settings for insert to authenticated
  with check (private.has_role(org_id, 'partner'));
create policy client_portal_settings_update on public.client_portal_settings for update to authenticated
  using (private.has_role(org_id, 'partner')) with check (private.has_role(org_id, 'partner'));

create policy client_files_select on public.client_files for select to authenticated using (private.has_role(org_id, 'viewer'));
create policy client_files_insert on public.client_files for insert to authenticated with check (private.has_role(org_id, 'partner'));
create policy client_files_update on public.client_files for update to authenticated
  using (private.has_role(org_id, 'partner')) with check (private.has_role(org_id, 'partner'));
create policy client_files_delete on public.client_files for delete to authenticated using (private.has_role(org_id, 'partner'));

-- ---------------------------------------------------------------------------
-- RPC de los socios
-- ---------------------------------------------------------------------------

-- Crea el enlace de un presupuesto enviado (y vigente) o del portal de un cliente, y revoca el
-- que tuviera. El token lo genera el servidor: aquí solo llega su hash.
create function public.create_public_link(p_kind public.public_link_kind, p_target uuid, p_token_hash text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote public.quotes;
  v_client public.clients;
  v_org uuid;
  v_expires timestamptz;
  v_id uuid;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'El token del enlace no es válido' using errcode = '22023', hint = 'token_invalid';
  end if;

  if p_kind = 'quote' then
    -- Bloquea el presupuesto: dos altas a la vez no dejan dos enlaces vivos.
    select * into v_quote from public.quotes q where q.id = p_target for update;
    if not found or not private.has_role(v_quote.org_id, 'partner') then
      raise exception 'Sin permiso sobre este presupuesto' using errcode = '42501';
    end if;
    if v_quote.status = 'draft' then
      raise exception 'Envía el presupuesto (o márcalo como enviado) antes de compartirlo'
        using errcode = 'P0001', hint = 'portal_quote_draft';
    end if;
    if v_quote.status <> 'sent' then
      raise exception 'Este presupuesto ya tiene respuesta' using errcode = 'P0001', hint = 'portal_quote_closed';
    end if;
    if v_quote.valid_until < private.org_today(v_quote.org_id) then
      raise exception 'La validez del presupuesto ya ha pasado' using errcode = 'P0001', hint = 'portal_quote_expired';
    end if;
    v_org := v_quote.org_id;
    v_expires := private.portal_quote_link_expiry(v_org, v_quote.valid_until);
    update public.public_links l set revoked_at = now(), revoked_by = auth.uid()
     where l.quote_id = v_quote.id and l.kind = 'quote' and l.revoked_at is null;
    insert into public.public_links (org_id, kind, quote_id, token_hash, expires_at, created_by)
    values (v_org, 'quote', v_quote.id, p_token_hash, v_expires, auth.uid())
    returning id into v_id;
  elsif p_kind = 'client' then
    select * into v_client from public.clients c where c.id = p_target for update;
    if not found or not private.has_role(v_client.org_id, 'partner') then
      raise exception 'Sin permiso sobre este cliente' using errcode = '42501';
    end if;
    if v_client.archived_at is not null then
      raise exception 'El cliente está archivado' using errcode = 'P0001', hint = 'portal_client_archived';
    end if;
    v_org := v_client.org_id;
    v_expires := private.portal_client_link_expiry(v_org);
    update public.public_links l set revoked_at = now(), revoked_by = auth.uid()
     where l.client_id = v_client.id and l.kind = 'client' and l.revoked_at is null;
    insert into public.public_links (org_id, kind, client_id, token_hash, expires_at, created_by)
    values (v_org, 'client', v_client.id, p_token_hash, v_expires, auth.uid())
    returning id into v_id;
  else
    raise exception 'Tipo de enlace no válido' using errcode = '22023';
  end if;

  return jsonb_build_object('id', v_id, 'expires_at', v_expires);
end;
$$;

-- Revoca un enlace: deja de funcionar al momento. Revocar uno revocado no hace nada.
create function public.revoke_public_link(p_link_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.public_links;
begin
  select * into v_link from public.public_links l where l.id = p_link_id for update;
  if not found or not private.has_role(v_link.org_id, 'partner') then
    raise exception 'Sin permiso sobre este enlace' using errcode = '42501';
  end if;
  if v_link.revoked_at is null then
    update public.public_links set revoked_at = now(), revoked_by = auth.uid() where id = v_link.id;
  end if;
end;
$$;

-- Renueva el portal de un cliente otro periodo desde hoy (el mismo enlace sigue sirviendo, aunque
-- hubiera caducado). El de un presupuesto caduca con su validez: se renueva ampliándola.
create function public.renew_public_link(p_link_id uuid) returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.public_links;
  v_expires timestamptz;
begin
  select * into v_link from public.public_links l where l.id = p_link_id for update;
  if not found or not private.has_role(v_link.org_id, 'partner') then
    raise exception 'Sin permiso sobre este enlace' using errcode = '42501';
  end if;
  if v_link.revoked_at is not null then
    raise exception 'Un enlace revocado no se renueva: crea otro' using errcode = 'P0001', hint = 'portal_link_revoked';
  end if;
  if v_link.kind <> 'client' then
    raise exception 'El enlace de un presupuesto caduca con su validez' using errcode = 'P0001', hint = 'portal_link_follows_quote';
  end if;
  v_expires := private.portal_client_link_expiry(v_link.org_id);
  update public.public_links set expires_at = v_expires where id = v_link.id;
  return v_expires;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC públicas: solo el servidor (service_role), después de recibir el token
-- ---------------------------------------------------------------------------

-- Resuelve un enlace por su hash. Si está vivo y se pide, cuenta la visita (salvo que la haga un
-- miembro de la org: los socios también abren sus enlaces para probarlos).
create function public.portal_link(p_token_hash text, p_track boolean default false, p_viewer uuid default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.public_links;
  v_status text;
begin
  select * into v_link from public.public_links l where l.token_hash = p_token_hash;
  if not found then
    return jsonb_build_object('status', 'unknown');
  end if;
  v_status := case
    when v_link.revoked_at is not null then 'revoked'
    when v_link.expires_at <= now() then 'expired'
    else 'active'
  end;
  if v_status = 'active' and p_track and not exists (
    select 1 from public.members m where m.org_id = v_link.org_id and m.user_id = p_viewer and m.is_active
  ) then
    update public.public_links
       set view_count = view_count + 1, last_viewed_at = now()
     where id = v_link.id
    returning * into v_link;
  end if;
  return jsonb_build_object(
    'status', v_status,
    'id', v_link.id,
    'kind', v_link.kind,
    'org_id', v_link.org_id,
    'quote_id', v_link.quote_id,
    'client_id', v_link.client_id,
    'expires_at', v_link.expires_at
  );
end;
$$;

-- Cuenta un intento de una acción pública (aceptar, rechazar, pedir algo) en una ventana fija y
-- dice si está dentro del límite. Va en su propia llamada: si la acción falla, el intento cuenta.
create function public.portal_hit(p_token_hash text, p_action text, p_limit integer, p_window_seconds integer) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link uuid;
  v_hits integer;
begin
  select l.id into v_link from public.public_links l where l.token_hash = p_token_hash;
  if v_link is null then
    return false;
  end if;
  insert into private.public_link_hits as h (link_id, action, window_started_at, hits)
  values (v_link, p_action, now(), 1)
  on conflict (link_id, action) do update set
    window_started_at = case when h.window_started_at <= now() - make_interval(secs => p_window_seconds) then now() else h.window_started_at end,
    hits = case when h.window_started_at <= now() - make_interval(secs => p_window_seconds) then 1 else h.hits + 1 end
  returning hits into v_hits;
  return v_hits <= p_limit;
end;
$$;

-- Aceptar online, en una transacción: comprueba el enlace, que el presupuesto sigue abierto y es
-- la versión que vio el cliente; guarda la evidencia; ejecuta accept_quote como el socio que
-- compartió el enlace (contrato, líneas, emisor, hitos, deal ganado) y avisa a los socios.
-- Devuelve el contrato, como accept_quote. Una segunda llamada falla con quote_already_accepted.
-- p_evidence: { signer_name, signer_email, signature?, consent_text, locale, ip_address?,
--               forwarded_for?, user_agent?, pdf_sha256, pdf_path? }
create function public.portal_accept_quote(p_token_hash text, p_quote_id uuid, p_version timestamptz, p_evidence jsonb) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.public_links;
  v_quote public.quotes;
  v_client_name text;
  v_prev text[];
  v_contract uuid;
  v_signer text := btrim(coalesce(p_evidence ->> 'signer_name', ''));
begin
  v_link := private.portal_live_link(p_token_hash);
  -- Bloquea el presupuesto: dos envíos a la vez se ordenan y el segundo ve el aceptado.
  select * into v_quote from public.quotes q where q.id = p_quote_id and q.org_id = v_link.org_id for update;
  if not found or not private.portal_link_covers(v_link, v_quote) then
    raise exception 'Presupuesto no encontrado' using errcode = 'P0002', hint = 'portal_quote_not_found';
  end if;
  if v_quote.status = 'accepted' then
    raise exception 'Este presupuesto ya está aceptado' using errcode = 'P0001', hint = 'quote_already_accepted';
  end if;
  if v_quote.status <> 'sent' then
    raise exception 'Este presupuesto ya no se puede aceptar' using errcode = 'P0001', hint = 'portal_quote_closed';
  end if;
  if v_quote.valid_until < private.org_today(v_quote.org_id) then
    raise exception 'La validez del presupuesto ya ha pasado' using errcode = 'P0001', hint = 'portal_quote_expired';
  end if;
  if p_version is null or v_quote.updated_at <> p_version then
    raise exception 'El presupuesto ha cambiado desde que se abrió' using errcode = 'P0001', hint = 'portal_quote_changed';
  end if;

  insert into public.quote_acceptances (
    org_id, quote_id, link_id, signer_name, signer_email, signature, consent_text, locale, ip_address,
    forwarded_for, user_agent, quote_number, quote_version, pdf_sha256, pdf_path
  )
  values (
    v_quote.org_id,
    v_quote.id,
    v_link.id,
    v_signer,
    lower(btrim(coalesce(p_evidence ->> 'signer_email', ''))),
    nullif(btrim(coalesce(p_evidence ->> 'signature', '')), ''),
    btrim(coalesce(p_evidence ->> 'consent_text', '')),
    coalesce(nullif(p_evidence ->> 'locale', '')::public.app_locale, v_quote.language),
    nullif(left(btrim(coalesce(p_evidence ->> 'ip_address', '')), 64), ''),
    nullif(left(btrim(coalesce(p_evidence ->> 'forwarded_for', '')), 500), ''),
    nullif(left(btrim(coalesce(p_evidence ->> 'user_agent', '')), 500), ''),
    v_quote.number,
    v_quote.updated_at,
    p_evidence ->> 'pdf_sha256',
    nullif(p_evidence ->> 'pdf_path', '')
  );

  v_prev := private.portal_act_as(v_link.created_by);
  v_contract := public.accept_quote(v_quote.id);
  perform private.portal_end_act(v_prev);

  select c.display_name into v_client_name from public.clients c where c.id = v_quote.client_id;
  perform private.portal_notify_partners(
    v_quote.org_id,
    'quote_accepted',
    jsonb_build_object('client', v_client_name, 'number', v_quote.number, 'title', v_quote.title, 'signer', v_signer),
    '/quotes/' || v_quote.id::text,
    'quote_accepted:' || v_quote.id::text
  );
  return v_contract;
end;
$$;

-- El borrador del primer hito tras aceptar online (lo que hace billMilestone con save_invoice_draft),
-- como el socio que compartió el enlace. Solo admite un borrador nuevo del cliente del enlace con
-- hitos de contratos aceptados desde este mismo enlace, y líneas que facturan esos hitos.
create function public.portal_save_invoice_draft(p_token_hash text, p jsonb) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.public_links;
  v_client uuid := nullif(p #>> '{header,client_id}', '')::uuid;
  v_items jsonb := coalesce(p -> 'new_items', '[]'::jsonb);
  v_lines jsonb := coalesce(p -> 'lines', '[]'::jsonb);
  v_prev text[];
  v_id uuid;
begin
  v_link := private.portal_live_link(p_token_hash);
  if nullif(p ->> 'invoice_id', '') is not null
     or v_client is null
     or jsonb_typeof(v_items) <> 'array'
     or jsonb_array_length(v_items) = 0
     or jsonb_typeof(v_lines) <> 'array'
     or exists (
       select 1 from jsonb_array_elements(v_items) x
       where x ->> 'source' is distinct from 'milestone'
          or not exists (
            select 1
            from public.contract_milestones m
            join public.quotes q on q.contract_id = m.contract_id
            join public.quote_acceptances a on a.quote_id = q.id
            where m.id = nullif(x ->> 'milestone_id', '')::uuid
              and q.org_id = v_link.org_id
              and q.client_id = v_client
              and a.link_id = v_link.id
          )
     )
     or exists (
       select 1 from jsonb_array_elements(v_lines) l
       where not exists (
         select 1 from jsonb_array_elements(v_items) x
         where nullif(l ->> 'billable_item_id', '') is not null and x ->> 'id' = l ->> 'billable_item_id'
       )
     ) then
    raise exception 'Este borrador no se puede preparar desde un enlace' using errcode = '42501', hint = 'portal_draft_forbidden';
  end if;

  v_prev := private.portal_act_as(v_link.created_by);
  v_id := public.save_invoice_draft(p);
  perform private.portal_end_act(v_prev);
  return v_id;
end;
$$;

-- Rechazar online (con el motivo, si lo da), como el socio que compartió el enlace, y avisar.
-- Repetirlo no hace nada.
create function public.portal_reject_quote(p_token_hash text, p_quote_id uuid, p_reason text default null) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.public_links;
  v_quote public.quotes;
  v_client_name text;
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
  v_prev text[];
begin
  v_link := private.portal_live_link(p_token_hash);
  select * into v_quote from public.quotes q where q.id = p_quote_id and q.org_id = v_link.org_id for update;
  if not found or not private.portal_link_covers(v_link, v_quote) then
    raise exception 'Presupuesto no encontrado' using errcode = 'P0002', hint = 'portal_quote_not_found';
  end if;
  if v_quote.status = 'rejected' then
    return;
  end if;
  if v_quote.status = 'accepted' then
    raise exception 'Este presupuesto ya está aceptado' using errcode = 'P0001', hint = 'quote_already_accepted';
  end if;
  if v_quote.status <> 'sent' then
    raise exception 'Este presupuesto ya no admite respuesta' using errcode = 'P0001', hint = 'portal_quote_closed';
  end if;
  if v_quote.valid_until < private.org_today(v_quote.org_id) then
    raise exception 'La validez del presupuesto ya ha pasado' using errcode = 'P0001', hint = 'portal_quote_expired';
  end if;

  v_prev := private.portal_act_as(v_link.created_by);
  perform public.reject_quote(v_quote.id, v_reason);
  perform private.portal_end_act(v_prev);

  select c.display_name into v_client_name from public.clients c where c.id = v_quote.client_id;
  perform private.portal_notify_partners(
    v_quote.org_id,
    'quote_rejected',
    jsonb_build_object('client', v_client_name, 'number', v_quote.number, 'title', v_quote.title, 'reason', coalesce(v_reason, '')),
    '/quotes/' || v_quote.id::text,
    'quote_rejected:' || v_quote.id::text
  );
end;
$$;

-- «Pedir algo» desde el portal: un deal en la primera etapa abierta con la fuente «Portal» (se
-- crea la primera vez), la petición como nota en su ficha y un aviso a su socio responsable (o a
-- todos los socios si no tiene). Si es urgente, la próxima acción del deal es hoy. Devuelve el deal.
-- p: { subject, description, urgent? }
create function public.portal_create_request(p_token_hash text, p jsonb) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.public_links;
  v_client public.clients;
  v_subject text := btrim(coalesce(p ->> 'subject', ''));
  v_body text := btrim(coalesce(p ->> 'description', ''));
  v_urgent boolean := coalesce((p ->> 'urgent')::boolean, false);
  v_stage uuid;
  v_source uuid;
  v_deal uuid;
begin
  v_link := private.portal_live_link(p_token_hash);
  if v_link.kind <> 'client' then
    raise exception 'El enlace no es válido' using errcode = 'P0002', hint = 'portal_link_invalid';
  end if;
  select * into v_client from public.clients c where c.id = v_link.client_id and c.org_id = v_link.org_id;
  if v_client.archived_at is not null then
    raise exception 'El cliente está archivado' using errcode = 'P0001', hint = 'portal_client_archived';
  end if;
  if char_length(v_subject) not between 1 and 200 or char_length(v_body) not between 1 and 5000 then
    raise exception 'La petición no es válida' using errcode = '22023', hint = 'portal_request_invalid';
  end if;

  select s.id into v_stage
  from public.pipeline_stages s
  where s.org_id = v_link.org_id and s.kind = 'open' and s.archived_at is null
  order by s.position, s.created_at
  limit 1;
  if v_stage is null then
    raise exception 'No hay ninguna etapa abierta en el pipeline' using errcode = 'P0001', hint = 'portal_request_unavailable';
  end if;

  -- La fuente «Portal»: dos peticiones a la vez no la crean dos veces.
  perform pg_advisory_xact_lock(hashtextextended('portal_source:' || v_link.org_id::text, 0));
  select a.id into v_source
  from public.acquisition_sources a
  where a.org_id = v_link.org_id and lower(btrim(a.name)) = 'portal' and a.archived_at is null
  order by a.created_at
  limit 1;
  if v_source is null then
    insert into public.acquisition_sources (org_id, name, position)
    values (
      v_link.org_id,
      'Portal',
      coalesce((select max(a.position) from public.acquisition_sources a where a.org_id = v_link.org_id), 0) + 1
    )
    returning id into v_source;
  end if;

  insert into public.deals (org_id, client_id, title, stage_id, source_id, owner_member_id, next_action_on)
  values (
    v_link.org_id,
    v_client.id,
    v_subject,
    v_stage,
    v_source,
    v_client.owner_member_id,
    case when v_urgent then private.org_today(v_link.org_id) end
  )
  returning id into v_deal;

  insert into public.activities (org_id, client_id, deal_id, kind, title, body, occurred_at)
  values (v_link.org_id, v_client.id, v_deal, 'note', v_subject, v_body, now());

  perform private.portal_notify_partners(
    v_link.org_id,
    'portal_request',
    jsonb_build_object('client', v_client.display_name, 'subject', v_subject, 'urgent', case when v_urgent then 'yes' else 'no' end),
    '/pipeline?deal=' || v_deal::text,
    'portal_request:' || v_deal::text,
    v_client.owner_member_id
  );
  return v_deal;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privilegios de funciones
-- ---------------------------------------------------------------------------
revoke all on function private.portal_setting_days(uuid, text, integer, integer) from public;
revoke all on function private.portal_quote_link_expiry(uuid, date) from public;
revoke all on function private.portal_client_link_expiry(uuid) from public;
revoke all on function private.portal_live_link(text) from public;
revoke all on function private.portal_link_covers(public.public_links, public.quotes) from public;
revoke all on function private.portal_act_as(uuid) from public;
revoke all on function private.portal_end_act(text[]) from public;
revoke all on function private.portal_notify_partners(uuid, text, jsonb, text, text, uuid) from public;

revoke all on function public.create_public_link(public.public_link_kind, uuid, text) from public, anon;
revoke all on function public.revoke_public_link(uuid) from public, anon;
revoke all on function public.renew_public_link(uuid) from public, anon;
grant execute on function public.create_public_link(public.public_link_kind, uuid, text) to authenticated;
grant execute on function public.revoke_public_link(uuid) to authenticated;
grant execute on function public.renew_public_link(uuid) to authenticated;

-- Las públicas, solo para el servidor: ni anon ni authenticated.
revoke all on function public.portal_link(text, boolean, uuid) from public, anon, authenticated;
revoke all on function public.portal_hit(text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.portal_accept_quote(text, uuid, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.portal_save_invoice_draft(text, jsonb) from public, anon, authenticated;
revoke all on function public.portal_reject_quote(text, uuid, text) from public, anon, authenticated;
revoke all on function public.portal_create_request(text, jsonb) from public, anon, authenticated;
grant execute on function public.portal_link(text, boolean, uuid) to service_role;
grant execute on function public.portal_hit(text, text, integer, integer) to service_role;
grant execute on function public.portal_accept_quote(text, uuid, timestamptz, jsonb) to service_role;
grant execute on function public.portal_save_invoice_draft(text, jsonb) to service_role;
grant execute on function public.portal_reject_quote(text, uuid, text) to service_role;
grant execute on function public.portal_create_request(text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Storage: entregables del cliente y copia exacta de cada presupuesto aceptado. Privados: solo el
-- servidor lee y escribe (subidas con URL firmada, descargas con URL firmada de vida corta).
-- En PGlite (tests) no existe el esquema storage y esto se salta.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is not null then
    execute $sql$
      insert into storage.buckets (id, name, public, file_size_limit)
      values ('client-files', 'client-files', false, 52428800),
             ('quote-acceptances', 'quote-acceptances', false, 10485760)
      on conflict (id) do nothing
    $sql$;
  end if;
end;
$$;

revoke all on all tables in schema public from anon;
