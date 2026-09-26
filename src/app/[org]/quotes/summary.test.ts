import { describe, expect, it } from "vitest";
import {
  effectiveDates,
  milestoneAmounts,
  PLAN_PRESETS,
  type PlanItem,
  paymentPlanError,
  type QuoteCalcLine,
  quoteLineBaseCents,
  quoteTotals,
  quoteValidityDays,
} from "./summary";

const vat21 = { vatBps: 2100, vatRegime: "general" as const };

function calc(billingType: QuoteCalcLine["billingType"], unitPriceCents: number, extra: Partial<QuoteCalcLine> = {}): QuoteCalcLine {
  return { billingType, quantity: "1", unitPriceCents, discountBps: 0, ...vat21, ...extra };
}

const item = (percentBps: number, when: PlanItem["when"] = "on_delivery", plannedOn: string | null = null): PlanItem => ({
  label: "Pago",
  percentBps,
  when,
  plannedOn,
});

describe("totales por tipo", () => {
  it("lo puntual, lo mensual y lo anual van por separado; el uso solo se cuenta", () => {
    const totals = quoteTotals([
      calc("one_off", 150_000),
      calc("one_off", 45_000, { quantity: "2", discountBps: 1000 }),
      calc("monthly", 35_000),
      calc("yearly", 24_000),
      calc("usage", 37_500),
      calc("usage", 12_000),
    ]);
    // 1.500 + 2 × 450 − 10 % = 2.310 €; IVA 485,10 €.
    expect(totals.oneOff).toMatchObject({ subtotalCents: 231_000, vatCents: 48_510, totalCents: 279_510 });
    expect(totals.monthly).toMatchObject({ subtotalCents: 35_000, vatCents: 7_350, totalCents: 42_350 });
    expect(totals.yearly).toMatchObject({ subtotalCents: 24_000, vatCents: 5_040, totalCents: 29_040 });
    expect(totals.usageCount).toBe(2);
  });

  it("sin líneas de un tipo, ese total es null; el desglose agrupa por tipo de IVA", () => {
    const totals = quoteTotals([calc("one_off", 10_000), calc("one_off", 5_000, { vatBps: 0, vatRegime: "reverse_charge_eu" })]);
    expect(totals.monthly).toBeNull();
    expect(totals.yearly).toBeNull();
    expect(totals.oneOff?.breakdown).toEqual([
      { vatBps: 2100, vatRegime: "general", baseCents: 10_000, vatCents: 2_100 },
      { vatBps: 0, vatRegime: "reverse_charge_eu", baseCents: 5_000, vatCents: 0 },
    ]);
  });

  it("la base de una línea redondea una vez: 3 × 33,33 € − 12,5 %", () => {
    expect(quoteLineBaseCents({ quantity: "3", unitPriceCents: 3_333, discountBps: 1250 })).toBe(8_749);
  });
});

describe("plan de pagos", () => {
  it("con líneas puntuales hace falta un plan que sume exactamente el 100 %", () => {
    expect(paymentPlanError([], true)).toBe("planRequired");
    expect(paymentPlanError([], false)).toBeNull();
    expect(paymentPlanError([item(5000, "on_accept"), item(4000)], true)).toBe("planTotal");
    expect(paymentPlanError([item(5000, "on_accept"), item(5000)], true)).toBeNull();
  });

  it("«a la aceptación» solo el primero; una fecha solo (y siempre) en los de fecha", () => {
    expect(paymentPlanError([item(5000), item(5000, "on_accept")], true)).toBe("planOrder");
    expect(paymentPlanError([item(10_000, "date")], true)).toBe("planInvalid");
    expect(paymentPlanError([item(10_000, "date", "2026-02-30")], true)).toBe("planInvalid");
    expect(paymentPlanError([item(10_000, "on_delivery", "2026-10-01")], true)).toBe("planInvalid");
    expect(paymentPlanError([item(10_000, "date", "2026-10-01")], true)).toBeNull();
    expect(paymentPlanError([{ ...item(10_000), label: "  " }], true)).toBe("planInvalid");
    expect(paymentPlanError([item(0), item(10_000)], true)).toBe("planInvalid");
  });

  it("los tres planes habituales suman el 100 % y empiezan a la aceptación", () => {
    for (const preset of Object.values(PLAN_PRESETS)) {
      const plan = preset.map((p) => ({ label: p.label, percentBps: p.percentBps, when: p.when, plannedOn: null }));
      expect(paymentPlanError(plan, true)).toBeNull();
      expect(plan[0]!.when).toBe("on_accept");
    }
  });

  it("cada pago cobra su parte de cada línea; el último, el resto: cuadra al céntimo", () => {
    const lines = [calc("one_off", 100_001), calc("one_off", 33_333, { vatBps: 1000 }), calc("monthly", 50_000)];
    const plan = [item(4000, "on_accept"), item(3000), item(3000)];
    const amounts = milestoneAmounts(lines, plan)!;
    // 1.000,01 € → 400,00 + 300,00 + 300,01; 333,33 € → 133,33 + 100,00 + 100,00.
    expect(amounts.map((a) => a.baseCents)).toEqual([53_333, 40_000, 40_001]);
    // Las bases suman lo puntual (el mensual no entra).
    expect(amounts.reduce((sum, a) => sum + a.baseCents, 0)).toBe(133_334);
    // El IVA de cada pago es el de su factura: cada parte con el tipo de su línea.
    expect(amounts[0]).toMatchObject({ vatCents: 8_400 + 1_333, totalCents: 53_333 + 9_733 });
    expect(milestoneAmounts(lines, [item(5000)])).toBeNull();
    expect(milestoneAmounts([calc("monthly", 1000)], [item(10_000, "on_accept")])).toBeNull();
  });
});

describe("validez", () => {
  it("la de la org o 30 días; un borrador toma las fechas de hoy", () => {
    expect(quoteValidityDays({ quote_validity_days: 15 })).toBe(15);
    expect(quoteValidityDays({ quote_validity_days: 0 })).toBe(30);
    expect(quoteValidityDays(null)).toBe(30);
    expect(effectiveDates(null, null, "2026-09-26", 30)).toEqual({ issuedOn: "2026-09-26", validUntil: "2026-10-26" });
    expect(effectiveDates("2026-09-20", "2026-12-31", "2026-09-26", 30)).toEqual({ issuedOn: "2026-09-20", validUntil: "2026-12-31" });
  });
});
