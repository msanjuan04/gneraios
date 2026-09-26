-- Reescribe los hitos de un contrato de una sola vez. El 100 % se comprueba al confirmar
-- (trigger diferido), así que editar 50/50 → 40/30/30 no pasa por un estado intermedio
-- inválido. Un hito ya facturado no se puede borrar (la FK de billable_items lo impide) ni
-- cambiar de porcentaje u orden (trigger contract_milestones_guard).
create function public.save_contract_milestones(p_contract_id uuid, p jsonb) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select c.org_id into v_org from public.contracts c where c.id = p_contract_id;
  if v_org is null then
    raise exception 'Contrato no encontrado' using errcode = 'P0002', hint = 'contract_not_found';
  end if;

  delete from public.contract_milestones m
  where m.contract_id = p_contract_id
    and m.id not in (
      select (x ->> 'id')::uuid from jsonb_array_elements(coalesce(p, '[]'::jsonb)) x where nullif(x ->> 'id', '') is not null
    );

  insert into public.contract_milestones (id, org_id, contract_id, position, label, percent_bps, planned_on, auto)
  select coalesce(x.id, gen_random_uuid()), v_org, p_contract_id, x.position, btrim(x.label), x.percent_bps,
         x.planned_on, coalesce(x.auto, false)
  from jsonb_to_recordset(coalesce(p, '[]'::jsonb)) as x (
    id uuid, position smallint, label text, percent_bps integer, planned_on date, auto boolean
  )
  on conflict (id) do update set
    position = excluded.position,
    label = excluded.label,
    percent_bps = excluded.percent_bps,
    planned_on = excluded.planned_on,
    auto = excluded.auto
  where public.contract_milestones.contract_id = p_contract_id;
end;
$$;

revoke all on function public.save_contract_milestones(uuid, jsonb) from public, anon;
grant execute on function public.save_contract_milestones(uuid, jsonb) to authenticated;
