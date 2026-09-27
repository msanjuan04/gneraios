import "server-only";
import { readOrgSettings } from "@/app/[org]/settings/schema";
import type {
  MemberHours,
  MyTask,
  ProjectDetailData,
  ProjectFormOptions,
  ProjectListItem,
  TemplateItem,
  TimerProjectOption,
} from "@/components/projects/types";
import { addDays, compareCivil, maxCivil, minCivil, type CivilDate } from "@/domain/dates/civil-date";
import { addMonths, monthOf } from "@/domain/metrics/months";
import {
  isOpenProjectStatus,
  monthlyEconomics,
  type ProjectKind,
  type ProjectStatus,
  readTemplateTasks,
  sumBy,
  type TaskPriority,
  type TaskStatus,
  templateSummary,
  weekRange,
  weeklySeries,
  weekStart,
} from "@/domain/projects";
import type { Tables } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/server/action-utils";
import { fetchAll } from "@/server/billing/context";
import {
  compareListItems,
  ENTRY_COLUMNS,
  type EntryRow,
  loadContractOptions,
  loadMembers,
  loadOverview,
  loadProjectsWithMyTasks,
  type OverviewFilter,
  TASK_COLUMNS,
  type TaskRow,
  toEntry,
  toListItem,
  toTask,
} from "./rows";

/**
 * Lecturas de proyectos, tareas y horas. Todo con el cliente del usuario: pasa por RLS (cualquier
 * miembro lee) y lo derivado se calcula con su única definición (src/domain/projects).
 */

type OrgRef = Pick<Tables<"orgs">, "id" | "settings">;

/** Objetivo de €/hora de la org (orgs.settings.target_hourly_rate_cents; 60 €/h por defecto). */
export function targetHourlyRateCents(org: Pick<Tables<"orgs">, "settings">): number {
  return readOrgSettings(org.settings).target_hourly_rate_cents;
}

const MAX_WEEKS = 26;
const MIN_WEEKS = 6;
const MAX_MONTHS = 24;

/**
 * Listado con lo derivado ya calculado, en su orden (compareListItems). Sin filtros, todos los
 * proyectos de la org (también los archivados: la pantalla filtra en el navegador, como los
 * contratos); con ellos, solo lo pedido. "Solo lo mío" = lo que lleva el miembro o tiene tareas suyas.
 */
export async function getProjectsList(org: OrgRef, memberId: string, filter: OverviewFilter & { mine?: boolean } = {}): Promise<ProjectListItem[]> {
  const supabase = await createClient();
  const [rows, mine] = await Promise.all([loadOverview(supabase, org.id, filter), loadProjectsWithMyTasks(supabase, org.id, memberId)]);
  const targetCents = targetHourlyRateCents(org);
  return rows
    .flatMap((row) => toListItem(row, { targetCents, mine, memberId }) ?? [])
    .filter((item) => !filter.mine || item.mine)
    .sort(compareListItems);
}

/** Clientes, contratos, socios y plantillas para el panel de alta y edición. */
export async function getProjectFormOptions(orgId: string): Promise<ProjectFormOptions> {
  const supabase = await createClient();
  const [clients, contracts, members, templates] = await Promise.all([
    supabase.from("clients").select("id, display_name").eq("org_id", orgId).is("archived_at", null).order("display_name"),
    loadContractOptions(supabase, orgId),
    loadMembers(supabase, orgId),
    supabase.from("project_templates").select("id, name, kind, tasks").eq("org_id", orgId).order("name"),
  ]);
  if (clients.error) throw clients.error;
  if (templates.error) throw templates.error;
  return {
    clients: (clients.data ?? []).map((c) => ({ id: c.id, name: c.display_name })),
    contracts,
    members,
    templates: (templates.data ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      kind: t.kind as ProjectKind,
      summary: templateSummary(readTemplateTasks(t.tasks)),
    })),
  };
}

/** Horas registradas por cada miembro entre dos fechas (ambas incluidas). */
export async function getMemberHours(orgId: string, from: CivilDate, to: CivilDate): Promise<MemberHours[]> {
  const supabase = await createClient();
  const rows = await fetchAll<{ member_id: string; minutes: number | null }>(
    (f, t) =>
      supabase
        .from("time_entries")
        .select("member_id, minutes")
        .eq("org_id", orgId)
        .gte("worked_on", from)
        .lte("worked_on", to)
        .not("minutes", "is", null)
        .order("id")
        .range(f, t),
    "projects.memberHours",
  );
  const byMember = sumBy(rows, (r) => r.member_id, (r) => r.minutes ?? 0);
  return [...byMember].map(([memberId, minutes]) => ({ memberId, minutes })).sort((a, b) => b.minutes - a.minutes);
}

/** Horas por miembro y semana (lunes) entre dos fechas: la carga del equipo. */
export async function getMemberWeeklyHours(
  orgId: string,
  from: CivilDate,
  to: CivilDate,
): Promise<{ weeks: CivilDate[]; members: { memberId: string; minutesByWeek: number[]; total: number }[] }> {
  const supabase = await createClient();
  const rows = await fetchAll<{ member_id: string; worked_on: string; minutes: number | null }>(
    (f, t) =>
      supabase
        .from("time_entries")
        .select("member_id, worked_on, minutes")
        .eq("org_id", orgId)
        .gte("worked_on", from)
        .lte("worked_on", to)
        .not("minutes", "is", null)
        .order("id")
        .range(f, t),
    "projects.memberWeeklyHours",
  );
  const weeks = weekRange(from, to);
  const index = new Map(weeks.map((w, i) => [w, i]));
  const byMember = new Map<string, number[]>();
  for (const row of rows) {
    const list = byMember.get(row.member_id) ?? weeks.map(() => 0);
    const i = index.get(weekStart(row.worked_on));
    if (i !== undefined) list[i] = (list[i] ?? 0) + (row.minutes ?? 0);
    byMember.set(row.member_id, list);
  }
  return {
    weeks,
    members: [...byMember]
      .map(([memberId, minutesByWeek]) => ({ memberId, minutesByWeek, total: minutesByWeek.reduce((s, m) => s + m, 0) }))
      .sort((a, b) => b.total - a.total),
  };
}

/** La fila de un proyecto (para el título de la página). null si no existe o la RLS no lo deja ver. */
export async function getProjectName(orgId: string, projectId: string): Promise<string | null> {
  if (!idSchema.safeParse(projectId).success) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("projects").select("name").eq("org_id", orgId).eq("id", projectId).maybeSingle();
  return data?.name ?? null;
}

/** Ficha de un proyecto: cabecera con lo derivado, tareas, horas y las series del resumen. */
export async function getProjectDetail(org: OrgRef, projectId: string, memberId: string, today: CivilDate): Promise<ProjectDetailData | null> {
  if (!idSchema.safeParse(projectId).success) return null;
  const supabase = await createClient();
  const { data: row, error } = await supabase.from("projects_overview").select("*").eq("org_id", org.id).eq("id", projectId).maybeSingle();
  if (error) throw error;
  if (!row) return null;

  const [taskRows, entryRows, members, revenueRows, siblings, mine] = await Promise.all([
    fetchAll<TaskRow>(
      (from, to) => supabase.from("project_tasks").select(TASK_COLUMNS).eq("project_id", projectId).order("position").order("id").range(from, to),
      "projects.tasks",
    ),
    fetchAll<EntryRow>(
      (from, to) =>
        supabase
          .from("time_entries")
          .select(ENTRY_COLUMNS)
          .eq("project_id", projectId)
          .order("worked_on", { ascending: false })
          .order("created_at", { ascending: false })
          .range(from, to),
      "projects.entries",
    ),
    loadMembers(supabase, org.id),
    row.contract_id
      ? fetchAll<{ issued_on: string | null; base_cents: number | null }>(
          (from, to) =>
            supabase
              .from("project_contract_revenue")
              .select("issued_on, base_cents")
              .eq("contract_id", row.contract_id!)
              .order("invoice_line_id")
              .range(from, to),
          "projects.revenue",
        )
      : Promise.resolve([]),
    row.contract_id
      ? supabase.from("projects").select("id, name").eq("contract_id", row.contract_id).neq("id", projectId).order("name")
      : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
    supabase.from("project_tasks").select("id").eq("project_id", projectId).eq("assignee_member_id", memberId).limit(1),
  ]);
  if (siblings.error) throw siblings.error;
  if (mine.error) throw mine.error;

  const targetCents = targetHourlyRateCents(org);
  const item = toListItem(row, { targetCents, mine: new Set((mine.data ?? []).length > 0 ? [projectId] : []), memberId });
  if (!item) return null;

  const entries = entryRows.map(toEntry);
  const logged = entries.filter((e): e is typeof e & { minutes: number } => e.minutes !== null);
  const byTask = sumBy(
    logged.filter((e) => e.taskId !== null),
    (e) => e.taskId!,
    (e) => e.minutes,
  );
  const tasks = taskRows.map((t) => toTask(t, byTask.get(t.id) ?? 0));

  // Series del resumen: desde que empezó (o desde la primera hora o factura) hasta hoy, acotadas.
  const timeRows = logged.map((e) => ({ workedOn: e.workedOn, minutes: e.minutes }));
  const revenue = revenueRows.flatMap((r) => (r.issued_on && r.base_cents !== null ? [{ issuedOn: r.issued_on, baseCents: r.base_cents }] : []));
  const starts = [row.starts_on, ...timeRows.map((e) => e.workedOn), ...revenue.map((r) => r.issuedOn)].filter(
    (d): d is string => typeof d === "string" && compareCivil(d, today) <= 0,
  );
  const earliest = starts.length > 0 ? minCivil(starts[0]!, ...starts.slice(1)) : today;
  // Al menos MIN_WEEKS semanas (para que la gráfica se lea) y como mucho MAX_WEEKS (lo anterior va en el acumulado).
  const weeksFrom = maxCivil(minCivil(earliest, addDays(today, -7 * (MIN_WEEKS - 1))), addDays(today, -7 * (MAX_WEEKS - 1)));
  const weekly = weeklySeries(timeRows, weeksFrom, today);
  const monthsFrom = maxCivil(earliest, addMonths(monthOf(today), -(MAX_MONTHS - 1)));

  const contractMinutes = row.contract_minutes ?? 0;
  const contractProjects = row.contract_projects ?? 0;
  const share =
    contractProjects > 1
      ? contractMinutes > 0
        ? { numerator: item.loggedMinutes, denominator: contractMinutes }
        : { numerator: 1, denominator: contractProjects }
      : null;
  const monthly = row.contract_id || timeRows.length > 0 ? monthlyEconomics(revenue, timeRows, { from: monthsFrom, to: today }, targetCents, share) : [];

  return {
    project: {
      ...item,
      notes: row.notes,
      contractMinutes,
      contractProjects,
      contractRevenueCents: row.revenue_cents ?? 0,
      billableMinutes: row.billable_minutes ?? 0,
    },
    tasks,
    entries,
    members,
    siblings: (siblings.data ?? []).map((s) => ({ id: s.id, name: s.name })),
    weekly,
    monthly,
    targetCents,
  };
}

/** Las tareas sin hacer asignadas a un miembro, de los proyectos que siguen vivos (ni archivados ni cancelados). */
export async function getMyTasks(orgId: string, memberId: string): Promise<MyTask[]> {
  const supabase = await createClient();
  return loadMyTasks(supabase, orgId, memberId);
}

export async function loadMyTasks(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string, memberId: string): Promise<MyTask[]> {
  const tasks = await fetchAll<{ id: string; title: string; status: string; priority: string; due_on: string | null; project_id: string }>(
    (from, to) =>
      supabase
        .from("project_tasks")
        .select("id, title, status, priority, due_on, project_id")
        .eq("org_id", orgId)
        .eq("assignee_member_id", memberId)
        .neq("status", "done")
        .order("id")
        .range(from, to),
    "projects.myTasks",
  );
  const projectIds = [...new Set(tasks.map((t) => t.project_id))];
  if (projectIds.length === 0) return [];
  const { data: projects, error } = await supabase
    .from("projects_overview")
    .select("id, name, status, archived_at, client_name")
    .in("id", projectIds);
  if (error) throw error;
  const byId = new Map((projects ?? []).map((p) => [p.id, p]));
  return tasks.flatMap((t) => {
    const p = byId.get(t.project_id);
    if (!p?.name || p.archived_at !== null || p.status === "cancelled") return [];
    return [
      {
        id: t.id,
        title: t.title,
        status: t.status as TaskStatus,
        priority: t.priority as TaskPriority,
        dueOn: t.due_on,
        projectId: t.project_id,
        projectName: p.name,
        clientName: p.client_name,
      },
    ];
  });
}

/** Proyectos vivos (sin archivar, sin terminar) para elegir dónde apuntar una tarea o unas horas. */
export async function getOpenProjectOptions(orgId: string): Promise<TimerProjectOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects_overview")
    .select("id, name, status, client_name, last_worked_on, updated_at")
    .eq("org_id", orgId)
    .is("archived_at", null)
    .order("name");
  if (error) throw error;
  return (data ?? []).flatMap((p) =>
    p.id && p.name && p.status && isOpenProjectStatus(p.status as ProjectStatus) ? [{ id: p.id, name: p.name, clientName: p.client_name }] : [],
  );
}

export async function getTemplates(orgId: string): Promise<TemplateItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("project_templates").select("id, name, kind, tasks, updated_at").eq("org_id", orgId).order("name");
  if (error) throw error;
  return (data ?? []).map((t) => {
    const tasks = readTemplateTasks(t.tasks);
    return { id: t.id, name: t.name, kind: t.kind as ProjectKind, tasks, summary: templateSummary(tasks), updatedAt: t.updated_at };
  });
}
