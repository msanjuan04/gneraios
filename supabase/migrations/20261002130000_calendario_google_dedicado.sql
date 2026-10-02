-- Cada miembro sincroniza su calendario secundario «GNERAI OS» en Google.
-- Las conexiones anteriores pueden mantener NULL hasta reconectar; así no se mueven
-- ni duplican sus eventos del calendario principal de forma silenciosa.
alter table public.google_calendar_connections
  add column calendar_id text;

alter table public.google_calendar_connections
  add constraint google_calendar_connections_calendar_id_nonempty
  check (calendar_id is null or char_length(btrim(calendar_id)) between 1 and 255);

grant select (calendar_id) on public.google_calendar_connections to authenticated;
