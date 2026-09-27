import { describe, expect, it } from "vitest";
import {
  customPeriod,
  DEFAULT_PERIOD_KIND,
  isPeriodInProgress,
  MAX_RANGE_DAYS,
  monthPeriod,
  parsePeriodValue,
  type Period,
  periodAnchor,
  periodOfKind,
  periodParams,
  periodQuery,
  quarterPeriod,
  readPeriod,
  rollingPeriod,
  shiftPeriod,
  yearPeriod,
} from "./period";
import { addDays } from "../dates/civil-date";

const TODAY = "2026-09-26";

describe("periodos", () => {
  it("los últimos 3 y 12 meses acaban hoy y empiezan el día siguiente al de hace 3 o 12 meses", () => {
    expect(rollingPeriod(TODAY, 3)).toEqual({ kind: "last3m", from: "2026-06-27", to: "2026-09-26" });
    expect(rollingPeriod(TODAY, 12)).toEqual({ kind: "last12m", from: "2025-09-27", to: "2026-09-26" });
    // Fin de mes: hace 3 meses del 31 de mayo es el 28 de febrero.
    expect(rollingPeriod("2026-05-31", 3)).toEqual({ kind: "last3m", from: "2026-03-01", to: "2026-05-31" });
  });

  it("meses, trimestres y años naturales, con sus dos extremos", () => {
    expect(monthPeriod(2028, 2)).toEqual({ kind: "month", from: "2028-02-01", to: "2028-02-29" });
    expect(quarterPeriod(2026, 1)).toEqual({ kind: "quarter", from: "2026-01-01", to: "2026-03-31" });
    expect(quarterPeriod(2026, 2)).toEqual({ kind: "quarter", from: "2026-04-01", to: "2026-06-30" });
    expect(quarterPeriod(2026, 4)).toEqual({ kind: "quarter", from: "2026-10-01", to: "2026-12-31" });
    expect(yearPeriod(2026)).toEqual({ kind: "year", from: "2026-01-01", to: "2026-12-31" });
  });

  it("lee el valor de la URL; lo que no es válido o empieza en el futuro, null", () => {
    expect(parsePeriodValue("2026-09", TODAY)).toEqual(monthPeriod(2026, 9));
    expect(parsePeriodValue("2026-Q3", TODAY)).toEqual(quarterPeriod(2026, 3));
    expect(parsePeriodValue("2026-t2", TODAY)).toEqual(quarterPeriod(2026, 2));
    expect(parsePeriodValue("2025", TODAY)).toEqual(yearPeriod(2025));
    expect(parsePeriodValue("last12m", TODAY)).toEqual(rollingPeriod(TODAY, 12));
    expect(parsePeriodValue("last3m", TODAY)).toEqual(rollingPeriod(TODAY, 3));
    for (const bad of ["", "2026-13", "2026-00", "2026-Q5", "1999", "3000", "abc", "2026-9", "2026-10", "2026-Q4", "2027"]) {
      expect(parsePeriodValue(bad, TODAY), bad).toBeNull();
    }
  });

  it("un rango a medida: fechas reales, en orden, de 3 años como mucho y que no empieza en el futuro", () => {
    expect(customPeriod("2026-01-15", "2026-03-31", TODAY)).toEqual({ kind: "custom", from: "2026-01-15", to: "2026-03-31" });
    expect(customPeriod("2026-03-31", "2026-03-31", TODAY)).not.toBeNull();
    // Puede acabar en el futuro (hoy aún no ha acabado el trimestre).
    expect(customPeriod("2026-07-01", "2026-12-31", TODAY)).not.toBeNull();
    expect(customPeriod("2026-03-31", "2026-01-15", TODAY)).toBeNull();
    expect(customPeriod("2026-02-30", "2026-03-31", TODAY)).toBeNull();
    expect(customPeriod("2026-09-27", "2026-12-31", TODAY)).toBeNull();
    expect(customPeriod("1999-12-31", "2000-01-31", TODAY)).toBeNull();
    expect(customPeriod("2020-01-01", addDays("2020-01-01", MAX_RANGE_DAYS - 1), TODAY)).not.toBeNull();
    expect(customPeriod("2020-01-01", addDays("2020-01-01", MAX_RANGE_DAYS), TODAY)).toBeNull();
    expect(customPeriod("", "", TODAY)).toBeNull();
  });

  it("readPeriod: sin nada, los últimos 12 meses; el rango manda sobre ?period=; lo que no se entiende, por defecto", () => {
    expect(readPeriod({}, TODAY)).toEqual(rollingPeriod(TODAY, 12));
    expect(DEFAULT_PERIOD_KIND).toBe("last12m");
    expect(readPeriod({ period: "2026-Q2" }, TODAY)).toEqual(quarterPeriod(2026, 2));
    expect(readPeriod({ period: ["2026-08", "2026-07"] }, TODAY)).toEqual(monthPeriod(2026, 8));
    expect(readPeriod({ period: "2026", from: "2026-02-01", to: "2026-02-15" }, TODAY)).toEqual({
      kind: "custom",
      from: "2026-02-01",
      to: "2026-02-15",
    });
    // Un rango mal escrito cae al ?period= y, si tampoco, al de por defecto.
    expect(readPeriod({ period: "2026", from: "2026-02-15", to: "2026-02-01" }, TODAY)).toEqual(yearPeriod(2026));
    expect(readPeriod({ period: "nunca", from: "2026-02-15" }, TODAY)).toEqual(rollingPeriod(TODAY, 12));
  });

  it("la URL de cada periodo lo vuelve a dar (ida y vuelta)", () => {
    const periods: Period[] = [
      rollingPeriod(TODAY, 3),
      rollingPeriod(TODAY, 12),
      monthPeriod(2026, 9),
      quarterPeriod(2025, 4),
      yearPeriod(2026),
      { kind: "custom", from: "2026-01-15", to: "2026-03-31" },
    ];
    for (const period of periods) expect(readPeriod(periodParams(period), TODAY)).toEqual(period);
    expect(periodQuery(rollingPeriod(TODAY, 12))).toBe("");
    expect(periodQuery(rollingPeriod(TODAY, 3))).toBe("?period=last3m");
    expect(periodQuery(quarterPeriod(2026, 3))).toBe("?period=2026-Q3");
    expect(periodQuery({ kind: "custom", from: "2026-01-15", to: "2026-03-31" })).toBe("?from=2026-01-15&to=2026-03-31");
  });

  it("← → mueve meses, trimestres y años, sin pasar al futuro; los demás no se mueven", () => {
    expect(shiftPeriod(monthPeriod(2026, 1), -1, TODAY)).toEqual(monthPeriod(2025, 12));
    expect(shiftPeriod(monthPeriod(2026, 8), 1, TODAY)).toEqual(monthPeriod(2026, 9));
    expect(shiftPeriod(monthPeriod(2026, 9), 1, TODAY)).toBeNull();
    expect(shiftPeriod(quarterPeriod(2026, 1), -1, TODAY)).toEqual(quarterPeriod(2025, 4));
    expect(shiftPeriod(quarterPeriod(2026, 2), 1, TODAY)).toEqual(quarterPeriod(2026, 3));
    expect(shiftPeriod(quarterPeriod(2026, 3), 1, TODAY)).toBeNull();
    expect(shiftPeriod(yearPeriod(2025), 1, TODAY)).toEqual(yearPeriod(2026));
    expect(shiftPeriod(yearPeriod(2026), 1, TODAY)).toBeNull();
    expect(shiftPeriod(yearPeriod(2000), -1, TODAY)).toBeNull();
    expect(shiftPeriod(rollingPeriod(TODAY, 3), -1, TODAY)).toBeNull();
    expect(shiftPeriod({ kind: "custom", from: "2026-01-01", to: "2026-01-31" }, -1, TODAY)).toBeNull();
  });

  it("en curso: hoy cae dentro y aún no ha acabado", () => {
    expect(isPeriodInProgress(monthPeriod(2026, 9), TODAY)).toBe(true);
    expect(isPeriodInProgress(monthPeriod(2026, 8), TODAY)).toBe(false);
    expect(isPeriodInProgress(monthPeriod(2026, 9), "2026-09-30")).toBe(false);
    expect(isPeriodInProgress(rollingPeriod(TODAY, 3), TODAY)).toBe(false);
  });

  it("al cambiar de tipo se ancla en el último día del periodo (sin pasar de hoy)", () => {
    const q2 = quarterPeriod(2026, 2);
    expect(periodAnchor(q2, TODAY)).toBe("2026-06-30");
    expect(periodOfKind("month", periodAnchor(q2, TODAY), TODAY)).toEqual(monthPeriod(2026, 6));
    expect(periodOfKind("year", periodAnchor(q2, TODAY), TODAY)).toEqual(yearPeriod(2026));
    expect(periodOfKind("quarter", periodAnchor(yearPeriod(2026), TODAY), TODAY)).toEqual(quarterPeriod(2026, 3));
    expect(periodOfKind("last12m", "2020-01-01", TODAY)).toEqual(rollingPeriod(TODAY, 12));
    expect(periodOfKind("custom", "2026-06-30", TODAY, q2)).toEqual({ kind: "custom", from: q2.from, to: q2.to });
  });
});
