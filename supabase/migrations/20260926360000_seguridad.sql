-- GNERAI OS · Seguridad del acceso
-- Los socios entran con email y contraseña y una verificación en dos pasos (TOTP, una app de
-- códigos). La app lo pide en cada entrada (src/proxy.ts, /auth/mfa); esta migración hace que,
-- además, la base de datos lo exija: con `orgs.require_mfa`, una sesión sin el segundo paso
-- (aal1) no ve ni toca nada de esa org, aunque alguien fuera directo a la API con una contraseña
-- robada. El nivel de la sesión viene firmado en el JWT (`aal`), no lo puede poner el cliente.

alter table public.orgs add column require_mfa boolean not null default false;

-- ¿La sesión actual ha pasado el segundo paso? (Supabase firma `aal` en el JWT.)
create function private.session_aal2() returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;

-- Autorización: ¿el usuario actual tiene al menos este rol en la org? Si la org exige la
-- verificación en dos pasos, solo con una sesión que la haya pasado.
create or replace function private.has_role(p_org uuid, p_min public.member_role) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.members m
    join public.orgs o on o.id = m.org_id
    where m.org_id = p_org
      and m.user_id = (select auth.uid())
      and m.is_active
      and m.role >= p_min
      and (not o.require_mfa or private.session_aal2())
  );
$$;

-- Nadie se queda fuera por activarlo: solo se enciende desde una sesión que ya ha pasado el
-- segundo paso (la app, además, exige que todos los miembros activos lo tengan configurado).
create function private.guard_require_mfa() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Solo aplica a los usuarios (rol authenticated); el servidor (service_role) y las migraciones no.
  if new.require_mfa and not old.require_mfa and current_user = 'authenticated' and not private.session_aal2() then
    raise exception 'Activa antes tu verificación en dos pasos' using errcode = '42501', hint = 'mfa_required_to_enable';
  end if;
  return new;
end;
$$;
create trigger guard_require_mfa before update of require_mfa on public.orgs
  for each row execute function private.guard_require_mfa();

-- Un owner cierra todas las sesiones de un miembro (p. ej. si ha perdido el móvil o se ha
-- comprometido su cuenta). Las fichas de acceso en curso caducan solas en menos de una hora.
create function public.revoke_member_sessions(p_org uuid, p_member uuid) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_count integer;
begin
  if not private.has_role(p_org, 'owner') then
    raise exception 'Solo un owner puede cerrar las sesiones de otro miembro' using errcode = '42501', hint = 'owner_required';
  end if;
  select m.user_id into v_user from public.members m where m.org_id = p_org and m.id = p_member;
  if v_user is null then
    raise exception 'Ese miembro no es de esta organización' using errcode = '22023', hint = 'member_not_found';
  end if;
  delete from auth.sessions s where s.user_id = v_user;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function private.session_aal2() from public;
grant execute on function private.session_aal2() to authenticated;
revoke all on function public.revoke_member_sessions(uuid, uuid) from public, anon;
grant execute on function public.revoke_member_sessions(uuid, uuid) to authenticated;
