-- GNERAI OS · PDF original de las facturas importadas
-- Las facturas que los socios emitieron con su herramienta anterior se importan leyendo su PDF
-- («Adjuntar facturas» en Facturas, en la ficha del cliente o en un proyecto): la factura entra con
-- import_historical_invoice (ya emitida, con su número y, si se cobró, su cobro) y su PDF se guarda
-- tal cual, en privado, enlazado a ella. Es el documento que recibió el cliente, así que la página
-- de la factura lo enseña y lo descarga en lugar de volver a pintarla con la plantilla de GNERAI OS.
-- Ver docs/IMPORTACION.md §10.
--
-- - Lo emitido no se modifica (invoices_guard): el enlace vive en su propia tabla y no en
--   invoices.pdf_path, que es la copia legal que genera GNERAI OS al emitir.
-- - Un PDF por factura y tipo (hoy solo 'original', y solo en facturas importadas). Tampoco se
--   reescribe: si se adjuntó uno equivocado, se quita y se vuelve a adjuntar.
-- - La huella (SHA-256) reconoce el mismo PDF subido otra vez: «ya importada».

create type public.invoice_attachment_kind as enum ('original');

create table public.invoice_attachments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  invoice_id uuid not null,
  kind public.invoice_attachment_kind not null default 'original',
  -- Ruta en el bucket privado invoice-attachments: <org>/<factura>.pdf.
  storage_path text not null check (
    storage_path like (org_id::text || '/%') and storage_path like '%.pdf' and char_length(storage_path) <= 300
  ),
  -- El nombre con el que se subió (para descargarlo igual).
  file_name text not null check (char_length(btrim(file_name)) between 1 and 255),
  content_type text not null default 'application/pdf' check (content_type = 'application/pdf'),
  size_bytes bigint not null check (size_bytes > 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  unique (invoice_id, kind),
  foreign key (org_id, invoice_id) references public.invoices (org_id, id) on delete cascade
);
create index invoice_attachments_hash_idx on public.invoice_attachments (org_id, sha256);

-- Solo una factura importada y ya emitida lleva su PDF original, y un adjunto no se reescribe.
create function private.invoice_attachments_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'Un PDF adjunto no se modifica: se quita y se vuelve a adjuntar'
      using errcode = 'P0001', hint = 'attachment_immutable';
  end if;
  if new.kind = 'original' and not exists (
    select 1 from public.invoices i
    where i.id = new.invoice_id and i.org_id = new.org_id and i.source = 'import' and i.lifecycle = 'issued'
  ) then
    raise exception 'Solo una factura importada lleva su PDF original'
      using errcode = 'P0001', hint = 'attachment_not_imported';
  end if;
  return new;
end;
$$;

create trigger invoice_attachments_guard before insert or update on public.invoice_attachments
  for each row execute function private.invoice_attachments_guard();

create trigger audit after insert or update or delete on public.invoice_attachments
  for each row execute function private.audit_row();

-- ---------------------------------------------------------------------------
-- RLS: lo ve cualquier miembro (como la factura); lo adjunta o lo quita un socio.
-- ---------------------------------------------------------------------------
alter table public.invoice_attachments enable row level security;

create policy invoice_attachments_select on public.invoice_attachments for select to authenticated
  using (private.has_role(org_id, 'viewer'));
create policy invoice_attachments_insert on public.invoice_attachments for insert to authenticated
  with check (private.has_role(org_id, 'partner'));
create policy invoice_attachments_delete on public.invoice_attachments for delete to authenticated
  using (private.has_role(org_id, 'partner'));
revoke update on public.invoice_attachments from authenticated;

-- ---------------------------------------------------------------------------
-- Storage: los PDF originales. Privado: solo el servidor lee y escribe, después de comprobar con
-- la sesión del usuario (RLS) que la factura es de su org. En PGlite (tests) no existe el esquema
-- storage y esto se salta.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is not null then
    execute $sql$
      insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('invoice-attachments', 'invoice-attachments', false, 10485760, array['application/pdf'])
      on conflict (id) do nothing
    $sql$;
  end if;
end;
$$;

revoke all on all tables in schema public from anon;
