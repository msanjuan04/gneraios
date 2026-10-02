-- Cuestionarios, materiales y accesos pedidos al cliente; distintos de tareas internas y entregas.
create type public.client_request_kind as enum ('questionnaire', 'material', 'access', 'other');
create type public.client_request_status as enum ('requested', 'received', 'cancelled');

create table public.client_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  client_id uuid not null,
  project_id uuid,
  kind public.client_request_kind not null,
  status public.client_request_status not null default 'requested',
  title text not null check (char_length(btrim(title)) between 1 and 200),
  instructions text check (instructions is null or char_length(instructions) <= 5000),
  requested_at date not null default (now() at time zone 'utc')::date,
  due_on date,
  received_at timestamptz,
  response text check (response is null or char_length(response) <= 10000),
  client_file_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  foreign key (org_id, client_id) references public.clients (org_id, id),
  foreign key (org_id, project_id, client_id) references public.projects (org_id, id, client_id),
  foreign key (org_id, client_id, client_file_id) references public.client_files (org_id, client_id, id),
  check (due_on is null or due_on >= requested_at),
  check ((status = 'received') = (received_at is not null)),
  check (client_file_id is null or status = 'received')
);
create index client_requests_client_idx on public.client_requests (org_id, client_id, status, due_on);
alter table public.client_requests enable row level security;
create policy client_requests_select on public.client_requests for select to authenticated
  using (private.has_role(org_id, 'viewer'));
create policy client_requests_insert on public.client_requests for insert to authenticated
  with check (private.has_role(org_id, 'partner'));
create policy client_requests_update on public.client_requests for update to authenticated
  using (private.has_role(org_id, 'partner')) with check (private.has_role(org_id, 'partner'));
create policy client_requests_delete on public.client_requests for delete to authenticated
  using (private.has_role(org_id, 'owner') and status = 'requested');

create function private.client_requests_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_file public.client_files;
begin
  if tg_op = 'UPDATE' and (new.id, new.org_id, new.client_id, new.created_at, new.created_by)
     is distinct from (old.id, old.org_id, old.client_id, old.created_at, old.created_by) then
    raise exception 'La identidad y autoría de una solicitud no se modifican' using errcode = 'P0001', hint = 'client_request_identity_immutable';
  end if;
  if tg_op = 'UPDATE' and old.status in ('received', 'cancelled') then
    raise exception 'Una solicitud cerrada no se reescribe; registra otra si hace falta' using errcode = 'P0001', hint = 'client_request_closed';
  end if;
  if new.status = 'received' then
    if nullif(btrim(coalesce(new.response, '')), '') is null and new.client_file_id is null then
      raise exception 'Registra la respuesta o vincula el archivo recibido' using errcode = 'P0001', hint = 'client_request_response_required';
    end if;
    if new.client_file_id is not null then
      select * into v_file from public.client_files f
        where f.org_id = new.org_id and f.client_id = new.client_id and f.id = new.client_file_id;
      if not found or (v_file.kind = 'file' and v_file.uploaded_at is null) then
        raise exception 'El archivo recibido todavía no está disponible' using errcode = 'P0001', hint = 'client_request_file_unavailable';
      end if;
    end if;
    if tg_op = 'UPDATE' then
      new.received_at := coalesce(old.received_at, new.received_at, now());
    else
      new.received_at := coalesce(new.received_at, now());
    end if;
  else
    new.received_at := null;
    new.client_file_id := null;
  end if;
  return new;
end;
$$;
create trigger client_requests_guard before insert or update on public.client_requests
  for each row execute function private.client_requests_guard();
create trigger client_requests_updated_at before update on public.client_requests
  for each row execute function private.set_updated_at();
create trigger client_requests_audit after insert or update or delete on public.client_requests
  for each row execute function private.audit_row();
