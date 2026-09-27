import "server-only";
import type { ClientProjectsData, MyTasksCardData } from "@/components/projects/types";
import type { CivilDate } from "@/domain/dates/civil-date";
import { aggregateEconomics, groupMyTasks } from "@/domain/projects";
import type { Tables } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { loadMyTasks, targetHourlyRateCents } from "./queries";
import { compareListItems, loadMembers, loadOverview, toListItem } from "./rows";

/**
 * Cargadores de las tarjetas que otras pantallas enseñan (la ficha del cliente y el dashboard).
 * Con el cliente del usuario: pasa por RLS.
 */

/**
 * Proyectos de un cliente para su ficha 360, con la rentabilidad del cliente: lo facturado de cada
 * contrato una sola vez, entre las horas de todos sus proyectos (también los archivados: las horas
 * se dedicaron igual).
 */
export async function getClientProjects(org: Pick<Tables<"orgs">, "id" | "settings">, clientId: string, memberId: string): Promise<ClientProjectsData> {
  const supabase = await createClient();
  const [rows, members] = await Promise.all([loadOverview(supabase, org.id, { clientId }), loadMembers(supabase, org.id)]);
  const targetCents = targetHourlyRateCents(org);
  const totals = aggregateEconomics(
    rows.map((r) => ({ contractId: r.contract_id, contractRevenueCents: r.revenue_cents ?? 0, loggedMinutes: r.logged_minutes ?? 0 })),
    targetCents,
  );
  const projects = rows.flatMap((row) => toListItem(row, { targetCents, mine: new Set(), memberId }) ?? []).sort(compareListItems);
  return { projects, members, totals, targetCents };
}

const CARD_TASKS = 6;

/** "Hoy" en el dashboard: lo atrasado y lo de hoy del usuario, y cuánto le queda esta semana. */
export async function getMyTasksCard(orgId: string, memberId: string, today: CivilDate): Promise<MyTasksCardData> {
  const supabase = await createClient();
  const tasks = await loadMyTasks(supabase, orgId, memberId);
  const groups = new Map(groupMyTasks(tasks, today).map((g) => [g.group, g.tasks]));
  const overdue = groups.get("overdue") ?? [];
  const dueToday = groups.get("today") ?? [];
  const thisWeek = groups.get("thisWeek") ?? [];
  return {
    tasks: [...overdue, ...dueToday, ...thisWeek].slice(0, CARD_TASKS),
    counts: { overdue: overdue.length, today: dueToday.length, thisWeek: thisWeek.length, open: tasks.length },
    today,
  };
}
