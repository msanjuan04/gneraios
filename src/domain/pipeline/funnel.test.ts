import { describe, expect, it } from "vitest";
import {
  cohort,
  computeCloseRates,
  computeConversion,
  computeTimeInStage,
  type DateRange,
  type FunnelDeal,
  funnelSequence,
  type FunnelStage,
  inDateRange,
  instantMs,
  type StageChange,
  summary,
  topLossReasons,
} from "./funnel";

// The seed stages of every org, deliberately out of order.
const STAGES: FunnelStage[] = [
  { id: "active", name: "Activo", position: 7, kind: "won" },
  { id: "lost", name: "Perdido", position: 6, kind: "lost" },
  { id: "proposal", name: "Propuesta enviada", position: 3, kind: "open" },
  { id: "lead", name: "Lead", position: 1, kind: "open" },
  { id: "won", name: "Ganado", position: 5, kind: "won" },
  { id: "meeting", name: "Reunión", position: 2, kind: "open" },
  { id: "negotiation", name: "Negociación", position: 4, kind: "open" },
];
const SEQUENCE = ["lead", "meeting", "proposal", "negotiation", "won"];

const DAY_MS = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);

/** ISO instant `days` (fractions allowed) after 2026-01-01T00:00:00Z. */
const at = (days: number) => new Date(T0 + Math.round(days * DAY_MS)).toISOString();
const range = (fromDay: number, toDay: number): DateRange => ({ from: at(fromDay), to: at(toDay) });

type Tracked = { deal: FunnelDeal; history: StageChange[] };

/**
 * A deal that went through `steps` ([stageId, day]): created on the first one and sitting in
 * the last one, with the history the trigger would have written.
 */
function tracked(id: string, steps: [string, number][], extra: Partial<FunnelDeal> = {}): Tracked {
  const history = steps.map(([stageId, day], i) => ({
    dealId: id,
    fromStageId: i === 0 ? null : steps[i - 1][0],
    toStageId: stageId,
    changedAt: at(day),
  }));
  return { deal: makeDeal(id, steps.at(-1)![0], steps[0][1], extra), history };
}

function makeDeal(id: string, stageId: string, createdDay: number, extra: Partial<FunnelDeal> = {}): FunnelDeal {
  return {
    id,
    createdAt: at(createdDay),
    stageId,
    sourceId: null,
    broughtById: null,
    ownerId: null,
    lossReasonId: null,
    estOneOffCents: 0,
    estMrrCents: 0,
    ...extra,
  };
}

function dataset(...items: Tracked[]): { deals: FunnelDeal[]; history: StageChange[] } {
  return { deals: items.map((i) => i.deal), history: items.flatMap((i) => i.history) };
}

const reachedOf = (rows: { reached: number }[]) => rows.map((r) => r.reached);

// A small pipeline covering every path through the funnel.
const PIPELINE = dataset(
  // Straight to won, and later active (a won-kind stage after Ganado).
  tracked("straight", [["lead", 0], ["meeting", 2], ["proposal", 5], ["negotiation", 9], ["won", 12], ["active", 40]]),
  // Lost after the proposal.
  tracked("lostAtProposal", [["lead", 1], ["meeting", 3], ["proposal", 6], ["lost", 8]], { lossReasonId: "price" }),
  // Created straight into the proposal: skipped Lead and Reunión.
  tracked("skipper", [["proposal", 2], ["won", 10]]),
  // Only the creation row.
  tracked("fresh", [["lead", 3]]),
  // Lost, reopened and won.
  tracked("reopened", [["lead", 4], ["lost", 5], ["lead", 20], ["negotiation", 25], ["won", 30]]),
  // Lost after the meeting.
  tracked("lostAtMeeting", [["meeting", 5], ["lost", 7]], { lossReasonId: "timing" }),
  // Created directly as lost (an import, say).
  tracked("bornLost", [["lost", 6]], { lossReasonId: "price" }),
);

describe("instantMs", () => {
  it("reads what Postgres sends, microseconds and all", () => {
    expect(instantMs("2026-09-26T10:17:43.123456+00:00")).toBe(Date.UTC(2026, 8, 26, 10, 17, 43, 123));
    expect(instantMs("2026-09-26 10:17:43.1+00")).toBe(Date.UTC(2026, 8, 26, 10, 17, 43, 100));
    expect(instantMs("2026-09-26T12:17:43+02:00")).toBe(Date.UTC(2026, 8, 26, 10, 17, 43));
    expect(instantMs("2026-09-26T12:17:43+0200")).toBe(Date.UTC(2026, 8, 26, 10, 17, 43));
    expect(instantMs("2026-09-26T10:17Z")).toBe(Date.UTC(2026, 8, 26, 10, 17));
    expect(instantMs("2026-09-26T10:17:43.000Z")).toBe(Date.UTC(2026, 8, 26, 10, 17, 43));
  });

  it("rejects anything that is not a real instant with an offset", () => {
    const invalid = [
      "", "hoy", "2026-09-26", "2026-09-26T10:17:43", "2026-02-30T00:00:00Z", "2026-13-01T00:00:00Z",
      "2026-09-26T24:00:00Z", "2026-09-26T10:60:00Z", "2026-09-26T10:17:60Z", "26/09/2026 10:17",
    ];
    for (const value of invalid) expect(() => instantMs(value), value).toThrow(/instante/);
  });
});

describe("date ranges", () => {
  it("include `from` and exclude `to`", () => {
    const r = range(10, 20);
    expect(inDateRange(at(10), r)).toBe(true);
    expect(inDateRange(at(19.999), r)).toBe(true);
    expect(inDateRange(at(20), r)).toBe(false);
    expect(inDateRange(at(9.999), r)).toBe(false);
    expect(inDateRange(at(-5000), null)).toBe(true);
  });

  it("pick the cohort by creation date", () => {
    const ids = (r: DateRange) => cohort(PIPELINE.deals, r).map((d) => d.id);
    expect(ids(null)).toHaveLength(7);
    expect(ids(range(2, 5))).toEqual(["skipper", "fresh", "reopened"]);
    expect(ids(range(100, 200))).toEqual([]);
    expect(ids(range(5, 5))).toEqual([]);
  });
});

describe("funnelSequence", () => {
  it("is the open stages by position followed by the first won stage", () => {
    expect(funnelSequence(STAGES).map((s) => s.id)).toEqual(SEQUENCE);
  });

  it("keeps open stages placed after the won ones and breaks position ties by id", () => {
    const stages: FunnelStage[] = [
      { id: "b", name: "B", position: 1, kind: "open" },
      { id: "a", name: "A", position: 1, kind: "open" },
      { id: "late-won", name: "Ganado 2", position: 4, kind: "won" },
      { id: "first-won", name: "Ganado", position: 2, kind: "won" },
      { id: "onboarding", name: "Onboarding", position: 9, kind: "open" },
    ];
    expect(funnelSequence(stages).map((s) => s.id)).toEqual(["a", "b", "onboarding", "first-won"]);
  });

  it("has no won step when there is no won stage", () => {
    expect(funnelSequence(STAGES.filter((s) => s.kind !== "won")).map((s) => s.id)).toEqual(SEQUENCE.slice(0, 4));
    expect(funnelSequence([])).toEqual([]);
  });
});

describe("computeConversion", () => {
  it("counts reaching a later stage as having passed the earlier ones", () => {
    const rows = computeConversion(STAGES, PIPELINE.deals, PIPELINE.history, null);
    expect(rows.map((r) => r.stageId)).toEqual(SEQUENCE);
    // lead: all but bornLost · meeting: not fresh · proposal: not lostAtMeeting · then the three winners.
    expect(reachedOf(rows)).toEqual([6, 5, 4, 3, 3]);
    expect(rows.map((r) => r.conversionToNext)).toEqual([5 / 6, 4 / 5, 3 / 4, 1, null]);
  });

  it("follows each kind of path", () => {
    const reached = (item: Tracked) => reachedOf(computeConversion(STAGES, [item.deal], item.history, null));
    // Skipped stages count as passed.
    expect(reached(tracked("x", [["proposal", 0]]))).toEqual([1, 1, 1, 0, 0]);
    // A lost deal counts up to the furthest stage it entered.
    expect(reached(tracked("x", [["lead", 0], ["meeting", 1], ["negotiation", 2], ["lost", 3]]))).toEqual([1, 1, 1, 1, 0]);
    // Lost, reopened and won counts all the way.
    expect(reached(tracked("x", [["lead", 0], ["lost", 1], ["lead", 2], ["won", 3]]))).toEqual([1, 1, 1, 1, 1]);
    // Won and later lost did reach Ganado.
    expect(reached(tracked("x", [["lead", 0], ["won", 1], ["lost", 2]]))).toEqual([1, 1, 1, 1, 1]);
    // Any won-kind stage counts as Ganado, even if the deal never passed through Ganado itself.
    expect(reached(tracked("x", [["meeting", 0], ["active", 5]]))).toEqual([1, 1, 1, 1, 1]);
    // Only the creation row.
    expect(reached(tracked("x", [["lead", 0]]))).toEqual([1, 0, 0, 0, 0]);
    // Created as lost: it never entered the funnel.
    expect(reached(tracked("x", [["lost", 0]]))).toEqual([0, 0, 0, 0, 0]);
  });

  it("falls back on the current stage and the `from` side when the history is incomplete", () => {
    const noHistory = makeDeal("x", "negotiation", 0);
    expect(reachedOf(computeConversion(STAGES, [noHistory], [], null))).toEqual([1, 1, 1, 1, 0]);

    // The creation row is missing, but the deal left from Reunión.
    const partial: StageChange[] = [{ dealId: "x", fromStageId: "meeting", toStageId: "lost", changedAt: at(3) }];
    expect(reachedOf(computeConversion(STAGES, [makeDeal("x", "lost", 0)], partial, null))).toEqual([1, 1, 0, 0, 0]);
  });

  it("ignores stages it does not know and history of other deals", () => {
    const deal = makeDeal("x", "archived", 0);
    const history: StageChange[] = [
      { dealId: "x", fromStageId: null, toStageId: "meeting", changedAt: at(0) },
      { dealId: "x", fromStageId: "meeting", toStageId: "archived", changedAt: at(1) },
      { dealId: "someone-else", fromStageId: null, toStageId: "won", changedAt: at(0) },
    ];
    expect(reachedOf(computeConversion(STAGES, [deal], history, null))).toEqual([1, 1, 0, 0, 0]);
  });

  it("measures the cohort created in the range, whenever the stages happened", () => {
    // Created on days 2-4: skipper, fresh, reopened (which was won on day 30, outside the range).
    const rows = computeConversion(STAGES, PIPELINE.deals, PIPELINE.history, range(2, 5));
    expect(reachedOf(rows)).toEqual([3, 2, 2, 2, 2]);
    expect(rows.map((r) => r.conversionToNext)).toEqual([2 / 3, 1, 1, 1, null]);
  });

  it("leaves the conversion empty when nobody reached the stage", () => {
    const rows = computeConversion(STAGES, PIPELINE.deals, PIPELINE.history, range(100, 200));
    expect(reachedOf(rows)).toEqual([0, 0, 0, 0, 0]);
    expect(rows.map((r) => r.conversionToNext)).toEqual([null, null, null, null, null]);
    expect(computeConversion(STAGES, [], [], null).map((r) => r.conversionToNext)).toEqual([null, null, null, null, null]);
    expect(computeConversion([], PIPELINE.deals, PIPELINE.history, null)).toEqual([]);
  });

  it("has no won step without a won stage", () => {
    const open = STAGES.filter((s) => s.kind !== "won");
    const rows = computeConversion(open, PIPELINE.deals, PIPELINE.history, null);
    expect(rows.map((r) => r.stageId)).toEqual(SEQUENCE.slice(0, 4));
    // Winners now count only up to the open stages they entered: skipper never saw Negociación.
    expect(reachedOf(rows)).toEqual([6, 5, 4, 2]);
  });
});

describe("computeTimeInStage", () => {
  it("measures every finished stint and leaves the open ones out", () => {
    const rows = computeTimeInStage(STAGES, PIPELINE.history);
    expect(rows).toEqual([
      // straight 2 · lostAtProposal 2 · reopened 1 and 5 (it was in Lead twice).
      { stageId: "lead", avgDays: 2.5, medianDays: 2, samples: 4 },
      // straight 3 · lostAtProposal 3 · lostAtMeeting 2.
      { stageId: "meeting", avgDays: 2.7, medianDays: 3, samples: 3 },
      // straight 4 · lostAtProposal 2 · skipper 8.
      { stageId: "proposal", avgDays: 4.7, medianDays: 4, samples: 3 },
      // straight 3 · reopened 5.
      { stageId: "negotiation", avgDays: 4, medianDays: 4, samples: 2 },
      // straight, until it became active.
      { stageId: "won", avgDays: 28, medianDays: 28, samples: 1 },
      // reopened, until it was reopened.
      { stageId: "lost", avgDays: 15, medianDays: 15, samples: 1 },
      { stageId: "active", avgDays: null, medianDays: null, samples: 0 },
    ]);
  });

  it("rounds days to one decimal, half up", () => {
    const stint = (hours: number) =>
      computeTimeInStage(STAGES, tracked("x", [["lead", 0], ["meeting", hours / 24]]).history)[0];
    expect(stint(27)).toMatchObject({ avgDays: 1.1, medianDays: 1.1 }); // 1.125
    expect(stint(30)).toMatchObject({ avgDays: 1.3, medianDays: 1.3 }); // 1.25
    expect(stint(1)).toMatchObject({ avgDays: 0, medianDays: 0 }); // 0.04
    expect(stint(2.4)).toMatchObject({ avgDays: 0.1 }); // 0.1 exactly
    expect(stint(0)).toMatchObject({ avgDays: 0, samples: 1 });

    // Mean and median of 1, 2 and 2.5 days: 1.8333… and 2.
    const history = [
      ...tracked("a", [["lead", 0], ["meeting", 1]]).history,
      ...tracked("b", [["lead", 0], ["meeting", 2]]).history,
      ...tracked("c", [["lead", 0], ["meeting", 2.5]]).history,
    ];
    expect(computeTimeInStage(STAGES, history)[0]).toEqual({ stageId: "lead", avgDays: 1.8, medianDays: 2, samples: 3 });
    // With an even number of stints the median is the mean of the middle two: 1.5 and 2.25.
    const even = [...history, ...tracked("d", [["lead", 0], ["meeting", 0.25]]).history];
    expect(computeTimeInStage(STAGES, even)[0]).toMatchObject({ medianDays: 1.5, samples: 4 });
  });

  it("has no samples for skipped stages or deals with only their creation row", () => {
    const history = [...tracked("x", [["lead", 0], ["negotiation", 3]]).history, ...tracked("y", [["meeting", 1]]).history];
    const samples = Object.fromEntries(computeTimeInStage(STAGES, history).map((r) => [r.stageId, r.samples]));
    expect(samples).toEqual({ lead: 1, meeting: 0, proposal: 0, negotiation: 0, won: 0, lost: 0, active: 0 });
  });

  it("sorts each deal's changes by time, whatever the input order", () => {
    const history = tracked("x", [["lead", 0], ["meeting", 1], ["proposal", 4]]).history.reverse();
    expect(computeTimeInStage(STAGES, history).slice(0, 2)).toEqual([
      { stageId: "lead", avgDays: 1, medianDays: 1, samples: 1 },
      { stageId: "meeting", avgDays: 3, medianDays: 3, samples: 1 },
    ]);
  });

  it("does not trust stints the next change does not leave from", () => {
    const history: StageChange[] = [
      { dealId: "x", fromStageId: null, toStageId: "lead", changedAt: at(0) },
      // The move Lead → Reunión is missing: the time until day 5 belongs to nobody we know.
      { dealId: "x", fromStageId: "meeting", toStageId: "proposal", changedAt: at(5) },
      { dealId: "x", fromStageId: "proposal", toStageId: "won", changedAt: at(7) },
    ];
    const samples = computeTimeInStage(STAGES, history).map((r) => [r.stageId, r.samples]);
    expect(samples.slice(0, 3)).toEqual([["lead", 0], ["meeting", 0], ["proposal", 1]]);
  });

  it("keeps a stint going when a change re-enters the same stage", () => {
    const history: StageChange[] = [
      { dealId: "x", fromStageId: null, toStageId: "lead", changedAt: at(0) },
      { dealId: "x", fromStageId: "lead", toStageId: "lead", changedAt: at(1) },
      { dealId: "x", fromStageId: "lead", toStageId: "meeting", changedAt: at(3) },
    ];
    expect(computeTimeInStage(STAGES, history)[0]).toEqual({ stageId: "lead", avgDays: 3, medianDays: 3, samples: 1 });
  });

  it("ignores unknown stages and returns every known one when there is no data", () => {
    const history = tracked("x", [["archived", 0], ["lead", 2], ["meeting", 3]]).history;
    const rows = computeTimeInStage(STAGES, history);
    expect(rows.find((r) => r.stageId === "lead")).toEqual({ stageId: "lead", avgDays: 1, medianDays: 1, samples: 1 });
    expect(rows).toHaveLength(7);

    expect(computeTimeInStage(STAGES, [])).toEqual(
      ["lead", "meeting", "proposal", "negotiation", "won", "lost", "active"].map((stageId) => ({
        stageId,
        avgDays: null,
        medianDays: null,
        samples: 0,
      })),
    );
    expect(computeTimeInStage([], PIPELINE.history)).toEqual([]);
  });
});

// Closes around a range from day 9 (inclusive) to day 31 (exclusive).
const CLOSES = dataset(
  // Won on day 10 and active later: one win, dated when it entered Ganado.
  tracked("c1", [["lead", 0], ["won", 10], ["active", 40]], {
    sourceId: "web", broughtById: "m1", ownerId: "m2", estOneOffCents: 150_000, estMrrCents: 35_000,
  }),
  tracked("c2", [["lead", 1], ["lost", 12]], {
    sourceId: "web", broughtById: "m1", ownerId: "m1", lossReasonId: "price", estOneOffCents: 999_999,
  }),
  // Won before the range.
  tracked("c3", [["lead", 2], ["won", 5]], { sourceId: "seo", broughtById: "m2", estOneOffCents: 70_000 }),
  // Lost inside the range but reopened: open today, so not closed.
  tracked("c4", [["lead", 3], ["lost", 15], ["lead", 18]], { sourceId: "web", broughtById: "m2" }),
  // Lost before the range, reopened and won inside it.
  tracked("c5", [["lead", 4], ["lost", 8], ["meeting", 11], ["won", 20]], { broughtById: "m1", estMrrCents: 50_000 }),
  // Won before the range and lost inside it: a loss.
  tracked("c6", [["lead", 5], ["won", 9], ["lost", 25]], { sourceId: "seo", broughtById: "m2", lossReasonId: "timing" }),
  // Lost after the range.
  tracked("c7", [["lead", 20], ["lost", 35]], { sourceId: "seo", lossReasonId: "price" }),
  // Created long before and won right at the start of the range.
  tracked("c8", [["lead", -30], ["won", 9]], { sourceId: "web", broughtById: "m1", estOneOffCents: 200_000 }),
  // Won right at the end of the range, which is excluded.
  tracked("c9", [["lead", 0], ["won", 31]], { sourceId: "web" }),
  // Still open.
  tracked("c10", [["lead", 12], ["negotiation", 14]], { sourceId: "seo" }),
);
const IN_RANGE = range(9, 31);

describe("computeCloseRates", () => {
  it("groups the deals closed in the range by source", () => {
    expect(computeCloseRates(CLOSES.deals, CLOSES.history, STAGES, IN_RANGE, "source")).toEqual([
      { key: "web", won: 2, lost: 1, rate: 2 / 3 }, // c1, c8 · c2
      { key: null, won: 1, lost: 0, rate: 1 }, // c5
      { key: "seo", won: 0, lost: 1, rate: 0 }, // c6
    ]);
  });

  it("groups by the member who brought the deal or by its owner", () => {
    expect(computeCloseRates(CLOSES.deals, CLOSES.history, STAGES, IN_RANGE, "broughtBy")).toEqual([
      { key: "m1", won: 3, lost: 1, rate: 0.75 },
      { key: "m2", won: 0, lost: 1, rate: 0 },
    ]);
    expect(computeCloseRates(CLOSES.deals, CLOSES.history, STAGES, IN_RANGE, "owner")).toEqual([
      { key: null, won: 2, lost: 1, rate: 2 / 3 },
      { key: "m2", won: 1, lost: 0, rate: 1 },
      { key: "m1", won: 0, lost: 1, rate: 0 },
    ]);
  });

  it("counts every deal closed today when there is no range", () => {
    expect(computeCloseRates(CLOSES.deals, CLOSES.history, STAGES, null, "source")).toEqual([
      { key: "web", won: 3, lost: 1, rate: 0.75 }, // c1, c8, c9 · c2
      { key: "seo", won: 1, lost: 2, rate: 1 / 3 }, // c3 · c6, c7
      { key: null, won: 1, lost: 0, rate: 1 }, // c5
    ]);
  });

  it("dates a close by the entry into Ganado, not by the later move to Activo", () => {
    const item = tracked("x", [["lead", 0], ["won", 5], ["active", 12]]);
    expect(computeCloseRates([item.deal], item.history, STAGES, range(4, 6), "source")).toEqual([
      { key: null, won: 1, lost: 0, rate: 1 },
    ]);
    expect(computeCloseRates([item.deal], item.history, STAGES, range(10, 20), "source")).toEqual([]);
  });

  it("only places a close it can date", () => {
    const undated = makeDeal("x", "won", 0);
    expect(computeCloseRates([undated], [], STAGES, null, "owner")).toEqual([{ key: null, won: 1, lost: 0, rate: 1 }]);
    expect(computeCloseRates([undated], [], STAGES, range(-100, 100), "owner")).toEqual([]);
    // The history ends in an open stage although the deal is won: the close is not in it.
    const stale = { ...tracked("y", [["lead", 0], ["won", 2], ["meeting", 3]]), deal: makeDeal("y", "won", 0) };
    expect(computeCloseRates([stale.deal], stale.history, STAGES, range(-100, 100), "owner")).toEqual([]);
  });

  it("is empty without closed deals", () => {
    expect(computeCloseRates([], [], STAGES, null, "source")).toEqual([]);
    const open = tracked("x", [["lead", 0], ["meeting", 1]]);
    expect(computeCloseRates([open.deal], open.history, STAGES, null, "source")).toEqual([]);
  });
});

describe("topLossReasons", () => {
  it("counts the deals lost in the range that are still lost", () => {
    expect(topLossReasons(CLOSES.deals, CLOSES.history, STAGES, IN_RANGE, 5)).toEqual([
      { reasonId: "price", count: 1 },
      { reasonId: "timing", count: 1 },
    ]);
    expect(topLossReasons(CLOSES.deals, CLOSES.history, STAGES, null, 5)).toEqual([
      { reasonId: "price", count: 2 }, // c2, c7
      { reasonId: "timing", count: 1 }, // c6
    ]);
  });

  it("sorts by count, keeps deals without a reason and applies the limit", () => {
    const lost = (id: string, reason: string | null, day: number) =>
      tracked(id, [["lead", 0], ["lost", day]], { lossReasonId: reason });
    const data = dataset(
      lost("a", "timing", 1), lost("b", "timing", 2), lost("c", "timing", 3),
      lost("d", null, 4), lost("e", null, 5), lost("f", "competition", 6), lost("g", "price", 7),
    );
    expect(topLossReasons(data.deals, data.history, STAGES, null, 10)).toEqual([
      { reasonId: "timing", count: 3 },
      { reasonId: null, count: 2 },
      { reasonId: "competition", count: 1 },
      { reasonId: "price", count: 1 },
    ]);
    expect(topLossReasons(data.deals, data.history, STAGES, null, 2)).toEqual([
      { reasonId: "timing", count: 3 },
      { reasonId: null, count: 2 },
    ]);
    expect(topLossReasons(data.deals, data.history, STAGES, null, 1.9)).toEqual([{ reasonId: "timing", count: 3 }]);
    expect(topLossReasons(data.deals, data.history, STAGES, null, 0)).toEqual([]);
    expect(topLossReasons(data.deals, data.history, STAGES, null, -1)).toEqual([]);
    expect(topLossReasons(data.deals, data.history, STAGES, range(3, 6), 10)).toEqual([
      { reasonId: null, count: 2 },
      { reasonId: "timing", count: 1 },
    ]);
  });

  it("is empty without losses", () => {
    expect(topLossReasons([], [], STAGES, null, 5)).toEqual([]);
    const won = tracked("x", [["lead", 0], ["lost", 1], ["won", 2]], { lossReasonId: "price" });
    expect(topLossReasons([won.deal], won.history, STAGES, null, 5)).toEqual([]);
  });
});

describe("summary", () => {
  it("counts the cohort by creation and the closes by close date, keeping amounts apart", () => {
    expect(summary(CLOSES.deals, CLOSES.history, STAGES, IN_RANGE)).toEqual({
      created: 2, // c7, c10
      won: 3, // c1, c5, c8
      lost: 2, // c2, c6
      closeRate: 0.6,
      wonOneOffCents: 350_000, // c1 + c8
      wonMrrCents: 85_000, // c1 + c5
    });
    expect(summary(CLOSES.deals, CLOSES.history, STAGES, null)).toEqual({
      created: 10,
      won: 5, // c1, c3, c5, c8, c9
      lost: 3, // c2, c6, c7
      closeRate: 5 / 8,
      wonOneOffCents: 420_000,
      wonMrrCents: 85_000,
    });
  });

  it("has no close rate when nothing closed", () => {
    const empty = { created: 0, won: 0, lost: 0, closeRate: null, wonOneOffCents: 0, wonMrrCents: 0 };
    expect(summary([], [], STAGES, null)).toEqual(empty);
    expect(summary(CLOSES.deals, CLOSES.history, STAGES, range(100, 200))).toEqual(empty);
    const open = tracked("x", [["lead", 0]]);
    expect(summary([open.deal], open.history, STAGES, null)).toEqual({ ...empty, created: 1 });
  });

  it("rejects amounts that are not integer cents", () => {
    const item = tracked("x", [["lead", 0], ["won", 1]], { estOneOffCents: 10.5 });
    expect(() => summary([item.deal], item.history, STAGES, null)).toThrow(/céntimos/);
  });
});
