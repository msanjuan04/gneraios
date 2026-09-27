// Capacidad (get_capacity): las horas que registra cada persona semana a semana frente a su
// capacidad semanal, y la carga planificada (la estimación de las tareas abiertas vencidas o con
// fecha en las próximas semanas). Las horas son las de Proyectos (time_entries, también las que
// se importan de GTiQ) y las semanas van de lunes a domingo con las mismas funciones que la carga
// del equipo en Proyectos (src/domain/projects/series). La misma foto evalúa la condición de
// capacidad de la regla de contratar de la política (get_policy): una sola definición de "carga".

import { z } from "zod";
import { addDays, compareCivil, type CivilDate } from "@/domain/dates/civil-date";
import { isOpenProjectStatus, weekRange, weekStart, weeklySeries } from "@/domain/projects";
import type { MemberInfo } from "../data/types";
import { m, shareBps } from "./common";
import { formatMetricValue, rangePeriod } from "./format";
import { defineTool, type Metric, type ToolContext, type ToolRow } from "./types";

/** Capacidad semanal por persona si la org no la fija en orgs.settings.weekly_capacity_minutes: 30 h. */
export const DEFAULT_WEEKLY_CAPACITY_MINUTES = 30 * 60;

const weeklyCapacitySetting = z.object({ weekly_capacity_minutes: z.number().int().min(60).max(7 * 24 * 60) });

/** orgs.settings.weekly_capacity_minutes si está y es válida; si no, el supuesto por defecto (y se dice). */
export function readWeeklyCapacity(settings: unknown): { minutes: number; fromSettings: boolean } {
  const parsed = weeklyCapacitySetting.safeParse(settings);
  return parsed.success ? { minutes: parsed.data.weekly_capacity_minutes, fromSettings: true } : { minutes: DEFAULT_WEEKLY_CAPACITY_MINUTES, fromSettings: false };
}

/** Las `weeks` semanas completas (de lunes a domingo) anteriores a la de hoy: la semana en curso aún no ha terminado. */
export function completeWeeks(today: CivilDate, weeks: number): { from: CivilDate; to: CivilDate; mondays: CivilDate[] } {
  const last = addDays(weekStart(today), -7);
  const from = addDays(last, -7 * (weeks - 1));
  const to = addDays(last, 6);
  return { from, to, mondays: weekRange(from, to) };
}

export type PersonLoad = {
  member: MemberInfo;
  /** Minutos registrados en cada semana, en el orden de `mondays`. */
  minutesByWeek: number[];
  totalMinutes: number;
  /** Ha registrado horas en el periodo. Si no, su carga no se conoce (no es cero). */
  tracked: boolean;
};

export type CapacitySnapshot = {
  capacity: { minutes: number; fromSettings: boolean };
  from: CivilDate;
  to: CivilDate;
  mondays: CivilDate[];
  /** Socios (owner y partner) y cualquiera que haya registrado horas. */
  people: PersonLoad[];
  /** Carga del equipo: la de quienes han registrado horas, frente a su capacidad. */
  team: { people: number; minutesByWeek: number[]; loadBpsByWeek: (number | null)[]; totalMinutes: number; avgLoadBps: number | null };
  /** Horas de personas que ya no están activas: no cuentan para la capacidad. */
  inactiveMinutes: number;
};

/** Horas por persona y semana en las últimas `weeks` semanas completas, con la carga del equipo. */
export async function loadCapacity(ctx: ToolContext, weeks: number): Promise<CapacitySnapshot> {
  const { from, to, mondays } = completeWeeks(ctx.today, weeks);
  const [members, entries] = await Promise.all([ctx.data.members(), ctx.data.timeEntries(from, to)]);
  const active = new Set(members.map((mm) => mm.id));
  const byMember = new Map<string, { workedOn: CivilDate; minutes: number }[]>();
  let inactiveMinutes = 0;
  for (const entry of entries) {
    if (!active.has(entry.memberId)) {
      inactiveMinutes += entry.minutes;
      continue;
    }
    const list = byMember.get(entry.memberId) ?? [];
    list.push({ workedOn: entry.workedOn, minutes: entry.minutes });
    byMember.set(entry.memberId, list);
  }
  const people = members
    .filter((member) => member.role !== "viewer" || byMember.has(member.id))
    .map((member): PersonLoad => {
      const minutesByWeek = weeklySeries(byMember.get(member.id) ?? [], from, to).map((point) => point.minutes);
      const totalMinutes = minutesByWeek.reduce((sum, minutes) => sum + minutes, 0);
      return { member, minutesByWeek, totalMinutes, tracked: totalMinutes > 0 };
    });
  const tracked = people.filter((p) => p.tracked);
  const weekCapacity = tracked.length * ctx.weeklyCapacity.minutes;
  const minutesByWeek = mondays.map((_, i) => tracked.reduce((sum, p) => sum + (p.minutesByWeek[i] ?? 0), 0));
  const totalMinutes = minutesByWeek.reduce((sum, minutes) => sum + minutes, 0);
  return {
    capacity: ctx.weeklyCapacity,
    from,
    to,
    mondays,
    people,
    team: {
      people: tracked.length,
      minutesByWeek,
      loadBpsByWeek: minutesByWeek.map((minutes) => (weekCapacity > 0 ? shareBps(minutes, weekCapacity) : null)),
      totalMinutes,
      avgLoadBps: weekCapacity > 0 ? shareBps(totalMinutes, weekCapacity * mondays.length) : null,
    },
    inactiveMinutes,
  };
}

/** Semanas seguidas, contando hacia atrás desde la última completa, con la carga del equipo en `minBps` o por encima. */
export function weeksAtOrAbove(loadBpsByWeek: readonly (number | null)[], minBps: number): number {
  let weeks = 0;
  for (let i = loadBpsByWeek.length - 1; i >= 0; i -= 1) {
    const load = loadBpsByWeek[i];
    if (load === null || load === undefined || load < minBps) break;
    weeks += 1;
  }
  return weeks;
}

/**
 * La condición de capacidad de la regla de contratar: la carga del equipo en el mínimo o por encima
 * todas las semanas. null (no se puede saber) si nadie ha registrado horas o si algún socio no ha
 * registrado ninguna: sin sus horas, la carga del equipo no se conoce.
 */
export function hireCapacityOk(snapshot: CapacitySnapshot, minBps: number): boolean | null {
  if (snapshot.team.people === 0 || snapshot.people.some((p) => !p.tracked)) return null;
  return snapshot.team.loadBpsByWeek.every((load) => load !== null && load >= minBps);
}

/** Los que no han registrado horas en el periodo, para decir de quién faltan. */
export function untrackedNames(snapshot: CapacitySnapshot): string[] {
  return snapshot.people.filter((p) => !p.tracked).map((p) => p.member.fullName);
}

type Planned = { minutes: number; overdue: number; unestimated: number };

/** Estimación de las tareas abiertas vencidas o con fecha hasta `until`, de proyectos que siguen vivos, por persona. */
async function plannedLoad(ctx: ToolContext, until: CivilDate): Promise<{ byMember: Map<string, Planned>; unassigned: Planned }> {
  const [projects, tasks] = await Promise.all([ctx.data.projects(), ctx.data.openTasks()]);
  const live = new Set(projects.filter((p) => !p.archived && isOpenProjectStatus(p.status)).map((p) => p.id));
  const byMember = new Map<string, Planned>();
  const unassigned: Planned = { minutes: 0, overdue: 0, unestimated: 0 };
  for (const task of tasks) {
    if (!live.has(task.projectId) || task.dueOn === null || compareCivil(task.dueOn, until) > 0) continue;
    const bucket = task.assigneeMemberId === null ? unassigned : (byMember.get(task.assigneeMemberId) ?? { minutes: 0, overdue: 0, unestimated: 0 });
    if (task.estimateMinutes === null) bucket.unestimated += 1;
    else {
      bucket.minutes += task.estimateMinutes;
      if (compareCivil(task.dueOn, ctx.today) < 0) bucket.overdue += task.estimateMinutes;
    }
    if (task.assigneeMemberId !== null) byMember.set(task.assigneeMemberId, bucket);
  }
  return { byMember, unassigned };
}

const HOURS_NEEDS = ["Registrar las horas en Proyectos (con el temporizador o a mano) o importar las de GTiQ"];

export const getCapacity = defineTool({
  name: "get_capacity",
  description:
    "Carga y capacidad por socio con las horas de Proyectos (también las importadas de GTiQ): horas registradas en cada una de las últimas N semanas completas (de lunes a domingo) frente a la capacidad semanal por persona (orgs.settings.weekly_capacity_minutes o, si no está, el supuesto de 30 h, y se dice), la carga del equipo semana a semana (la misma que evalúa la regla de contratar) y la carga planificada: la estimación de las tareas abiertas vencidas o con fecha en las próximas semanas. Sin horas registradas devuelve missing_data.",
  input: z
    .object({
      weeks: z.number().int().min(1).max(26).optional().describe("Semanas completas hacia atrás (por defecto, las de la regla de contratar de la política)"),
      ahead_weeks: z.number().int().min(1).max(12).default(4).describe("Semanas hacia delante para la carga planificada"),
    })
    .strict(),
  async run(ctx, { weeks, ahead_weeks: ahead }) {
    const policy = ctx.policy.policy;
    const n = weeks ?? Math.min(26, policy.hire.weeks);
    const snapshot = await loadCapacity(ctx, n);
    const until = addDays(ctx.today, 7 * ahead - 1);
    const { byMember, unassigned } = await plannedLoad(ctx, until);
    const capacity = snapshot.capacity.minutes;
    const period = rangePeriod(snapshot.from, snapshot.to);
    const aheadPeriod = rangePeriod(ctx.today, until);
    const weekPeriod = (monday: CivilDate) => rangePeriod(monday, addDays(monday, 6));
    const plannedLabel = `hasta el ${until}`;

    const metrics: Metric[] = [
      m.minutes(
        "capacity.weekly_capacity",
        snapshot.capacity.fromSettings
          ? "Capacidad semanal por persona (fijada en Ajustes: orgs.settings.weekly_capacity_minutes)"
          : `Capacidad semanal por persona (supuesto por defecto de ${formatMetricValue(capacity, "minutes")}: la org no la ha fijado en orgs.settings.weekly_capacity_minutes)`,
        capacity,
        ctx.today,
        "/settings",
      ),
      m.count("capacity.people", "Personas que cuentan para la carga del equipo (las que registran horas)", snapshot.team.people, period, "/projects"),
    ];
    if (snapshot.team.people > 0) {
      snapshot.mondays.forEach((monday, i) => {
        metrics.push(m.minutes(`capacity.team.${monday}.minutes`, `Horas registradas del equipo · semana del ${monday}`, snapshot.team.minutesByWeek[i] ?? 0, weekPeriod(monday), "/projects"));
        const load = snapshot.team.loadBpsByWeek[i];
        if (load !== null && load !== undefined) metrics.push(m.bps(`capacity.team.${monday}.load`, `Carga del equipo · semana del ${monday}`, load, weekPeriod(monday)));
      });
      if (snapshot.team.avgLoadBps !== null) metrics.push(m.bps("capacity.team.avg_load", `Carga media del equipo en las últimas ${n} semanas completas`, snapshot.team.avgLoadBps, period, "/projects"));
      metrics.push(
        m.count(
          "capacity.team.weeks_at_policy",
          "Semanas seguidas, hasta la última completa, con la carga del equipo en el mínimo de la política para contratar o por encima",
          weeksAtOrAbove(snapshot.team.loadBpsByWeek, policy.hire.min_capacity_bps),
          period,
          "/settings/council",
        ),
      );
    }

    let plannedTotal = unassigned.minutes;
    let unestimatedTotal = unassigned.unestimated;
    const people = snapshot.people.map((person) => {
      const id = person.member.id;
      const planned = byMember.get(id) ?? { minutes: 0, overdue: 0, unestimated: 0 };
      plannedTotal += planned.minutes;
      unestimatedTotal += planned.unestimated;
      const load = person.tracked ? (shareBps(person.totalMinutes, capacity * n) ?? 0) : null;
      const rowMetrics: Metric[] = [];
      if (load !== null) {
        snapshot.mondays.forEach((monday, i) => {
          rowMetrics.push(m.minutes(`capacity.${id}.${monday}`, `Horas registradas · semana del ${monday}`, person.minutesByWeek[i] ?? 0, weekPeriod(monday), "/projects"));
        });
        rowMetrics.push(
          m.minutes(`capacity.${id}.avg`, `Media semanal de horas registradas (${n} semanas)`, Math.round(person.totalMinutes / n), period, "/projects"),
          m.bps(`capacity.${id}.load`, "Carga media frente a su capacidad semanal", load, period),
        );
      }
      rowMetrics.push(
        m.minutes(`capacity.${id}.planned`, `Estimación de sus tareas abiertas vencidas o con fecha ${plannedLabel}`, planned.minutes, aheadPeriod, "/projects/tasks"),
        m.bps(`capacity.${id}.planned_load`, `Carga planificada frente a su capacidad de las próximas ${ahead} semanas`, shareBps(planned.minutes, capacity * ahead) ?? 0, aheadPeriod),
      );
      if (planned.overdue > 0) rowMetrics.push(m.minutes(`capacity.${id}.overdue`, "De esa estimación, tareas ya vencidas", planned.overdue, ctx.today, "/projects/tasks"));
      if (planned.unestimated > 0) rowMetrics.push(m.count(`capacity.${id}.unestimated`, "Tareas suyas en ese plazo sin estimación (no suman)", planned.unestimated, aheadPeriod, "/projects/tasks"));
      const row: ToolRow = {
        subject: `member:${id}`,
        label: `${person.member.fullName} (${person.member.initials})`,
        href: "/projects",
        fields: { rol: person.member.role, registra_horas: person.tracked, sin_horas: person.tracked ? null : "Sin ningún registro de horas en el periodo: su carga no se conoce" },
        metrics: rowMetrics,
      };
      return { row, load };
    });
    // Primero quien más cargado va; al final, quien no registra horas.
    const rows = people.sort((a, b) => (b.load ?? -1) - (a.load ?? -1)).map((p) => p.row);

    const plannedCapacity = capacity * ahead * snapshot.people.length;
    metrics.push(m.minutes("capacity.team.planned", `Estimación de las tareas abiertas vencidas o con fecha ${plannedLabel}`, plannedTotal, aheadPeriod, "/projects/tasks"));
    if (plannedCapacity > 0) metrics.push(m.bps("capacity.team.planned_load", `Carga planificada del equipo en las próximas ${ahead} semanas`, shareBps(plannedTotal, plannedCapacity) ?? 0, aheadPeriod));
    if (unassigned.minutes > 0) metrics.push(m.minutes("capacity.team.unassigned", "De esa estimación, tareas sin asignar", unassigned.minutes, aheadPeriod, "/projects/tasks"));
    if (unestimatedTotal > 0) metrics.push(m.count("capacity.team.unestimated", "Tareas abiertas en ese plazo sin estimación (no suman)", unestimatedTotal, aheadPeriod, "/projects/tasks"));
    if (snapshot.inactiveMinutes > 0) metrics.push(m.minutes("capacity.inactive", "Horas de personas que ya no están activas (no cuentan)", snapshot.inactiveMinutes, period));

    const missingNames = untrackedNames(snapshot);
    const noHours = snapshot.team.people === 0;
    const notes = [
      "Las semanas van de lunes a domingo; la semana en curso no cuenta hasta que termina.",
      "La carga planificada suma la estimación de las tareas abiertas, sin descontar lo ya registrado en ellas.",
    ];
    if (!snapshot.capacity.fromSettings) notes.push("La capacidad semanal es un supuesto por defecto: si la org la fija en Ajustes (weekly_capacity_minutes), la carga es la suya.");
    if (missingNames.length > 0 && !noHours) notes.push("Quien no registra horas no cuenta en la carga del equipo, y sin sus horas la regla de contratar no se puede evaluar.");

    return {
      tool: "get_capacity",
      status: noHours ? "missing_data" : "ok",
      subject: "capacity",
      period: { from: snapshot.from, to: snapshot.to },
      source: "Horas registradas en Proyectos (time_entries: temporizador, a mano o importadas de GTiQ) y tareas abiertas con su estimación (project_tasks). Capacidad semanal por persona de orgs.settings.",
      href: "/projects",
      summary: noHours
        ? `Nadie ha registrado horas en las últimas ${n} semanas completas: no se puede medir la capacidad comprometida.`
        : `Carga media del equipo en las últimas ${n} semanas: ${formatMetricValue(snapshot.team.avgLoadBps ?? 0, "bps")} de su capacidad (${formatMetricValue(capacity, "minutes")} por persona y semana${snapshot.capacity.fromSettings ? "" : ", supuesto por defecto"}).`,
      metrics,
      rows,
      missing: noHours
        ? { what: `Horas registradas por socio en las últimas ${n} semanas`, needs: HOURS_NEEDS, href: "/projects" }
        : missingNames.length > 0
          ? { what: `Horas de ${missingNames.join(", ")}: sin registros en las últimas ${n} semanas, su carga no se conoce`, needs: HOURS_NEEDS, href: "/projects" }
          : null,
      notes,
    };
  },
});
