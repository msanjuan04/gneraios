-- Citas personales de cada socio y conexión OAuth individual con Google Calendar.
-- Los vencimientos/facturas/tareas siguen en sus tablas de origen; solo estas citas se guardan aquí.
create table public.calendar_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  member_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text not null default '' check (char_length(description) <= 10000),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  google_event_id text,
  dirty boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  foreign key (org_id, member_id) references public.members (org_id, id) on delete cascade,
  unique (org_id, member_id, google_event_id),
  check (ends_at > starts_at),
  check (ends_at <= starts_at + interval '31 days')
);
create index calendar_entries_range_idx on public.calendar_entries (org_id, member_id, starts_at);
create trigger set_updated_at before update on public.calendar_entries
  for each row execute function private.set_updated_at();
alter table public.calendar_entries enable row level security;
create policy calendar_entries_select on public.calendar_entries for select to authenticated
  using (private.has_role(org_id, 'viewer') and exists (
    select 1 from public.members m where m.org_id = calendar_entries.org_id and m.id = calendar_entries.member_id
      and m.user_id = (select auth.uid()) and m.is_active));
create policy calendar_entries_insert on public.calendar_entries for insert to authenticated
  with check (private.has_role(org_id, 'partner') and exists (
    select 1 from public.members m where m.org_id = calendar_entries.org_id and m.id = calendar_entries.member_id
      and m.user_id = (select auth.uid()) and m.is_active));
create policy calendar_entries_update on public.calendar_entries for update to authenticated
  using (private.has_role(org_id, 'partner') and exists (
    select 1 from public.members m where m.org_id = calendar_entries.org_id and m.id = calendar_entries.member_id
      and m.user_id = (select auth.uid()) and m.is_active))
  with check (private.has_role(org_id, 'partner') and exists (
    select 1 from public.members m where m.org_id = calendar_entries.org_id and m.id = calendar_entries.member_id
      and m.user_id = (select auth.uid()) and m.is_active));
create policy calendar_entries_delete on public.calendar_entries for delete to authenticated
  using (private.has_role(org_id, 'partner') and exists (
    select 1 from public.members m where m.org_id = calendar_entries.org_id and m.id = calendar_entries.member_id
      and m.user_id = (select auth.uid()) and m.is_active));
revoke all on public.calendar_entries from anon;
grant select (id, org_id, member_id, title, description, starts_at, ends_at, all_day, google_event_id, dirty, deleted_at, created_at, updated_at, created_by)
  on public.calendar_entries to authenticated;
grant insert (org_id, member_id, title, description, starts_at, ends_at, all_day, created_by)
  on public.calendar_entries to authenticated;
grant update (title, description, starts_at, ends_at, all_day, dirty, deleted_at) on public.calendar_entries to authenticated;
grant delete on public.calendar_entries to authenticated;

-- El refresh token nunca es visible por la API de usuario. Solo lo lee la app con service_role
-- tras comprobar sesión y pertenencia del socio. No se reutiliza el OAuth SEO de la organización.
create table public.google_calendar_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  member_id uuid not null,
  account_email text not null default '',
  refresh_token_ciphertext text not null,
  granted_scopes text[] not null default '{}',
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (org_id, member_id) references public.members (org_id, id) on delete cascade,
  unique (org_id, member_id)
);
create trigger set_updated_at before update on public.google_calendar_connections
  for each row execute function private.set_updated_at();
alter table public.google_calendar_connections enable row level security;
create policy google_calendar_connections_select on public.google_calendar_connections for select to authenticated
  using (private.has_role(org_id, 'viewer') and exists (
    select 1 from public.members m where m.org_id = google_calendar_connections.org_id and m.id = google_calendar_connections.member_id
      and m.user_id = (select auth.uid()) and m.is_active));
revoke all on public.google_calendar_connections from anon, authenticated;
grant select (id, org_id, member_id, account_email, granted_scopes, connected_at, last_synced_at, last_error, created_at, updated_at)
  on public.google_calendar_connections to authenticated;
