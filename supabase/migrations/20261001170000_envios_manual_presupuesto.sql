-- Entrega de una propuesta por WhatsApp, LinkedIn u otra vía: conserva evidencia real
-- separada del registro de email; no finge que esos canales se sincronizan.
create type public.quote_send_method as enum ('email', 'whatsapp', 'linkedin', 'other');

create table public.quote_sent_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  quote_id uuid not null,
  method public.quote_send_method not null,
  recipient text check (recipient is null or char_length(recipient) <= 254),
  note text check (note is null or char_length(note) <= 2000),
  document_snapshot jsonb not null,
  pdf_snapshot bytea not null,
  pdf_sha256 text not null check (pdf_sha256 ~ '^[0-9a-f]{64}$'),
  sent_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  foreign key (org_id, quote_id) references public.quotes (org_id, id) on delete restrict
);
create index quote_sent_versions_quote_idx on public.quote_sent_versions (org_id, quote_id, sent_at desc);
alter table public.quote_sent_versions enable row level security;
create policy quote_sent_versions_select on public.quote_sent_versions for select to authenticated
  using (private.has_role(org_id, 'viewer'));
create policy quote_sent_versions_insert on public.quote_sent_versions for insert to authenticated
  with check (private.has_role(org_id, 'partner'));
create function private.quote_sent_versions_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'La evidencia del envío de una propuesta es inmutable' using errcode = 'P0001', hint = 'quote_snapshot_immutable';
end;
$$;
create trigger quote_sent_versions_immutable before update or delete on public.quote_sent_versions
  for each row execute function private.quote_sent_versions_immutable();
create trigger quote_sent_versions_audit after insert or update or delete on public.quote_sent_versions
  for each row execute function private.audit_row();
