-- GNERAI OS · Notificaciones push
-- La app se instala como PWA (móvil y escritorio) y cada dispositivo puede recibir los avisos de
-- la bandeja (notifications) como notificación del sistema: un presupuesto aceptado, un
-- recordatorio listo para enviar, una renovación… Esta migración solo añade:
--
-- - push_subscriptions: la suscripción Web Push de cada dispositivo (el endpoint del servicio de
--   push del navegador y sus claves públicas). No da acceso a nada: sin la clave VAPID privada,
--   que solo tiene el servidor, nadie puede mandar una notificación a ese endpoint.
-- - notifications.pushed_at: cuándo se repartió el aviso a los dispositivos. Es un hecho de la
--   entrega, no una copia del aviso; el texto sigue saliendo de kind + params al enviarlo.
--
-- El reparto lo hace el servidor con service_role (src/server/push/dispatch.ts), llamado por el
-- cron (docs/CRON.md) y justo después de crear los avisos que no pueden esperar.

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  member_id uuid not null,
  endpoint text not null check (endpoint ~ '^https://' and char_length(endpoint) <= 2000),
  -- Claves públicas del navegador (base64url), tal como las da PushSubscription.toJSON().
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_=-]{40,200}$'),
  auth_secret text not null check (auth_secret ~ '^[A-Za-z0-9_=-]{8,100}$'),
  user_agent text check (char_length(user_agent) <= 400),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_success_at timestamptz,
  -- Fallos seguidos (no los 404/410, que borran la suscripción): a partir de unos cuantos se deja
  -- de intentar.
  failure_count integer not null default 0 check (failure_count >= 0),
  unique (org_id, id),
  -- Un navegador es un dispositivo: si otro miembro se suscribe desde él, pasa a ser suyo.
  unique (org_id, endpoint),
  foreign key (org_id, member_id) references public.members (org_id, id) on delete cascade
);
create index push_subscriptions_member_idx on public.push_subscriptions (member_id);
create trigger set_updated_at before update on public.push_subscriptions
  for each row execute function private.set_updated_at();

alter table public.push_subscriptions enable row level security;
-- Cada miembro ve solo sus dispositivos. Se escriben con las RPC de abajo; el servidor reparte con
-- service_role.
create policy push_subscriptions_select on public.push_subscriptions for select to authenticated
  using (
    exists (
      select 1 from public.members m
      where m.id = member_id and m.org_id = push_subscriptions.org_id and m.user_id = (select auth.uid())
    )
  );
revoke all on public.push_subscriptions from anon, authenticated;
grant select (id, org_id, member_id, endpoint, user_agent, created_at, updated_at, last_success_at, failure_count)
  on public.push_subscriptions to authenticated;

-- Da de alta (o renueva) la suscripción de este dispositivo para el miembro actual. Cualquier rol:
-- los avisos son de todos. Si el endpoint ya existía, se reasigna y se reinician los fallos.
create function public.register_push_subscription(
  p_org uuid,
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member uuid;
  v_id uuid;
begin
  select m.id into v_member
  from public.members m
  where m.org_id = p_org and m.user_id = auth.uid() and m.is_active;
  if v_member is null then
    raise exception 'No eres miembro de esta organización' using errcode = '42501', hint = 'not_a_member';
  end if;

  insert into public.push_subscriptions (org_id, member_id, endpoint, p256dh, auth_secret, user_agent)
  values (p_org, v_member, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 400))
  on conflict (org_id, endpoint) do update
    set member_id = excluded.member_id,
        p256dh = excluded.p256dh,
        auth_secret = excluded.auth_secret,
        user_agent = excluded.user_agent,
        failure_count = 0
  returning id into v_id;
  return v_id;
end;
$$;

-- Da de baja este dispositivo (solo si es del miembro actual; si no existe, no hace nada).
create function public.unregister_push_subscription(p_org uuid, p_endpoint text) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.push_subscriptions s
  using public.members m
  where s.org_id = p_org
    and s.endpoint = p_endpoint
    and m.id = s.member_id
    and m.user_id = auth.uid();
end;
$$;

revoke all on function public.register_push_subscription(uuid, text, text, text, text) from public, anon;
revoke all on function public.unregister_push_subscription(uuid, text) from public, anon;
grant execute on function public.register_push_subscription(uuid, text, text, text, text) to authenticated;
grant execute on function public.unregister_push_subscription(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Reparto de avisos
-- ---------------------------------------------------------------------------
alter table public.notifications add column pushed_at timestamptz;
-- Lo que el repartidor busca: avisos recientes aún sin repartir.
create index notifications_push_pending_idx on public.notifications (created_at) where pushed_at is null;
