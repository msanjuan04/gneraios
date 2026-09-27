import { describe, expect, it } from "vitest";
import {
  nextChargeOn,
  planSubscriptionExpenses,
  subscriptionChargesDue,
  subscriptionMonthlyCostCents,
  upcomingSubscriptionCharges,
  type ExpenseSubscription,
} from "./subscriptions";

const base: ExpenseSubscription = {
  id: "s1",
  issuerId: "sl",
  vendorId: "adobe",
  categoryId: "software",
  memberId: null,
  description: "Adobe Creative Cloud",
  baseCents: 6_000,
  vatBps: 2100,
  vatDeductible: true,
  irpfBps: 0,
  interval: "monthly",
  startsOn: "2026-01-31",
  endsOn: null,
  billingDay: 31,
  paymentMethod: "card",
  isActive: true,
  allocation: "company",
  clientId: null,
  rebill: false,
  rebillMarkupBps: 0,
};

const starts = (sub: ExpenseSubscription, until: string, generated: string[] = []) =>
  subscriptionChargesDue(sub, new Set(generated), until).map((c) => c.chargedOn);

describe("calendario de cargos (el mismo que factura)", () => {
  it("mensual el día 31: el último día de los meses cortos, sin deriva", () => {
    expect(starts(base, "2026-05-31")).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]);
  });

  it("el primer cargo es el día de alta aunque no coincida con el de cargo, y entero", () => {
    const sub = { ...base, startsOn: "2026-03-15", billingDay: 1 };
    const charges = subscriptionChargesDue(sub, new Set(), "2026-05-01");
    expect(charges.map((c) => c.chargedOn)).toEqual(["2026-03-15", "2026-04-01", "2026-05-01"]);
    expect(charges.every((c) => c.amounts.totalCents === 7_260)).toBe(true);
  });

  it("anual en su aniversario: un 29 de febrero se cobra el 28 en los años no bisiestos", () => {
    const sub: ExpenseSubscription = { ...base, interval: "yearly", billingDay: null, startsOn: "2024-02-29", baseCents: 120_000 };
    expect(starts(sub, "2028-03-01")).toEqual(["2024-02-29", "2025-02-28", "2026-02-28", "2027-02-28", "2028-02-29"]);
  });

  it("termina con su fecha de fin y apagada no genera nada", () => {
    expect(starts({ ...base, startsOn: "2026-01-01", billingDay: 1, endsOn: "2026-03-15" }, "2026-12-31")).toEqual([
      "2026-01-01",
      "2026-02-01",
      "2026-03-01",
    ]);
    expect(starts({ ...base, isActive: false }, "2026-12-31")).toEqual([]);
  });

  it("es idempotente: con lo ya generado solo devuelve lo que falta (también huecos de días perdidos)", () => {
    const sub = { ...base, startsOn: "2026-01-01", billingDay: 1 };
    expect(starts(sub, "2026-04-10", ["2026-01-01", "2026-03-01"])).toEqual(["2026-02-01", "2026-04-01"]);
    expect(starts(sub, "2026-04-10", ["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01"])).toEqual([]);
  });

  it("el próximo cargo, para la lista de suscripciones", () => {
    expect(nextChargeOn(base, "2026-02-28")).toBe("2026-03-31");
    expect(nextChargeOn({ ...base, interval: "yearly", billingDay: null, startsOn: "2025-10-01" }, "2026-09-26")).toBe("2026-10-01");
    expect(nextChargeOn({ ...base, endsOn: "2026-03-01" }, "2026-02-28")).toBeNull();
    expect(nextChargeOn({ ...base, isActive: false }, "2026-02-28")).toBeNull();
  });
});

describe("gastos que genera el cron", () => {
  it("con tarjeta nacen pagados el día del cargo; con transferencia, pendientes con ese vencimiento", () => {
    const card = { ...base, startsOn: "2026-08-01", billingDay: 1 };
    const rent: ExpenseSubscription = {
      ...base,
      id: "s2",
      vendorId: "landlord",
      categoryId: "office",
      description: "Alquiler de la oficina",
      baseCents: 80_000,
      irpfBps: 1900,
      startsOn: "2026-09-01",
      billingDay: 1,
      paymentMethod: "transfer",
    };
    const planned = planSubscriptionExpenses([card, rent], new Map([["s1", new Set(["2026-08-01"])]]), "2026-09-26");
    expect(planned).toEqual([
      expect.objectContaining({ subscriptionId: "s1", periodStart: "2026-09-01", issuedOn: "2026-09-01", paidOn: "2026-09-01", totalCents: 7_260 }),
      expect.objectContaining({
        subscriptionId: "s2",
        periodStart: "2026-09-01",
        dueOn: "2026-09-01",
        paidOn: null,
        paymentMethod: "transfer",
        vatCents: 16_800,
        irpfCents: 15_200,
        totalCents: 81_600,
      }),
    ]);
  });

  it("cada gasto hereda a quién sirve la suscripción y si se repercute, con su margen", () => {
    const hosting: ExpenseSubscription = {
      ...base,
      id: "s3",
      description: "Servidor de la web de Acme",
      startsOn: "2026-09-01",
      billingDay: 1,
      allocation: "client",
      clientId: "acme",
      rebill: true,
      rebillMarkupBps: 1500,
    };
    const shared: ExpenseSubscription = { ...base, id: "s4", startsOn: "2026-09-01", billingDay: 1, allocation: "hosted_sites" };
    const planned = planSubscriptionExpenses([hosting, shared], new Map(), "2026-10-05");
    expect(planned.filter((p) => p.subscriptionId === "s3")).toEqual([
      expect.objectContaining({ periodStart: "2026-09-01", allocation: "client", clientId: "acme", rebill: true, rebillMarkupBps: 1500 }),
      expect.objectContaining({ periodStart: "2026-10-01", allocation: "client", clientId: "acme", rebill: true, rebillMarkupBps: 1500 }),
    ]);
    expect(planned.filter((p) => p.subscriptionId === "s4")).toEqual([
      expect.objectContaining({ allocation: "hosted_sites", clientId: null, rebill: false, rebillMarkupBps: 0 }),
      expect.objectContaining({ allocation: "hosted_sites", clientId: null, rebill: false, rebillMarkupBps: 0 }),
    ]);
  });

  it("lo incoherente no pasa a los gastos: sin cliente no hay repercusión y sin repercusión no hay margen", () => {
    const sub: ExpenseSubscription = { ...base, startsOn: "2026-09-01", billingDay: 1, allocation: "company", clientId: "acme", rebill: true, rebillMarkupBps: 500 };
    const [planned] = planSubscriptionExpenses([sub], new Map(), "2026-09-01");
    expect(planned).toMatchObject({ allocation: "company", clientId: null, rebill: false, rebillMarkupBps: 0 });
    const noRebill: ExpenseSubscription = { ...sub, allocation: "client", rebill: false };
    expect(planSubscriptionExpenses([noRebill], new Map(), "2026-09-01")[0]).toMatchObject({ clientId: "acme", rebill: false, rebillMarkupBps: 0 });
  });

  it("los cargos por venir para una previsión incluyen los vencidos sin generar", () => {
    const sub = { ...base, startsOn: "2026-08-01", billingDay: 1 };
    const upcoming = upcomingSubscriptionCharges([sub], new Map([["s1", new Set(["2026-08-01"])]]), "2026-11-15");
    expect(upcoming.map((c) => c.chargedOn)).toEqual(["2026-09-01", "2026-10-01", "2026-11-01"]);
  });
});

describe("coste mensual equivalente", () => {
  it("la cuota mensual, la doceava parte de la anual y el IVA si no se deduce", () => {
    const today = "2026-09-26";
    expect(subscriptionMonthlyCostCents(base, today)).toBe(6_000);
    expect(subscriptionMonthlyCostCents({ ...base, vatDeductible: false }, today)).toBe(7_260);
    // 1.000 € al año: 83,333… → 83,33 €.
    expect(subscriptionMonthlyCostCents({ ...base, interval: "yearly", billingDay: null, baseCents: 100_000 }, today)).toBe(8_333);
    expect(subscriptionMonthlyCostCents({ ...base, endsOn: "2026-09-01" }, today)).toBe(0);
    expect(subscriptionMonthlyCostCents({ ...base, isActive: false }, today)).toBe(0);
  });
});
