-- GNERAI OS · Consejo de agentes
-- Política financiera versionada, recomendaciones con evidencia y su seguimiento (tareas y
-- revisiones a 30/60/90 días), informes (briefing semanal y cierre mensual), la cola de trabajos,
-- el registro de ejecuciones con su coste y los ajustes por agente. Ver CONSEJO.md.
--
-- Reparto de responsabilidades:
-- - Las cifras las calculan las tools deterministas en TS (src/council/tools, sobre src/domain).
--   Aquí solo se guarda lo que ya viene calculado y se protegen las decisiones de los socios.
-- - Los agentes no escriben nada con la sesión de un usuario: el runner (service_role) guarda
--   ejecuciones, recomendaciones e informes. Los socios solo deciden (estado y motivo), editan y
--   aceptan el cierre mensual; los owners fijan la política y los ajustes de los agentes.
-- - Estados derivados (regla de oro): "pospuesta hasta hoy" vuelve sola al feed porque la UI
--   compara postponed_until con hoy; el gasto del mes de un agente es Σ agent_runs.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.council_agent as enum (
  'cfo', 'commercial', 'pricing', 'retention', 'operations', 'growth', 'fiscal', 'devils_advocate', 'chief_of_staff'
);
-- Los valores de la recomendación siguen el formato que fijaron los socios en el prompt del consejo.
create type public.recommendation_status as enum ('nueva', 'aceptada', 'descartada', 'pospuesta', 'hecha');
create type public.recommendation_confidence as enum ('alta', 'media', 'baja');
create type public.recommendation_urgency as enum ('hoy', 'esta_semana', 'este_mes');
-- decision: propone algo; alert: avisa de algo que vigilar; data_gap: explica qué dato falta.
create type public.recommendation_kind as enum ('decision', 'alert', 'data_gap');
create type public.agent_job_status as enum ('pending', 'running', 'done', 'failed', 'skipped', 'cancelled');
create type public.agent_run_status as enum ('running', 'succeeded', 'failed', 'skipped');
create type public.council_report_kind as enum ('weekly_briefing', 'monthly_close');
create type public.council_report_status as enum ('published', 'accepted');
create type public.review_state as enum ('pending', 'done', 'skipped');
create type public.review_outcome as enum ('hit', 'partial', 'miss', 'no_data');

-- ---------------------------------------------------------------------------
-- Política financiera: versiones inmutables; la vigente es la de mayor versión. Sin ninguna
-- versión, la app usa los valores de ejemplo de CONSEJO.md §4 (src/council/policy), marcados
-- como tales, y las recomendaciones guardan policy_version = null.
-- ---------------------------------------------------------------------------
create table public.financial_policies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  version integer not null check (version >= 1),
  -- Validada con Zod en el servidor (src/council/policy/schema.ts).
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, version),
  unique (org_id, id)
);

-- ---------------------------------------------------------------------------
-- Ajustes por org y agente (sin fila = los valores por defecto de src/council/agents.config.ts)
-- ---------------------------------------------------------------------------
create table public.agent_settings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  agent public.council_agent not null,
  enabled boolean not null default true,
  -- Vacío: el modelo por defecto del agente. La lista de modelos válidos vive en TS.
  model text check (model is null or model ~ '^[a-z0-9][a-z0-9.:_-]{1,80}$'),
  -- Presupuesto mensual en céntimos de dólar (la API factura en USD). Vacío: el de por defecto.
  monthly_budget_usd_cents integer check (monthly_budget_usd_cents is null or monthly_budget_usd_cents between 0 and 10000000),
  -- Umbrales del agente (días sin movimiento, inactividad, máximo de recomendaciones…).
  thresholds jsonb not null default '{}'::jsonb check (jsonb_typeof(thresholds) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, agent),
  unique (org_id, id)
);

-- ---------------------------------------------------------------------------
-- Reglas de venta cruzada (son datos, no código): palabras de las líneas de contrato
-- ---------------------------------------------------------------------------
create table public.upsell_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  label text not null check (char_length(btrim(label)) between 1 and 120),
  -- El cliente ha contratado algo que contiene alguna de estas palabras (en cualquier momento).
  requires_any text[] not null default '{}',
  -- …y no tiene activo (ni ha comprado como puntual) nada que contenga ninguna de estas.
  excludes_any text[] not null default '{}',
  -- Como mucho tantos servicios recurrentes activos (null = sin límite).
  max_services smallint check (max_services is null or max_services between 1 and 20),
  -- Cliente desde hace al menos tantos meses (null = da igual).
  min_months smallint check (min_months is null or min_months between 0 and 120),
  suggestion text not null check (char_length(btrim(suggestion)) between 1 and 300),
  -- Precio de referencia del servicio sugerido (€/mes sin IVA): da el impacto de la regla.
  reference_mrr_cents bigint check (reference_mrr_cents is null or reference_mrr_cents >= 0),
  position smallint not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  check (cardinality(requires_any) <= 20 and cardinality(excludes_any) <= 20)
);
create index upsell_rules_org_idx on public.upsell_rules (org_id, position) where archived_at is null;

create function private.seed_org_council_defaults(p_org uuid) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.upsell_rules (org_id, label, requires_any, excludes_any, max_services, min_months, suggestion, position) values
    (p_org, 'Web sin mantenimiento', array['web', 'tienda', 'shopify'], array['mantenimiento'], null, null,
      'Ofrecer el mantenimiento mensual de la web', 1),
    (p_org, 'Web sin SEO', array['web', 'tienda', 'shopify'], array['seo'], null, null,
      'Proponer SEO local para que la web traiga clientes', 2),
    (p_org, 'Ads sin landing', array['ads'], array['landing', 'web'], null, null,
      'Proponer una landing propia para las campañas', 3),
    (p_org, 'SEO sin informe mensual', array['seo'], array['informe'], null, null,
      'Añadir un informe mensual de resultados del SEO', 4),
    (p_org, 'Un solo servicio desde hace más de 6 meses', '{}', '{}', 1, 6,
      'Explorar un segundo servicio (venta cruzada)', 5);
$$;

create function private.orgs_seed_council() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_org_council_defaults(new.id);
  return null;
end;
$$;

create trigger orgs_seed_council after insert on public.orgs
  for each row execute function private.orgs_seed_council();

select private.seed_org_council_defaults(o.id)
from public.orgs o
where not exists (select 1 from public.upsell_rules r where r.org_id = o.id);

-- ---------------------------------------------------------------------------
-- Cola de trabajos (solo service_role; los socios encolan con council_enqueue_run)
-- ---------------------------------------------------------------------------
create table public.agent_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  agent public.council_agent not null,
  -- daily, weekly, monthly_close, manual, review…
  trigger text not null check (trigger ~ '^[a-z][a-z0-9_:-]{0,59}$'),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  status public.agent_job_status not null default 'pending',
  attempts smallint not null default 0 check (attempts >= 0),
  max_attempts smallint not null default 2 check (max_attempts between 1 and 10),
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  finished_at timestamptz,
  last_error text,
  -- Los programados se encolan una vez por periodo (agente:disparador:periodo).
  dedupe_key text check (dedupe_key is null or char_length(dedupe_key) <= 200),
  requested_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, id)
);
create unique index agent_jobs_dedupe_idx on public.agent_jobs (org_id, dedupe_key) where dedupe_key is not null;
create index agent_jobs_pending_idx on public.agent_jobs (run_after) where status = 'pending';
create index agent_jobs_org_agent_idx on public.agent_jobs (org_id, agent, created_at desc);

-- ---------------------------------------------------------------------------
-- Ejecuciones: entrada, tools llamadas, salida, tokens, coste y duración (las lee un owner)
-- ---------------------------------------------------------------------------
create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  agent public.council_agent not null,
  job_id uuid,
  -- La revisión del abogado del diablo cuelga de la ejecución que revisa.
  parent_run_id uuid,
  trigger text not null check (char_length(trigger) between 1 and 60),
  status public.agent_run_status not null default 'running',
  -- claude (API), fake (tests y evals) o local (más adelante).
  runtime text not null check (runtime ~ '^[a-z][a-z0-9_-]{0,30}$'),
  model text,
  input jsonb not null default '{}'::jsonb,
  -- [{ name, input, status, summary, duration_ms }]
  tool_calls jsonb not null default '[]'::jsonb check (jsonb_typeof(tool_calls) = 'array'),
  output jsonb,
  error text,
  attempts smallint not null default 0,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cache_read_tokens integer not null default 0 check (cache_read_tokens >= 0),
  cache_write_tokens integer not null default 0 check (cache_write_tokens >= 0),
  -- Coste estimado en millonésimas de dólar (tokens × tabla de precios de agents.config.ts).
  cost_usd_micros bigint not null default 0 check (cost_usd_micros >= 0),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  policy_version integer,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (org_id, id),
  foreign key (org_id, job_id) references public.agent_jobs (org_id, id) on delete set null (job_id),
  foreign key (org_id, parent_run_id) references public.agent_runs (org_id, id) on delete set null (parent_run_id)
);
create index agent_runs_org_idx on public.agent_runs (org_id, started_at desc);
create index agent_runs_cost_idx on public.agent_runs (org_id, agent, started_at);

-- ---------------------------------------------------------------------------
-- Recomendaciones (CONSEJO.md §7): el formato del prompt + org, ejecución y clave de deduplicación
-- ---------------------------------------------------------------------------
create table public.recommendations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  agent public.council_agent not null,
  run_id uuid,
  kind public.recommendation_kind not null default 'decision',
  title text not null check (char_length(btrim(title)) between 1 and 200),
  summary text not null check (char_length(summary) between 1 and 1500),
  reasoning text not null check (char_length(reasoning) <= 6000),
  -- [{ ref, tool, key, label, value, unit, display, period, source, href }]: cada cifra del texto sale de aquí.
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  -- [{ title, due_in_days }]: al aceptar se convierten en tareas.
  proposed_actions jsonb not null default '[]'::jsonb check (jsonb_typeof(proposed_actions) = 'array'),
  -- Lo que falta para decidir mejor (texto).
  missing_data jsonb not null default '[]'::jsonb check (jsonb_typeof(missing_data) = 'array'),
  -- Sale de una métrica de la evidencia (nunca lo estima el modelo).
  impact_eur_cents bigint,
  confidence public.recommendation_confidence not null,
  urgency public.recommendation_urgency not null,
  risks text check (risks is null or char_length(risks) <= 3000),
  requires_professional_review boolean not null default false,
  -- Revisión del abogado del diablo (impacto alto): veredicto, supuestos débiles, escenario pesimista.
  challenge jsonb,
  policy_version integer,
  -- De qué trata (cliente, deal, línea, métrica): con el agente forma la clave de deduplicación.
  subject text not null check (char_length(subject) between 1 and 200),
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 300),
  status public.recommendation_status not null default 'nueva',
  -- El motivo de un descarte, en una línea: vuelve al contexto del agente la próxima vez.
  decision_note text check (decision_note is null or (char_length(decision_note) <= 500 and decision_note !~ '[\n\r]')),
  postponed_until date,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, run_id) references public.agent_runs (org_id, id) on delete set null (run_id)
);
-- Nada se repite mientras siga abierto (nueva, pospuesta o aceptada y en marcha).
create unique index recommendations_open_dedupe_idx on public.recommendations (org_id, dedupe_key)
  where status in ('nueva', 'pospuesta', 'aceptada');
create index recommendations_org_status_idx on public.recommendations (org_id, status, created_at desc);
create index recommendations_org_agent_idx on public.recommendations (org_id, agent, created_at desc);

-- ---------------------------------------------------------------------------
-- Tareas: aceptar una recomendación crea tareas, nunca mueve dinero
-- ---------------------------------------------------------------------------
create table public.council_tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  recommendation_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 300),
  due_on date,
  assignee_member_id uuid,
  position smallint not null default 0,
  done_at timestamptz,
  done_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  foreign key (org_id, recommendation_id) references public.recommendations (org_id, id) on delete cascade,
  foreign key (org_id, assignee_member_id) references public.members (org_id, id)
);
create index council_tasks_rec_idx on public.council_tasks (recommendation_id, position);
create index council_tasks_open_idx on public.council_tasks (org_id, due_on) where done_at is null;

-- ---------------------------------------------------------------------------
-- Aprendizaje: a los 30, 60 y 90 días de aceptar, el agente compara lo real con lo estimado
-- ---------------------------------------------------------------------------
create table public.recommendation_reviews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  recommendation_id uuid not null,
  horizon_days smallint not null check (horizon_days in (30, 60, 90)),
  due_on date not null,
  state public.review_state not null default 'pending',
  outcome public.review_outcome,
  estimated_impact_cents bigint,
  actual_impact_cents bigint,
  notes text check (notes is null or char_length(notes) <= 2000),
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  run_id uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (recommendation_id, horizon_days),
  unique (org_id, id),
  foreign key (org_id, recommendation_id) references public.recommendations (org_id, id) on delete cascade,
  foreign key (org_id, run_id) references public.agent_runs (org_id, id) on delete set null (run_id)
);
create index recommendation_reviews_due_idx on public.recommendation_reviews (org_id, due_on) where state = 'pending';

-- ---------------------------------------------------------------------------
-- Informes: el briefing semanal del Chief of Staff y el cierre mensual del CFO
-- ---------------------------------------------------------------------------
create table public.council_reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  kind public.council_report_kind not null,
  agent public.council_agent not null,
  run_id uuid,
  period_start date not null,
  period_end date not null,
  -- El cierre lleva content.distribution.{available_cents, buckets} calculado por la tool.
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  policy_version integer,
  status public.council_report_status not null default 'published',
  -- Al aceptar el cierre: el reparto elegido (quizá editado) y la versión de la política vigente.
  decision jsonb,
  decision_note text check (decision_note is null or char_length(decision_note) <= 500),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  check (period_end >= period_start),
  foreign key (org_id, run_id) references public.agent_runs (org_id, id) on delete set null (run_id)
);
create index council_reports_org_kind_idx on public.council_reports (org_id, kind, period_start desc, created_at desc);
-- Un solo cierre aceptado por mes.
create unique index council_reports_one_accepted_idx on public.council_reports (org_id, kind, period_start)
  where status = 'accepted';

-- ---------------------------------------------------------------------------
-- Guardas
-- ---------------------------------------------------------------------------

-- Una versión de la política no se toca nunca (tampoco service_role): se crea otra.
create function private.financial_policies_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Una versión de la política financiera no se modifica ni se borra: se guarda una nueva'
    using errcode = 'P0001', hint = 'policy_immutable';
end;
$$;

create trigger financial_policies_guard before update or delete on public.financial_policies
  for each row execute function private.financial_policies_guard();
create trigger financial_policies_no_truncate before truncate on public.financial_policies
  for each statement execute function private.financial_policies_guard();

-- Decidir una recomendación: transiciones válidas, motivo al descartar, fecha al posponer, y
-- quién y cuándo lo decidió (lo pone la base de datos, no el cliente).
create function private.recommendations_decide() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_today date;
begin
  if new.status is distinct from old.status then
    if not (
      (old.status = 'nueva' and new.status in ('aceptada', 'descartada', 'pospuesta'))
      or (old.status = 'pospuesta' and new.status in ('nueva', 'aceptada', 'descartada'))
      or (old.status = 'aceptada' and new.status in ('hecha', 'descartada'))
      or (old.status = 'descartada' and new.status = 'nueva')
    ) then
      raise exception 'Una recomendación % no puede pasar a %', old.status, new.status
        using errcode = 'P0001', hint = 'recommendation_transition';
    end if;
    select (now() at time zone o.timezone)::date into v_today from public.orgs o where o.id = new.org_id;
    if new.status = 'descartada' and nullif(btrim(coalesce(new.decision_note, '')), '') is null then
      raise exception 'Para descartar una recomendación hay que decir por qué'
        using errcode = 'P0001', hint = 'discard_reason_required';
    end if;
    if new.status = 'pospuesta' and (new.postponed_until is null or new.postponed_until <= v_today) then
      raise exception 'Para posponer una recomendación hay que elegir hasta cuándo'
        using errcode = 'P0001', hint = 'postpone_date_required';
    end if;
    if new.status <> 'pospuesta' then
      new.postponed_until := null;
    end if;
    new.decided_by := auth.uid();
    new.decided_at := now();
  elsif new.postponed_until is distinct from old.postponed_until and new.status <> 'pospuesta' then
    new.postponed_until := old.postponed_until;
  end if;
  if new.decision_note is not null then
    new.decision_note := nullif(btrim(new.decision_note), '');
  end if;
  return new;
end;
$$;

create trigger recommendations_decide before update on public.recommendations
  for each row execute function private.recommendations_decide();

-- Al aceptar: las acciones propuestas pasan a ser tareas (una sola vez) y, si es una decisión,
-- se programan sus revisiones a 30, 60 y 90 días.
create function private.recommendations_accepted() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date;
begin
  if new.status = 'aceptada' and old.status is distinct from 'aceptada' then
    select (now() at time zone o.timezone)::date into v_today from public.orgs o where o.id = new.org_id;
    if not exists (select 1 from public.council_tasks t where t.recommendation_id = new.id) then
      if jsonb_array_length(new.proposed_actions) = 0 then
        insert into public.council_tasks (org_id, recommendation_id, title, position, created_by)
        values (new.org_id, new.id, left(new.title, 300), 1, auth.uid());
      else
        insert into public.council_tasks (org_id, recommendation_id, title, due_on, position, created_by)
        select
          new.org_id,
          new.id,
          left(btrim(a.value ->> 'title'), 300),
          case
            when jsonb_typeof(a.value -> 'due_in_days') = 'number'
              then v_today + least(greatest((a.value ->> 'due_in_days')::numeric::integer, 0), 365)
          end,
          a.ordinality::smallint,
          auth.uid()
        from jsonb_array_elements(new.proposed_actions) with ordinality as a(value, ordinality)
        where jsonb_typeof(a.value) = 'object' and nullif(btrim(coalesce(a.value ->> 'title', '')), '') is not null;
      end if;
    end if;
    if new.kind = 'decision' then
      insert into public.recommendation_reviews (org_id, recommendation_id, horizon_days, due_on, estimated_impact_cents)
      select new.org_id, new.id, h.days, v_today + h.days, new.impact_eur_cents
      from (values (30), (60), (90)) as h(days)
      on conflict (recommendation_id, horizon_days) do nothing;
    end if;
  end if;
  return null;
end;
$$;

create trigger recommendations_accepted after update of status on public.recommendations
  for each row execute function private.recommendations_accepted();

-- Marcar una tarea como hecha deja quién la hizo.
create function private.council_tasks_stamp() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.done_at is not null and old.done_at is null then
    new.done_by := auth.uid();
  elsif new.done_at is null then
    new.done_by := null;
  end if;
  return new;
end;
$$;

create trigger council_tasks_stamp before update on public.council_tasks
  for each row execute function private.council_tasks_stamp();

-- Un cierre aceptado queda congelado (también para service_role).
create function private.council_reports_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'accepted' then
    raise exception 'Un cierre aceptado no se modifica ni se borra'
      using errcode = 'P0001', hint = 'report_immutable';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger council_reports_guard before update or delete on public.council_reports
  for each row execute function private.council_reports_guard();

-- ---------------------------------------------------------------------------
-- Triggers comunes
-- ---------------------------------------------------------------------------
create trigger set_updated_at before update on public.agent_settings for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.upsell_rules for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.recommendations for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.council_tasks for each row execute function private.set_updated_at();

-- Auditoría de lo que decide una persona (política, ajustes, decisiones, tareas y cierres).
create trigger audit after insert or update or delete on public.financial_policies for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.agent_settings for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.upsell_rules for each row execute function private.audit_row();
create trigger audit after update on public.recommendations for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.council_tasks for each row execute function private.audit_row();
create trigger audit after update on public.council_reports for each row execute function private.audit_row();

-- ---------------------------------------------------------------------------
-- RLS y privilegios
-- ---------------------------------------------------------------------------
alter table public.financial_policies enable row level security;
alter table public.agent_settings enable row level security;
alter table public.upsell_rules enable row level security;
alter table public.agent_jobs enable row level security;
alter table public.agent_runs enable row level security;
alter table public.recommendations enable row level security;
alter table public.council_tasks enable row level security;
alter table public.recommendation_reviews enable row level security;
alter table public.council_reports enable row level security;

revoke all on public.financial_policies, public.agent_settings, public.upsell_rules, public.agent_jobs, public.agent_runs,
  public.recommendations, public.council_tasks, public.recommendation_reviews, public.council_reports from anon;

-- Política: la ve cualquier miembro; se guarda una versión nueva con save_financial_policy (owners).
create policy financial_policies_select on public.financial_policies for select to authenticated
  using (private.has_role(org_id, 'viewer'));
revoke insert, update, delete, truncate on public.financial_policies from authenticated;

-- Ajustes de los agentes y reglas de venta cruzada: los ve cualquier miembro y los cambia un owner.
create policy agent_settings_select on public.agent_settings for select to authenticated
  using (private.has_role(org_id, 'viewer'));
create policy agent_settings_insert on public.agent_settings for insert to authenticated
  with check (private.has_role(org_id, 'owner'));
create policy agent_settings_update on public.agent_settings for update to authenticated
  using (private.has_role(org_id, 'owner')) with check (private.has_role(org_id, 'owner'));
revoke delete, truncate on public.agent_settings from authenticated;

create policy upsell_rules_select on public.upsell_rules for select to authenticated
  using (private.has_role(org_id, 'viewer'));
create policy upsell_rules_insert on public.upsell_rules for insert to authenticated
  with check (private.has_role(org_id, 'owner'));
create policy upsell_rules_update on public.upsell_rules for update to authenticated
  using (private.has_role(org_id, 'owner')) with check (private.has_role(org_id, 'owner'));
revoke delete, truncate on public.upsell_rules from authenticated;

-- Cola: solo el servidor (service_role). Ni siquiera se puede leer con la sesión de un usuario.
revoke all on public.agent_jobs from authenticated;

-- Ejecuciones: coste y detalle técnico, para los owners. Las escribe el servidor.
create policy agent_runs_select on public.agent_runs for select to authenticated
  using (private.has_role(org_id, 'owner'));
revoke insert, update, delete, truncate on public.agent_runs from authenticated;

-- Recomendaciones: las ve cualquier miembro; un socio decide (estado, motivo y fecha de posponer).
create policy recommendations_select on public.recommendations for select to authenticated
  using (private.has_role(org_id, 'viewer'));
create policy recommendations_update on public.recommendations for update to authenticated
  using (private.has_role(org_id, 'partner')) with check (private.has_role(org_id, 'partner'));
revoke insert, update, delete, truncate on public.recommendations from authenticated;
grant update (status, decision_note, postponed_until) on public.recommendations to authenticated;

-- Tareas: las ve cualquier miembro y las lleva un socio.
create policy council_tasks_select on public.council_tasks for select to authenticated
  using (private.has_role(org_id, 'viewer'));
create policy council_tasks_insert on public.council_tasks for insert to authenticated
  with check (private.has_role(org_id, 'partner'));
create policy council_tasks_update on public.council_tasks for update to authenticated
  using (private.has_role(org_id, 'partner')) with check (private.has_role(org_id, 'partner'));
create policy council_tasks_delete on public.council_tasks for delete to authenticated
  using (private.has_role(org_id, 'partner'));
revoke truncate on public.council_tasks from authenticated;
revoke update on public.council_tasks from authenticated;
grant update (title, due_on, assignee_member_id, position, done_at) on public.council_tasks to authenticated;

-- Revisiones e informes: los leen los miembros; los escribe el servidor (y el cierre se acepta por RPC).
create policy recommendation_reviews_select on public.recommendation_reviews for select to authenticated
  using (private.has_role(org_id, 'viewer'));
revoke insert, update, delete, truncate on public.recommendation_reviews from authenticated;

create policy council_reports_select on public.council_reports for select to authenticated
  using (private.has_role(org_id, 'viewer'));
revoke insert, update, delete, truncate on public.council_reports from authenticated;

-- ---------------------------------------------------------------------------
-- RPC
-- ---------------------------------------------------------------------------

-- Guarda una versión nueva de la política (owners). Devuelve el número de versión.
create function public.save_financial_policy(p_org uuid, p_data jsonb, p_note text default null) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version integer;
begin
  if not private.has_role(p_org, 'owner') then
    raise exception 'Solo un owner puede cambiar la política financiera' using errcode = '42501';
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'La política no es válida' using errcode = '22023', hint = 'policy_invalid';
  end if;
  -- Dos guardados a la vez no pueden coger el mismo número.
  perform 1 from public.orgs where id = p_org for update;
  select coalesce(max(version), 0) + 1 into v_version from public.financial_policies where org_id = p_org;
  insert into public.financial_policies (org_id, version, data, note, created_by)
  values (p_org, v_version, p_data, nullif(btrim(coalesce(p_note, '')), ''), auth.uid());
  return v_version;
end;
$$;

-- "Ejecutar ahora" (socios): encola el trabajo del agente, o devuelve el que ya está en cola.
create function public.council_enqueue_run(p_org uuid, p_agent public.council_agent, p_payload jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.has_role(p_org, 'partner') then
    raise exception 'Solo un socio puede lanzar el consejo' using errcode = '42501';
  end if;
  if p_agent = 'devils_advocate' then
    raise exception 'El abogado del diablo solo revisa lo que proponen los demás'
      using errcode = 'P0001', hint = 'agent_not_runnable';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Datos del trabajo no válidos' using errcode = '22023';
  end if;
  perform 1 from public.orgs where id = p_org for update;
  select j.id into v_id
  from public.agent_jobs j
  where j.org_id = p_org and j.agent = p_agent and j.trigger = 'manual' and j.status in ('pending', 'running')
  order by j.created_at
  limit 1;
  if v_id is not null then
    return v_id;
  end if;
  insert into public.agent_jobs (org_id, agent, trigger, payload, requested_by)
  values (p_org, p_agent, 'manual', p_payload, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Estado de cada agente para los miembros: cola, último resultado y gasto del mes (zona de la org).
create function public.council_status(p_org uuid)
returns table (
  agent public.council_agent,
  pending_jobs integer,
  running_jobs integer,
  last_status public.agent_job_status,
  last_finished_at timestamptz,
  last_error text,
  month_cost_usd_micros bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    a.agent,
    (select count(*)::integer from public.agent_jobs j where j.org_id = p_org and j.agent = a.agent and j.status = 'pending'),
    (select count(*)::integer from public.agent_jobs j where j.org_id = p_org and j.agent = a.agent and j.status = 'running'),
    last.status,
    last.finished_at,
    last.last_error,
    coalesce((
      select sum(r.cost_usd_micros)
      from public.agent_runs r
      where r.org_id = p_org
        and r.agent = a.agent
        and r.started_at >= (date_trunc('month', now() at time zone o.timezone) at time zone o.timezone)
    ), 0)::bigint
  from public.orgs o
  cross join unnest(enum_range(null::public.council_agent)) as a(agent)
  left join lateral (
    select j.status, j.finished_at, j.last_error
    from public.agent_jobs j
    where j.org_id = p_org and j.agent = a.agent and j.status in ('done', 'failed', 'skipped')
    order by j.finished_at desc nulls last, j.created_at desc
    limit 1
  ) last on true
  where o.id = p_org and private.has_role(p_org, 'viewer')
$$;

-- El worker (service_role) coge trabajos pendientes: los bloquea y cuenta el intento. Antes
-- devuelve a la cola (o da por fallidos) los que llevan más de 30 minutos colgados.
create function public.claim_agent_jobs(p_limit integer default 5, p_org uuid default null, p_ids uuid[] default null)
returns setof public.agent_jobs
language plpgsql
set search_path = ''
as $$
begin
  update public.agent_jobs
     set status = case when attempts >= max_attempts then 'failed'::public.agent_job_status else 'pending'::public.agent_job_status end,
         locked_at = null,
         finished_at = case when attempts >= max_attempts then now() end,
         last_error = coalesce(last_error, 'timeout')
   where status = 'running' and locked_at < now() - interval '30 minutes';

  return query
  update public.agent_jobs j
     set status = 'running', locked_at = now(), attempts = j.attempts + 1
   where j.id in (
     select x.id
     from public.agent_jobs x
     where x.status = 'pending'
       and x.run_after <= now()
       and (p_org is null or x.org_id = p_org)
       and (p_ids is null or x.id = any (p_ids))
     order by x.run_after, x.created_at
     limit greatest(1, least(coalesce(p_limit, 5), 50))
     for update skip locked
   )
  returning j.*;
end;
$$;

-- Acepta el cierre mensual con el reparto elegido (quizá editado): impuestos, colchón,
-- reinversión y socios, en céntimos, que tienen que sumar lo disponible. Queda registrado con la
-- versión de la política con la que se propuso y la vigente al aceptarlo.
create function public.accept_monthly_close(p_report_id uuid, p_buckets jsonb, p_note text default null) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report public.council_reports;
  v_available bigint;
  v_sum bigint := 0;
  v_key text;
  v_value jsonb;
  v_version integer;
begin
  select * into v_report from public.council_reports where id = p_report_id for update;
  if v_report.id is null or not private.has_role(v_report.org_id, 'partner') then
    raise exception 'Sin permiso sobre este cierre' using errcode = '42501';
  end if;
  if v_report.kind <> 'monthly_close' then
    raise exception 'Solo se acepta un cierre mensual' using errcode = 'P0001', hint = 'not_a_close';
  end if;
  if v_report.status = 'accepted' then
    raise exception 'Este cierre ya está aceptado' using errcode = 'P0001', hint = 'close_already_accepted';
  end if;
  if jsonb_typeof(v_report.content #> '{distribution,available_cents}') is distinct from 'number' then
    raise exception 'Este cierre no tiene propuesta de reparto (faltan datos)' using errcode = 'P0001', hint = 'close_not_available';
  end if;
  v_available := (v_report.content #>> '{distribution,available_cents}')::bigint;
  if p_buckets is null or jsonb_typeof(p_buckets) <> 'object'
     or (select count(*) from jsonb_object_keys(p_buckets)) <> 4 then
    raise exception 'Reparto no válido' using errcode = '22023', hint = 'close_invalid';
  end if;
  foreach v_key in array array['taxes', 'cushion', 'reinvestment', 'partners'] loop
    v_value := p_buckets -> v_key;
    if v_value is null or jsonb_typeof(v_value) <> 'number'
       or (v_value #>> '{}')::numeric < 0 or (v_value #>> '{}')::numeric <> trunc((v_value #>> '{}')::numeric) then
      raise exception 'Reparto no válido' using errcode = '22023', hint = 'close_invalid';
    end if;
    v_sum := v_sum + (v_value #>> '{}')::bigint;
  end loop;
  if v_sum <> v_available then
    raise exception 'El reparto tiene que sumar lo disponible' using errcode = 'P0001', hint = 'close_sum_mismatch';
  end if;
  select max(p.version) into v_version from public.financial_policies p where p.org_id = v_report.org_id;
  update public.council_reports
     set status = 'accepted',
         decision = jsonb_build_object(
           'buckets', p_buckets,
           'edited', p_buckets is distinct from (v_report.content #> '{distribution,buckets}'),
           'policy_version_at_acceptance', v_version
         ),
         decision_note = nullif(btrim(coalesce(p_note, '')), ''),
         decided_by = auth.uid(),
         decided_at = now()
   where id = p_report_id;
end;
$$;

revoke all on function public.save_financial_policy(uuid, jsonb, text) from public, anon;
revoke all on function public.council_enqueue_run(uuid, public.council_agent, jsonb) from public, anon;
revoke all on function public.council_status(uuid) from public, anon;
revoke all on function public.claim_agent_jobs(integer, uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.accept_monthly_close(uuid, jsonb, text) from public, anon;
grant execute on function public.save_financial_policy(uuid, jsonb, text) to authenticated;
grant execute on function public.council_enqueue_run(uuid, public.council_agent, jsonb) to authenticated;
grant execute on function public.council_status(uuid) to authenticated;
grant execute on function public.claim_agent_jobs(integer, uuid, uuid[]) to service_role;
grant execute on function public.accept_monthly_close(uuid, jsonb, text) to authenticated;
