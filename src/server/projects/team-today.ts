import "server-only";

import type { CivilDate } from "@/domain/dates/civil-date";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/server/billing/context";
import { loadMembers } from "./rows";

/**
 * Qué tiene cada persona del equipo para hoy: lo vencido y lo que vence hoy, más cuántas tareas
 * abiertas lleva. Es la foto del día, para saber de un vistazo quién va ahogado y quién no.
 * Las tareas sin fecha no cuentan como «de hoy»: están abiertas, pero no comprometidas para hoy.
 */

export type TeamMemberToday = {
  memberId: string;
  fullName: string;
  initials: string;
  color: string | null;
  /** Vencidas (fecha anterior a hoy) y para hoy. */
  overdue: number;
  today: number;
  /** Todas las que tiene abiertas, con fecha o sin ella. */
  open: number;
  /** Lo primero que debería mirar: lo más atrasado, y si no, lo de hoy. */
  next: { title: string; projectName: string; clientName: string | null; dueOn: CivilDate | null } | null;
};

export async function loadTeamToday(orgId: string, today: CivilDate): Promise<TeamMemberToday[]> {
  const supabase = await createClient();
  const [members, tasks] = await Promise.all([
    loadMembers(supabase, orgId),
    fetchAll<{ id: string; title: string; due_on: string | null; assignee_member_id: string | null; project_id: string }>(
      (from, to) =>
        supabase
          .from("project_tasks")
          .select("id, title, due_on, assignee_member_id, project_id")
          .eq("org_id", orgId)
          .neq("status", "done")
          .not("assignee_member_id", "is", null)
          .order("id")
          .range(from, to),
      "projects.teamToday",
    ),
  ]);
  if (tasks.length === 0) return [];

  // Un proyecto archivado o cancelado no cuenta: su trabajo ya no está en marcha.
  const { data: projects, error } = await supabase
    .from("projects_overview")
    .select("id, name, status, archived_at, client_name")
    .in("id", [...new Set(tasks.map((task) => task.project_id))]);
  if (error) throw error;
  const liveProjects = new Map(
    (projects ?? []).flatMap((project) =>
      project.id && project.name && project.archived_at === null && project.status !== "cancelled"
        ? [[project.id, { name: project.name, clientName: project.client_name }] as const]
        : [],
    ),
  );

  const byMember = new Map<string, TeamMemberToday>(
    members
      .filter((member) => member.active)
      .map((member) => [
        member.id,
        { memberId: member.id, fullName: member.fullName, initials: member.initials, color: member.color, overdue: 0, today: 0, open: 0, next: null },
      ]),
  );

  for (const task of tasks) {
    const row = task.assignee_member_id ? byMember.get(task.assignee_member_id) : undefined;
    const project = liveProjects.get(task.project_id);
    if (!row || !project) continue;
    row.open += 1;
    const late = task.due_on !== null && task.due_on < today;
    const isToday = task.due_on === today;
    if (late) row.overdue += 1;
    else if (isToday) row.today += 1;
    // Lo primero a mirar: lo más atrasado; a igualdad, lo que antes vence.
    if ((late || isToday) && (row.next === null || (task.due_on ?? "") < (row.next.dueOn ?? "9999-99-99"))) {
      row.next = { title: task.title, projectName: project.name, clientName: project.clientName, dueOn: task.due_on };
    }
  }

  // Primero quien tiene algo urgente; después, quien más carga lleva.
  return [...byMember.values()]
    .filter((row) => row.open > 0)
    .sort((a, b) => b.overdue - a.overdue || b.today - a.today || b.open - a.open || a.fullName.localeCompare(b.fullName));
}
