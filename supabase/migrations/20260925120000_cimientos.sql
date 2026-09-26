-- GNERAI OS · Hito 1.0 · Cimientos
-- Organizaciones, miembros, invitaciones, emisores, series de facturación, impuestos,
-- auditoría y RLS. Ver ARCHITECTURE.md §5 y §6.

-- ---------------------------------------------------------------------------
-- Esquema privado: funciones auxiliares y tablas internas que la API no expone.
-- ---------------------------------------------------------------------------
create schema if not exists private;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Enums de dominio (valores en inglés; las etiquetas salen de i18n)
-- ---------------------------------------------------------------------------
create type public.member_role as enum ('viewer', 'partner', 'owner'); -- el orden importa: viewer < partner < owner
create type public.app_locale as enum ('es', 'ca', 'en');
create type public.issuer_kind as enum ('company', 'self_employed');
create type public.series_kind as enum ('ordinary', 'rectifying');
create type public.tax_kind as enum ('vat', 'irpf');
create type public.vat_regime as enum ('general', 'exempt', 'reverse_charge_eu', 'not_subject');
create type public.fiscal_provider as enum ('internal');

-- ---------------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------------
create function private.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create function private.initials_from(p_name text) returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    nullif(upper(left(coalesce(parts[1], ''), 1) || left(coalesce(parts[2], ''), 1)), ''),
    'U'
  )
  from (
    select regexp_split_to_array(btrim(split_part(coalesce(p_name, ''), '@', 1)), '[[:space:]._-]+') as parts
  ) s;
$$;

-- ---------------------------------------------------------------------------
-- Organizaciones (tenant)
-- ---------------------------------------------------------------------------
create table public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  slug text not null unique
    check (slug ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$')
    check (slug not in ('login', 'logout', 'auth', 'onboarding', 'api', 'preview', 'settings',
                        'invite', 'admin', 'app', 'brand', 'static', '_next')),
  locale text not null default 'es-ES',
  timezone text not null default 'Europe/Madrid',
  currency char(3) not null default 'EUR',
  -- Umbrales de negocio: viven en la base de datos, no en el código.
  settings jsonb not null default jsonb_build_object(
    'payment_terms_days', 30,
    'billing_day', 1,
    'dunning_days', jsonb_build_array(7, 15),
    'renewal_alert_days', jsonb_build_array(60, 30, 7)
  ),
  branding jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null
);

-- ---------------------------------------------------------------------------
-- Miembros
-- ---------------------------------------------------------------------------
create table public.members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null default 'partner',
  full_name text not null check (char_length(btrim(full_name)) between 1 and 120),
  initials text not null check (char_length(initials) between 1 and 3 and initials = upper(initials)),
  color text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  locale public.app_locale not null default 'es',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, user_id),
  unique (org_id, id)
);
create index members_user_id_idx on public.members (user_id);

-- Autorización: ¿el usuario actual tiene al menos este rol en la org?
-- security definer: consulta members sin pasar por su propia RLS (evita la recursión).
create function private.has_role(p_org uuid, p_min public.member_role) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.members m
    where m.org_id = p_org
      and m.user_id = (select auth.uid())
      and m.is_active
      and m.role >= p_min
  );
$$;
revoke all on function private.has_role(uuid, public.member_role) from public;
grant execute on function private.has_role(uuid, public.member_role) to authenticated;

-- Siempre debe quedar al menos un owner activo por org.
create function private.ensure_an_owner_remains() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'owner' and old.is_active
     and (tg_op = 'DELETE' or new.role <> 'owner' or not new.is_active) then
    -- Serializa cambios de owners en la misma org.
    perform 1 from public.orgs where id = old.org_id for update;
    if not exists (
      select 1
      from public.members m
      where m.org_id = old.org_id
        and m.id <> old.id
        and m.role = 'owner'
        and m.is_active
    ) then
      raise exception 'La organización necesita al menos un owner activo' using errcode = 'P0001';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger members_keep_an_owner
  before update or delete on public.members
  for each row execute function private.ensure_an_owner_remains();

-- ---------------------------------------------------------------------------
-- Invitaciones (se aceptan al iniciar sesión con el email invitado)
-- ---------------------------------------------------------------------------
create table public.member_invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  email text not null
    check (email = lower(btrim(email)))
    check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  role public.member_role not null default 'partner',
  full_name text,
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, email)
);

-- ---------------------------------------------------------------------------
-- Emisores fiscales (GNERAI SL y los socios autónomos)
-- ---------------------------------------------------------------------------
create table public.issuers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  kind public.issuer_kind not null,
  legal_name text not null check (char_length(btrim(legal_name)) between 1 and 200),
  trade_name text,
  tax_id text check (tax_id is null or tax_id ~ '^[A-Z0-9]{8,14}$'),
  address_line text,
  postal_code text,
  city text,
  province text,
  country_code char(2) not null default 'ES' check (country_code ~ '^[A-Z]{2}$'),
  email text,
  phone text,
  iban text check (iban is null or iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'),
  default_irpf_bps integer not null default 0 check (default_irpf_bps between 0 and 10000),
  member_id uuid,
  is_primary boolean not null default false,
  active_from date,
  active_until date,
  verifactu_from date not null,
  fiscal_provider public.fiscal_provider not null default 'internal',
  provider_config jsonb not null default '{}'::jsonb,
  registry_info text,
  logo_path text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  foreign key (org_id, member_id) references public.members (org_id, id),
  check (active_until is null or active_from is null or active_until >= active_from),
  check (kind = 'self_employed' or member_id is null)
);
create unique index issuers_one_primary_idx on public.issuers (org_id) where is_primary and archived_at is null;
create unique index issuers_tax_id_idx on public.issuers (org_id, tax_id) where tax_id is not null and archived_at is null;
create index issuers_member_id_idx on public.issuers (member_id) where member_id is not null;

-- Normaliza NIF e IBAN y pone la fecha Verifactu por defecto según el tipo de emisor.
create function private.issuers_normalize() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.tax_id := nullif(upper(regexp_replace(coalesce(new.tax_id, ''), '[^A-Za-z0-9]', '', 'g')), '');
  new.iban := nullif(upper(regexp_replace(coalesce(new.iban, ''), '[^A-Za-z0-9]', '', 'g')), '');
  if new.verifactu_from is null then
    -- RDL 15/2025: sujetos al Impuesto sobre Sociedades antes del 01/01/2027; el resto antes del 01/07/2027.
    new.verifactu_from := case new.kind when 'company' then date '2027-01-01' else date '2027-07-01' end;
  end if;
  return new;
end;
$$;

create trigger issuers_normalize
  before insert or update on public.issuers
  for each row execute function private.issuers_normalize();

-- ---------------------------------------------------------------------------
-- Series de facturación y contador sin huecos
-- ---------------------------------------------------------------------------
create table public.invoice_series (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  issuer_id uuid not null,
  code text not null check (code ~ '^[A-Z0-9-]{1,12}$'),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  kind public.series_kind not null default 'ordinary',
  format text not null default '{yyyy}-{n:4}' check (format ~ '\{n(:[1-9])?\}'),
  reset_yearly boolean not null default true,
  is_default boolean not null default false,
  provider_series_ref text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  unique (issuer_id, code),
  foreign key (org_id, issuer_id) references public.issuers (org_id, id),
  -- Si la numeración se reinicia cada año, el año tiene que formar parte del número.
  check (not reset_yearly or format ~ '\{yy(yy)?\}')
);
create unique index invoice_series_one_default_idx
  on public.invoice_series (issuer_id, kind) where is_default and archived_at is null;

-- Último número usado por serie y año (año 0 si la serie no se reinicia).
-- Se incrementa con UPSERT dentro de la transacción de emisión (hito 1.2): si la
-- transacción falla, el incremento se deshace y no queda hueco.
create table private.invoice_series_counters (
  series_id uuid not null references public.invoice_series (id) on delete restrict,
  year smallint not null check (year = 0 or year between 2000 and 2999),
  last_number integer not null default 0 check (last_number >= 0),
  updated_at timestamptz not null default now(),
  primary key (series_id, year)
);

-- ---------------------------------------------------------------------------
-- Impuestos (el 21 % es una fila, no una constante)
-- ---------------------------------------------------------------------------
create table public.tax_rates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  kind public.tax_kind not null,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  rate_bps integer not null check (rate_bps between 0 and 10000),
  regime public.vat_regime,
  legal_note text,
  is_default boolean not null default false,
  position smallint not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  check ((kind = 'vat') = (regime is not null)),
  check (kind <> 'vat' or regime = 'general' or rate_bps = 0)
);
create unique index tax_rates_one_default_idx
  on public.tax_rates (org_id, kind) where is_default and archived_at is null;

-- ---------------------------------------------------------------------------
-- Auditoría (solo inserciones, escrita por triggers)
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs (id) on delete restrict,
  table_name text not null,
  record_id uuid,
  action text not null check (action in ('insert', 'update', 'delete')),
  actor_id uuid,
  at timestamptz not null default now(),
  old_data jsonb,
  new_data jsonb
);
create index audit_log_org_at_idx on public.audit_log (org_id, at desc);

create function private.audit_row() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
begin
  if tg_op = 'UPDATE' and (v_old - 'updated_at') = (v_new - 'updated_at') then
    return null;
  end if;
  insert into public.audit_log (org_id, table_name, record_id, action, actor_id, old_data, new_data)
  values (
    case when tg_table_name = 'orgs' then (v_row ->> 'id')::uuid else (v_row ->> 'org_id')::uuid end,
    tg_table_name,
    (v_row ->> 'id')::uuid,
    lower(tg_op),
    auth.uid(),
    v_old,
    v_new
  );
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Triggers comunes
-- ---------------------------------------------------------------------------
create trigger set_updated_at before update on public.orgs
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.members
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.member_invitations
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.issuers
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.invoice_series
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.tax_rates
  for each row execute function private.set_updated_at();

create trigger audit after insert or update or delete on public.orgs
  for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.members
  for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.member_invitations
  for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.issuers
  for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.invoice_series
  for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.tax_rates
  for each row execute function private.audit_row();

-- ---------------------------------------------------------------------------
-- RLS: nadie ve nada de una org de la que no es miembro
-- ---------------------------------------------------------------------------
alter table public.orgs enable row level security;
alter table public.members enable row level security;
alter table public.member_invitations enable row level security;
alter table public.issuers enable row level security;
alter table public.invoice_series enable row level security;
alter table public.tax_rates enable row level security;
alter table public.audit_log enable row level security;

-- orgs: se crean solo con create_organization(); nunca se borran.
create policy orgs_select on public.orgs for select to authenticated
  using (private.has_role(id, 'viewer'));
create policy orgs_update on public.orgs for update to authenticated
  using (private.has_role(id, 'owner')) with check (private.has_role(id, 'owner'));

-- members: altas solo por create_organization() o accept_pending_invitations().
create policy members_select on public.members for select to authenticated
  using (private.has_role(org_id, 'viewer'));
create policy members_update on public.members for update to authenticated
  using (private.has_role(org_id, 'owner')) with check (private.has_role(org_id, 'owner'));
create policy members_delete on public.members for delete to authenticated
  using (private.has_role(org_id, 'owner'));

create policy member_invitations_select on public.member_invitations for select to authenticated
  using (private.has_role(org_id, 'partner'));
create policy member_invitations_insert on public.member_invitations for insert to authenticated
  with check (private.has_role(org_id, 'owner'));
create policy member_invitations_update on public.member_invitations for update to authenticated
  using (private.has_role(org_id, 'owner')) with check (private.has_role(org_id, 'owner'));
create policy member_invitations_delete on public.member_invitations for delete to authenticated
  using (private.has_role(org_id, 'owner'));

-- Configuración fiscal: la ve cualquier miembro y la cambia un owner. Sin borrado: se archiva.
create policy issuers_select on public.issuers for select to authenticated
  using (private.has_role(org_id, 'viewer'));
create policy issuers_insert on public.issuers for insert to authenticated
  with check (private.has_role(org_id, 'owner'));
create policy issuers_update on public.issuers for update to authenticated
  using (private.has_role(org_id, 'owner')) with check (private.has_role(org_id, 'owner'));

create policy invoice_series_select on public.invoice_series for select to authenticated
  using (private.has_role(org_id, 'viewer'));
create policy invoice_series_insert on public.invoice_series for insert to authenticated
  with check (private.has_role(org_id, 'owner'));
create policy invoice_series_update on public.invoice_series for update to authenticated
  using (private.has_role(org_id, 'owner')) with check (private.has_role(org_id, 'owner'));

create policy tax_rates_select on public.tax_rates for select to authenticated
  using (private.has_role(org_id, 'viewer'));
create policy tax_rates_insert on public.tax_rates for insert to authenticated
  with check (private.has_role(org_id, 'owner'));
create policy tax_rates_update on public.tax_rates for update to authenticated
  using (private.has_role(org_id, 'owner')) with check (private.has_role(org_id, 'owner'));

create policy audit_log_select on public.audit_log for select to authenticated
  using (private.has_role(org_id, 'owner'));

-- ---------------------------------------------------------------------------
-- RPC
-- ---------------------------------------------------------------------------

-- Onboarding en una sola transacción: org, owner, emisores con sus series (y el
-- último número ya usado, para continuar la numeración), impuestos e invitaciones.
-- El servidor valida el payload con Zod; aquí mandan las restricciones de las tablas.
create function public.create_organization(p jsonb) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_member uuid;
  v_issuer uuid;
  v_series uuid;
  v_year smallint := extract(year from (now() at time zone 'Europe/Madrid'))::smallint;
  i jsonb;
  s jsonb;
  t jsonb;
  inv jsonb;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;

  insert into public.orgs (name, slug, created_by)
  values (btrim(p #>> '{org,name}'), lower(btrim(p #>> '{org,slug}')), v_uid)
  returning id into v_org;

  insert into public.members (org_id, user_id, role, full_name, initials, locale, created_by)
  values (
    v_org,
    v_uid,
    'owner',
    btrim(p #>> '{owner,full_name}'),
    upper(btrim(coalesce(p #>> '{owner,initials}', private.initials_from(p #>> '{owner,full_name}')))),
    coalesce((p #>> '{owner,locale}')::public.app_locale, 'es'),
    v_uid
  )
  returning id into v_member;

  for i in select * from jsonb_array_elements(coalesce(p -> 'issuers', '[]'::jsonb)) loop
    insert into public.issuers (
      org_id, kind, legal_name, trade_name, tax_id, address_line, postal_code, city, province,
      country_code, email, phone, iban, default_irpf_bps, member_id, is_primary, active_from,
      registry_info, created_by
    )
    values (
      v_org,
      (i ->> 'kind')::public.issuer_kind,
      btrim(i ->> 'legal_name'),
      nullif(btrim(i ->> 'trade_name'), ''),
      i ->> 'tax_id',
      nullif(btrim(i ->> 'address_line'), ''),
      nullif(btrim(i ->> 'postal_code'), ''),
      nullif(btrim(i ->> 'city'), ''),
      nullif(btrim(i ->> 'province'), ''),
      coalesce(nullif(i ->> 'country_code', ''), 'ES'),
      nullif(btrim(i ->> 'email'), ''),
      nullif(btrim(i ->> 'phone'), ''),
      i ->> 'iban',
      coalesce((i ->> 'default_irpf_bps')::integer, 0),
      case when coalesce((i ->> 'is_me')::boolean, false) then v_member end,
      coalesce((i ->> 'is_primary')::boolean, false),
      nullif(i ->> 'active_from', '')::date,
      nullif(btrim(i ->> 'registry_info'), ''),
      v_uid
    )
    returning id into v_issuer;

    for s in select * from jsonb_array_elements(coalesce(i -> 'series', '[]'::jsonb)) loop
      insert into public.invoice_series (org_id, issuer_id, code, name, kind, format, reset_yearly, is_default, created_by)
      values (
        v_org,
        v_issuer,
        upper(btrim(s ->> 'code')),
        btrim(s ->> 'name'),
        coalesce((s ->> 'kind')::public.series_kind, 'ordinary'),
        coalesce(nullif(s ->> 'format', ''), '{yyyy}-{n:4}'),
        coalesce((s ->> 'reset_yearly')::boolean, true),
        coalesce((s ->> 'is_default')::boolean, false),
        v_uid
      )
      returning id into v_series;

      if coalesce((s ->> 'last_number')::integer, 0) > 0 then
        insert into private.invoice_series_counters (series_id, year, last_number)
        values (
          v_series,
          case when coalesce((s ->> 'reset_yearly')::boolean, true)
            then coalesce((s ->> 'last_number_year')::smallint, v_year)
            else 0
          end,
          (s ->> 'last_number')::integer
        );
      end if;
    end loop;
  end loop;

  for t in select * from jsonb_array_elements(coalesce(p -> 'tax_rates', '[]'::jsonb)) loop
    insert into public.tax_rates (org_id, kind, name, rate_bps, regime, legal_note, is_default, position, created_by)
    values (
      v_org,
      (t ->> 'kind')::public.tax_kind,
      btrim(t ->> 'name'),
      (t ->> 'rate_bps')::integer,
      (t ->> 'regime')::public.vat_regime,
      nullif(btrim(t ->> 'legal_note'), ''),
      coalesce((t ->> 'is_default')::boolean, false),
      coalesce((t ->> 'position')::smallint, 0),
      v_uid
    );
  end loop;

  for inv in select * from jsonb_array_elements(coalesce(p -> 'invitations', '[]'::jsonb)) loop
    insert into public.member_invitations (org_id, email, role, full_name, created_by)
    values (
      v_org,
      lower(btrim(inv ->> 'email')),
      coalesce((inv ->> 'role')::public.member_role, 'partner'),
      nullif(btrim(inv ->> 'full_name'), ''),
      v_uid
    );
  end loop;

  return v_org;
end;
$$;

-- Une al usuario actual a las orgs que le han invitado (por su email verificado).
create function public.accept_pending_invitations() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_count integer := 0;
  r record;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;

  select lower(u.email) into v_email from auth.users u where u.id = v_uid;
  if v_email is null then
    return 0;
  end if;

  for r in
    select i.id, i.org_id, i.role, i.full_name, i.created_by
    from public.member_invitations i
    where i.email = v_email
      and i.accepted_at is null
      and i.expires_at > now()
    for update
  loop
    insert into public.members (org_id, user_id, role, full_name, initials, created_by)
    values (
      r.org_id,
      v_uid,
      r.role,
      coalesce(nullif(btrim(r.full_name), ''), split_part(v_email, '@', 1)),
      private.initials_from(coalesce(nullif(btrim(r.full_name), ''), v_email)),
      r.created_by
    )
    on conflict (org_id, user_id) do nothing;

    update public.member_invitations
       set accepted_at = now(), accepted_by = v_uid
     where id = r.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- Cada miembro edita su propio perfil, pero no su rol.
create function public.update_my_profile(
  p_org uuid,
  p_full_name text,
  p_initials text,
  p_locale public.app_locale
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.members
     set full_name = btrim(p_full_name),
         initials = upper(btrim(p_initials)),
         locale = p_locale
   where org_id = p_org
     and user_id = auth.uid();
  if not found then
    raise exception 'No eres miembro de esta organización' using errcode = '42501';
  end if;
end;
$$;

-- Fija el último número usado en una serie (para continuar la numeración de otra herramienta).
-- En el hito 1.2 se bloqueará si ya hay facturas emitidas desde GNERAI OS en esa serie y año.
create function public.set_series_last_number(p_series_id uuid, p_year integer, p_last_number integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_reset boolean;
begin
  select s.org_id, s.reset_yearly into v_org, v_reset
  from public.invoice_series s
  where s.id = p_series_id;

  if v_org is null or not private.has_role(v_org, 'owner') then
    raise exception 'Sin permiso sobre esta serie' using errcode = '42501';
  end if;
  if p_last_number < 0 then
    raise exception 'El último número no puede ser negativo' using errcode = '22023';
  end if;

  insert into private.invoice_series_counters (series_id, year, last_number)
  values (p_series_id, case when v_reset then p_year::smallint else 0 end, p_last_number)
  on conflict (series_id, year)
  do update set last_number = excluded.last_number, updated_at = now();
end;
$$;

-- Contadores de las series de una org (para mostrar el siguiente número).
create function public.series_counters(p_org uuid)
returns table (series_id uuid, year smallint, last_number integer)
language sql
stable
security definer
set search_path = ''
as $$
  select c.series_id, c.year, c.last_number
  from private.invoice_series_counters c
  join public.invoice_series s on s.id = c.series_id
  where s.org_id = p_org
    and private.has_role(p_org, 'viewer');
$$;

revoke all on function public.create_organization(jsonb) from public, anon;
revoke all on function public.accept_pending_invitations() from public, anon;
revoke all on function public.update_my_profile(uuid, text, text, public.app_locale) from public, anon;
revoke all on function public.set_series_last_number(uuid, integer, integer) from public, anon;
revoke all on function public.series_counters(uuid) from public, anon;
grant execute on function public.create_organization(jsonb) to authenticated;
grant execute on function public.accept_pending_invitations() to authenticated;
grant execute on function public.update_my_profile(uuid, text, text, public.app_locale) to authenticated;
grant execute on function public.set_series_last_number(uuid, integer, integer) to authenticated;
grant execute on function public.series_counters(uuid) to authenticated;

-- anon no necesita nada de este esquema.
revoke all on all tables in schema public from anon;
