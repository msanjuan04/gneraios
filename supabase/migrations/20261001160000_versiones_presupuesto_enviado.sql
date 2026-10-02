-- Conserva exactamente el documento, PDF y mensaje que acompañaron cada envío de propuesta.
-- Los campos de snapshot se escriben antes de llamar al proveedor de email.
alter table public.outbound_emails
  add column quote_document_snapshot jsonb,
  add column quote_pdf_snapshot bytea,
  add column quote_pdf_sha256 text;

alter table public.outbound_emails
  add constraint outbound_quote_snapshot_shape check (
    (quote_document_snapshot is null and quote_pdf_snapshot is null and quote_pdf_sha256 is null)
    or (template = 'quote' and quote_id is not null and quote_document_snapshot is not null
      and quote_pdf_snapshot is not null and quote_pdf_sha256 ~ '^[0-9a-f]{64}$')
  ) not valid;

create function private.outbound_quote_snapshot_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.quote_document_snapshot is not null and (
    new.quote_document_snapshot is distinct from old.quote_document_snapshot
    or new.quote_pdf_snapshot is distinct from old.quote_pdf_snapshot
    or new.quote_pdf_sha256 is distinct from old.quote_pdf_sha256
  ) then
    raise exception 'La copia enviada del presupuesto es inmutable' using errcode = 'P0001', hint = 'quote_snapshot_immutable';
  end if;
  if new.status = 'sent' and new.template = 'quote' and new.quote_document_snapshot is null
     and (tg_op = 'INSERT' or old.status <> 'sent') then
    raise exception 'No se puede marcar enviado sin copia exacta del presupuesto' using errcode = 'P0001', hint = 'quote_snapshot_required';
  end if;
  return new;
end;
$$;
create trigger outbound_quote_snapshot_guard before insert or update on public.outbound_emails
  for each row execute function private.outbound_quote_snapshot_guard();
