import { describe, expect, it } from "vitest";
import {
  addQuarters,
  estimateVatQuarter,
  estimateWithholdingsQuarter,
  nextDueQuarter,
  quarterEnd,
  quarterKey,
  quarterOf,
  quarterStart,
  quartersDueBetween,
  taxPaymentDueOn,
} from "./tax";

describe("trimestres y plazos", () => {
  it("cada fecha en su trimestre", () => {
    expect(quarterOf("2026-01-01")).toEqual({ year: 2026, quarter: 1 });
    expect(quarterOf("2026-09-30")).toEqual({ year: 2026, quarter: 3 });
    expect(quarterOf("2026-10-01")).toEqual({ year: 2026, quarter: 4 });
    expect(quarterStart({ year: 2026, quarter: 3 })).toBe("2026-07-01");
    expect(quarterEnd({ year: 2026, quarter: 4 })).toBe("2026-12-31");
    expect(addQuarters({ year: 2026, quarter: 4 }, 1)).toEqual({ year: 2027, quarter: 1 });
    expect(addQuarters({ year: 2026, quarter: 1 }, -1)).toEqual({ year: 2025, quarter: 4 });
    expect(quarterKey({ year: 2026, quarter: 3 })).toBe("2026-Q3");
  });

  it("20 de abril, julio y octubre y 30 de enero; en fin de semana, el lunes siguiente", () => {
    expect(taxPaymentDueOn({ year: 2026, quarter: 1 })).toBe("2026-04-20");
    expect(taxPaymentDueOn({ year: 2026, quarter: 2 })).toBe("2026-07-20");
    expect(taxPaymentDueOn({ year: 2026, quarter: 3 })).toBe("2026-10-20");
    // 30/01/2027 es sábado.
    expect(taxPaymentDueOn({ year: 2026, quarter: 4 })).toBe("2027-02-01");
    // 20/07/2025 es domingo; 30/01/2026, viernes.
    expect(taxPaymentDueOn({ year: 2025, quarter: 2 })).toBe("2025-07-21");
    expect(taxPaymentDueOn({ year: 2025, quarter: 4 })).toBe("2026-01-30");
  });

  it("qué plazos caen en un periodo y cuál toca pagar ahora", () => {
    expect(quartersDueBetween("2026-09-26", "2026-12-25")).toEqual([{ year: 2026, quarter: 3 }]);
    expect(quartersDueBetween("2026-10-20", "2027-04-20")).toEqual([
      { year: 2026, quarter: 3 },
      { year: 2026, quarter: 4 },
      { year: 2027, quarter: 1 },
    ]);
    expect(quartersDueBetween("2026-10-21", "2026-12-31")).toEqual([]);
    expect(nextDueQuarter("2026-09-26")).toEqual({ year: 2026, quarter: 3 });
    expect(nextDueQuarter("2026-10-05")).toEqual({ year: 2026, quarter: 3 });
    expect(nextDueQuarter("2026-10-21")).toEqual({ year: 2026, quarter: 4 });
    expect(nextDueQuarter("2027-01-25")).toEqual({ year: 2026, quarter: 4 });
  });
});

describe("estimaciones", () => {
  const q3 = { year: 2026, quarter: 3 as const };

  it("IVA por emisor: repercutido − soportado deducible; un resultado negativo no resta a otro emisor", () => {
    const estimate = estimateVatQuarter(
      q3,
      [
        { issuerId: "sl", on: "2026-07-01", cents: 210_000 },
        { issuerId: "sl", on: "2026-09-01", cents: -21_000 }, // rectificativa
        { issuerId: "sl", on: "2026-09-28", cents: 10_500, forecast: true },
        { issuerId: "laia", on: "2026-08-01", cents: 5_000 },
        { issuerId: "sl", on: "2026-10-01", cents: 999_999 }, // otro trimestre
      ],
      [
        { issuerId: "sl", on: "2026-08-01", cents: 40_000 },
        { issuerId: "laia", on: "2026-07-15", cents: 12_000 },
      ],
    );
    expect(estimate).toMatchObject({ from: "2026-07-01", to: "2026-09-30", dueOn: "2026-10-20", payableCents: 159_500 });
    expect(estimate.issuers).toEqual([
      {
        issuerId: "laia",
        outputVatCents: 5_000,
        inputVatCents: 12_000,
        forecastOutputVatCents: 0,
        forecastInputVatCents: 0,
        resultCents: -7_000,
        payableCents: 0,
      },
      {
        issuerId: "sl",
        outputVatCents: 199_500,
        inputVatCents: 40_000,
        forecastOutputVatCents: 10_500,
        forecastInputVatCents: 0,
        resultCents: 159_500,
        payableCents: 159_500,
      },
    ]);
  });

  it("retenciones practicadas por emisor en el trimestre", () => {
    const estimate = estimateWithholdingsQuarter(q3, [
      { issuerId: "sl", on: "2026-07-01", cents: 15_000 },
      { issuerId: "sl", on: "2026-09-30", cents: 15_200, forecast: true },
      { issuerId: "sl", on: "2026-06-30", cents: 99_000 },
      { issuerId: "laia", on: "2026-08-01", cents: 0 },
    ]);
    expect(estimate).toEqual({
      quarter: q3,
      from: "2026-07-01",
      to: "2026-09-30",
      dueOn: "2026-10-20",
      issuers: [{ issuerId: "sl", withheldCents: 30_200, forecastCents: 15_200 }],
      totalCents: 30_200,
    });
  });
});
