-- Borrar un cliente del todo.
--
-- Hasta ahora un cliente se archivaba (deja de verse, su historial se conserva) y los mensajes del
-- expediente eran inmutables: así nadie reescribe lo que se habló con alguien. Pero un lead que
-- nunca llegó a serlo —prospección en frío que no contestó, un apunte equivocado— no es historial
-- de nadie: es ruido, y el equipo quiere poder quitarlo de en medio.
--
-- `purge_client` lo borra entero (contactos, deals con su historial, actividades y la ficha) con dos
-- condiciones que no se pueden saltar: lo hace un owner y el cliente no puede tener presupuestos,
-- contratos ni facturas. En cuanto hay un papel de por medio, el cliente se archiva, no se borra.
-- El borrado queda en la auditoría (private.audit_row): quién lo hizo y qué había.

-- El trigger que hace inmutables los mensajes del expediente respeta la purga, que es lo contrario
-- de reescribir el historial: lo borra entero, a propósito y dejando rastro.
create or replace function private.activity_message_immutable() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.purging_client', true), '') = '1' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if old.kind = 'email' then
    if tg_op = 'DELETE' then
      raise exception 'Los mensajes del expediente no se borran; registra una nota de corrección' using errcode = 'P0001', hint = 'activity_message_immutable';
    end if;
    if (new.org_id, new.client_id, new.deal_id, new.contact_id, new.kind, new.title, new.body,
        new.occurred_at, new.member_id, new.direction, new.channel, new.counterpart, new.external_reference)
       is distinct from
       (old.org_id, old.client_id, old.deal_id, old.contact_id, old.kind, old.title, old.body,
        old.occurred_at, old.member_id, old.direction, old.channel, old.counterpart, old.external_reference) then
      raise exception 'Los mensajes del expediente no se editan; registra una nota de corrección' using errcode = 'P0001', hint = 'activity_message_immutable';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create function public.purge_client(p_client uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_count integer;
begin
  select org_id into v_org from public.clients where id = p_client;
  if v_org is null then
    raise exception 'Ese cliente no existe' using errcode = 'P0001', hint = 'client_not_found';
  end if;
  if not private.has_role(v_org, 'owner') then
    raise exception 'Solo un owner puede borrar un cliente del todo' using errcode = '42501';
  end if;

  select count(*) into v_count from public.quotes where client_id = p_client;
  if v_count > 0 then
    raise exception 'El cliente tiene % presupuesto(s): archívalo en vez de borrarlo', v_count using errcode = 'P0001', hint = 'client_has_documents';
  end if;
  select count(*) into v_count from public.contracts where client_id = p_client;
  if v_count > 0 then
    raise exception 'El cliente tiene % contrato(s): archívalo en vez de borrarlo', v_count using errcode = 'P0001', hint = 'client_has_documents';
  end if;
  select count(*) into v_count from public.invoices where client_id = p_client;
  if v_count > 0 then
    raise exception 'El cliente tiene % factura(s): archívalo en vez de borrarlo', v_count using errcode = 'P0001', hint = 'client_has_documents';
  end if;

  perform set_config('app.purging_client', '1', true);
  delete from public.activities where client_id = p_client;
  delete from public.deal_stage_history where deal_id in (select id from public.deals where client_id = p_client);
  delete from public.deals where client_id = p_client;
  delete from public.contacts where client_id = p_client;
  delete from public.clients where id = p_client;
  perform set_config('app.purging_client', '', true);
end;
$$;

revoke all on function public.purge_client(uuid) from public, anon;
grant execute on function public.purge_client(uuid) to authenticated;

comment on function public.purge_client(uuid) is 'Borra un cliente sin presupuestos, contratos ni facturas, con todo lo suyo. Solo owner; queda en la auditoría.';
