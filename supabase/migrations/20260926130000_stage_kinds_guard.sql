-- Toda org debe conservar al menos una etapa abierta, una ganada y una perdida sin archivar.
-- Ajustes ya lo valida; aquí lo garantiza la base de datos también ante cambios simultáneos.
-- Es un constraint trigger diferido: se comprueba al confirmar la transacción, así que
-- sembrar las etapas de una org nueva (varias filas a la vez) o reordenarlas no lo dispara a medias.

create function private.ensure_stage_kinds() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_org uuid := coalesce(new.org_id, old.org_id);
begin
  if exists (select 1 from public.orgs where id = v_org) and (
    select count(distinct s.kind) from public.pipeline_stages s
    where s.org_id = v_org and s.archived_at is null
  ) < 3 then
    raise exception 'El pipeline necesita al menos una etapa abierta, una ganada y una perdida'
      using errcode = 'P0001', hint = 'stage_kinds_required';
  end if;
  return null;
end;
$$;

create constraint trigger pipeline_stages_keep_kinds
  after insert or update or delete on public.pipeline_stages
  deferrable initially deferred
  for each row execute function private.ensure_stage_kinds();
