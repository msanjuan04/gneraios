// Milestones of one-off lines (ARCHITECTURE.md §6.3 `contract_milestones`): 50/50, 40/30/30…
// Every milestone but the last bills round(base × percent) of each line; the last one bills
// what is left, so each line adds up to its base to the cent.

import { assertCents, divRoundHalfAwayFromZero, type Bps, type Cents } from "../money";

/** i18n keys (leaf names) for an invalid milestone plan. */
export type MilestonePlanError = "milestonesEmpty" | "milestonePercentInvalid" | "milestonesSumNot100";

const FULL_BPS = 10_000;

/**
 * Checks a milestone plan: at least one milestone, every percent a positive integer of basis
 * points, and all of them adding up to exactly 100 % (10 000). Returns the error key or null.
 */
export function validateMilestones(percents: readonly Bps[]): MilestonePlanError | null {
  if (percents.length === 0) return "milestonesEmpty";
  if (!percents.every((percent) => Number.isSafeInteger(percent) && percent > 0)) return "milestonePercentInvalid";
  return percents.reduce((sum, percent) => sum + percent, 0) === FULL_BPS ? null : "milestonesSumNot100";
}

function assertUniqueIds(items: ReadonlyArray<{ id: string }>, what: string): void {
  const ids = new Set(items.map((item) => item.id));
  if (ids.size !== items.length) throw new Error(`Hay ${what} con el id repetido.`);
}

/**
 * Amount of each line that each milestone bills, as { milestoneId: { lineId: cents } }.
 * Milestones go in plan order (by position): the last one gets the remainder. Throws if the
 * plan is not valid (see validateMilestones) or an id is repeated.
 */
export function splitByMilestones(
  lines: ReadonlyArray<{ id: string; baseCents: Cents }>,
  milestones: ReadonlyArray<{ id: string; percentBps: Bps }>,
): Record<string, Record<string, Cents>> {
  const error = validateMilestones(milestones.map((milestone) => milestone.percentBps));
  if (error !== null) throw new Error(`El plan de hitos no es válido: ${error}.`);
  assertUniqueIds(lines, "líneas");
  assertUniqueIds(milestones, "hitos");

  const shares = milestones.map((): [string, Cents][] => []);
  const lastIndex = milestones.length - 1;
  for (const line of lines) {
    const base = BigInt(assertCents(line.baseCents));
    let rest = base;
    milestones.forEach((milestone, index) => {
      const share =
        index === lastIndex ? rest : divRoundHalfAwayFromZero(base * BigInt(milestone.percentBps), BigInt(FULL_BPS));
      rest -= share;
      shares[index].push([line.id, assertCents(Number(share))]);
    });
  }
  // Object.fromEntries defines own properties, so no id (not even "__proto__") can misbehave.
  return Object.fromEntries(milestones.map((milestone, index) => [milestone.id, Object.fromEntries(shares[index])]));
}
