import "server-only";
import { compareCivil, type CivilDate } from "@/domain/dates/civil-date";
import { isProjectOverdue, isTaskOverdue, type ProjectStatus, type TaskStatus } from "@/domain/projects";
import { nowInZone } from "@/lib/clock";
import { type Db, fetchAll } from "@/server/billing/context";

/**
 * Fechas de proyectos para el calendario: la fecha de cada tarea y la entrega de cada proyecto.
 * No copia nada: el calendario las lee de aquí en cada carga y se editan en su proyecto.
 *
 * Funciona con el cliente del usuario (RLS) y con el de servidor (el enlace ICS, sin sesión):
 * por eso TODAS las consultas filtran por `org_id` explícito. Ni horas, ni notas, ni dinero.
 */

export type ProjectCalendarItem = {
  /** Estable entre cargas: "project-task:<id>" o "project:<id>". */
  id: string;
  kind: "task" | "project";
  /** La fuente: la tarea o el proyecto. */
  sourceId: string;
  date: CivilDate;
  title: string;
  /** Ruta dentro de la org, donde se cambia la fecha. */
  href: string;
  /** Estado de la tarea (todo, doing, review, done) o del proyecto (planned, active, paused, done). */
  status: TaskStatus | ProjectStatus;
  /** Su fecha ya pasó y aún pide trabajo. */
  overdue: boolean;
  /** Quién la tiene asignada (la tarea) o quién lo lleva (el proyecto). */
  assigneeMemberId: string | null;
  projectId: string;
  projectName: string;
  clientId: string | null;
  clientName: string | null;
};

type ProjectRow = { id: string; name: string; status: string; client_id: string | null; due_on: string | null; owner_member_id: string | null };

/**
 * Tareas con fecha y entregas de proyectos entre `from` y `to` (ambos incluidos), de proyectos sin
 * archivar ni cancelar. `today` (por defecto, hoy en la zona de la org) decide qué va con retraso.
 */
export async function getProjectCalendarItems(
  db: Db,
  orgId: string,
  from: CivilDate,
  to: CivilDate,
  opts: { today?: CivilDate } = {},
): Promise<ProjectCalendarItem[]> {
  let today = opts.today;
  if (!today) {
    const { data: org, error } = await db.from("orgs").select("timezone").eq("id", orgId).maybeSingle();
    if (error) throw error;
    today = nowInZone(org?.timezone ?? "Europe/Madrid").date;
  }

  const [projects, tasks] = await Promise.all([
    fetchAll<ProjectRow>(
      (f, t) =>
        db
          .from("projects")
          .select("id, name, status, client_id, due_on, owner_member_id")
          .eq("org_id", orgId)
          .is("archived_at", null)
          .neq("status", "cancelled")
          .order("id")
          .range(f, t),
      "projects.calendar.projects",
    ),
    fetchAll<{ id: string; project_id: string; title: string; status: string; due_on: string | null; assignee_member_id: string | null }>(
      (f, t) =>
        db
          .from("project_tasks")
          .select("id, project_id, title, status, due_on, assignee_member_id")
          .eq("org_id", orgId)
          .gte("due_on", from)
          .lte("due_on", to)
          .order("id")
          .range(f, t),
      "projects.calendar.tasks",
    ),
  ]);

  const clientIds = [...new Set(projects.map((p) => p.client_id).filter((id): id is string => id !== null))];
  const clients = new Map<string, string>();
  if (clientIds.length > 0) {
    const { data, error } = await db.from("clients").select("id, display_name").eq("org_id", orgId).in("id", clientIds);
    if (error) throw error;
    for (const c of data ?? []) clients.set(c.id, c.display_name);
  }

  const byId = new Map(projects.map((p) => [p.id, p]));
  const items: ProjectCalendarItem[] = [];
  for (const task of tasks) {
    const project = byId.get(task.project_id);
    if (!project || !task.due_on) continue;
    const status = task.status as TaskStatus;
    items.push({
      id: `project-task:${task.id}`,
      kind: "task",
      sourceId: task.id,
      date: task.due_on,
      title: task.title,
      href: `/projects/${project.id}?task=${task.id}`,
      status,
      overdue: isTaskOverdue({ dueOn: task.due_on, status }, today),
      assigneeMemberId: task.assignee_member_id,
      projectId: project.id,
      projectName: project.name,
      clientId: project.client_id,
      clientName: project.client_id ? (clients.get(project.client_id) ?? null) : null,
    });
  }
  for (const project of projects) {
    if (!project.due_on || compareCivil(project.due_on, from) < 0 || compareCivil(project.due_on, to) > 0) continue;
    const status = project.status as ProjectStatus;
    items.push({
      id: `project:${project.id}`,
      kind: "project",
      sourceId: project.id,
      date: project.due_on,
      title: project.name,
      href: `/projects/${project.id}`,
      status,
      overdue: isProjectOverdue({ dueOn: project.due_on, status }, today),
      assigneeMemberId: project.owner_member_id,
      projectId: project.id,
      projectName: project.name,
      clientId: project.client_id,
      clientName: project.client_id ? (clients.get(project.client_id) ?? null) : null,
    });
  }
  return items.sort((a, b) => compareCivil(a.date, b.date) || Number(a.kind === "task") - Number(b.kind === "task") || a.title.localeCompare(b.title, "es"));
}
