import { describe, expect, it } from "vitest";
import {
  baseFromTotal,
  computeExpenseAmounts,
  deductibleVatCents,
  expenseCostCents,
  expenseStatus,
  isAutoPaid,
  payableOn,
} from "./expense";

describe("importes de un gasto", () => {
  it("freelance con IVA y retención: 1.000 € + 21 % − 15 % = 1.060 € a pagar", () => {
    expect(computeExpenseAmounts({ baseCents: 100_000, vatBps: 2100, irpfBps: 1500 })).toEqual({
      baseCents: 100_000,
      vatCents: 21_000,
      irpfCents: 15_000,
      totalCents: 106_000,
    });
  });

  it("alquiler con retención del 19 % y software sin IVA (inversión del sujeto pasivo)", () => {
    expect(computeExpenseAmounts({ baseCents: 80_000, vatBps: 2100, irpfBps: 1900 })).toMatchObject({
      vatCents: 16_800,
      irpfCents: 15_200,
      totalCents: 81_600,
    });
    expect(computeExpenseAmounts({ baseCents: 5_999, vatBps: 0, irpfBps: 0 })).toEqual({
      baseCents: 5_999,
      vatCents: 0,
      irpfCents: 0,
      totalCents: 5_999,
    });
  });

  it("redondea el medio céntimo hacia fuera, también en un abono (negativo)", () => {
    // 0,50 € al 21 % son 0,105 € → 0,11 €; 0,10 € al 15 % son 0,015 € → 0,02 €.
    expect(computeExpenseAmounts({ baseCents: 50, vatBps: 2100, irpfBps: 0 })).toMatchObject({ vatCents: 11, totalCents: 61 });
    expect(computeExpenseAmounts({ baseCents: 10, vatBps: 0, irpfBps: 1500 })).toMatchObject({ irpfCents: 2, totalCents: 8 });
    expect(computeExpenseAmounts({ baseCents: -50, vatBps: 2100, irpfBps: 0 })).toEqual({
      baseCents: -50,
      vatCents: -11,
      irpfCents: 0,
      totalCents: -61,
    });
  });

  it("rechaza importes y tipos que no son enteros", () => {
    expect(() => computeExpenseAmounts({ baseCents: 10.5, vatBps: 2100, irpfBps: 0 })).toThrow(/céntimos/);
    expect(() => computeExpenseAmounts({ baseCents: 100, vatBps: 21.5, irpfBps: 0 })).toThrow(/puntos básicos/);
    expect(() => computeExpenseAmounts({ baseCents: 100, vatBps: 12_000, irpfBps: 0 })).toThrow(/IVA/);
  });

  it("saca la base de lo pagado cuando existe una base exacta", () => {
    expect(baseFromTotal(12_100, 2100, 0)).toBe(10_000);
    expect(baseFromTotal(106_000, 2100, 1500)).toBe(100_000);
    expect(baseFromTotal(81_600, 2100, 1900)).toBe(80_000);
    expect(baseFromTotal(-12_100, 2100, 0)).toBe(-10_000);
    expect(baseFromTotal(0, 2100, 0)).toBe(0);
    // 3 céntimos con IVA del 21 %: la base 2 da 2 y la 3 da 4. No hay ninguna exacta.
    expect(baseFromTotal(3, 2100, 0)).toBeNull();
    // Cualquier total que sí existe se recupera.
    for (let base = 0; base < 3000; base += 7) {
      const { totalCents } = computeExpenseAmounts({ baseCents: base, vatBps: 2100, irpfBps: 700 });
      const found = baseFromTotal(totalCents, 2100, 700);
      expect(found === null ? null : computeExpenseAmounts({ baseCents: found, vatBps: 2100, irpfBps: 700 }).totalCents).toBe(totalCents);
    }
  });
});

describe("coste, IVA deducible y estado", () => {
  it("el coste suma el IVA que no se deduce; la retención no lo reduce", () => {
    expect(expenseCostCents({ baseCents: 10_000, vatCents: 2_100, vatDeductible: true })).toBe(10_000);
    expect(expenseCostCents({ baseCents: 10_000, vatCents: 2_100, vatDeductible: false })).toBe(12_100);
    expect(deductibleVatCents({ vatCents: 2_100, vatDeductible: true })).toBe(2_100);
    expect(deductibleVatCents({ vatCents: 2_100, vatDeductible: false })).toBe(0);
  });

  it("pagado si tiene fecha de pago; vencido si su vencimiento (o su fecha) ya pasó; si no, pendiente", () => {
    const today = "2026-09-26";
    expect(expenseStatus({ paidOn: "2026-01-02", dueOn: "2026-01-01", issuedOn: "2025-12-01" }, today)).toBe("paid");
    expect(expenseStatus({ paidOn: null, dueOn: "2026-09-25", issuedOn: "2026-09-01" }, today)).toBe("overdue");
    expect(expenseStatus({ paidOn: null, dueOn: "2026-09-26", issuedOn: "2026-09-01" }, today)).toBe("pending");
    expect(expenseStatus({ paidOn: null, dueOn: null, issuedOn: "2026-09-25" }, today)).toBe("overdue");
    expect(expenseStatus({ paidOn: null, dueOn: null, issuedOn: "2026-09-26" }, today)).toBe("pending");
    expect(payableOn({ dueOn: null, issuedOn: "2026-09-25" })).toBe("2026-09-25");
  });

  it("con tarjeta o domiciliación el cargo se hace solo", () => {
    expect(isAutoPaid("card")).toBe(true);
    expect(isAutoPaid("sepa_debit")).toBe(true);
    expect(isAutoPaid("transfer")).toBe(false);
    expect(isAutoPaid("cash")).toBe(false);
  });
});
