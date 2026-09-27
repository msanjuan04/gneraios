-- GNERAI OS · Cobros sin factura
-- Mientras no se factura desde GNERAI OS (hasta que exista la SL), lo que paga cada cliente se
-- apunta aquí: el día en que entró el dinero, el importe, un concepto y, si es de un proyecto,
-- el proyecto. No es una factura ni un cobro de factura (`payments` sigue siendo la única fuente
-- de «cobrada» de una factura), así que no numera series ni toca el IVA; sí cuenta como lo
-- cobrado del cliente en su ficha, en el histórico y en la rentabilidad.

create table public.client_receipts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  client_id uuid not null,
  -- El día en que entró el dinero.
  received_on date not null,
  -- En negativo, una devolución al cliente.
  amount_cents bigint not null check (amount_cents <> 0),
  method public.payment_method not null default 'transfer',
  concept text not null check (char_length(btrim(concept)) between 1 and 300),
  reference text check (reference is null or char_length(reference) between 1 and 200),
  -- Opcional: el proyecto del cliente al que corresponde.
  project_id uuid,
  notes text check (notes is null or char_length(notes) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  foreign key (org_id, client_id) references public.clients (org_id, id),
  foreign key (org_id, project_id) references public.projects (org_id, id) on delete set null (project_id)
);
create index client_receipts_client_idx on public.client_receipts (org_id, client_id, received_on desc);
create index client_receipts_project_idx on public.client_receipts (project_id) where project_id is not null;

-- Textos limpios y el proyecto, del mismo cliente.
create function private.client_receipts_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.concept := btrim(new.concept);
  new.reference := nullif(btrim(coalesce(new.reference, '')), '');
  new.notes := nullif(btrim(coalesce(new.notes, '')), '');
  if new.project_id is not null and not exists (
    select 1 from public.projects p where p.id = new.project_id and p.org_id = new.org_id and p.client_id = new.client_id
  ) then
    raise exception 'El proyecto no es de este cliente' using errcode = 'P0001', hint = 'receipt_project_client';
  end if;
  return new;
end;
$$;
create trigger client_receipts_guard before insert or update on public.client_receipts
  for each row execute function private.client_receipts_guard();

create trigger set_updated_at before update on public.client_receipts for each row execute function private.set_updated_at();
create trigger audit after insert or update or delete on public.client_receipts for each row execute function private.audit_row();

-- Como los cobros de facturas: los ve cualquier miembro y los lleva un socio.
alter table public.client_receipts enable row level security;
create policy client_receipts_select on public.client_receipts for select to authenticated using (private.has_role(org_id, 'viewer'));
create policy client_receipts_insert on public.client_receipts for insert to authenticated with check (private.has_role(org_id, 'partner'));
create policy client_receipts_update on public.client_receipts for update to authenticated
  using (private.has_role(org_id, 'partner')) with check (private.has_role(org_id, 'partner'));
create policy client_receipts_delete on public.client_receipts for delete to authenticated using (private.has_role(org_id, 'partner'));
revoke all on public.client_receipts from anon;
