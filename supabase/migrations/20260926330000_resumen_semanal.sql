-- GNERAI OS · Resumen semanal
-- Cada lunes, cada socio recibe por email (y en sus dispositivos con avisos) la semana que viene:
-- cobros previstos, plazos, lo que espera a alguien, cómo va la semana pasada y los objetivos.
-- Lo manda POST /api/cron/weekly (docs/CRON.md); job_runs ('weekly_digest') evita repetirlo.
-- Aquí solo se guarda si cada miembro lo quiere recibir.

alter table public.members add column weekly_digest boolean not null default true;

-- Cada miembro decide por sí mismo (cualquier rol).
create function public.set_my_weekly_digest(p_org uuid, p_enabled boolean) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.members
     set weekly_digest = coalesce(p_enabled, true)
   where org_id = p_org
     and user_id = auth.uid();
  if not found then
    raise exception 'No eres miembro de esta organización' using errcode = '42501', hint = 'not_a_member';
  end if;
end;
$$;

revoke all on function public.set_my_weekly_digest(uuid, boolean) from public, anon;
grant execute on function public.set_my_weekly_digest(uuid, boolean) to authenticated;
