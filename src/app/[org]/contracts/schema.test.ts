import { describe, expect, it } from "vitest";
import {
  bpsToPercentInput,
  cancelFormSchema,
  centsToMoneyInput,
  contractFormSchema,
  type ContractFormInput,
  discountToBps,
  isCivilDate,
  type LineFormInput,
  lineFormSchema,
  lineVersionSheetSchema,
  milestonePlanError,
  milestonesSheetSchema,
  milestonesTotalBps,
  moneyInputToCents,
  newLineDefaults,
  parseBillingDay,
  parseDays,
  parseQuantity,
  pauseFormSchema,
  percentInputToBps,
  quantityToInput,
  termsFormSchema,
  toCreateContractPayload,
  toLinePayload,
  toMilestonesPayload,
  toVersionPayload,
  usageFormSchema,
} from "./schema";

const VAT = "7b2a4f1e-3c1d-4b8e-9a6f-2d5c8e1f0a3b";
const ISSUER = "0f8e2c4a-6b1d-4e3f-8a9c-5d7e1f2a3b4c";
const CLIENT = "3c5e7a9b-1d2f-4a6c-8e0b-2f4a6c8e0b1d";
const MILESTONE = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

const monthly: LineFormInput = {
  ...newLineDefaults("monthly", { vatRateId: VAT, billingDay: 1, today: "2026-09-26" }),
  description: "Mantenimiento web",
  unit_price: "150",
};

const oneOff: LineFormInput = {
  ...newLineDefaults("one_off", { vatRateId: VAT, billingDay: 1, today: "2026-09-26" }),
  description: "Diseño web",
  unit_price: "3.000",
};

const contract = (patch: Partial<ContractFormInput> = {}): ContractFormInput => ({
  client_id: CLIENT,
  new_client_name: "",
  title: "Web + mantenimiento",
  issuer_id: ISSUER,
  signed_on: "",
  payment_terms_days: "",
  payment_method: "transfer",
  invoice_grouping: "client",
  lines: [monthly],
  milestones: [],
  ...patch,
});

const messages = (result: { success: boolean; error?: { issues: { message: string; path: PropertyKey[] }[] } }) =>
  result.error?.issues.map((i) => `${i.path.join(".")}:${i.message}`) ?? [];

describe("importes, porcentajes y cantidades a la española", () => {
  it("lee precios con separador de miles y coma decimal; vacío o negativo no vale", () => {
    expect(moneyInputToCents("1.500")).toBe(150_000);
    expect(moneyInputToCents("450,50")).toBe(45_050);
    expect(moneyInputToCents("99 €")).toBe(9_900);
    expect(moneyInputToCents("0")).toBe(0);
    expect(moneyInputToCents("")).toBeNull();
    expect(moneyInputToCents("-20")).toBeNull();
    expect(moneyInputToCents("12,345")).toBeNull();
  });

  it("vuelve a escribir los céntimos para editarlos, sin decimales binarios", () => {
    expect(centsToMoneyInput(150_000)).toBe("1500");
    expect(centsToMoneyInput(150_050)).toBe("1500,50");
    expect(centsToMoneyInput(7)).toBe("0,07");
    expect(moneyInputToCents(centsToMoneyInput(123_456_789))).toBe(123_456_789);
  });

  it("convierte porcentajes a puntos básicos de forma exacta", () => {
    expect(percentInputToBps("21")).toBe(2100);
    expect(percentInputToBps("12,5")).toBe(1250);
    expect(percentInputToBps("33.33")).toBe(3333);
    expect(percentInputToBps("1,005")).toBeNull();
    expect(percentInputToBps("100")).toBe(10_000);
    expect(percentInputToBps("100,01")).toBeNull();
    expect(percentInputToBps("40 %")).toBe(4000);
    expect(bpsToPercentInput(1250)).toBe("12,5");
    expect(bpsToPercentInput(3333)).toBe("33,33");
    expect(bpsToPercentInput(5)).toBe("0,05");
    expect(discountToBps("")).toBe(0);
  });

  it("la cantidad es mayor que 0, con 3 decimales como mucho y coma o punto decimal", () => {
    expect(parseQuantity("1")).toBe("1");
    expect(parseQuantity("2,5")).toBe("2.5");
    expect(parseQuantity("0,333")).toBe("0.333");
    expect(parseQuantity("1.500")).toBe("1.5");
    expect(parseQuantity("007")).toBe("7");
    expect(parseQuantity("0")).toBeNull();
    expect(parseQuantity("0,000")).toBeNull();
    expect(parseQuantity("1,2345")).toBeNull();
    expect(parseQuantity("-1")).toBeNull();
    expect(quantityToInput(1.5)).toBe("1,5");
  });

  it("valida plazos, días de facturación y fechas civiles reales", () => {
    expect(parseDays("")).toBeNull();
    expect(parseDays("30")).toBe(30);
    expect(parseDays("366")).toBeUndefined();
    expect(parseBillingDay("31")).toBe(31);
    expect(parseBillingDay("0")).toBeNull();
    expect(parseBillingDay("32")).toBeNull();
    expect(isCivilDate("2028-02-29")).toBe(true);
    expect(isCivilDate("2026-02-29")).toBe(false);
    expect(isCivilDate("26/09/2026")).toBe(false);
  });
});

describe("línea de contrato", () => {
  it("una mensual necesita inicio y día de facturación; el fin no puede ir antes del inicio", () => {
    expect(lineFormSchema.safeParse(monthly).success).toBe(true);
    expect(messages(lineFormSchema.safeParse({ ...monthly, starts_on: "" }))).toContain("starts_on:startsOnRequired");
    expect(messages(lineFormSchema.safeParse({ ...monthly, billing_day: "40" }))).toContain("billing_day:billingDay");
    expect(messages(lineFormSchema.safeParse({ ...monthly, ends_on: "2026-09-01" }))).toContain("ends_on:endsBeforeStart");
  });

  it("rechaza cantidad, precio, descuento, IVA y fechas mal escritos con su mensaje", () => {
    const r = lineFormSchema.safeParse({
      ...monthly,
      quantity: "0",
      unit_price: "12.00.0",
      discount: "120",
      tax_rate_id: "",
      ends_on: "2026-13-01",
    });
    expect(messages(r)).toEqual(
      expect.arrayContaining([
        "quantity:quantity",
        "unit_price:money",
        "discount:discount",
        "tax_rate_id:vatRate",
        "ends_on:date",
      ]),
    );
    expect(messages(lineFormSchema.safeParse({ ...monthly, unit_price: " " }))).toContain("unit_price:required");
  });

  it("un one-off no lleva fechas ni día de facturación; una anual no prorratea", () => {
    const row = toLinePayload(lineFormSchema.parse({ ...oneOff, starts_on: "2026-10-01", discount: "10" }), 2);
    expect(row).toMatchObject({
      position: 2,
      billing_type: "one_off",
      quantity: "1",
      unit_price_cents: 300_000,
      discount_bps: 1000,
      starts_on: null,
      ends_on: null,
      billing_day: null,
    });
    const yearly = toLinePayload(
      lineFormSchema.parse({ ...monthly, billing_type: "yearly", prorate_first: false, quantity: "2,5" }),
      0,
    );
    expect(yearly).toMatchObject({ billing_type: "yearly", quantity: "2.5", billing_day: null, prorate_first: true });
  });

  it("la versión nueva exige su fecha y solo lleva las condiciones que cambian", () => {
    expect(messages(lineVersionSheetSchema.safeParse({ from: "", lines: [monthly] }))).toContain("from:required");
    const parsed = lineVersionSheetSchema.parse({ from: "2026-10-01", lines: [{ ...monthly, unit_price: "170" }] });
    expect(toVersionPayload(parsed.lines[0]!)).toEqual({
      description: "Mantenimiento web",
      quantity: "1",
      unit_price_cents: 17_000,
      discount_bps: 0,
      tax_rate_id: VAT,
      irpf_applies: true,
    });
  });
});

describe("hitos", () => {
  const m = (percent: string, patch: Record<string, unknown> = {}) => ({
    id: "",
    label: "Hito",
    percent,
    planned_on: "",
    auto: false,
    ...patch,
  });

  it("tienen que sumar exactamente el 100 %", () => {
    expect(milestonePlanError([m("50"), m("50")], true)).toBeNull();
    expect(milestonePlanError([m("40"), m("30"), m("30")], true)).toBeNull();
    expect(milestonePlanError([m("33,33"), m("33,33"), m("33,34")], true)).toBeNull();
    expect(milestonePlanError([m("50"), m("40")], true)).toBe("milestonesSumNot100");
    expect(milestonePlanError([m("60"), m("50")], true)).toBe("milestonesSumNot100");
    expect(milestonePlanError([], true)).toBe("milestonesEmpty");
    expect(milestonePlanError([], false)).toBeNull();
    // Un porcentaje que no se entiende ya tiene su error en la fila.
    expect(milestonePlanError([m("cincuenta"), m("50")], true)).toBeNull();
    expect(milestonesTotalBps([m("40"), m("30"), m("x")])).toBe(7000);
  });

  it("un hito automático necesita fecha, y el porcentaje tiene que ser mayor que 0", () => {
    const schema = milestonesSheetSchema(true);
    expect(messages(schema.safeParse({ milestones: [m("100", { auto: true })] }))).toContain("milestones.0.planned_on:autoNeedsDate");
    expect(messages(schema.safeParse({ milestones: [m("0"), m("100")] }))).toContain("milestones.0.percent:percent");
    expect(messages(schema.safeParse({ milestones: [m("50")] }))).toContain("milestones:milestonesSumNot100");
    expect(schema.safeParse({ milestones: [m("100", { auto: true, planned_on: "2026-10-15" })] }).success).toBe(true);
    expect(milestonesSheetSchema(false).safeParse({ milestones: [] }).success).toBe(true);
  });

  it("los ya facturados conservan su posición y los nuevos van detrás", () => {
    const rows = toMilestonesPayload(
      [
        { id: MILESTONE, label: "A la firma", percent: "50", planned_on: "", auto: false },
        { id: "", label: " Entrega ", percent: "50", planned_on: "2026-11-30", auto: true },
      ],
      new Map([[MILESTONE, 3]]),
    );
    expect(rows).toEqual([
      { id: MILESTONE, position: 3, label: "A la firma", percent_bps: 5000, planned_on: null, auto: false },
      { id: null, position: 4, label: "Entrega", percent_bps: 5000, planned_on: "2026-11-30", auto: true },
    ]);
  });
});

describe("alta del contrato", () => {
  it("exige cliente (existente o nuevo), al menos una línea y un plazo de pago válido", () => {
    expect(contractFormSchema.safeParse(contract()).success).toBe(true);
    expect(contractFormSchema.safeParse(contract({ client_id: "", new_client_name: "Bar Nou" })).success).toBe(true);
    expect(messages(contractFormSchema.safeParse(contract({ client_id: "" })))).toContain("client_id:clientRequired");
    expect(messages(contractFormSchema.safeParse(contract({ lines: [] })))).toContain("lines:linesEmpty");
    expect(messages(contractFormSchema.safeParse(contract({ payment_terms_days: "400" })))).toContain(
      "payment_terms_days:days",
    );
    expect(messages(contractFormSchema.safeParse(contract({ issuer_id: "" })))).toContain("issuer_id:issuerRequired");
  });

  it("con una línea puntual, los hitos son obligatorios y suman el 100 %", () => {
    const noMilestones = contractFormSchema.safeParse(contract({ lines: [monthly, oneOff] }));
    expect(messages(noMilestones)).toContain("milestones:milestonesEmpty");
    const half = contractFormSchema.safeParse(
      contract({
        lines: [monthly, oneOff],
        milestones: [
          { id: "", label: "A la firma", percent: "50", planned_on: "", auto: false },
          { id: "", label: "A la entrega", percent: "40", planned_on: "", auto: false },
        ],
      }),
    );
    expect(messages(half)).toContain("milestones:milestonesSumNot100");
    const badRow = contractFormSchema.safeParse(
      contract({ lines: [oneOff], milestones: [{ id: "", label: "", percent: "100", planned_on: "", auto: true }] }),
    );
    expect(messages(badRow)).toEqual(expect.arrayContaining(["milestones.0.label:required", "milestones.0.planned_on:autoNeedsDate"]));
  });

  it("sin nada puntual, los hitos (ocultos) no bloquean el alta", () => {
    const hidden = contractFormSchema.safeParse(
      contract({ milestones: [{ id: "", label: "", percent: "cincuenta", planned_on: "", auto: false }] }),
    );
    expect(hidden.success).toBe(true);
  });

  it("monta el JSON de create_contract: sin firma queda en borrador y sin one-off no hay hitos", () => {
    const values = contractFormSchema.parse(
      contract({
        signed_on: "2026-09-20",
        payment_terms_days: "15",
        lines: [monthly, oneOff],
        milestones: [{ id: "", label: "A la firma", percent: "100", planned_on: "", auto: false }],
      }),
    );
    const payload = toCreateContractPayload(values, CLIENT);
    expect(payload).toMatchObject({
      client_id: CLIENT,
      issuer_id: ISSUER,
      signed_on: "2026-09-20",
      payment_terms_days: 15,
      milestones: [{ position: 0, label: "A la firma", percent_bps: 10_000, planned_on: null, auto: false }],
    });
    expect(payload.lines.map((l) => [l.position, l.billing_type, l.unit_price_cents, l.billing_day])).toEqual([
      [0, "monthly", 15_000, 1],
      [1, "one_off", 300_000, null],
    ]);

    const draft = toCreateContractPayload(
      contractFormSchema.parse(contract({ milestones: [{ id: "", label: "x", percent: "100", planned_on: "", auto: false }] })),
      CLIENT,
    );
    expect(draft).toMatchObject({ signed_on: null, payment_terms_days: null, milestones: [] });
  });
});

describe("otras acciones", () => {
  it("condiciones, pausas, bajas y usos validan sus fechas y cantidades", () => {
    expect(
      termsFormSchema.safeParse({
        title: "Web",
        signed_on: "",
        payment_terms_days: "30",
        payment_method: "sepa_debit",
        invoice_grouping: "contract",
        notes: "",
      }).success,
    ).toBe(true);
    expect(messages(pauseFormSchema.safeParse({ starts_on: "2026-10-10", ends_on: "2026-10-01", reason: "" }))).toContain(
      "ends_on:endsBeforeStart",
    );
    expect(pauseFormSchema.safeParse({ starts_on: "2026-10-01", ends_on: "", reason: "Vacaciones" }).success).toBe(true);
    expect(messages(cancelFormSchema.safeParse({ ends_on: "", reason: "" }))).toContain("ends_on:required");
    expect(messages(usageFormSchema.safeParse({ quantity: "0", billable_on: "2026-09-26", description: "" }))).toContain(
      "quantity:quantity",
    );
    expect(usageFormSchema.safeParse({ quantity: "2", billable_on: "2026-09-26", description: "" }).success).toBe(true);
  });
});
