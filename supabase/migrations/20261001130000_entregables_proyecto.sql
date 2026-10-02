-- Entregables al cliente como hechos distintos de las tareas internas.
create type public.deliverable_status as enum ('planned', 'in_progress', 'review', 'sent', 'accepted', 'cancelled');

alter table public.projects
  add constraint projects_org_id_id_client_id_key unique (org_id, id, client_id);
alter table public.client_files
  add constraint client_files_org_id_client_id_id_key unique (org_id, client_id, id);

create table public.project_deliverables (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  project_id uuid not null,
  client_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (description is null or char_length(description) <= 5000),
  due_on date,
  assignee_member_id uuid,
  status public.deliverable_status not null default 'planned',
  -- Se conserva el documento/enlace exacto asociado al envío. Una nueva versión crea otra ficha.
  client_file_id uuid,
  sent_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  foreign key (org_id, project_id, client_id) references public.projects (org_id, id, client_id),
  foreign key (org_id, client_id) references public.clients (org_id, id),
  foreign key (org_id, client_id, client_file_id) references public.client_files (org_id, client_id, id),
  foreign key (org_id, assignee_member_id) references public.members (org_id, id),
  check (status not in ('sent', 'accepted') or sent_at is not null),
  check ((status = 'accepted') = (accepted_at is not null)),
  check (accepted_at is null or accepted_at >= sent_at)
);
create index project_deliverables_due_idx on public.project_deliverables (org_id, due_on) where status not in ('accepted', 'cancelled');
create index project_deliverables_project_idx on public.project_deliverables (project_id, due_on);
create index project_deliverables_client_idx on public.project_deliverables (client_id, due_on);

create function private.project_deliverables_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_file public.client_files;
begin
  if tg_op = 'UPDATE' and (new.id, new.org_id, new.created_at, new.created_by)
     is distinct from (old.id, old.org_id, old.created_at, old.created_by) then
    raise exception 'La identidad y autoría de una entrega no se modifican' using errcode = 'P0001', hint = 'deliverable_identity_immutable';
  end if;
  if tg_op = 'UPDATE' and old.status in ('sent', 'accepted') then
    if (new.org_id, new.project_id, new.client_id, new.title, new.description, new.due_on,
        new.assignee_member_id, new.client_file_id)
       is distinct from
       (old.org_id, old.project_id, old.client_id, old.title, old.description, old.due_on,
        old.assignee_member_id, old.client_file_id) then
      raise exception 'Una entrega enviada conserva su contenido y documento; registra una nueva versión' using errcode = 'P0001', hint = 'deliverable_sent_immutable';
    end if;
    if old.status = 'accepted' and new.status <> 'accepted' then
      raise exception 'Una entrega aceptada no se reabre; registra una nueva versión' using errcode = 'P0001', hint = 'deliverable_accepted_immutable';
    end if;
    if old.status = 'sent' and new.status not in ('sent', 'accepted', 'cancelled') then
      raise exception 'Una entrega enviada solo se acepta o se cancela; registra una nueva versión' using errcode = 'P0001', hint = 'deliverable_sent_immutable';
    end if;
  end if;
  if new.status in ('sent', 'accepted') then
    if new.client_file_id is null then
      raise exception 'Vincula el archivo exacto antes de marcar la entrega como enviada' using errcode = 'P0001', hint = 'deliverable_file_required';
    end if;
    select * into v_file from public.client_files f
      where f.org_id = new.org_id and f.client_id = new.client_id and f.id = new.client_file_id;
    if not found or (v_file.kind = 'file' and v_file.uploaded_at is null) then
      raise exception 'El archivo todavía no está disponible para el cliente' using errcode = 'P0001', hint = 'deliverable_file_unavailable';
    end if;
    if tg_op = 'UPDATE' then
      new.sent_at := coalesce(old.sent_at, new.sent_at, now());
    else
      new.sent_at := coalesce(new.sent_at, now());
    end if;
    if new.status = 'accepted' then
      if tg_op = 'UPDATE' then new.accepted_at := coalesce(old.accepted_at, new.accepted_at, now());
      else new.accepted_at := coalesce(new.accepted_at, now());
      end if;
    else new.accepted_at := null;
    end if;
  elsif new.status = 'cancelled' then
    if tg_op = 'UPDATE' then
      new.sent_at := case when old.status in ('sent', 'accepted') then old.sent_at else null end;
    else
      new.sent_at := null;
    end if;
    new.accepted_at := null;
  else
    new.sent_at := null;
    new.accepted_at := null;
  end if;
  return new;
end;
$$;
create trigger project_deliverables_guard before insert or update on public.project_deliverables
  for each row execute function private.project_deliverables_guard();
create trigger project_deliverables_updated_at before update on public.project_deliverables
  for each row execute function private.set_updated_at();
create trigger project_deliverables_audit after insert or update or delete on public.project_deliverables
  for each row execute function private.audit_row();

-- Historial de envío/aceptación/versiones: los eventos solo los escribe este trigger.
create table public.project_deliverable_events (
  id bigint generated always as identity primary key,
  org_id uuid not null,
  deliverable_id uuid not null,
  from_status public.deliverable_status,
  to_status public.deliverable_status not null,
  client_file_id uuid,
  happened_at timestamptz not null default now(),
  member_id uuid references auth.users (id) on delete set null,
  foreign key (org_id, deliverable_id) references public.project_deliverables (org_id, id) on delete restrict,
  foreign key (org_id, client_file_id) references public.client_files (org_id, id)
);
create index project_deliverable_events_idx on public.project_deliverable_events (deliverable_id, happened_at desc);
alter table public.project_deliverable_events enable row level security;
create policy project_deliverable_events_select on public.project_deliverable_events for select to authenticated
  using (private.has_role(org_id, 'viewer'));

create function private.project_deliverables_record_event() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.project_deliverable_events (org_id, deliverable_id, to_status, client_file_id, member_id)
    values (new.org_id, new.id, new.status, new.client_file_id, auth.uid());
  elsif new.status is distinct from old.status or new.client_file_id is distinct from old.client_file_id then
    insert into public.project_deliverable_events (org_id, deliverable_id, from_status, to_status, client_file_id, member_id)
    values (new.org_id, new.id, old.status, new.status, new.client_file_id, auth.uid());
  end if;
  return null;
end;
$$;
revoke all on function private.project_deliverables_record_event() from public, anon, authenticated;
create trigger project_deliverables_event after insert or update on public.project_deliverables
  for each row execute function private.project_deliverables_record_event();

alter table public.project_deliverables enable row level security;
create policy project_deliverables_select on public.project_deliverables for select to authenticated
  using (private.has_role(org_id, 'viewer'));
create policy project_deliverables_insert on public.project_deliverables for insert to authenticated
  with check (private.has_role(org_id, 'partner'));
create policy project_deliverables_update on public.project_deliverables for update to authenticated
  using (private.has_role(org_id, 'partner')) with check (private.has_role(org_id, 'partner'));
create policy project_deliverables_delete on public.project_deliverables for delete to authenticated
  using (private.has_role(org_id, 'partner') and status not in ('sent', 'accepted'));
