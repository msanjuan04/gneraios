// Sin "server-only": lo usan también los cargadores que reciben el cliente de servidor (portal,
// calendario). Solo se importa desde código de servidor.
import type { ContractOption, MemberRef, ProjectListItem, ProjectTask, TimeEntry } from "@/components/projects/types";
import {
  budgetBurn,
  type ProjectKind,
  projectEconomics,
  projectProgress,
  type ProjectStatus,
  type TaskPriority,
  type TaskStatus,
} from "@/domain/projects";
import type { Database, Tables } from "@/lib/supabase/database.types";
import { type Db, fetchAll } from "@/server/billing/context";

/**
 * Filas de la base de datos → modelos de la pantalla. Lo derivado sale de su única definición:
 * el retraso de la vista (gemela de isProjectOverdue, con test de paridad), lo facturado de la
 * vista project_contract_revenue y el reparto, el avance, el consumo y la tarifa de src/domain.
 */

export type OverviewRow = Database["public"]["Views"]["projects_overview"]["Row"];

export const TASK_COLUMNS =
  "id, project_id, title, description, status, assignee_member_id, due_on, priority, estimate_minutes, position, client_visible, completed_at, created_at";
export const ENTRY_COLUMNS = "id, member_id, project_id, task_id, worked_on, minutes, started_at, note, billable, created_at";

type TaskRow = Pick<
  Tables<"project_tasks">,
  | "id"
  | "project_id"
  | "title"
  | "description"
  | "status"
  | "assignee_member_id"
  | "due_on"
  | "priority"
  | "estimate_minutes"
  | "position"
  | "client_visible"
  | "completed_at"
  | "created_at"
>;
type EntryRow = Pick<
  Tables<"time_entries">,
  "id" | "member_id" | "project_id" | "task_id" | "worked_on" | "minutes" | "started_at" | "note" | "billable" | "created_at"
>;

export function toListItem(row: OverviewRow, opts: { targetCents: number; mine: ReadonlySet<string>; memberId: string }): ProjectListItem | null {
  if (!row.id || !row.name || !row.kind || !row.status) return null;
  const status = row.status as ProjectStatus;
  const loggedMinutes = row.logged_minutes ?? 0;
  const economics = projectEconomics(
    {
      contractId: row.contract_id,
      contractRevenueCents: row.revenue_cents ?? 0,
      projectMinutes: loggedMinutes,
      contractMinutes: row.contract_minutes ?? 0,
      contractProjects: row.contract_projects ?? 0,
    },
    opts.targetCents,
  );
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as ProjectKind,
    status,
    clientId: row.client_id,
    clientName: row.client_name,
    contractId: row.contract_id,
    contractTitle: row.contract_title,
    ownerId: row.owner_member_id,
    startsOn: row.starts_on,
    dueOn: row.due_on,
    overdue: row.is_overdue ?? false,
    archived: row.archived_at !== null,
    portalVisible: row.portal_visible ?? false,
    progress: projectProgress({ tasksTotal: row.tasks_total ?? 0, tasksDone: row.tasks_done ?? 0, status }),
    tasksOverdue: row.tasks_overdue ?? 0,
    loggedMinutes,
    budgetMinutes: row.budget_minutes,
    burn: budgetBurn(loggedMinutes, row.budget_minutes),
    revenueCents: economics.revenueCents,
    rateCents: economics.rateCents,
    standing: economics.standing,
    sharedContract: economics.shared,
    nextTask: row.next_task_id && row.next_task_title ? { id: row.next_task_id, title: row.next_task_title, dueOn: row.next_task_due_on } : null,
    mine: row.owner_member_id === opts.memberId || opts.mine.has(row.id),
    runningTimers: row.running_timers ?? 0,
    lastWorkedOn: row.last_worked_on,
  };
}

const STATUS_ORDER: Record<ProjectStatus, number> = { active: 0, planned: 1, paused: 2, done: 3, cancelled: 4 };

/**
 * Orden de los listados: lo vivo antes que lo archivado; en marcha, planificado, en pausa, hecho y
 * cancelado; dentro de cada estado, primero lo que va con retraso y luego por fecha de entrega.
 */
export function compareListItems(a: ProjectListItem, b: ProjectListItem): number {
  return (
    Number(a.archived) - Number(b.archived) ||
    STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
    Number(b.overdue) - Number(a.overdue) ||
    (a.dueOn ?? "9999-12-31").localeCompare(b.dueOn ?? "9999-12-31") ||
    a.name.localeCompare(b.name, "es")
  );
}

export function toTask(row: TaskRow, loggedMinutes = 0): ProjectTask {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status as TaskStatus,
    assigneeId: row.assignee_member_id,
    dueOn: row.due_on,
    priority: row.priority as TaskPriority,
    estimateMinutes: row.estimate_minutes,
    position: Number(row.position),
    clientVisible: row.client_visible,
    completedAt: row.completed_at,
    loggedMinutes,
  };
}

export function toEntry(row: EntryRow): TimeEntry {
  return {
    id: row.id,
    memberId: row.member_id,
    taskId: row.task_id,
    workedOn: row.worked_on,
    minutes: row.minutes,
    startedAt: row.started_at,
    note: row.note,
    billable: row.billable,
  };
}

/** Todos los miembros de la org (también los inactivos: sus horas y sus proyectos siguen ahí). */
export async function loadMembers(db: Db, orgId: string): Promise<MemberRef[]> {
  const { data, error } = await db
    .from("members")
    .select("id, full_name, initials, color, is_active")
    .eq("org_id", orgId)
    .order("full_name");
  if (error) throw error;
  return (data ?? []).map((m) => ({ id: m.id, fullName: m.full_name, initials: m.initials, color: m.color, active: m.is_active }));
}

export type OverviewFilter = {
  clientId?: string;
  status?: ProjectStatus;
  ownerId?: string;
  /** Por defecto también salen los archivados (el listado los esconde con su propio filtro). */
  includeArchived?: boolean;
};

/** Filas de la vista, paginadas (PostgREST devuelve como mucho 1.000). */
export function loadOverview(db: Db, orgId: string, filter: OverviewFilter = {}): Promise<OverviewRow[]> {
  return fetchAll<OverviewRow>((from, to) => {
    let query = db.from("projects_overview").select("*").eq("org_id", orgId);
    if (filter.clientId) query = query.eq("client_id", filter.clientId);
    if (filter.status) query = query.eq("status", filter.status);
    if (filter.ownerId) query = query.eq("owner_member_id", filter.ownerId);
    if (filter.includeArchived === false) query = query.is("archived_at", null);
    return query.order("id").range(from, to);
  }, "projects.overview");
}

/** Proyectos en los que el miembro tiene alguna tarea asignada (para "solo lo mío"). */
export async function loadProjectsWithMyTasks(db: Db, orgId: string, memberId: string): Promise<Set<string>> {
  const rows = await fetchAll<{ project_id: string }>(
    (from, to) =>
      db
        .from("project_tasks")
        .select("project_id")
        .eq("org_id", orgId)
        .eq("assignee_member_id", memberId)
        .order("id")
        .range(from, to),
    "projects.myTasks",
  );
  return new Set(rows.map((r) => r.project_id));
}

export async function loadContractOptions(db: Db, orgId: string): Promise<ContractOption[]> {
  const { data, error } = await db
    .from("contracts")
    .select("id, title, client_id, signed_on")
    .eq("org_id", orgId)
    .is("archived_at", null)
    .order("title");
  if (error) throw error;
  return (data ?? []).map((c) => ({ id: c.id, title: c.title, clientId: c.client_id, signed: c.signed_on !== null }));
}

export type { EntryRow, TaskRow };
