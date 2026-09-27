import { describe, expect, it } from "vitest";
import {
  centMinutesToCents,
  costBook,
  costInForce,
  costMinuteCents,
  costStatus,
  hourlyCostOn,
  type MemberCost,
  minutesCostCents,
} from "./costs";

const LAIA = "laia";
const PAU = "pau";

const HISTORY: MemberCost[] = [
  // Desordenado a propósito: el libro lo ordena.
  { memberId: LAIA, validFrom: "2026-07-01", hourlyCostCents: 3200 },
  { memberId: PAU, validFrom: "2026-01-01", hourlyCostCents: 2600 },
  { memberId: LAIA, validFrom: "2026-01-01", hourlyCostCents: 2800 },
  { memberId: LAIA, validFrom: "2026-10-01", hourlyCostCents: 3500 },
];

describe("costBook y costInForce", () => {
  it("agrupa por miembro y ordena por fecha", () => {
    const book = costBook(HISTORY);
    expect(book.get(LAIA)!.map((r) => r.validFrom)).toEqual(["2026-01-01", "2026-07-01", "2026-10-01"]);
    expect(book.get(PAU)!.map((r) => r.hourlyCostCents)).toEqual([2600]);
  });

  it("vale el de la fecha más reciente que no pasa del día: el mismo día ya cuenta", () => {
    const laia = costBook(HISTORY).get(LAIA)!;
    expect(costInForce(laia, "2025-12-31")).toBeNull();
    expect(costInForce(laia, "2026-01-01")?.hourlyCostCents).toBe(2800);
    expect(costInForce(laia, "2026-06-30")?.hourlyCostCents).toBe(2800);
    expect(costInForce(laia, "2026-07-01")?.hourlyCostCents).toBe(3200);
    expect(costInForce(laia, "2026-09-30")?.hourlyCostCents).toBe(3200);
    expect(costInForce(laia, "2027-01-01")?.hourlyCostCents).toBe(3500);
  });

  it("sin coste propio ese día (o nunca), el de la org", () => {
    const book = costBook(HISTORY);
    expect(hourlyCostOn(book, LAIA, "2026-08-15", 3000)).toEqual({ cents: 3200, fromDefault: false });
    expect(hourlyCostOn(book, LAIA, "2025-06-01", 3000)).toEqual({ cents: 3000, fromDefault: true });
    expect(hourlyCostOn(book, "nadie", "2026-08-15", 3000)).toEqual({ cents: 3000, fromDefault: true });
  });

  it("un coste 0 es un coste (no cae al de la org)", () => {
    const book = costBook([{ memberId: PAU, validFrom: "2026-01-01", hourlyCostCents: 0 }]);
    expect(hourlyCostOn(book, PAU, "2026-02-01", 3000)).toEqual({ cents: 0, fromDefault: false });
  });

  it("rechaza fechas que no existen y costes negativos o con decimales", () => {
    expect(() => costBook([{ memberId: PAU, validFrom: "2026-02-30", hourlyCostCents: 100 }])).toThrow();
    expect(() => costBook([{ memberId: PAU, validFrom: "2026-02-01", hourlyCostCents: -1 }])).toThrow();
    expect(() => costBook([{ memberId: PAU, validFrom: "2026-02-01", hourlyCostCents: 10.5 }])).toThrow();
  });
});

describe("lo que cuestan unos minutos", () => {
  it("minutos × céntimos por hora ÷ 60, redondeado una sola vez (la mitad se aleja de cero)", () => {
    expect(minutesCostCents(60, 3500)).toBe(3500);
    expect(minutesCostCents(90, 3000)).toBe(4500);
    expect(minutesCostCents(1, 3000)).toBe(50);
    // 90 × 3333 / 60 = 4999,5 → 5000.
    expect(minutesCostCents(90, 3333)).toBe(5000);
    // 7 × 1001 / 60 = 116,78… → 117.
    expect(minutesCostCents(7, 1001)).toBe(117);
    expect(minutesCostCents(0, 3000)).toBe(0);
  });

  it("acumular céntimos-minuto y dividir al final no pierde céntimos por el camino", () => {
    // Tres registros de 1 minuto a 25 €/h: 41,67 céntimos cada uno. Sumados, 125 céntimos exactos.
    const acc = [1, 1, 1].reduce((sum, m) => sum + costMinuteCents(m, 2500), BigInt(0));
    expect(centMinutesToCents(acc)).toBe(125);
    expect(3 * minutesCostCents(1, 2500)).toBe(126);
  });

  it("rechaza minutos negativos o con decimales", () => {
    expect(() => costMinuteCents(-1, 3000)).toThrow();
    expect(() => costMinuteCents(1.5, 3000)).toThrow();
  });
});

describe("costStatus", () => {
  it("el vigente hoy y el próximo cambio programado", () => {
    const laia = costBook(HISTORY).get(LAIA)!;
    expect(costStatus(laia, "2026-09-26")).toEqual({
      current: { memberId: LAIA, validFrom: "2026-07-01", hourlyCostCents: 3200 },
      next: { memberId: LAIA, validFrom: "2026-10-01", hourlyCostCents: 3500 },
    });
    expect(costStatus(laia, "2025-01-01")).toEqual({ current: null, next: laia[0] });
    expect(costStatus(laia, "2026-12-01")).toEqual({ current: laia[2], next: null });
    expect(costStatus([], "2026-09-26")).toEqual({ current: null, next: null });
  });
});
