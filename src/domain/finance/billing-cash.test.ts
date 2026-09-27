import { describe, expect, it } from "vitest";
import { forecastBilling, type ForecastContract } from "../billing/forecast";
import { addDays, addMonthsClamped } from "../dates/civil-date";
import { billingCashEvents, pendingItemEvents, type CashBillingContract } from "./billing-cash";

const IRPF = new Map([
  ["laia", 1500],
  ["sl", 0],
]);

const esBusiness = { isBusiness: true, taxIdKind: "es" as const, countryCode: "ES" };

/** El mismo contrato de la previsión de facturación, con lo que la caja necesita además. */
function toCash(contract: ForecastContract, extra: Partial<CashBillingContract> = {}): CashBillingContract {
  return {
    ...contract,
    paymentTermsDays: 30,
    issuers: [{ issuerId: "laia", validFrom: "2025-01-01" }],
    client: esBusiness,
    lines: contract.lines.map((l) => ({ ...l, vatBps: 2100, irpfApplies: true })),
    ...extra,
  };
}

const recurring: ForecastContract = {
  id: "c1",
  signedOn: "2026-01-10",
  lines: [
    { id: "m", billingType: "monthly", quantity: "1", unitPriceCents: 50_000, discountBps: 0, startsOn: "2026-10-15", endsOn: "2027-01-31", billingDay: 1, prorateFirst: true, pauses: [{ startsOn: "2026-12-01", endsOn: "2026-12-31" }] },
    { id: "y", billingType: "yearly", quantity: "1", unitPriceCents: 120_000, discountBps: 0, startsOn: "2025-11-20", endsOn: null, billingDay: null, prorateFirst: false, pauses: [] },
    { id: "d", billingType: "monthly", quantity: "2", unitPriceCents: 12_345, discountBps: 1250, startsOn: "2026-06-01", endsOn: null, billingDay: 31, prorateFirst: true, pauses: [] },
    { id: "u", billingType: "usage", quantity: "1", unitPriceCents: 37_500, discountBps: 0, startsOn: null, endsOn: null, billingDay: null, prorateFirst: false, pauses: [] },
  ],
  milestones: [],
  billedMilestoneIds: new Set(),
  billedStarts: new Map([
    ["y", new Set(["2025-11-20"])],
    ["d", new Set(["2026-06-01", "2026-06-30", "2026-07-31", "2026-08-31"])],
  ]),
};

const oneOff: ForecastContract = {
  id: "c2",
  signedOn: "2026-05-01",
  lines: [
    { id: "web", billingType: "one_off", quantity: "1", unitPriceCents: 300_000, discountBps: 0, startsOn: null, endsOn: null, billingDay: null, prorateFirst: false, pauses: [] },
    { id: "logo", billingType: "one_off", quantity: "1", unitPriceCents: 45_001, discountBps: 0, startsOn: null, endsOn: null, billingDay: null, prorateFirst: false, pauses: [] },
  ],
  milestones: [
    { id: "a", position: 1, percentBps: 4000, plannedOn: "2026-09-01" },
    { id: "b", position: 2, percentBps: 3000, plannedOn: "2026-08-01" },
    { id: "c", position: 3, percentBps: 3000, plannedOn: "2026-12-15" },
  ],
  billedMilestoneIds: new Set(["a"]),
  billedStarts: new Map(),
};

describe("paridad con la previsión de facturación", () => {
  it("las bases por mes son exactamente las de forecastBilling", () => {
    for (const [from, months] of [
      ["2026-10-05", 4],
      ["2026-09-01", 6],
      ["2026-12-20", 13],
    ] as const) {
      const expected = forecastBilling([recurring, oneOff], from, months);
      const first = `${from.slice(0, 7)}-01`;
      const until = addDays(addMonthsClamped(first, months), -1);
      const events = billingCashEvents([toCash(recurring), toCash(oneOff)], IRPF, from, until);
      const byMonth = new Map(expected.map((m) => [m.month, { recurringCents: 0, oneOffCents: 0 }]));
      for (const e of events) {
        const month = e.billableOn < first ? first : `${e.billableOn.slice(0, 7)}-01`;
        const bucket = byMonth.get(month)!;
        if (e.kind === "recurring") bucket.recurringCents += e.baseCents;
        else bucket.oneOffCents += e.baseCents;
      }
      expect([...byMonth.entries()].map(([month, v]) => ({ month, ...v })), `${from} +${months}`).toEqual(expected);
    }
  });
});

describe("cobros previstos", () => {
  it("con IVA y la retención del emisor vigente, cobrados a los días de pago", () => {
    const events = billingCashEvents(
      [toCash(recurring, { issuers: [{ issuerId: "laia", validFrom: "2025-01-01" }, { issuerId: "sl", validFrom: "2026-12-01" }] })],
      IRPF,
      "2026-10-05",
      "2027-01-31",
    );
    const monthly = events.filter((e) => e.lineId === "m");
    expect(monthly.map((e) => [e.billableOn, e.collectedOn, e.issuerId, e.baseCents, e.vatCents, e.irpfCents, e.totalCents])).toEqual([
      ["2026-10-15", "2026-11-14", "laia", 27_419, 5_758, 4_113, 29_064],
      ["2026-11-01", "2026-12-01", "laia", 50_000, 10_500, 7_500, 53_000],
      // Traspasado a la SL desde el 01/12: sin retención.
      ["2027-01-01", "2027-01-31", "sl", 50_000, 10_500, 0, 60_500],
    ]);
    const yearly = events.find((e) => e.lineId === "y")!;
    expect(yearly).toMatchObject({ billableOn: "2026-11-20", baseCents: 120_000, vatCents: 25_200, irpfCents: 18_000, totalCents: 127_200 });
  });

  it("lo que ya tocaba facturar y no se ha emitido se factura hoy; sin empresa española no hay retención", () => {
    const monthly = (client: CashBillingContract["client"]) =>
      billingCashEvents([toCash(recurring, { client })], IRPF, "2026-10-20", "2026-10-31").find((e) => e.lineId === "m");
    expect(monthly({ isBusiness: false, taxIdKind: "es", countryCode: "ES" })).toMatchObject({
      billableOn: "2026-10-15",
      invoicedOn: "2026-10-20",
      collectedOn: "2026-11-19",
      irpfCents: 0,
    });
    expect(monthly({ isBusiness: true, taxIdKind: "eu_vat", countryCode: "FR" })).toMatchObject({ irpfCents: 0 });
    expect(monthly(esBusiness)).toMatchObject({ irpfCents: 4_113 });
  });

  it("los hitos con fecha, cada línea con su IVA y su retención; los ya preparados no se repiten", () => {
    const events = billingCashEvents([toCash(oneOff)], IRPF, "2026-10-01", "2026-12-31");
    expect(events.map((e) => [e.milestoneId, e.invoicedOn, e.baseCents, e.vatCents, e.irpfCents, e.totalCents])).toEqual([
      // 30 % de 3.000 € y de 450,01 € (135,003 → 135,00 €): IVA e IRPF por línea.
      ["b", "2026-10-01", 103_500, 21_735, 15_525, 109_710],
      ["c", "2026-12-15", 103_501, 21_735, 15_525, 109_711],
    ]);
  });

  it("los usos registrados y los hitos preparados sin factura emitida también se cobran", () => {
    const events = pendingItemEvents(
      [
        { id: "i1", contractId: "c1", lineId: "u", source: "usage", periodStart: null, billableOn: "2026-09-30", amountCents: 37_500 },
        { id: "i2", contractId: "zz", lineId: "u", source: "usage", periodStart: null, billableOn: "2026-09-30", amountCents: 1 },
      ],
      [toCash(recurring)],
      IRPF,
      "2026-10-01",
    );
    expect(events).toEqual([
      expect.objectContaining({
        kind: "pending",
        itemId: "i1",
        invoicedOn: "2026-10-01",
        collectedOn: "2026-10-31",
        baseCents: 37_500,
        vatCents: 7_875,
        irpfCents: 5_625,
        totalCents: 39_750,
      }),
    ]);
  });
});
