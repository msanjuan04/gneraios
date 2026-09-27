import { describe, expect, it } from "vitest";
import { ageBucket, bankingDigest, monthProgress } from "./digest";
import { reconciliationStatus, remainingCents } from "./status";

describe("cifras del banco", () => {
  const today = "2026-09-26";
  const movements = [
    { bookedOn: "2026-09-25", amountCents: 45_000, remainingCents: 45_000, status: "unmatched" as const },
    { bookedOn: "2026-09-20", amountCents: -8_640, remainingCents: 8_640, status: "unmatched" as const },
    { bookedOn: "2026-09-02", amountCents: 100_000, remainingCents: 4_600, status: "partial" as const },
    { bookedOn: "2026-07-20", amountCents: -184_320, remainingCents: 184_320, status: "unmatched" as const },
    { bookedOn: "2026-09-10", amountCents: -2_000, remainingCents: 0, status: "reconciled" as const },
    { bookedOn: "2026-09-05", amountCents: -15_000, remainingCents: 15_000, status: "ignored" as const },
  ];

  it("lo pendiente por antigüedad: entradas y salidas sin explicar y su efecto neto", () => {
    const digest = bankingDigest(movements, today);
    expect(digest.pending).toEqual({ count: 4, creditsCents: 49_600, debitsCents: 192_960, netCents: 49_600 - 192_960 });
    expect(digest.byAge.map((b) => [b.bucket, b.totals.count])).toEqual([
      ["0-7", 2],
      ["8-30", 1],
      ["31-90", 1],
      ["90+", 0],
    ]);
    expect(digest.oldestPendingOn).toBe("2026-07-20");
    expect(ageBucket("2026-06-01", today)).toBe("90+");
  });

  it("el mes: cuántos movimientos están explicados (conciliados o ignorados)", () => {
    expect(monthProgress(movements, "2026-09")).toEqual({ total: 5, explained: 2, reconciled: 1, ignored: 1 });
  });

  it("estado y pendiente de un movimiento", () => {
    expect(reconciliationStatus({ amountCents: -3_000, matchedCents: 0, ignored: false })).toBe("unmatched");
    expect(reconciliationStatus({ amountCents: -3_000, matchedCents: 2_000, ignored: false })).toBe("partial");
    expect(reconciliationStatus({ amountCents: -3_000, matchedCents: 3_000, ignored: false })).toBe("reconciled");
    expect(reconciliationStatus({ amountCents: 3_000, matchedCents: 0, ignored: true })).toBe("ignored");
    expect(remainingCents({ amountCents: -3_000, matchedCents: 2_000 })).toBe(1_000);
  });
});
