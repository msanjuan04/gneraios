import { describe, expect, it } from "vitest";
import {
  lineFormDefaults,
  parseEmailList,
  planFormError,
  planTotalBps,
  type QuoteFormInput,
  quoteFormSchema,
  readStoredPlan,
  toSaveQuotePayload,
} from "./schema";

const TODAY = "2026-09-26";
const VAT = "0b5f1a3e-8c1d-4a7e-9f2b-3c4d5e6f7a8b";
const ISSUER = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const CLIENT = "2d3e4f5a-6b7c-4d8e-9fa0-1b2c3d4e5f6a";
const ids = ["3e4f5a6b-7c8d-4e9f-a0b1-2c3d4e5f6a7b", "4f5a6b7c-8d9e-4fa0-b1c2-3d4e5f6a7b8c", "5a6b7c8d-9eaf-4b01-82d3-4e5f6a7b8c9d"];

function line(id: string, billing_type: "one_off" | "monthly" | "yearly" | "usage", unit_price: string, extra = {}) {
  return {
    id,
    billing_type,
    description: `Línea ${billing_type}`,
    quantity: "1",
    unit_price,
    discount: "",
    tax_rate_id: VAT,
    irpf_applies: true,
    starts_on: "",
    ends_on: "",
    billing_day: "",
    ...extra,
  };
}

function form(extra: Partial<QuoteFormInput> = {}): QuoteFormInput {
  return {
    client_id: CLIENT,
    new_client_name: "",
    deal_id: "",
    issuer_id: ISSUER,
    title: "Web corporativa",
    issued_on: "",
    valid_until: "",
    language: "es",
    notes: "",
    lines: [line(ids[1]!, "monthly", "350"), line(ids[0]!, "one_off", "1.500"), line(ids[2]!, "usage", "375")],
    plan: [
      { label: "Inicio del proyecto", when: "on_accept", planned_on: "", percent: "50" },
      { label: "Entrega final", when: "on_delivery", planned_on: "", percent: "50" },
    ],
    ...extra,
  };
}

const schema = quoteFormSchema(TODAY);
const messages = (input: QuoteFormInput) => {
  const result = schema.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join(".")}:${i.message}`);
};

describe("formulario del presupuesto", () => {
  it("un presupuesto completo vale y se convierte en el JSON de save_quote", () => {
    const parsed = schema.parse(form());
    const payload = toSaveQuotePayload(parsed, { quoteId: null, expectedUpdatedAt: null, clientId: CLIENT });
    // Por sección: primero lo puntual, luego lo mensual y lo de uso, con su posición.
    expect(payload.lines.map((l) => [l.position, l.billing_type, l.unit_price_cents, l.base_cents])).toEqual([
      [0, "one_off", 150_000, 150_000],
      [1, "monthly", 35_000, 35_000],
      [2, "usage", 37_500, 37_500],
    ]);
    expect(payload.header).toMatchObject({
      client_id: CLIENT,
      deal_id: null,
      issued_on: null,
      valid_until: null,
      notes: null,
      payment_plan: [
        { label: "Inicio del proyecto", percent_bps: 5000, when: "on_accept", planned_on: null },
        { label: "Entrega final", percent_bps: 5000, when: "on_delivery", planned_on: null },
      ],
    });
  });

  it("líneas: cantidad, importe, descuento, fechas y día de cobro se leen a la española", () => {
    const parsed = schema.parse(
      form({
        lines: [line(ids[0]!, "monthly", "1.234,5", { quantity: "2,5", discount: "12,5", starts_on: "2026-10-01", billing_day: "15" })],
        plan: [],
      }),
    );
    const [monthly] = toSaveQuotePayload(parsed, { quoteId: "q", expectedUpdatedAt: "t", clientId: CLIENT }).lines;
    expect(monthly).toMatchObject({
      quantity: "2.5",
      unit_price_cents: 123_450,
      discount_bps: 1250,
      starts_on: "2026-10-01",
      billing_day: 15,
      // 2,5 × 1.234,50 − 12,5 % = 2.700,47 €
      base_cents: 270_047,
    });
    expect(
      messages(form({ lines: [line(ids[0]!, "monthly", "abc", { quantity: "0", discount: "120", billing_day: "32", starts_on: "2026-10-02", ends_on: "2026-10-01" })], plan: [] })),
    ).toEqual(["lines.0.quantity:quantity", "lines.0.unit_price:money", "lines.0.discount:discount", "lines.0.ends_on:endsBeforeStart", "lines.0.billing_day:billingDay"]);
  });

  it("con algo puntual, el plan tiene que sumar el 100 %; sin puntual, no viaja", () => {
    expect(messages(form({ plan: [] }))).toEqual(["plan:planRequired"]);
    expect(messages(form({ plan: [{ label: "Todo", when: "on_delivery", planned_on: "", percent: "90" }] }))).toEqual(["plan:planTotal"]);
    expect(messages(form({ plan: [{ label: "Todo", when: "date", planned_on: "", percent: "100" }] }))).toEqual(["plan.0.planned_on:planDateRequired"]);
    const recurring = schema.parse(form({ lines: [line(ids[0]!, "monthly", "350")] }));
    expect(toSaveQuotePayload(recurring, { quoteId: null, expectedUpdatedAt: null, clientId: CLIENT }).header.payment_plan).toEqual([]);
    expect(planTotalBps([{ label: "a", when: "on_accept", planned_on: "", percent: "33,33" }, { label: "b", when: "on_delivery", planned_on: "", percent: "x" }])).toBe(3333);
    expect(planFormError([{ label: "a", when: "on_delivery", planned_on: "", percent: "50" }, { label: "b", when: "on_accept", planned_on: "", percent: "50" }])).toBe("planOrder");
  });

  it("cliente, fechas futuras y validez anterior a la fecha", () => {
    expect(messages(form({ client_id: "" }))).toEqual(["client_id:clientRequired"]);
    expect(messages(form({ client_id: "", new_client_name: "Bar Nou" }))).toEqual([]);
    expect(messages(form({ issued_on: "2026-09-27" }))).toEqual(["issued_on:futureDate"]);
    expect(messages(form({ issued_on: "2026-09-20", valid_until: "2026-09-19" }))).toEqual(["valid_until:validBeforeIssue"]);
  });
});

describe("de lo guardado al formulario", () => {
  it("una línea guardada vuelve a escribirse como la tecleó el usuario", () => {
    expect(
      lineFormDefaults({
        id: ids[0]!,
        billingType: "monthly",
        description: "Mantenimiento",
        quantity: 1.5,
        unitPriceCents: 150_050,
        discountBps: 1250,
        taxRateId: VAT,
        irpfApplies: false,
        startsOn: null,
        endsOn: "2027-09-30",
        billingDay: 5,
      }),
    ).toMatchObject({ quantity: "1,5", unit_price: "1500,50", discount: "12,5", starts_on: "", ends_on: "2027-09-30", billing_day: "5" });
  });

  it("el plan guardado (jsonb) se lee con cuidado", () => {
    expect(
      readStoredPlan([
        { label: "Inicio", percent_bps: 5000, when: "on_accept", planned_on: null },
        { label: "Fecha", percent_bps: 5000, when: "date", planned_on: "2026-11-01" },
        { label: "Raro", percent_bps: "50", when: "on_accept" },
        null,
      ]),
    ).toEqual([
      { label: "Inicio", percentBps: 5000, when: "on_accept", plannedOn: null },
      { label: "Fecha", percentBps: 5000, when: "date", plannedOn: "2026-11-01" },
    ]);
    expect(readStoredPlan({})).toEqual([]);
  });

  it("destinatarios: sin repetidos, en minúsculas y válidos", () => {
    expect(parseEmailList("Ana@Example.com; ana@example.com, pep@example.es")).toEqual(["ana@example.com", "pep@example.es"]);
    expect(parseEmailList("no-es-un-email")).toBeNull();
    expect(parseEmailList("  ")).toBeNull();
  });
});
