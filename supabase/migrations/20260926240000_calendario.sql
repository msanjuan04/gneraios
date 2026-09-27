-- GNERAI OS · Calendario
-- El calendario es una vista sobre fechas que ya existen (vencimientos de facturas, recordatorios
-- por aprobar, facturación recurrente y renovaciones, altas y bajas de líneas, hitos, próximas
-- acciones de los deals, validez de presupuestos, reuniones y llamadas, y los plazos fiscales,
-- que se derivan de los emisores en src/domain/calendar/fiscal.ts). No copia ninguna fecha.
-- Esta migración solo añade lo que no existía:
--
-- - calendar_feeds: el enlace privado (ICS) de cada miembro para suscribirse desde Google
--   Calendar o Apple Calendar. Se guarda el hash SHA-256 del token, nunca el token: su dueño lo
--   ve una sola vez, al crearlo. Se revoca (o se sustituye por otro) cuando se quiera.
-- - reschedule_milestone: mover la fecha prevista de un hito que aún no se ha facturado
--   (arrastrarlo en el calendario), con la comprobación y el bloqueo en la misma transacción.
--
-- Sin tabla de eventos propios, a propósito: una reunión o una llamada con un cliente es una
-- actividad (activities, con fecha futura mientras no ha pasado), y lo interno sin cliente vive
-- en el calendario de cada socio, que ahora recibe las fechas de GNERAI OS por el enlace ICS.
-- Guardarlo también aquí sería escribirlo dos veces.

-- ---------------------------------------------------------------------------
-- Enlaces ICS
-- ---------------------------------------------------------------------------
-- Qué incluye un enlace: lo del miembro y lo que es de todos (p. ej. los plazos de la SL), o todo.
create type public.calendar_feed_scope as enum ('mine', 'all');

create table public.calendar_feeds (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  member_id uuid not null,
  -- SHA-256 (hex) del token del enlace. Ningún miembro puede leer esta columna (ver privilegios).
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  scope public.calendar_feed_scope not null default 'mine',
  -- Última vez que un calendario lo leyó (se actualiza como mucho una vez por hora).
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  unique (token_hash),
  foreign key (org_id, member_id) references public.members (org_id, id) on delete cascade
);
-- Un solo enlace activo por miembro: crear otro revoca el anterior.
create unique index calendar_feeds_one_active_idx on public.calendar_feeds (member_id) where revoked_at is null;

create trigger set_updated_at before update on public.calendar_feeds
  for each row execute function private.set_updated_at();

-- La auditoría (que leen los owners) nunca guarda el hash, y cada lectura del calendario, que
-- solo toca last_used_at, no llena el log.
create function private.audit_calendar_feeds() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) - 'token_hash' end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) - 'token_hash' end;
  v_row jsonb := coalesce(v_new, v_old);
  v_noise text[] := array['updated_at', 'last_used_at'];
begin
  if tg_op = 'UPDATE' and (v_old - v_noise) = (v_new - v_noise) then
    return null;
  end if;
  insert into public.audit_log (org_id, table_name, record_id, action, actor_id, old_data, new_data)
  values ((v_row ->> 'org_id')::uuid, tg_table_name, (v_row ->> 'id')::uuid, lower(tg_op), auth.uid(), v_old, v_new);
  return null;
end;
$$;

create trigger audit after insert or update or delete on public.calendar_feeds
  for each row execute function private.audit_calendar_feeds();

-- ---------------------------------------------------------------------------
-- RLS y privilegios
-- ---------------------------------------------------------------------------
alter table public.calendar_feeds enable row level security;

-- Cada miembro ve sus enlaces; un owner, los de todos (para revocarlos si alguien se va). Nadie
-- lee el hash: sin privilegio de columna, ni siquiera un `select *` llega a él. Se escriben solo
-- con las RPC de abajo; el enlace lo resuelve el servidor (service_role) al servir el ICS.
create policy calendar_feeds_select on public.calendar_feeds for select to authenticated
  using (
    private.has_role(org_id, 'viewer')
    and (
      private.has_role(org_id, 'owner')
      or exists (select 1 from public.members m where m.id = member_id and m.user_id = (select auth.uid()))
    )
  );
revoke all on public.calendar_feeds from authenticated;
grant select (id, org_id, member_id, scope, last_used_at, revoked_at, created_at, updated_at, created_by)
  on public.calendar_feeds to authenticated;

-- ---------------------------------------------------------------------------
-- RPC
-- ---------------------------------------------------------------------------

-- Crea el enlace del miembro actual (cualquier rol: solo da lectura) y revoca el que tuviera.
-- El token lo genera el servidor y aquí solo llega su hash.
create function public.create_calendar_feed(
  p_org uuid,
  p_token_hash text,
  p_scope public.calendar_feed_scope default 'mine'
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member uuid;
  v_id uuid;
begin
  -- Bloquea al miembro: dos altas a la vez no dejan dos enlaces activos.
  select m.id into v_member
  from public.members m
  where m.org_id = p_org and m.user_id = auth.uid() and m.is_active
  for update;
  if v_member is null then
    raise exception 'No eres miembro de esta organización' using errcode = '42501', hint = 'not_a_member';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'El token del enlace no es válido' using errcode = '22023', hint = 'token_invalid';
  end if;

  update public.calendar_feeds set revoked_at = now()
  where member_id = v_member and revoked_at is null;

  insert into public.calendar_feeds (org_id, member_id, token_hash, scope, created_by)
  values (p_org, v_member, p_token_hash, coalesce(p_scope, 'mine'), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Revoca un enlace: el suyo, cualquier miembro activo; el de otro, un owner.
create function public.revoke_calendar_feed(p_feed_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_member uuid;
begin
  select f.org_id, f.member_id into v_org, v_member from public.calendar_feeds f where f.id = p_feed_id;
  if v_org is null or not (
    private.has_role(v_org, 'owner')
    or exists (
      select 1 from public.members m
      where m.id = v_member and m.user_id = auth.uid() and m.is_active
    )
  ) then
    raise exception 'Sin permiso sobre este enlace' using errcode = '42501', hint = 'feed_forbidden';
  end if;
  update public.calendar_feeds set revoked_at = coalesce(revoked_at, now()) where id = p_feed_id;
end;
$$;

-- Mueve la fecha prevista de un hito que aún no se ha facturado (arrastrar en el calendario).
-- security invoker: manda la RLS de quien lo mueve (un socio). El FOR UPDATE espera a un cron
-- que lo esté facturando en ese momento (la FK de billable_items bloquea la misma fila), así que
-- nunca se mueve un hito ya facturado. Si es automático, el cron lo prepara en su nueva fecha.
create function public.reschedule_milestone(p_milestone_id uuid, p_planned_on date) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_planned_on is null then
    raise exception 'Falta la fecha del hito' using errcode = '22023', hint = 'date_required';
  end if;
  select m.id into v_id from public.contract_milestones m where m.id = p_milestone_id for update;
  if v_id is null then
    raise exception 'Hito no encontrado' using errcode = 'P0002', hint = 'milestone_not_found';
  end if;
  if exists (select 1 from public.billable_items b where b.milestone_id = p_milestone_id) then
    raise exception 'Este hito ya se ha facturado: su fecha ya no se mueve'
      using errcode = 'P0001', hint = 'milestone_billed';
  end if;
  update public.contract_milestones set planned_on = p_planned_on where id = p_milestone_id;
end;
$$;

revoke all on function public.create_calendar_feed(uuid, text, public.calendar_feed_scope) from public, anon;
revoke all on function public.revoke_calendar_feed(uuid) from public, anon;
revoke all on function public.reschedule_milestone(uuid, date) from public, anon;
grant execute on function public.create_calendar_feed(uuid, text, public.calendar_feed_scope) to authenticated;
grant execute on function public.revoke_calendar_feed(uuid) to authenticated;
grant execute on function public.reschedule_milestone(uuid, date) to authenticated;

revoke all on all tables in schema public from anon;
