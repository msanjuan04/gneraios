-- Calendario compartido: las citas de cada socio las ven todos los miembros de la org (con el
-- nombre y el color de quien la puso); cada uno sigue creando, cambiando y borrando solo las suyas,
-- y la conexión con Google sigue siendo individual.
drop policy calendar_entries_select on public.calendar_entries;
create policy calendar_entries_select on public.calendar_entries for select to authenticated
  using (private.has_role(org_id, 'viewer'));

comment on table public.calendar_entries is 'Citas de los socios. Las ven todos los miembros de la org; las escribe solo su dueño (member_id).';
