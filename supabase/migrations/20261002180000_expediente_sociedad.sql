-- GNERAI OS · Expediente de la sociedad
-- Los documentos legales y administrativos de la propia organización (constitución de la SL, DUE,
-- certificado de denominación, estatutos, acuerdos entre socios, mandatos, altas…), con su estado
-- real (borrador, pendiente de firma, firmado, presentado, inscrito, sustituido). Se guardan tal cual
-- en el bucket privado `org-documents` (<org>/<documento>/<huella>.<ext>) y nunca se sobrescriben: una
-- versión nueva es otro documento, y el anterior pasa a «sustituido». Lo ven y lo suben los socios; lo
-- archiva un owner. No es asesoramiento: el estado lo pone quien sube el documento.

create type public.org_document_category as enum (
  'constitution', 'statutes', 'registry', 'tax', 'social_security', 'partner_agreement', 'bank', 'other'
);
create type public.org_document_status as enum (
  'draft', 'pending_signature', 'signed', 'filed', 'registered', 'superseded'
);

create table public.org_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  category public.org_document_category not null default 'other',
  status public.org_document_status not null default 'draft',
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (description is null or char_length(description) <= 5000),
  -- Fecha del documento (firma, presentación, emisión…), si la tiene.
  effective_on date,
  -- El socio al que se refiere (un mandato, un anexo personal…); vacío = la sociedad.
  member_id uuid,
  storage_path text not null check (storage_path like (org_id::text || '/%') and char_length(storage_path) <= 300),
  file_name text not null check (char_length(btrim(file_name)) between 1 and 255),
  content_type text not null check (char_length(content_type) between 3 and 100),
  size_bytes bigint not null check (size_bytes > 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  archived_at timestamptz,
  unique (org_id, id),
  foreign key (org_id, member_id) references public.members (org_id, id)
);
create index org_documents_org_idx on public.org_documents (org_id, category, effective_on desc) where archived_at is null;
create trigger org_documents_updated_at before update on public.org_documents
  for each row execute function private.set_updated_at();
create trigger org_documents_audit after insert or update or delete on public.org_documents
  for each row execute function private.audit_row();

-- La ruta y la huella identifican el fichero: no se cambian. Para otro fichero, otro documento.
create function private.org_documents_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.id, new.org_id, new.storage_path, new.sha256, new.size_bytes, new.content_type, new.created_at, new.created_by)
     is distinct from (old.id, old.org_id, old.storage_path, old.sha256, old.size_bytes, old.content_type, old.created_at, old.created_by) then
    raise exception 'El fichero de un documento no se cambia; sube otro documento' using errcode = 'P0001', hint = 'org_document_file_immutable';
  end if;
  return new;
end;
$$;
create trigger org_documents_guard before update on public.org_documents
  for each row execute function private.org_documents_guard();

alter table public.org_documents enable row level security;
create policy org_documents_select on public.org_documents for select to authenticated
  using (private.has_role(org_id, 'partner'));
create policy org_documents_insert on public.org_documents for insert to authenticated
  with check (private.has_role(org_id, 'partner'));
create policy org_documents_update on public.org_documents for update to authenticated
  using (private.has_role(org_id, 'partner')) with check (private.has_role(org_id, 'partner'));
create policy org_documents_delete on public.org_documents for delete to authenticated
  using (private.has_role(org_id, 'owner'));

-- Bucket privado: solo el servidor (service_role) lee y escribe, siempre tras pasar por RLS en la
-- tabla. En PGlite (tests) no existe el esquema storage y esto se salta.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    execute $sql$
      insert into storage.buckets (id, name, public)
      values ('org-documents', 'org-documents', false)
      on conflict (id) do nothing
    $sql$;
  end if;
end $$;
