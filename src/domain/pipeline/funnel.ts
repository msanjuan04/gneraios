// Pipeline funnel analytics (ARCHITECTURE.md §7.9): pure functions over plain rows of
// `pipeline_stages`, `deals` and `deal_stage_history`.
//
// Definitions, shared by every function below:
// - Funnel sequence: the open stages by position, then the first won stage by position
//   (Lead → Reunión → Propuesta enviada → Negociación → Ganado).
// - Reach: a deal reached a sequence stage if it ever entered that stage or any later one,
//   because getting further implies having passed the earlier ones. Every won-kind stage
//   (Ganado, Activo…) counts as the won step; lost stages add nothing, so a lost deal counts
//   up to the furthest sequence stage it entered. The deal's current stage and the `from`
//   side of its changes also count as entered, in case the history is incomplete.
// - Cohort: the deals created within the range (conversion; time in stage is computed over
//   whatever history the caller passes, usually the cohort's).
// - Close: the change that put the deal into its current outcome, i.e. the first change of
//   the final run of changes into stages of the deal's current kind (won or lost). Moving
//   Ganado → Activo is not a second close, and a deal lost and then reopened is only closed
//   again when it reaches won or lost once more. Close rates, loss reasons and the summary
//   go by close date; deals that are open today are not closed.

import { assertCents, type Cents } from "../money";

export type StageKind = "open" | "won" | "lost";

export type FunnelStage = { id: string; name: string; position: number; kind: StageKind };

export type FunnelDeal = {
  id: string;
  /** ISO instant. */
  createdAt: string;
  stageId: string;
  sourceId: string | null;
  broughtById: string | null;
  ownerId: string | null;
  lossReasonId: string | null;
  estOneOffCents: Cents;
  estMrrCents: Cents;
};

export type StageChange = {
  dealId: string;
  fromStageId: string | null;
  toStageId: string;
  /** ISO instant. */
  changedAt: string;
};

/** ISO instants: `from` inclusive, `to` exclusive. `null` means all time. */
export type DateRange = { from: string; to: string } | null;

export type StageConversion = {
  stageId: string;
  /** Cohort deals that reached this stage or a later one. */
  reached: number;
  /** reached(next) / reached(this), 0..1; null for the last stage or when nobody reached this one. */
  conversionToNext: number | null;
};

export type StageTime = {
  stageId: string;
  /** Mean length of the finished stints in the stage, in days rounded to 1 decimal. */
  avgDays: number | null;
  medianDays: number | null;
  /** Finished stints measured. */
  samples: number;
};

export type CloseRateGroupBy = "source" | "broughtBy" | "owner";

export type CloseRate = {
  /** Source or member id; null groups the deals without one. */
  key: string | null;
  won: number;
  lost: number;
  /** won / (won + lost), 0..1. */
  rate: number;
};

export type LossReasonCount = { reasonId: string | null; count: number };

export type FunnelSummary = {
  /** Deals created in the range. */
  created: number;
  /** Deals won / lost in the range, by close date. */
  won: number;
  lost: number;
  /** won / (won + lost); null when nothing closed. */
  closeRate: number | null;
  /** Estimated amounts of the deals won in the range. One-off and recurring never add up. */
  wonOneOffCents: Cents;
  wonMrrCents: Cents;
};

const DAY_MS = 86_400_000;
const TENTH_OF_DAY_MS = DAY_MS / 10;

// ---------------------------------------------------------------------------
// Instants and ranges
// ---------------------------------------------------------------------------

// Postgres sends microseconds and "+00:00"; ECMAScript only guarantees parsing milliseconds.
const ISO_INSTANT = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?(Z|[+-]\d{2}(?::?\d{2})?)$/i;

/** Milliseconds since the epoch of an ISO 8601 instant with an explicit offset. Throws if invalid. */
export function instantMs(value: string): number {
  const match = ISO_INSTANT.exec(value.trim());
  if (match) {
    const [, year, month, day, hour, minute, second = "00", fraction = "", zone] = match;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    const realDate =
      date.getUTCFullYear() === Number(year) &&
      date.getUTCMonth() === Number(month) - 1 &&
      date.getUTCDate() === Number(day);
    if (realDate && Number(hour) <= 23 && Number(minute) <= 59 && Number(second) <= 59) {
      const millis = fraction.padEnd(3, "0").slice(0, 3);
      const ms = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}.${millis}${normalizeOffset(zone)}`);
      if (!Number.isNaN(ms)) return ms;
    }
  }
  throw new Error(`El instante no es una fecha ISO válida: «${value}».`);
}

function normalizeOffset(zone: string): string {
  if (zone.toUpperCase() === "Z") return "Z";
  const digits = zone.slice(1).replace(":", "");
  return `${zone[0]}${digits.slice(0, 2)}:${digits.slice(2, 4) || "00"}`;
}

type MsRange = { from: number; to: number } | null;

function msRange(range: DateRange): MsRange {
  return range === null ? null : { from: instantMs(range.from), to: instantMs(range.to) };
}

function inMsRange(ms: number, range: MsRange): boolean {
  return range === null || (ms >= range.from && ms < range.to);
}

/** True if the instant falls in the range (from inclusive, to exclusive); always true for null. */
export function inDateRange(instant: string, range: DateRange): boolean {
  return inMsRange(instantMs(instant), msRange(range));
}

/** The deals created within the range. */
export function cohort<D extends Pick<FunnelDeal, "createdAt">>(deals: readonly D[], range: DateRange): D[] {
  const r = msRange(range);
  return deals.filter((deal) => inMsRange(instantMs(deal.createdAt), r));
}

// ---------------------------------------------------------------------------
// Stages and history
// ---------------------------------------------------------------------------

function compareStages(a: FunnelStage, b: FunnelStage): number {
  return a.position - b.position || compareKeys(a.id, b.id);
}

/** Ascending, with null last. */
function compareKeys(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

/** The open stages by position, then the first won stage by position. */
export function funnelSequence(stages: readonly FunnelStage[]): FunnelStage[] {
  const sorted = [...stages].sort(compareStages);
  const won = sorted.find((stage) => stage.kind === "won");
  const open = sorted.filter((stage) => stage.kind === "open");
  return won ? [...open, won] : open;
}

function kindsById(stages: readonly FunnelStage[]): Map<string, StageKind> {
  return new Map(stages.map((stage) => [stage.id, stage.kind]));
}

type TimedChange = StageChange & { ms: number };

/** Each deal's changes, oldest first. Changes at the same instant keep their input order. */
function changesByDeal(history: readonly StageChange[]): Map<string, TimedChange[]> {
  const byDeal = new Map<string, TimedChange[]>();
  for (const change of history) {
    let changes = byDeal.get(change.dealId);
    if (!changes) {
      changes = [];
      byDeal.set(change.dealId, changes);
    }
    changes.push({ ...change, ms: instantMs(change.changedAt) });
  }
  for (const changes of byDeal.values()) changes.sort((a, b) => a.ms - b.ms);
  return byDeal;
}

type Closing = { outcome: "won" | "lost"; /** Close instant; null if the history does not show it. */ at: number | null };

function closingOf(deal: FunnelDeal, changes: readonly TimedChange[] | undefined, kinds: Map<string, StageKind>): Closing | null {
  const outcome = kinds.get(deal.stageId);
  if (outcome !== "won" && outcome !== "lost") return null;
  let at: number | null = null;
  for (let i = (changes?.length ?? 0) - 1; i >= 0; i--) {
    const change = changes![i];
    if (kinds.get(change.toStageId) !== outcome) break;
    at = change.ms;
  }
  return { outcome, at };
}

/** A close without a date only counts when there is no range to place it in. */
function closedIn(closing: Closing, range: MsRange): boolean {
  return range === null || (closing.at !== null && inMsRange(closing.at, range));
}

/** The deals whose close falls in the range, with their outcome. */
function closedDeals(
  deals: readonly FunnelDeal[],
  history: readonly StageChange[],
  stages: readonly FunnelStage[],
  range: DateRange,
): { deal: FunnelDeal; outcome: Closing["outcome"] }[] {
  const kinds = kindsById(stages);
  const byDeal = changesByDeal(history);
  const r = msRange(range);
  const closed: { deal: FunnelDeal; outcome: Closing["outcome"] }[] = [];
  for (const deal of deals) {
    const closing = closingOf(deal, byDeal.get(deal.id), kinds);
    if (closing && closedIn(closing, r)) closed.push({ deal, outcome: closing.outcome });
  }
  return closed;
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/** How many cohort deals reached each stage of the funnel sequence, and the step-to-step conversion. */
export function computeConversion(
  stages: readonly FunnelStage[],
  deals: readonly FunnelDeal[],
  history: readonly StageChange[],
  range: DateRange,
): StageConversion[] {
  const sequence = funnelSequence(stages);
  const last = sequence.length - 1;
  const wonIndex = last >= 0 && sequence[last].kind === "won" ? last : -1;
  const kinds = kindsById(stages);
  const indexOf = new Map(sequence.map((stage, index) => [stage.id, index]));
  const stepOf = (stageId: string | null): number => {
    if (stageId === null) return -1;
    return indexOf.get(stageId) ?? (kinds.get(stageId) === "won" ? wonIndex : -1);
  };

  const byDeal = changesByDeal(history);
  const reached = sequence.map(() => 0);
  for (const deal of cohort(deals, range)) {
    let furthest = stepOf(deal.stageId);
    for (const change of byDeal.get(deal.id) ?? []) {
      furthest = Math.max(furthest, stepOf(change.toStageId), stepOf(change.fromStageId));
    }
    for (let step = 0; step <= furthest; step++) reached[step]++;
  }

  return sequence.map((stage, index) => ({
    stageId: stage.id,
    reached: reached[index],
    conversionToNext: index === last || reached[index] === 0 ? null : reached[index + 1] / reached[index],
  }));
}

/**
 * Time spent in each stage: from entering it to the deal's next change. Stints still open are
 * left out, and so are those the history cannot vouch for (the next change does not leave from
 * that stage). One entry per stage, by position.
 */
export function computeTimeInStage(stages: readonly FunnelStage[], history: readonly StageChange[]): StageTime[] {
  const durations = new Map<string, number[]>(stages.map((stage) => [stage.id, []]));
  for (const changes of changesByDeal(history).values()) {
    let current: TimedChange | null = null;
    for (const change of changes) {
      if (current !== null) {
        // Entering the stage it is already in does not end the stint.
        if (change.toStageId === current.toStageId) continue;
        if (change.fromStageId === current.toStageId) durations.get(current.toStageId)?.push(change.ms - current.ms);
      }
      current = change;
    }
  }

  return [...stages].sort(compareStages).map((stage) => {
    const stints = durations.get(stage.id) ?? [];
    return {
      stageId: stage.id,
      avgDays: stints.length > 0 ? roundDays(stints.reduce((sum, ms) => sum + ms, 0) / stints.length) : null,
      medianDays: stints.length > 0 ? roundDays(median(stints)) : null,
      samples: stints.length,
    };
  });
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Milliseconds → days with 1 decimal, half up (durations are never negative). */
function roundDays(ms: number): number {
  return Math.round(ms / TENTH_OF_DAY_MS) / 10;
}

/**
 * Close rate per source, per member who brought the deal or per owner, over the deals closed in
 * the range. Groups with more closed deals come first.
 */
export function computeCloseRates(
  deals: readonly FunnelDeal[],
  history: readonly StageChange[],
  stages: readonly FunnelStage[],
  range: DateRange,
  groupBy: CloseRateGroupBy,
): CloseRate[] {
  const groups = new Map<string | null, { won: number; lost: number }>();
  for (const { deal, outcome } of closedDeals(deals, history, stages, range)) {
    const key = groupBy === "source" ? deal.sourceId : groupBy === "broughtBy" ? deal.broughtById : deal.ownerId;
    const group = groups.get(key) ?? { won: 0, lost: 0 };
    group[outcome]++;
    groups.set(key, group);
  }
  return [...groups]
    .map(([key, { won, lost }]) => ({ key, won, lost, rate: won / (won + lost) }))
    .sort((a, b) => b.won + b.lost - (a.won + a.lost) || b.won - a.won || compareKeys(a.key, b.key));
}

/** The most frequent loss reasons of the deals that are lost today and were lost in the range. */
export function topLossReasons(
  deals: readonly FunnelDeal[],
  history: readonly StageChange[],
  stages: readonly FunnelStage[],
  range: DateRange,
  limit: number,
): LossReasonCount[] {
  const counts = new Map<string | null, number>();
  for (const { deal, outcome } of closedDeals(deals, history, stages, range)) {
    if (outcome === "lost") counts.set(deal.lossReasonId, (counts.get(deal.lossReasonId) ?? 0) + 1);
  }
  return [...counts]
    .map(([reasonId, count]) => ({ reasonId, count }))
    .sort((a, b) => b.count - a.count || compareKeys(a.reasonId, b.reasonId))
    .slice(0, Math.max(0, Math.floor(limit)));
}

/** Headline figures: deals created in the range, and deals won and lost in it by close date. */
export function summary(
  deals: readonly FunnelDeal[],
  history: readonly StageChange[],
  stages: readonly FunnelStage[],
  range: DateRange,
): FunnelSummary {
  let won = 0;
  let lost = 0;
  let oneOff = BigInt(0);
  let mrr = BigInt(0);
  for (const { deal, outcome } of closedDeals(deals, history, stages, range)) {
    if (outcome === "lost") {
      lost++;
      continue;
    }
    won++;
    oneOff += BigInt(assertCents(deal.estOneOffCents));
    mrr += BigInt(assertCents(deal.estMrrCents));
  }
  return {
    created: cohort(deals, range).length,
    won,
    lost,
    closeRate: won + lost > 0 ? won / (won + lost) : null,
    wonOneOffCents: assertCents(Number(oneOff)),
    wonMrrCents: assertCents(Number(mrr)),
  };
}
