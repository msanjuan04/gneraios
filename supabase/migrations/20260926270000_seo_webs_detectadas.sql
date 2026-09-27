-- Webs de Search Console detectadas: en cada sincronización se guarda la lista EXACTA de
-- propiedades de la cuenta conectada ("sc-domain:…" o "https://…/") con su nivel de permiso, para
-- que la app proponga dar de alta las que faltan sin tocar código ni escribir URLs a mano.
alter table public.integrations
  add column discovered_sites jsonb not null default '[]'::jsonb,
  add column discovered_at timestamptz;

grant select (discovered_sites, discovered_at) on public.integrations to authenticated;

-- La auditoría ignora también lo que refresca la sincronización diaria.
create or replace function private.audit_integrations() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) - 'refresh_token_encrypted' end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) - 'refresh_token_encrypted' end;
  v_row jsonb := coalesce(v_new, v_old);
  v_noise text[] := array['updated_at', 'last_sync_at', 'last_error', 'discovered_sites', 'discovered_at'];
begin
  if tg_op = 'UPDATE' and (v_old - v_noise) = (v_new - v_noise) then
    return null;
  end if;
  insert into public.audit_log (org_id, table_name, record_id, action, actor_id, old_data, new_data)
  values ((v_row ->> 'org_id')::uuid, tg_table_name, (v_row ->> 'id')::uuid, lower(tg_op), auth.uid(), v_old, v_new);
  return null;
end;
$$;
