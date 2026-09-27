import { describe, expect, it } from "vitest";
import {
  aggregateEconomics,
  attributedRevenueCents,
  budgetBurn,
  effectiveRateCents,
  projectEconomics,
  rateStanding,
  rateVsTargetBps,
} from "./economics";

const TARGET = 6000; // 60 €/h

describe("tarifa efectiva", () => {
  it("facturado entre horas, en céntimos por hora y redondeado", () => {
    expect(effectiveRateCents(300_000, 50 * 60)).toBe(6000); // 3.000 € en 50 h → 60 €/h
    expect(effectiveRateCents(100_000, 7 * 60)).toBe(14_286); // 1.000 € / 7 h = 142,857… → 142,86
    expect(effectiveRateCents(1, 120)).toBe(1); // 0,5 céntimos/h: la mitad se aleja de cero
    expect(effectiveRateCents(-100_000, 60)).toBe(-100_000);
  });

  it("sin horas no hay tarifa", () => {
    expect(effectiveRateCents(100_000, 0)).toBeNull();
    expect(effectiveRateCents(100_000, -5)).toBeNull();
  });

  it("verde en el objetivo o por encima, ámbar desde el 80 %, rojo por debajo", () => {
    expect(rateStanding(6000, TARGET)).toBe("good");
    expect(rateStanding(9000, TARGET)).toBe("good");
    expect(rateStanding(5999, TARGET)).toBe("warning");
    expect(rateStanding(4800, TARGET)).toBe("warning");
    expect(rateStanding(4799, TARGET)).toBe("bad");
    expect(rateStanding(0, TARGET)).toBe("bad");
    expect(rateStanding(null, TARGET)).toBe("none");
    expect(rateStanding(5000, 0)).toBe("none");
    expect(rateStanding(5000, TARGET, 9000)).toBe("bad");
  });

  it("frente al objetivo en puntos básicos", () => {
    expect(rateVsTargetBps(7200, TARGET)).toBe(12_000);
    expect(rateVsTargetBps(3000, TARGET)).toBe(5000);
    expect(rateVsTargetBps(null, TARGET)).toBeNull();
  });
});

describe("presupuesto de horas", () => {
  it("sin presupuesto no hay consumo", () => {
    expect(budgetBurn(600, null)).toEqual({ ratio: null, remainingMinutes: null, state: "none" });
    expect(budgetBurn(600, 0).state).toBe("none");
  });

  it("aviso desde el 80 % y pasado por encima del 100 %", () => {
    expect(budgetBurn(0, 600)).toEqual({ ratio: 0, remainingMinutes: 600, state: "ok" });
    expect(budgetBurn(479, 600).state).toBe("ok");
    expect(budgetBurn(480, 600).state).toBe("warning");
    expect(budgetBurn(600, 600).state).toBe("warning");
    expect(budgetBurn(601, 600)).toEqual({ ratio: 601 / 600, remainingMinutes: -1, state: "over" });
  });
});

describe("contrato compartido", () => {
  it("con el contrato para él solo, todo lo facturado es suyo", () => {
    expect(attributedRevenueCents({ contractRevenueCents: 500_000, projectMinutes: 600, contractMinutes: 600, contractProjects: 1 })).toBe(500_000);
  });

  it("si lo comparte, se reparte por horas; sin horas, a partes iguales", () => {
    const share = { contractRevenueCents: 300_000, contractMinutes: 900, contractProjects: 2 };
    const a = attributedRevenueCents({ ...share, projectMinutes: 600 });
    const b = attributedRevenueCents({ ...share, projectMinutes: 300 });
    expect([a, b]).toEqual([200_000, 100_000]);
    expect(attributedRevenueCents({ ...share, contractMinutes: 0, projectMinutes: 0, contractProjects: 3 })).toBe(100_000);
  });

  it("todos los proyectos del contrato tienen la misma tarifa, la del contrato entero", () => {
    const share = { contractId: "c1", contractRevenueCents: 100_000, contractMinutes: 7 * 60, contractProjects: 2 };
    const a = projectEconomics({ ...share, projectMinutes: 5 * 60 }, TARGET);
    const b = projectEconomics({ ...share, projectMinutes: 2 * 60 }, TARGET);
    expect(a.rateCents).toBe(14_286);
    expect(b.rateCents).toBe(14_286);
    expect(a.shared && b.shared).toBe(true);
    expect(a.standing).toBe("good");
    // La suma de las partes es lo facturado (±1 céntimo de redondeo).
    expect(Math.abs(a.revenueCents! + b.revenueCents! - 100_000)).toBeLessThanOrEqual(1);
  });

  it("sin contrato no hay facturado ni tarifa; sin horas, tampoco tarifa", () => {
    expect(projectEconomics({ contractId: null, contractRevenueCents: 0, projectMinutes: 600, contractMinutes: 0, contractProjects: 0 }, TARGET)).toEqual({
      revenueCents: null,
      rateCents: null,
      standing: "none",
      shared: false,
    });
    const idle = projectEconomics({ contractId: "c1", contractRevenueCents: 50_000, projectMinutes: 0, contractMinutes: 0, contractProjects: 1 }, TARGET);
    expect(idle).toEqual({ revenueCents: 50_000, rateCents: null, standing: "none", shared: false });
  });

  it("un contrato con horas y nada facturado todavía va en rojo (0 €/h)", () => {
    const e = projectEconomics({ contractId: "c1", contractRevenueCents: 0, projectMinutes: 600, contractMinutes: 600, contractProjects: 1 }, TARGET);
    expect(e.rateCents).toBe(0);
    expect(e.standing).toBe("bad");
  });
});

describe("rentabilidad de un cliente", () => {
  it("cada contrato cuenta una vez; las horas de todos sus proyectos, también las de los que no tienen contrato", () => {
    const result = aggregateEconomics(
      [
        { contractId: "c1", contractRevenueCents: 300_000, loggedMinutes: 1200 },
        { contractId: "c1", contractRevenueCents: 300_000, loggedMinutes: 600 },
        { contractId: "c2", contractRevenueCents: 60_000, loggedMinutes: 600 },
        { contractId: null, contractRevenueCents: 0, loggedMinutes: 600 },
      ],
      TARGET,
    );
    expect(result).toEqual({ revenueCents: 360_000, minutes: 3000, rateCents: 7200, standing: "good" });
  });

  it("sin horas, sin tarifa", () => {
    expect(aggregateEconomics([], TARGET)).toEqual({ revenueCents: 0, minutes: 0, rateCents: null, standing: "none" });
  });
});
