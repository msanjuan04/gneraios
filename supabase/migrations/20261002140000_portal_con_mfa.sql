-- Enlaces públicos cuando la org exige la verificación en dos pasos (auditoría A13).
--
-- Un enlace público actúa con la autoridad del socio que lo creó (private.portal_act_as). Esa
-- autoridad nació de una sesión de ese socio que ya había pasado la verificación (la app no deja
-- crear enlaces sin ella): no se le vuelve a exigir a un visitante sin sesión. La marca la pone solo
-- portal_act_as, dura lo que la transacción y la retira portal_end_act. Nada que venga del cliente
-- (PostgREST solo rellena request.jwt.* y request.headers) puede ponerla.

create function private.acting_for_portal() returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('request.gnerai.portal', true), '') = '1';
$$;
revoke all on function private.acting_for_portal() from public;
grant execute on function private.acting_for_portal() to authenticated, service_role;

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
      and (not o.require_mfa or private.session_aal2() or private.acting_for_portal())
  );
$$;

create or replace function private.portal_act_as(p_user uuid) returns text[]
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
  perform set_config('request.gnerai.portal', '1', true);
  return v_prev;
end;
$$;

create or replace function private.portal_end_act(p_prev text[]) returns void
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_prev[1], ''), true);
  perform set_config('request.jwt.claims', coalesce(p_prev[2], ''), true);
  perform set_config('request.gnerai.portal', '', true);
end;
$$;
