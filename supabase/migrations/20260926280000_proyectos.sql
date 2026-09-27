-- GNERAI OS · Proyectos, tareas y horas
-- Proyectos (de un cliente y, si lo hay, de su contrato; o internos), tareas en tablero,
-- registro de horas con temporizador y plantillas. Ver ARCHITECTURE.md §6.3 y §6.4.
--
-- Lo que se guarda es lo que decide una persona: el estado de un proyecto (planificado, en
-- marcha, en pausa, hecho o cancelado), el de cada tarea y las horas que alguien dedica. Todo
-- lo demás se deriva y no se guarda (vista projects_overview y src/domain/projects):
-- - si un proyecto o una tarea va con retraso (depende del calendario, no de nadie);
-- - el avance (tareas hechas / tareas), las horas registradas y el consumo del presupuesto;
-- - lo facturado (vista project_contract_revenue: la ÚNICA definición) y la tarifa efectiva
--   (facturado / horas) frente al objetivo de la org (orgs.settings.target_hourly_rate_cents).
-- La única marca de tiempo que se materializa es completed_at: cuándo se terminó una tarea es
-- un suceso que el estado no puede contar. La pone y la quita un trigger.
--
-- Seguridad: cada tabla lleva org_id, RLS con private.has_role y FKs compuestas (org_id, x_id).
-- Las horas las lee cualquier miembro; cada socio registra y corrige las suyas, y un owner
-- puede corregir las de cualquiera. Un solo temporizador en marcha por miembro.

-- ---------------------------------------------------------------------------
-- Enums (valores en inglés; las etiquetas salen de i18n)
-- ---------------------------------------------------------------------------
create type public.project_kind as enum ('web', 'seo', 'ads', 'branding', 'social', 'maintenance', 'internal', 'other');
-- Decisión humana. "Con retraso" no es un estado: se deriva de due_on y del calendario.
create type public.project_status as enum ('planned', 'active', 'paused', 'done', 'cancelled');
create type public.project_task_status as enum ('todo', 'doing', 'review', 'done');
create type public.project_task_priority as enum ('low', 'normal', 'high', 'urgent');
-- Origen de un registro de horas: la app (a mano o con el temporizador) o GTiQ (importación).
create type public.time_entry_source as enum ('app', 'gtiq');

-- ---------------------------------------------------------------------------
-- Proyectos
-- ---------------------------------------------------------------------------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  -- Vacío: proyecto interno.
  client_id uuid,
  -- El contrato que lo paga: de él sale lo facturado (y la tarifa efectiva).
  contract_id uuid,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  kind public.project_kind not null default 'other',
  status public.project_status not null default 'planned',
  owner_member_id uuid,
  starts_on date,
  due_on date,
  -- Horas vendidas o estimadas, en minutos. Opcional.
  budget_minutes integer check (budget_minutes is null or budget_minutes between 1 and 6000000),
  -- Se enseña en el portal del cliente (solo nombre, estado, fechas, avance y tareas visibles).
  portal_visible boolean not null default false,
  notes text check (notes is null or char_length(notes) <= 10000),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  foreign key (org_id, client_id) references public.clients (org_id, id),
  -- El contrato tiene que ser del mismo cliente (contracts es único en (org_id, id, client_id)).
  foreign key (org_id, contract_id, client_id) references public.contracts (org_id, id, client_id),
  foreign key (org_id, owner_member_id) references public.members (org_id, id),
  -- Con una columna nula la FK compuesta no se comprueba: un contrato exige cliente.
  check (contract_id is null or client_id is not null),
  check (due_on is null or starts_on is null or due_on >= starts_on),
  -- Un proyecto interno no tiene portal en el que enseñarse.
  check (not portal_visible or client_id is not null)
);
create index projects_org_idx on public.projects (org_id, status) where archived_at is null;
create index projects_client_idx on public.projects (client_id) where client_id is not null;
create index projects_contract_idx on public.projects (contract_id) where contract_id is not null;
create index projects_owner_idx on public.projects (owner_member_id) where owner_member_id is not null;

-- ---------------------------------------------------------------------------
-- Tareas
-- ---------------------------------------------------------------------------
create table public.project_tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  project_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 300),
  description text check (description is null or char_length(description) <= 10000),
  status public.project_task_status not null default 'todo',
  assignee_member_id uuid,
  due_on date,
  priority public.project_task_priority not null default 'normal',
  estimate_minutes integer check (estimate_minutes is null or estimate_minutes between 1 and 600000),
  -- Orden dentro de su columna (índice fraccional: mover una tarjeta es cambiar una fila).
  position numeric not null,
  -- Se enseña en el portal si el proyecto también lo está.
  client_visible boolean not null default false,
  -- Cuándo pasó a hecha. La pone y la quita el trigger: es el suceso, no el estado.
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  -- Para que un registro de horas solo apunte a tareas de su proyecto.
  unique (org_id, project_id, id),
  foreign key (org_id, project_id) references public.projects (org_id, id),
  foreign key (org_id, assignee_member_id) references public.members (org_id, id),
  check ((status = 'done') = (completed_at is not null))
);
create index project_tasks_board_idx on public.project_tasks (project_id, status, position);
create index project_tasks_assignee_idx on public.project_tasks (assignee_member_id, due_on)
  where assignee_member_id is not null and status <> 'done';
create index project_tasks_due_idx on public.project_tasks (org_id, due_on) where due_on is not null;

-- ---------------------------------------------------------------------------
-- Horas
-- ---------------------------------------------------------------------------
create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  member_id uuid not null,
  project_id uuid not null,
  task_id uuid,
  -- Día de trabajo (fecha civil en la zona de la org).
  worked_on date not null,
  -- Vacío mientras el temporizador está en marcha. Un registro es como mucho un día.
  minutes integer check (minutes is null or minutes between 1 and 1440),
  -- Solo los que vienen del temporizador: cuándo empezó.
  started_at timestamptz,
  note text check (note is null or char_length(note) <= 2000),
  billable boolean not null default true,
  source public.time_entry_source not null default 'app',
  -- Importaciones idempotentes (GTiQ): reimportar no duplica.
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  foreign key (org_id, member_id) references public.members (org_id, id),
  foreign key (org_id, project_id) references public.projects (org_id, id),
  -- La tarea tiene que ser del mismo proyecto. Borrar la tarea no borra las horas.
  foreign key (org_id, project_id, task_id) references public.project_tasks (org_id, project_id, id)
    on delete set null (task_id),
  -- Un temporizador en marcha sabe cuándo empezó.
  check (minutes is not null or started_at is not null),
  check (external_id is null or source <> 'app')
);
-- Un solo temporizador en marcha por miembro.
create unique index time_entries_one_running_idx on public.time_entries (member_id) where minutes is null;
create unique index time_entries_external_idx on public.time_entries (org_id, source, external_id) where external_id is not null;
create index time_entries_project_idx on public.time_entries (project_id, worked_on);
create index time_entries_member_idx on public.time_entries (member_id, worked_on);
create index time_entries_org_idx on public.time_entries (org_id, worked_on);
create index time_entries_task_idx on public.time_entries (task_id) where task_id is not null;

-- ---------------------------------------------------------------------------
-- Plantillas
-- ---------------------------------------------------------------------------
-- tasks: [{ title, estimate_minutes?, offset_days?, client_visible? }]. offset_days cuenta
-- desde el inicio del proyecto: la fecha de la tarea es starts_on + offset_days.
create function private.template_tasks_valid(p jsonb) returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  t jsonb;
  v jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 200 then
    return false;
  end if;
  for t in select e.value from jsonb_array_elements(p) as e loop
    if jsonb_typeof(t) <> 'object' then
      return false;
    end if;
    if exists (
      select 1 from jsonb_object_keys(t) as k (key)
      where k.key not in ('title', 'estimate_minutes', 'offset_days', 'client_visible')
    ) then
      return false;
    end if;
    if jsonb_typeof(t -> 'title') is distinct from 'string' or char_length(btrim(t ->> 'title')) not between 1 and 300 then
      return false;
    end if;
    v := t -> 'estimate_minutes';
    if v is not null and jsonb_typeof(v) <> 'null' and (
      jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric % 1 <> 0 or (v #>> '{}')::numeric not between 1 and 600000
    ) then
      return false;
    end if;
    v := t -> 'offset_days';
    if v is not null and jsonb_typeof(v) <> 'null' and (
      jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric % 1 <> 0 or (v #>> '{}')::numeric not between 0 and 3650
    ) then
      return false;
    end if;
    v := t -> 'client_visible';
    if v is not null and jsonb_typeof(v) not in ('boolean', 'null') then
      return false;
    end if;
  end loop;
  return true;
end;
$$;
-- La usa el CHECK de la tabla con los privilegios de quien escribe.
grant execute on function private.template_tasks_valid(jsonb) to authenticated, service_role;

create table public.project_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  kind public.project_kind not null default 'other',
  tasks jsonb not null default '[]'::jsonb check (private.template_tasks_valid(tasks)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id)
);
create unique index project_templates_name_idx on public.project_templates (org_id, lower(btrim(name)));

-- ---------------------------------------------------------------------------
-- Funciones auxiliares
-- ---------------------------------------------------------------------------
-- ¿Es este miembro el usuario actual (y está activo)?
create function private.is_member_self(p_member uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.members m
    where m.id = p_member and m.user_id = (select auth.uid()) and m.is_active
  )
$$;
revoke all on function private.is_member_self(uuid) from public;
grant execute on function private.is_member_self(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Guardas
-- ---------------------------------------------------------------------------
-- completed_at registra cuándo se terminó una tarea: se pone al entrar en "hecha" y se quita al
-- salir. La variable de sesión app.task_completed_at permite fecharlo hacia atrás (importar
-- históricos o sembrar la demo), como app.stage_changed_at en los deals.
create function private.project_tasks_stamp() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_at timestamptz := coalesce(nullif(current_setting('app.task_completed_at', true), '')::timestamptz, now());
begin
  if tg_op = 'UPDATE' and new.project_id <> old.project_id then
    raise exception 'Una tarea no cambia de proyecto' using errcode = 'P0001', hint = 'task_project_fixed';
  end if;
  if new.status = 'done' then
    if tg_op = 'INSERT' or old.status <> 'done' then
      new.completed_at := v_at;
    else
      new.completed_at := old.completed_at;
    end if;
  else
    new.completed_at := null;
  end if;
  return new;
end;
$$;

create trigger project_tasks_stamp before insert or update on public.project_tasks
  for each row execute function private.project_tasks_stamp();

-- Horas: la tarea es del proyecto (la FK compuesta es la barrera; esto da un error legible) y
-- un proyecto archivado ya no admite horas nuevas.
create function private.time_entries_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.task_id is not null and not exists (
    select 1 from public.project_tasks t where t.id = new.task_id and t.project_id = new.project_id
  ) then
    raise exception 'La tarea no es de este proyecto' using errcode = 'P0001', hint = 'task_not_in_project';
  end if;
  if (tg_op = 'INSERT' or new.project_id <> old.project_id) and exists (
    select 1 from public.projects p where p.id = new.project_id and p.archived_at is not null
  ) then
    raise exception 'El proyecto está archivado' using errcode = 'P0001', hint = 'project_archived';
  end if;
  return new;
end;
$$;

create trigger time_entries_guard before insert or update on public.time_entries
  for each row execute function private.time_entries_guard();

-- ---------------------------------------------------------------------------
-- Triggers comunes y auditoría
-- ---------------------------------------------------------------------------
create trigger set_updated_at before update on public.projects for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.project_tasks for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.time_entries for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.project_templates for each row execute function private.set_updated_at();

-- Reordenar tarjetas solo cambia `position`: eso no es una decisión que auditar.
create function private.audit_project_tasks() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_noise text[] := array['updated_at', 'position'];
begin
  if tg_op = 'UPDATE' and (v_old - v_noise) = (v_new - v_noise) then
    return null;
  end if;
  insert into public.audit_log (org_id, table_name, record_id, action, actor_id, old_data, new_data)
  values ((v_row ->> 'org_id')::uuid, tg_table_name, (v_row ->> 'id')::uuid, lower(tg_op), auth.uid(), v_old, v_new);
  return null;
end;
$$;

create trigger audit after insert or update or delete on public.projects for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.project_tasks for each row execute function private.audit_project_tasks();
create trigger audit after insert or update or delete on public.time_entries for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.project_templates for each row execute function private.audit_row();

-- ---------------------------------------------------------------------------
-- RLS y privilegios
-- ---------------------------------------------------------------------------
alter table public.projects enable row level security;
alter table public.project_tasks enable row level security;
alter table public.time_entries enable row level security;
alter table public.project_templates enable row level security;

-- Proyectos: los ve cualquier miembro y los lleva un socio. Se archivan, no se borran.
create policy projects_select on public.projects for select to authenticated using (private.has_role(org_id, 'viewer'));
create policy projects_insert on public.projects for insert to authenticated with check (private.has_role(org_id, 'partner'));
create policy projects_update on public.projects for update to authenticated
  using (private.has_role(org_id, 'partner')) with check (private.has_role(org_id, 'partner'));

create policy project_tasks_select on public.project_tasks for select to authenticated using (private.has_role(org_id, 'viewer'));
create policy project_tasks_insert on public.project_tasks for insert to authenticated with check (private.has_role(org_id, 'partner'));
create policy project_tasks_update on public.project_tasks for update to authenticated
  using (private.has_role(org_id, 'partner')) with check (private.has_role(org_id, 'partner'));
create policy project_tasks_delete on public.project_tasks for delete to authenticated using (private.has_role(org_id, 'partner'));

-- Horas: las lee cualquier miembro (para ver cuánto cuesta cada proyecto); cada socio escribe
-- las suyas, y un owner corrige las de cualquiera.
create policy time_entries_select on public.time_entries for select to authenticated using (private.has_role(org_id, 'viewer'));
create policy time_entries_insert on public.time_entries for insert to authenticated
  with check (
    private.has_role(org_id, 'owner')
    or (private.has_role(org_id, 'partner') and private.is_member_self(member_id))
  );
create policy time_entries_update on public.time_entries for update to authenticated
  using (
    private.has_role(org_id, 'owner')
    or (private.has_role(org_id, 'partner') and private.is_member_self(member_id))
  )
  with check (
    private.has_role(org_id, 'owner')
    or (private.has_role(org_id, 'partner') and private.is_member_self(member_id))
  );
create policy time_entries_delete on public.time_entries for delete to authenticated
  using (
    private.has_role(org_id, 'owner')
    or (private.has_role(org_id, 'partner') and private.is_member_self(member_id))
  );

create policy project_templates_select on public.project_templates for select to authenticated using (private.has_role(org_id, 'viewer'));
create policy project_templates_insert on public.project_templates for insert to authenticated with check (private.has_role(org_id, 'partner'));
create policy project_templates_update on public.project_templates for update to authenticated
  using (private.has_role(org_id, 'partner')) with check (private.has_role(org_id, 'partner'));
create policy project_templates_delete on public.project_templates for delete to authenticated using (private.has_role(org_id, 'partner'));

revoke all on public.projects, public.project_tasks, public.time_entries, public.project_templates from anon;

-- ---------------------------------------------------------------------------
-- Vistas derivadas (security_invoker: respetan la RLS de quien consulta)
-- ---------------------------------------------------------------------------

-- Lo facturado de cada contrato, línea a línea: la base (sin IVA) de las facturas emitidas cuyas
-- líneas salen de una línea del contrato. Las rectificativas restan (su base es negativa y
-- heredan la línea de contrato de la línea que rectifican), así que una factura anulada suma 0.
-- Es la ÚNICA definición de "facturado" de un proyecto: projects_overview la suma y el resumen
-- del proyecto la agrupa por mes.
create view public.project_contract_revenue with (security_invoker = true) as
select
  l.org_id,
  cl.contract_id,
  i.id as invoice_id,
  i.number as invoice_number,
  i.kind as invoice_kind,
  i.issued_on,
  l.id as invoice_line_id,
  l.base_cents
from public.invoice_lines l
join public.invoices i on i.id = l.invoice_id
left join public.invoice_lines original on original.id = l.rectifies_line_id
join public.contract_lines cl on cl.id = coalesce(l.contract_line_id, original.contract_line_id)
where i.lifecycle = 'issued';

-- Proyectos con todo lo que se deriva: tareas, retraso, horas y lo facturado del contrato. Si
-- varios proyectos comparten contrato, contract_projects y contract_minutes permiten repartir
-- lo facturado sin contarlo dos veces (src/domain/projects/economics.ts).
create view public.projects_overview with (security_invoker = true) as
select
  p.id,
  p.org_id,
  p.client_id,
  c.display_name as client_name,
  p.contract_id,
  ct.title as contract_title,
  p.name,
  p.kind,
  p.status,
  p.owner_member_id,
  m.full_name as owner_name,
  m.initials as owner_initials,
  m.color as owner_color,
  p.starts_on,
  p.due_on,
  p.budget_minutes,
  p.portal_visible,
  p.notes,
  p.archived_at,
  p.created_at,
  p.updated_at,
  coalesce(tk.total, 0)::integer as tasks_total,
  coalesce(tk.done, 0)::integer as tasks_done,
  coalesce(tk.overdue, 0)::integer as tasks_overdue,
  coalesce(tk.client_visible, 0)::integer as tasks_client_visible,
  nt.id as next_task_id,
  nt.title as next_task_title,
  nt.due_on as next_task_due_on,
  coalesce(te.minutes, 0)::integer as logged_minutes,
  coalesce(te.billable, 0)::integer as billable_minutes,
  coalesce(te.running, 0)::integer as running_timers,
  te.last_worked_on,
  coalesce(rev.cents, 0)::bigint as revenue_cents,
  coalesce(sh.projects, 0)::integer as contract_projects,
  coalesce(sh.minutes, 0)::integer as contract_minutes,
  -- Gemela de isProjectOverdue (src/domain/projects/overdue.ts): un test comprueba la paridad.
  (p.due_on is not null and p.due_on < d.today and p.status in ('planned', 'active', 'paused')) as is_overdue
from public.projects p
join public.orgs o on o.id = p.org_id
cross join lateral (select (now() at time zone o.timezone)::date as today) d
left join public.clients c on c.id = p.client_id
left join public.contracts ct on ct.id = p.contract_id
left join public.members m on m.id = p.owner_member_id
left join lateral (
  select
    count(*) as total,
    count(*) filter (where t.status = 'done') as done,
    count(*) filter (where t.status <> 'done' and t.due_on < d.today) as overdue,
    count(*) filter (where t.client_visible) as client_visible
  from public.project_tasks t
  where t.project_id = p.id
) tk on true
left join lateral (
  select t.id, t.title, t.due_on
  from public.project_tasks t
  where t.project_id = p.id and t.status <> 'done' and t.due_on is not null
  order by t.due_on, t.position, t.id
  limit 1
) nt on true
left join lateral (
  select
    sum(e.minutes) as minutes,
    sum(e.minutes) filter (where e.billable) as billable,
    count(*) filter (where e.minutes is null) as running,
    max(e.worked_on) filter (where e.minutes is not null) as last_worked_on
  from public.time_entries e
  where e.project_id = p.id
) te on true
left join lateral (
  select sum(r.base_cents) as cents
  from public.project_contract_revenue r
  where r.contract_id = p.contract_id
) rev on true
left join lateral (
  select count(distinct p2.id) as projects, sum(e2.minutes) as minutes
  from public.projects p2
  left join public.time_entries e2 on e2.project_id = p2.id
  where p2.contract_id = p.contract_id
) sh on true;

revoke all on public.project_contract_revenue, public.projects_overview from anon;

-- ---------------------------------------------------------------------------
-- RPC
-- ---------------------------------------------------------------------------

-- Pone en marcha el temporizador del usuario en un proyecto (y, si se indica, una tarea suya).
-- Antes para el que tuviera en marcha: una persona trabaja en una cosa a la vez.
-- security invoker: manda la RLS (un socio escribe sus propias horas).
create function public.start_timer(p_project_id uuid, p_task_id uuid default null) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_project public.projects;
  v_member uuid;
  v_today date;
  v_id uuid;
begin
  select * into v_project from public.projects where id = p_project_id;
  if not found then
    raise exception 'Proyecto no encontrado' using errcode = 'P0002', hint = 'project_not_found';
  end if;
  if not private.has_role(v_project.org_id, 'partner') then
    raise exception 'Solo un socio registra horas' using errcode = '42501';
  end if;
  if v_project.archived_at is not null then
    raise exception 'El proyecto está archivado' using errcode = 'P0001', hint = 'project_archived';
  end if;
  select m.id into v_member
  from public.members m
  where m.org_id = v_project.org_id and m.user_id = (select auth.uid()) and m.is_active;

  -- Serializa los arranques del mismo miembro: dos clics seguidos no dejan dos temporizadores.
  perform pg_advisory_xact_lock(hashtextextended('start_timer:' || v_member::text, 0));
  perform public.stop_timer();

  select (now() at time zone o.timezone)::date into v_today from public.orgs o where o.id = v_project.org_id;
  insert into public.time_entries (org_id, member_id, project_id, task_id, worked_on, started_at)
  values (v_project.org_id, v_member, v_project.id, p_task_id, v_today, now())
  returning id into v_id;
  return v_id;
end;
$$;

-- Para el temporizador en marcha del usuario (en cualquiera de sus orgs): minutos redondeados
-- (como mínimo 1, como mucho un día) y el día en que empezó, en la zona de la org. Devuelve el
-- registro parado, o null si no había ninguno.
create function public.stop_timer() returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  with stopped as (
    update public.time_entries e
       set minutes = least(1440, greatest(1, round(extract(epoch from (now() - e.started_at)) / 60)::integer)),
           worked_on = (e.started_at at time zone o.timezone)::date
      from public.orgs o, public.members m
     where e.minutes is null
       and o.id = e.org_id
       and m.id = e.member_id
       and m.user_id = (select auth.uid())
    returning e.id, e.started_at
  )
  select s.id into v_id from stopped s order by s.started_at desc limit 1;
  return v_id;
end;
$$;

-- Alta de un proyecto desde una plantilla, con sus tareas en el orden de la plantilla y fechadas
-- desde el inicio (starts_on + offset_days). security invoker: manda la RLS de quien lo crea.
-- p: { name?, client_id?, contract_id?, kind?, status?, owner_member_id?, starts_on?, due_on?,
--      budget_minutes?, portal_visible?, notes? }
create function public.create_project_from_template(p_template_id uuid, p jsonb) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_template public.project_templates;
  v_starts date := nullif(p ->> 'starts_on', '')::date;
  v_project uuid;
begin
  select * into v_template from public.project_templates where id = p_template_id;
  if not found then
    raise exception 'Plantilla no encontrada' using errcode = 'P0002', hint = 'template_not_found';
  end if;

  insert into public.projects (
    org_id, client_id, contract_id, name, kind, status, owner_member_id, starts_on, due_on,
    budget_minutes, portal_visible, notes
  )
  values (
    v_template.org_id,
    nullif(p ->> 'client_id', '')::uuid,
    nullif(p ->> 'contract_id', '')::uuid,
    coalesce(nullif(btrim(p ->> 'name'), ''), v_template.name),
    coalesce(nullif(p ->> 'kind', '')::public.project_kind, v_template.kind),
    coalesce(nullif(p ->> 'status', '')::public.project_status, 'planned'),
    nullif(p ->> 'owner_member_id', '')::uuid,
    v_starts,
    nullif(p ->> 'due_on', '')::date,
    nullif(p ->> 'budget_minutes', '')::numeric::integer,
    coalesce((p ->> 'portal_visible')::boolean, false),
    nullif(btrim(p ->> 'notes'), '')
  )
  returning id into v_project;

  insert into public.project_tasks (org_id, project_id, title, status, estimate_minutes, due_on, position, client_visible)
  select
    v_template.org_id,
    v_project,
    btrim(x.task ->> 'title'),
    'todo',
    nullif(x.task ->> 'estimate_minutes', '')::numeric::integer,
    case when v_starts is not null and nullif(x.task ->> 'offset_days', '') is not null
      then v_starts + (x.task ->> 'offset_days')::numeric::integer
    end,
    x.ord * 1024,
    coalesce((x.task ->> 'client_visible')::boolean, false)
  from jsonb_array_elements(v_template.tasks) with ordinality as x (task, ord);

  return v_project;
end;
$$;

revoke all on function public.start_timer(uuid, uuid) from public, anon;
revoke all on function public.stop_timer() from public, anon;
revoke all on function public.create_project_from_template(uuid, jsonb) from public, anon;
grant execute on function public.start_timer(uuid, uuid) to authenticated;
grant execute on function public.stop_timer() to authenticated;
grant execute on function public.create_project_from_template(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- ⌘K también busca proyectos (por nombre o por cliente). Copia de la definición de
-- 20260926200000_busqueda_presupuestos.sql con la rama 'project' al final.
-- ---------------------------------------------------------------------------
create or replace function public.search_org(p_org uuid, p_query text, p_limit integer default 6)
returns table (kind text, id uuid, client_id uuid, title text, subtitle text)
language sql
stable
security invoker
set search_path = ''
as $$
  with q as (
    select '%' || private.search_text(btrim(p_query)) || '%' as pattern
  )
  (select 'client', c.id, c.id, c.display_name, coalesce(c.legal_name, c.tax_id, c.city)
   from public.clients c, q
   where c.org_id = p_org and c.archived_at is null
     and (private.search_text(c.display_name) like q.pattern
          or private.search_text(c.legal_name) like q.pattern
          or lower(coalesce(c.tax_id, '')) like q.pattern)
   order by c.display_name
   limit p_limit)
  union all
  (select 'contact', ct.id, ct.client_id, ct.full_name, coalesce(ct.email, cl.display_name)
   from public.contacts ct
   join public.clients cl on cl.id = ct.client_id, q
   where ct.org_id = p_org and ct.archived_at is null
     and (private.search_text(ct.full_name) like q.pattern or lower(coalesce(ct.email, '')) like q.pattern)
   order by ct.full_name
   limit p_limit)
  union all
  (select 'deal', d.id, d.client_id, d.title, cl.display_name
   from public.deals d
   join public.clients cl on cl.id = d.client_id, q
   where d.org_id = p_org and d.archived_at is null
     and (private.search_text(d.title) like q.pattern or private.search_text(cl.display_name) like q.pattern)
   order by d.updated_at desc
   limit p_limit)
  union all
  (select 'contract', k.id, k.client_id, k.title, cl.display_name
   from public.contracts k
   join public.clients cl on cl.id = k.client_id, q
   where k.org_id = p_org and k.archived_at is null
     and private.search_text(k.title) like q.pattern
   order by k.updated_at desc
   limit p_limit)
  union all
  (select 'invoice', i.id, i.client_id, i.number, cl.display_name
   from public.invoices i
   join public.clients cl on cl.id = i.client_id, q
   where i.org_id = p_org and i.number is not null
     and lower(i.number) like q.pattern
   order by i.issued_on desc
   limit p_limit)
  union all
  (select 'quote', qt.id, qt.client_id, coalesce(qt.number || ' · ', '') || qt.title, cl.display_name
   from public.quotes qt
   join public.clients cl on cl.id = qt.client_id, q
   where qt.org_id = p_org
     and (private.search_text(qt.title) like q.pattern or lower(coalesce(qt.number, '')) like q.pattern)
   order by qt.updated_at desc
   limit p_limit)
  union all
  (select 'project', pr.id, pr.client_id, pr.name, cl.display_name
   from public.projects pr
   left join public.clients cl on cl.id = pr.client_id, q
   where pr.org_id = p_org and pr.archived_at is null
     and (private.search_text(pr.name) like q.pattern or private.search_text(cl.display_name) like q.pattern)
   order by pr.updated_at desc
   limit p_limit)
$$;
