import { describe, expect, it } from "vitest";
import { type BillingState, type PlanContract, type PlanItem, planBillingRun } from "./plan";

const vat = new Map([["iva21", { id: "iva21", rateBps: 2100, regime: "general" as const, legalNote: null }]]);

function ids() {
  let n = 0;
  return () => `id-${++n}`;
}

const deps = () => ({
  newId: ids(),
  renderReminder: (i: { number: string }) => ({ subject: `Recordatorio ${i.number}`, body: "…" }),
});

function contract(overrides: Partial<PlanContract> = {}): PlanContract {
  return {
    id: "c1",
    clientId: "cl1",
    dealId: null,
    title: "Mantenimiento",
    signedOn: "2026-08-01",
    paymentTermsDays: null,
    paymentMethod: "transfer",
    invoiceGrouping: "client",
    issuers: [{ issuerId: "autonomo", validFrom: "2026-01-01" }],
    lines: [
      {
        id: "l1",
        position: 0,
        description: "Mantenimiento web",
        billingType: "monthly",
        quantity: "1",
        unitPriceCents: 50_000,
        discountBps: 0,
        taxRateId: "iva21",
        irpfApplies: true,
        startsOn: "2026-08-15",
        endsOn: null,
        billingDay: 1,
        prorateFirst: true,
        pauses: [],
      },
    ],
    milestones: [],
    ...overrides,
  };
}

function state(overrides: Partial<BillingState> = {}): BillingState {
  return {
    orgId: "org",
    today: "2026-09-26",
    settings: { paymentTermsDays: 30, dunningDays: [7, 15], renewalAlertDays: [60, 30, 7] },
    issuers: [
      { id: "autonomo", name: "Marc Sanjuan", defaultIrpfBps: 1500, fiscalProvider: "internal", verifactuFrom: "2027-07-01", active: true },
      { id: "sl", name: "GNERAI SL", defaultIrpfBps: 0, fiscalProvider: "internal", verifactuFrom: "2027-01-01", active: true },
    ],
    vatRates: vat,
    clients: [
      {
        id: "cl1",
        name: "Restaurant del Port",
        isBusiness: true,
        taxIdKind: "es",
        countryCode: "ES",
        language: "ca",
        paymentTermsDays: 15,
        ownerMemberId: "m1",
        billingEmails: ["admin@example.com"],
      },
    ],
    contracts: [contract()],
    items: [],
    openDrafts: [],
    overdueInvoices: [],
    deals: [],
    activeStageId: null,
    ...overrides,
  };
}

describe("cron diario: recurrentes y borradores", () => {
  it("recupera los periodos que faltan (alta prorrateada incluida) y monta un borrador por cliente", () => {
    const { payload } = planBillingRun(state(), deps());
    expect(payload.items.map((i) => [i.period_start, i.period_end, i.unit_price_cents])).toEqual([
      ["2026-08-15", "2026-08-31", 27_419], // 500 € × 17/31
      ["2026-09-01", "2026-09-30", 50_000],
    ]);
    expect(payload.drafts).toHaveLength(1);
    const draft = payload.drafts[0]!;
    expect(draft.grouping_key).toBe("client");
    // Autónomo + empresa española: IRPF 15 %. Idioma y plazo del cliente.
    expect(draft.header).toMatchObject({ issuer_id: "autonomo", irpf_bps: 1500, language: "ca", payment_terms_days: 15 });
    expect(draft.lines.map((l) => [l.base_cents, l.vat_cents, l.irpf_cents, l.billable_item_id])).toEqual([
      [27_419, 5_758, 4_113, payload.items[0]!.id],
      [50_000, 10_500, 7_500, payload.items[1]!.id],
    ]);
  });

  it("es idempotente: con esos periodos ya facturados no hay nada nuevo", () => {
    const billed: PlanItem[] = ["2026-08-15", "2026-09-01"].map((start, i) => ({
      id: `b${i}`,
      contractLineId: "l1",
      source: "recurring",
      periodStart: start,
      periodEnd: start,
      milestoneId: null,
      description: "x",
      quantity: "1",
      unitPriceCents: 1,
      discountBps: 0,
      amountCents: 1,
      billableOn: start,
      invoiceLineId: `line-${i}`,
      waived: false,
    }));
    const { payload } = planBillingRun(state({ items: billed }), deps());
    expect(payload.items).toEqual([]);
    expect(payload.drafts).toEqual([]);
  });

  it("añade al borrador automático abierto sin tocar lo que ya tiene (y con su IRPF)", () => {
    const existingLine = {
      id: "old",
      position: 0,
      description: "Extra",
      quantity: "1",
      unit_price_cents: 10_000,
      discount_bps: 0,
      base_cents: 10_000,
      tax_rate_id: "iva21",
      vat_bps: 2100,
      vat_regime: "general" as const,
      vat_cents: 2_100,
      irpf_applies: true,
      irpf_cents: 700,
      legal_note: null,
      billing_type: "one_off" as const,
      period_start: null,
      period_end: null,
      contract_line_id: null,
      rectifies_line_id: null,
    };
    const { payload } = planBillingRun(
      state({
        openDrafts: [{ id: "d1", issuerId: "autonomo", clientId: "cl1", groupingKey: "client", updatedAt: "2026-09-25T10:00:00Z", irpfBps: 700, lines: [existingLine] }],
      }),
      deps(),
    );
    const draft = payload.drafts[0]!;
    expect(draft).toMatchObject({ invoice_id: "d1", expected_updated_at: "2026-09-25T10:00:00Z" });
    expect(draft.header).toBeUndefined();
    expect(draft.lines[0]).toMatchObject({ id: "old", position: 0 });
    // El borrador tenía IRPF 7 %: las líneas nuevas lo respetan.
    expect(draft.lines[2]!.irpf_cents).toBe(3_500);
  });

  it("cada periodo lo factura el emisor vigente en su inicio (traspaso a la SL)", () => {
    const { payload } = planBillingRun(
      state({
        contracts: [
          contract({
            issuers: [
              { issuerId: "autonomo", validFrom: "2026-01-01" },
              { issuerId: "sl", validFrom: "2026-09-01" },
            ],
          }),
        ],
      }),
      deps(),
    );
    expect(payload.drafts.map((d) => [d.header?.issuer_id, d.header?.irpf_bps, d.lines.length])).toEqual([
      ["autonomo", 1500, 1],
      ["sl", 0, 1],
    ]);
  });

  it("un emisor inactivo no factura: no crea pendientes ni borradores, y lo explica", () => {
    const s = state();
    s.issuers[0]!.active = false;
    const plan = planBillingRun(s, deps());
    expect(plan.payload.items).toEqual([]);
    expect(plan.skipped[0]).toMatchObject({ lineId: "l1", reason: "issuer_inactive" });
  });
});

describe("cron diario: hitos, avisos y recordatorios", () => {
  it("prepara los hitos automáticos con fecha cumplida, en orden", () => {
    const withMilestones = contract({
      lines: [{ ...contract().lines[0]!, id: "web", billingType: "one_off", unitPriceCents: 300_000, startsOn: null }],
      milestones: [
        { id: "m1", position: 1, label: "A la firma", percentBps: 5000, plannedOn: "2026-09-01", auto: true },
        { id: "m2", position: 2, label: "A la entrega", percentBps: 5000, plannedOn: "2026-12-01", auto: true },
      ],
    });
    const { payload } = planBillingRun(state({ contracts: [withMilestones] }), deps());
    expect(payload.items.map((i) => [i.milestone_id, i.amount_cents])).toEqual([["m1", 150_000]]);
    expect(payload.drafts[0]!.lines[0]!.billing_type).toBe("one_off");
  });

  it("avisa de la renovación anual al socio responsable según el umbral alcanzado", () => {
    const yearly = contract({
      lines: [{ ...contract().lines[0]!, id: "y1", billingType: "yearly", startsOn: "2025-10-20", billingDay: null, unitPriceCents: 120_000 }],
      signedOn: "2025-10-01",
    });
    const items: PlanItem[] = [
      {
        id: "b",
        contractLineId: "y1",
        source: "recurring",
        periodStart: "2025-10-20",
        periodEnd: "2026-10-19",
        milestoneId: null,
        description: "x",
        quantity: "1",
        unitPriceCents: 120_000,
        discountBps: 0,
        amountCents: 120_000,
        billableOn: "2025-10-20",
        invoiceLineId: "l",
        waived: false,
      },
    ];
    const { payload } = planBillingRun(state({ contracts: [yearly], items }), deps());
    expect(payload.notifications).toEqual([
      expect.objectContaining({ kind: "renewal", member_id: "m1", dedupe_key: "renewal:y1:2026-10-20:30", due_on: "2026-10-20" }),
    ]);
  });

  it("prepara el recordatorio del mayor umbral alcanzado, pendiente de aprobación", () => {
    const { payload } = planBillingRun(
      state({
        contracts: [],
        overdueInvoices: [
          {
            id: "inv",
            number: "2026-0031",
            clientId: "cl1",
            issuerName: "Marc Sanjuan",
            issuedOn: "2026-08-10",
            dueOn: "2026-09-09",
            totalCents: 95_400,
            outstandingCents: 95_400,
            language: "ca",
            paymentMethod: "transfer",
            iban: null,
          },
        ],
      }),
      deps(),
    );
    expect(payload.emails).toEqual([
      expect.objectContaining({ dedupe_key: "reminder:inv:15", to_emails: ["admin@example.com"], language: "ca" }),
    ]);
    expect(payload.notifications.map((n) => n.dedupe_key)).toContain("reminder_ready:inv:15");
  });

  it("un deal ganado pasa a Activo cuando empieza su contrato", () => {
    const { payload } = planBillingRun(
      state({
        contracts: [contract({ dealId: "deal1" })],
        deals: [{ id: "deal1", stageId: "ganado", stageKind: "won" }],
        activeStageId: "activo",
      }),
      deps(),
    );
    expect(payload.deal_moves).toEqual([{ deal_id: "deal1", stage_id: "activo" }]);
  });

  it("avisa de la cuenta atrás de Verifactu a 90, 30 y 7 días", () => {
    const { payload } = planBillingRun(state({ contracts: [], today: "2026-10-15" }), deps());
    expect(payload.notifications.map((n) => n.dedupe_key)).toEqual(["verifactu:sl:2027-01-01:90"]);
  });
});
