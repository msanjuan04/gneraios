-- La auditoría guardaba, en cada cambio, la fila entera: también las columnas cifradas (la contraseña
-- del buzón, las claves de Ads, los tokens de Google). Cifradas con la clave del servidor, pero no
-- deben estar en un registro que lee un owner y que crece sin parar. Peor: cada sincronización del
-- correo (cada 5 minutos) escribía una fila nueva solo por apuntar `last_sync_at`.

-- Quita de un jsonb toda clave que acabe en `_ciphertext` o `_encrypted`.
create or replace function private.audit_strip_secrets(p jsonb) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when p is null then null else
    coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(p) e where e.key !~ '(_ciphertext|_encrypted)$'), '{}'::jsonb)
  end
$$;

create or replace function private.audit_row() returns trigger
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
    private.audit_strip_secrets(v_old),
    private.audit_strip_secrets(v_new)
  );
  return null;
end;
$$;

-- Apuntar la última sincronización no es un cambio que merezca auditoría: el trigger solo salta si
-- cambia algo de la configuración del buzón.
drop trigger if exists audit on public.mail_accounts;
create trigger audit after insert or delete or update of address, display_name, imap_host, imap_port, smtp_host, smtp_port, username, password_ciphertext, archived_at
  on public.mail_accounts for each row execute function private.audit_row();

-- Lo ya guardado: se quitan las columnas cifradas y las filas de «última sincronización» que no dicen nada.
update public.audit_log
   set old_data = private.audit_strip_secrets(old_data), new_data = private.audit_strip_secrets(new_data)
 where old_data::text ~ '(_ciphertext|_encrypted)' or new_data::text ~ '(_ciphertext|_encrypted)';

delete from public.audit_log
 where table_name = 'mail_accounts' and action = 'update'
   and (old_data - 'updated_at' - 'last_sync_at' - 'last_error') = (new_data - 'updated_at' - 'last_sync_at' - 'last_error');
