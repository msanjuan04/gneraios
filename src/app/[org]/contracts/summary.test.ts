import { describe, expect, it } from "vitest";
import {
  contractSummary,
  currentPause,
  defaultVersionFrom,
  lineNextBillingOn,
  milestoneAmounts,
  potentialMrrCents,
  recommendedEndOn,
  resumePlan,
  type SummaryLine,
  upcomingPause,
} from "./summary";

const line = (patch: Partial<SummaryLine> = {}): SummaryLine => ({
  billingType: "monthly",
  quantity: 1,
  unitPriceCents: 15_000,
  discountBps: 0,
  startsOn: "2026-01-01",
  endsOn: null,
  billingDay: 1,
  prorateFirst: true,
  pauses: [],
  ...patch,
});

const TODAY = "2026-09-26";

describe("resumen de un contrato", () => {
  it("MRR = mensuales + anuales / 12 activas hoy; lo puntual y el uso van aparte", () => {
    const summary = contractSummary(
      [
        line(),
        line({ billingType: "yearly", unitPriceCents: 120_000, billingDay: null }),
        line({ billingType: "one_off", unitPriceCents: 300_000, quantity: 2, discountBps: 1000, startsOn: null }),
        line({ billingType: "usage", unitPriceCents: 37_500, startsOn: null }),
        // Terminada y en pausa: no cuentan.
        line({ endsOn: "2026-06-30" }),
        line({ pauses: [{ startsOn: "2026-09-01", endsOn: null }] }),
      ],
      TODAY,
    );
    expect(summary.mrrCents).toBe(15_000 + 10_000);
    expect(summary.oneOffCents).toBe(540_000);
    expect(summary.nextBillingOn).toBe("2026-10-01");
    expect(summary.upcomingMrr).toBeNull();
  });

  it("si todo empieza más adelante, dice cuánto y desde cuándo", () => {
    const summary = contractSummary([line({ startsOn: "2026-10-15" })], TODAY);
    expect(summary.mrrCents).toBe(0);
    expect(summary.upcomingMrr).toEqual({ cents: 15_000, from: "2026-10-15" });
    expect(summary.nextBillingOn).toBe("2026-10-15");
  });

  it("la próxima facturación salta las pausas y respeta el aniversario de las anuales", () => {
    expect(lineNextBillingOn(line({ pauses: [{ startsOn: "2026-09-20", endsOn: "2026-11-30" }] }), TODAY)).toBe("2026-12-01");
    expect(lineNextBillingOn(line({ billingType: "yearly", startsOn: "2025-03-10", billingDay: null }), TODAY)).toBe(
      "2027-03-10",
    );
    expect(lineNextBillingOn(line({ endsOn: "2026-09-30" }), TODAY)).toBeNull();
    expect(lineNextBillingOn(line({ billingType: "usage" }), TODAY)).toBeNull();
  });

  it("la vista previa del alta cuenta el MRR sin mirar fechas", () => {
    expect(
      potentialMrrCents([
        { billingType: "monthly", quantity: "2", unitPriceCents: 10_000, discountBps: 0 },
        { billingType: "yearly", quantity: "1", unitPriceCents: 100, discountBps: 0 },
        { billingType: "one_off", quantity: "1", unitPriceCents: 999_999, discountBps: 0 },
      ]),
    ).toBe(20_008);
  });
});

describe("bajas, versiones y pausas", () => {
  it("recomienda dar de baja a fin del periodo en curso, nunca antes de lo facturado", () => {
    expect(recommendedEndOn({ ...line(), billedUntil: "2026-09-30" }, TODAY)).toBe("2026-09-30");
    expect(recommendedEndOn({ ...line({ billingDay: 15 }), billedUntil: null }, TODAY)).toBe("2026-10-14");
    const yearly = { ...line({ billingType: "yearly", startsOn: "2026-03-01", billingDay: null }), billedUntil: "2027-02-28" };
    expect(recommendedEndOn(yearly, TODAY)).toBe("2027-02-28");
    // Aún no ha empezado: fin de su primer periodo.
    expect(recommendedEndOn({ ...line({ startsOn: "2026-11-01" }), billedUntil: null }, TODAY)).toBe("2026-11-30");
    expect(recommendedEndOn({ ...line({ billingType: "usage", startsOn: null }), billedUntil: null }, TODAY)).toBe(TODAY);
    expect(recommendedEndOn({ ...line({ billingType: "one_off" }), billedUntil: null }, TODAY)).toBeNull();
  });

  it("la versión nueva empieza el día siguiente a lo facturado y después del inicio", () => {
    expect(defaultVersionFrom({ startsOn: "2026-01-01", billedUntil: "2026-09-30" }, TODAY)).toBe("2026-10-01");
    expect(defaultVersionFrom({ startsOn: null, billedUntil: null }, TODAY)).toBe(TODAY);
    expect(defaultVersionFrom({ startsOn: TODAY, billedUntil: null }, TODAY)).toBe("2026-09-27");
  });

  it("reanudar termina la pausa ayer, o la borra si aún no había empezado", () => {
    const pauses = [
      { id: "a", startsOn: "2026-08-01", endsOn: "2026-08-31" },
      { id: "b", startsOn: "2026-09-10", endsOn: null },
      { id: "c", startsOn: "2026-12-01", endsOn: "2026-12-31" },
    ];
    expect(currentPause(pauses, TODAY)?.id).toBe("b");
    expect(upcomingPause(pauses, TODAY)?.id).toBe("c");
    expect(resumePlan(pauses[1]!, TODAY)).toEqual({ kind: "end", endsOn: "2026-09-25" });
    expect(resumePlan({ startsOn: TODAY, endsOn: null }, TODAY)).toEqual({ kind: "delete" });
    expect(resumePlan(pauses[2]!, TODAY)).toEqual({ kind: "delete" });
  });
});

describe("importe de los hitos", () => {
  it("reparte las bases puntuales y el último hito se lleva el resto", () => {
    const amounts = milestoneAmounts(
      [
        { id: "web", baseCents: 100_001 },
        { id: "logo", baseCents: 33_333 },
      ],
      [
        { id: "firma", percentBps: 4000 },
        { id: "mitad", percentBps: 3000 },
        { id: "entrega", percentBps: 3000 },
      ],
    );
    expect(amounts).toEqual({ firma: 40_000 + 13_333, mitad: 30_000 + 10_000, entrega: 30_001 + 10_000 });
    expect(Object.values(amounts!).reduce((a, b) => a + b, 0)).toBe(133_334);
    expect(milestoneAmounts([{ id: "web", baseCents: 1000 }], [{ id: "x", percentBps: 5000 }])).toBeNull();
  });
});
