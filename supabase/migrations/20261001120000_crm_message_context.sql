-- Contexto explícito para mensajes anotados manualmente desde el expediente del cliente.
-- No conecta correo, WhatsApp ni redes; solo conserva el registro que introduce el equipo.
alter table public.activities
  add column direction text check (direction is null or direction in ('incoming', 'outgoing', 'internal')),
  add column channel text check (channel is null or channel in ('email', 'whatsapp', 'phone', 'linkedin', 'instagram', 'other')),
  add column counterpart text check (counterpart is null or char_length(counterpart) <= 254),
  add column external_reference text check (external_reference is null or char_length(external_reference) <= 200);

alter table public.activities
  add constraint activities_message_context_check check (
    (kind = 'email' and ((direction is null and channel is null) or (direction is not null and channel is not null)))
    or (kind <> 'email' and direction is null and channel is null and counterpart is null and external_reference is null)
  );

-- Los mensajes son hechos del expediente: se añaden, no se reescriben ni borran.
-- `client_visible` puede cambiar porque es un ajuste de publicación en el portal, no del mensaje.
create function private.activity_message_immutable() returns trigger
language plpgsql
set search_path = ''
as $$
begin
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

create trigger activities_message_immutable
  before update or delete on public.activities
  for each row execute function private.activity_message_immutable();

comment on column public.activities.direction is 'Sentido de un mensaje registrado manualmente; null en historial antiguo sin clasificar.';
comment on column public.activities.channel is 'Canal introducido por el equipo. No implica integración ni sincronización.';
