// Qué trabajos tocan ahora (CONSEJO.md §5): el briefing del lunes a las 8:00, el cierre mensual el
// día 5, el comercial cada mañana… en la zona horaria de la org. Puro e idempotente: cada trabajo
// lleva una clave por periodo (agente:disparador:periodo) y la cola no admite dos iguales, así que
// el cron se puede llamar cada hora; si un día falla, la siguiente llamada lo recupera.

import { addDays, parseCivilDate, type CivilDate } from "@/domain/dates/civil-date";
import { addMonths, monthOf } from "@/domain/metrics";
import { AGENTS } from "./agents";
import type { AgentSettingsRecord, NewJob } from "./store/types";
import { AGENT_NAMES } from "./types";

export type LocalNow = { date: CivilDate; hour: number; /** 1 = lunes … 7 = domingo */ weekday: number };

export function localNow(now: Date, timeZone: string): LocalNow {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) % 24, weekday: weekdays.indexOf(get("weekday")) + 1 };
}

/** Semana ISO de una fecha: `2026-W39`. */
export function isoWeekKey(date: CivilDate): string {
  const { year, month, day } = parseCivilDate(date);
  // El jueves de esa semana decide el año ISO; la semana 1 es la del 4 de enero.
  const thursday = new Date(Date.UTC(year, month - 1, day));
  thursday.setUTCDate(thursday.getUTCDate() - ((thursday.getUTCDay() + 6) % 7) + 3);
  const isoYear = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const days = (thursday.getTime() - jan4.getTime()) / 86_400_000;
  const week = 1 + Math.round((days - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/** Lunes y domingo de la semana de una fecha. */
export function weekRange(date: CivilDate): { from: CivilDate; to: CivilDate } {
  const { year, month, day } = parseCivilDate(date);
  const dow = (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
  const from = addDays(date, -dow);
  return { from, to: addDays(from, 6) };
}

/** Los trabajos programados que tocan ahora en una org (los agentes desactivados no se encolan). */
export function dueScheduledJobs(opts: { orgId: string; timeZone: string; now: Date; settings: readonly AgentSettingsRecord[] }): NewJob[] {
  const local = localNow(opts.now, opts.timeZone);
  const { day } = parseCivilDate(local.date);
  const jobs: NewJob[] = [];
  for (const name of AGENT_NAMES) {
    if (opts.settings.find((s) => s.agent === name)?.enabled === false) continue;
    for (const scheduled of AGENTS[name].schedules) {
      const s = scheduled.schedule;
      let period: string | null = null;
      if (s.kind === "daily" && local.hour >= s.hour) period = local.date;
      if (s.kind === "weekly" && (local.weekday > s.weekday || (local.weekday === s.weekday && local.hour >= s.hour))) period = isoWeekKey(local.date);
      if (s.kind === "monthly" && (day > s.day || (day === s.day && local.hour >= s.hour))) period = local.date.slice(0, 7);
      if (period === null) continue;
      const payload: Record<string, unknown> = { task: scheduled.task };
      if (scheduled.task === "monthly_close") payload.month = addMonths(monthOf(local.date), -1);
      jobs.push({ orgId: opts.orgId, agent: name, trigger: scheduled.trigger, payload, dedupeKey: `${name}:${scheduled.trigger}:${period}` });
    }
  }
  return jobs;
}
