// Objetivos de los socios (orgs.settings.goals): un MRR a una fecha y una facturación del año.
// El progreso se deriva de las mismas cifras del dashboard; aquí no se guarda nada.

import { addMonthsClamped, type CivilDate, compareCivil, parseCivilDate } from "../dates/civil-date";
import type { MonthRevenue } from "./revenue";

export type MrrGoal = { targetCents: number; by: CivilDate };
export type RevenueGoal = { targetCents: number; year: number };
export type Goals = { mrr: MrrGoal | null; revenueYear: RevenueGoal | null };

const CIVIL = /^\d{4}-\d{2}-\d{2}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const positiveCents = (value: unknown) => (typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null);

/** Lo que haya en `orgs.settings.goals`; un objetivo incompleto o raro, como si no estuviera. */
export function readGoals(orgSettings: unknown): Goals {
  const raw = isObject(orgSettings) && isObject(orgSettings.goals) ? orgSettings.goals : {};
  const mrrTarget = positiveCents(raw.mrr_target_cents);
  const mrrBy = typeof raw.mrr_target_by === "string" && CIVIL.test(raw.mrr_target_by) ? raw.mrr_target_by : null;
  const revenueTarget = positiveCents(raw.revenue_year_target_cents);
  const year = typeof raw.revenue_year === "number" && Number.isInteger(raw.revenue_year) ? raw.revenue_year : null;
  return {
    mrr: mrrTarget !== null && mrrBy !== null ? { targetCents: mrrTarget, by: mrrBy } : null,
    revenueYear: revenueTarget !== null && year !== null && year >= 2000 && year <= 2100 ? { targetCents: revenueTarget, year } : null,
  };
}

/** Meses naturales que quedan de `today` a `by`, contando el de `by` si aún no ha acabado (0 si ya pasó). */
export function monthsLeft(today: CivilDate, by: CivilDate): number {
  if (compareCivil(by, today) < 0) return 0;
  const a = parseCivilDate(today);
  const b = parseCivilDate(by);
  return (b.year - a.year) * 12 + (b.month - a.month) + (b.day >= a.day ? 1 : 0);
}

export type GoalStatus = "reached" | "on_track" | "behind" | "missed";

export type MrrGoalProgress = MrrGoal & {
  currentCents: number;
  /** Progreso en puntos básicos (10.000 = objetivo cumplido); puede pasar de 10.000. */
  progressBps: number;
  monthsLeft: number;
  /** MRR neto nuevo que hace falta cada mes para llegar a tiempo (null si ya se ha llegado o no queda tiempo). */
  neededPerMonthCents: number | null;
  /** Ritmo de los últimos meses: variación media de MRR al mes. */
  paceCents: number;
  /** A ese ritmo, el mes en que se llegaría (null si el ritmo no crece). */
  projectedMonth: CivilDate | null;
  status: GoalStatus;
};

/**
 * Progreso del objetivo de MRR. `sparkline`: MRR al cierre de cada mes (el último, hoy); el ritmo
 * es la variación media de los últimos `paceMonths` meses.
 */
export function mrrGoalProgress(
  goal: MrrGoal,
  currentCents: number,
  sparkline: readonly { cents: number }[],
  today: CivilDate,
  paceMonths = 3,
): MrrGoalProgress {
  const left = monthsLeft(today, goal.by);
  const gap = goal.targetCents - currentCents;
  const window = sparkline.slice(-(paceMonths + 1));
  const paceCents = window.length >= 2 ? Math.round((window[window.length - 1]!.cents - window[0]!.cents) / (window.length - 1)) : 0;
  const progressBps = goal.targetCents > 0 ? Math.round((currentCents / goal.targetCents) * 10_000) : 0;

  // El mes en curso cuenta como uno de crecimiento (igual que en monthsLeft): con n meses de ritmo,
  // se llega en el mes en curso + n − 1.
  let projectedMonth: CivilDate | null = null;
  if (gap <= 0) projectedMonth = `${today.slice(0, 7)}-01`;
  else if (paceCents > 0) projectedMonth = addMonthsClamped(`${today.slice(0, 7)}-01`, Math.ceil(gap / paceCents) - 1);

  const neededPerMonthCents = gap > 0 && left > 0 ? Math.ceil(gap / left) : null;
  let status: GoalStatus;
  if (gap <= 0) status = "reached";
  else if (left === 0) status = "missed";
  else status = paceCents >= (neededPerMonthCents ?? 0) ? "on_track" : "behind";

  return { ...goal, currentCents, progressBps, monthsLeft: left, neededPerMonthCents, paceCents, projectedMonth, status };
}

export type RevenueGoalProgress = RevenueGoal & {
  /** Facturado en el año (base sin IVA, las rectificativas restan), hasta hoy. */
  invoicedCents: number;
  /** Lo que los contratos firmados facturarán aún este año (previsión del cron). */
  signedCents: number;
  projectedCents: number;
  /** Lo que falta por vender para llegar, contando lo firmado. */
  gapCents: number;
  progressBps: number;
  projectedBps: number;
  status: GoalStatus;
};

type ForecastLike = { month: CivilDate; recurringCents: number; oneOffCents: number };

/** Progreso del objetivo de facturación del año: lo facturado más lo que ya está firmado. */
export function revenueGoalProgress(
  goal: RevenueGoal,
  history: readonly MonthRevenue[],
  forecast: readonly ForecastLike[],
  today: CivilDate,
): RevenueGoalProgress {
  const prefix = `${goal.year}-`;
  const invoicedCents = history
    .filter((m) => m.month.startsWith(prefix))
    .reduce((sum, m) => sum + m.recurringCents + m.usageCents + m.oneOffCents, 0);
  const signedCents = forecast
    .filter((m) => m.month.startsWith(prefix))
    .reduce((sum, m) => sum + m.recurringCents + m.oneOffCents, 0);
  const projectedCents = invoicedCents + signedCents;
  const gapCents = Math.max(0, goal.targetCents - projectedCents);
  const yearOver = Number(today.slice(0, 4)) > goal.year;
  let status: GoalStatus;
  if (invoicedCents >= goal.targetCents) status = "reached";
  else if (yearOver) status = "missed";
  else status = projectedCents >= goal.targetCents ? "on_track" : "behind";
  return {
    ...goal,
    invoicedCents,
    signedCents,
    projectedCents,
    gapCents,
    progressBps: Math.round((invoicedCents / goal.targetCents) * 10_000),
    projectedBps: Math.round((projectedCents / goal.targetCents) * 10_000),
    status,
  };
}
