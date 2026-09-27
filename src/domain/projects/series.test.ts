import { describe, expect, it } from "vitest";
import { monthlyEconomics, sumBy, weekEnd, weekRange, weeklySeries, weekStart } from "./series";

describe("semanas", () => {
  it("de lunes a domingo", () => {
    expect(weekStart("2026-09-26")).toBe("2026-09-21"); // sábado → lunes
    expect(weekStart("2026-09-27")).toBe("2026-09-21"); // domingo → lunes anterior
    expect(weekStart("2026-09-21")).toBe("2026-09-21");
    expect(weekStart("2026-01-01")).toBe("2025-12-29"); // cruza el año
    expect(weekEnd("2026-09-23")).toBe("2026-09-27");
  });

  it("los lunes de las semanas que tocan el rango", () => {
    expect(weekRange("2026-09-02", "2026-09-16")).toEqual(["2026-08-31", "2026-09-07", "2026-09-14"]);
    expect(weekRange("2026-09-16", "2026-09-02")).toEqual([]);
  });
});

describe("horas por semana", () => {
  const entries = [
    { workedOn: "2026-08-20", minutes: 60 }, // antes del rango: solo cuenta en el acumulado
    { workedOn: "2026-09-01", minutes: 90 },
    { workedOn: "2026-09-03", minutes: 30 },
    { workedOn: "2026-09-15", minutes: 120 },
    { workedOn: "2026-10-01", minutes: 999 }, // después del rango: fuera
  ];

  it("suma por semana, con semanas vacías y el acumulado desde antes del rango", () => {
    expect(weeklySeries(entries, "2026-08-31", "2026-09-20")).toEqual([
      { week: "2026-08-31", minutes: 120, cumulativeMinutes: 180 },
      { week: "2026-09-07", minutes: 0, cumulativeMinutes: 180 },
      { week: "2026-09-14", minutes: 120, cumulativeMinutes: 300 },
    ]);
  });

  it("sin rango, sin serie", () => {
    expect(weeklySeries(entries, "2026-09-20", "2026-09-01")).toEqual([]);
  });

  it("suma por cualquier clave", () => {
    const byMember = sumBy(
      [
        { m: "a", minutes: 30 },
        { m: "b", minutes: 15 },
        { m: "a", minutes: 45 },
      ],
      (r) => r.m,
      (r) => r.minutes,
    );
    expect([...byMember]).toEqual([
      ["a", 75],
      ["b", 15],
    ]);
  });
});

describe("facturado frente a horas por mes", () => {
  const revenue = [
    { issuedOn: "2026-06-15", baseCents: 50_000 }, // antes del rango
    { issuedOn: "2026-07-02", baseCents: 100_000 },
    { issuedOn: "2026-08-02", baseCents: 100_000 },
    { issuedOn: "2026-08-20", baseCents: -20_000 }, // rectificativa
  ];
  const entries = [
    { workedOn: "2026-06-20", minutes: 600 },
    { workedOn: "2026-07-10", minutes: 1200 },
    { workedOn: "2026-09-01", minutes: 600 },
  ];

  it("acumula desde antes del rango y compara con lo que valen las horas al objetivo", () => {
    const points = monthlyEconomics(revenue, entries, { from: "2026-07-01", to: "2026-09-26" }, 6000);
    expect(points).toEqual([
      {
        month: "2026-07-01",
        revenueCents: 100_000,
        minutes: 1200,
        cumulativeRevenueCents: 150_000,
        cumulativeMinutes: 1800,
        cumulativeTargetCents: 180_000,
        cumulativeRateCents: 5000,
      },
      {
        month: "2026-08-01",
        revenueCents: 80_000,
        minutes: 0,
        cumulativeRevenueCents: 230_000,
        cumulativeMinutes: 1800,
        cumulativeTargetCents: 180_000,
        cumulativeRateCents: 7667,
      },
      {
        month: "2026-09-01",
        revenueCents: 0,
        minutes: 600,
        cumulativeRevenueCents: 230_000,
        cumulativeMinutes: 2400,
        cumulativeTargetCents: 240_000,
        cumulativeRateCents: 5750,
      },
    ]);
  });

  it("con un contrato compartido, la serie termina exactamente en la parte del proyecto", () => {
    const points = monthlyEconomics(revenue, entries, { from: "2026-07-01", to: "2026-09-26" }, 6000, { numerator: 1, denominator: 3 });
    expect(points.map((p) => p.cumulativeRevenueCents)).toEqual([50_000, 76_667, 76_667]); // 150.000 / 3 y 230.000 / 3
    // Lo de cada mes es la diferencia de los acumulados: sumado a la base (junio, 50.000 / 3), da el total.
    expect(points.map((p) => p.revenueCents)).toEqual([33_333, 26_667, 0]);
    expect(16_667 + points.reduce((sum, p) => sum + p.revenueCents, 0)).toBe(76_667);
  });

  it("sin horas no hay tarifa acumulada", () => {
    const [point] = monthlyEconomics(revenue, [], { from: "2026-07-01", to: "2026-07-31" }, 6000);
    expect(point!.cumulativeRateCents).toBeNull();
    expect(point!.cumulativeTargetCents).toBe(0);
  });
});
