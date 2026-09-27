import { describe, expect, it } from "vitest";
import {
  customPeriod,
  isPeriodInProgress,
  LIFETIME_FROM,
  lifetimePeriod,
  MAX_RANGE_DAYS,
  parsePeriodValue,
  periodAnchor,
  periodOfKind,
  periodParams,
  periodQuery,
  readPeriod,
  shiftPeriod,
} from "./period";
import { daysBetween } from "../dates/civil-date";

const TODAY = "2026-09-27";

describe("desde siempre", () => {
  it("de la primera factura o el primer coste a hoy; sin saberla aún, desde el primer día posible", () => {
    expect(lifetimePeriod(TODAY, "2019-03-12")).toEqual({ kind: "all", from: "2019-03-12", to: TODAY });
    expect(lifetimePeriod(TODAY)).toEqual({ kind: "all", from: LIFETIME_FROM, to: TODAY });
    // Sin nada todavía (o una fecha imposible): solo hoy.
    expect(lifetimePeriod(TODAY, null)).toEqual({ kind: "all", from: TODAY, to: TODAY });
    expect(lifetimePeriod(TODAY, "2027-01-01")).toEqual({ kind: "all", from: TODAY, to: TODAY });
    expect(lifetimePeriod(TODAY, "1999-12-31")).toEqual({ kind: "all", from: TODAY, to: TODAY });
  });

  it("viaja en la URL como ?period=all (ida y vuelta)", () => {
    expect(parsePeriodValue("all", TODAY)).toEqual(lifetimePeriod(TODAY));
    expect(readPeriod({ period: "all" }, TODAY)).toEqual(lifetimePeriod(TODAY));
    expect(periodParams(lifetimePeriod(TODAY, "2019-03-12"))).toEqual({ period: "all" });
    expect(periodQuery(lifetimePeriod(TODAY, "2019-03-12"))).toBe("?period=all");
    expect(readPeriod(periodParams(lifetimePeriod(TODAY, "2019-03-12")), TODAY).kind).toBe("all");
  });

  it("no se mueve con ← →, no está «en curso» y al cambiar de tipo se ancla en hoy", () => {
    const all = lifetimePeriod(TODAY, "2019-03-12");
    expect(shiftPeriod(all, -1, TODAY)).toBeNull();
    expect(isPeriodInProgress(all, TODAY)).toBe(false);
    expect(periodAnchor(all, TODAY)).toBe(TODAY);
    expect(periodOfKind("all", "2026-06-30", TODAY)).toEqual(lifetimePeriod(TODAY));
  });

  it("de desde siempre a un rango a medida: los últimos 3 años, que es lo más largo que admite", () => {
    const custom = periodOfKind("custom", TODAY, TODAY, lifetimePeriod(TODAY, "2019-03-12"));
    expect(custom.to).toBe(TODAY);
    expect(daysBetween(custom.from, custom.to)).toBe(MAX_RANGE_DAYS - 1);
    expect(customPeriod(custom.from, custom.to, TODAY)).toEqual(custom);
    // Uno corto no cambia.
    expect(periodOfKind("custom", TODAY, TODAY, { from: "2026-08-01", to: "2026-08-31" })).toEqual({
      kind: "custom",
      from: "2026-08-01",
      to: "2026-08-31",
    });
  });
});
