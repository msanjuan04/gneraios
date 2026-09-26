import { describe, expect, it } from "vitest";
import { parseMoneyInput } from "@/domain/money";
import {
  bpsToInput,
  centsToInput,
  type DraftFormInput,
  draftFormSchema,
  emailFormSchema,
  parseDiscountInput,
  parseEmailList,
  parsePercentInput,
  parseQuantityInput,
  paymentFormSchema,
  quantityToInput,
  readListFilter,
  rectifyFormSchema,
  sanitizeSearch,
  statusesFor,
} from "./schema";

const TODAY = "2026-09-26";
const ID = "7b2a4f1e-3c1d-4b8e-9a6f-2d5c8e1f0a3b";
const ID2 = "0f8e2c6a-9b4d-4e1f-8a3c-5d7b9e1f2a4c";

const line = (patch: Partial<DraftFormInput["lines"][number]> = {}): DraftFormInput["lines"][number] => ({
  id: ID2,
  description: "Mantenimiento web",
  quantity: "1",
  unit_price: "150,00",
  discount: "",
  tax_rate_id: ID,
  irpf_applies: true,
  billing_type: "monthly",
  period_start: "2026-09-01",
  period_end: "2026-09-30",
  ...patch,
});

const draft = (patch: Partial<DraftFormInput> = {}): DraftFormInput => ({
  issuer_id: ID,
  client_id: ID,
  series_id: "",
  issued_on: "",
  operation_on: "",
  due_mode: "terms",
  due_on: "",
  payment_terms_days: "",
  language: "es",
  irpf_bps: "1500",
  payment_method: "transfer",
  notes: "",
  rectification_reason: "",
  lines: [line()],
  ...patch,
});

const messages = (result: { success: boolean; error?: { issues: { message: string; path: PropertyKey[] }[] } }) =>
  result.error?.issues.map((i) => `${i.path.join(".")}:${i.message}`) ?? [];

describe("cantidades, porcentajes e importes escritos a la española", () => {
  it("lee cantidades con coma decimal y punto de miles, hasta 3 decimales", () => {
    expect(parseQuantityInput("1")).toBe("1");
    expect(parseQuantityInput("1,5")).toBe("1.5");
    expect(parseQuantityInput("0,125")).toBe("0.125");
    expect(parseQuantityInput(",5")).toBe("0.5");
    expect(parseQuantityInput("1.5")).toBe("1.5");
    expect(parseQuantityInput("1.500")).toBe("1500");
    expect(parseQuantityInput("1.000,25")).toBe("1000.25");
    expect(parseQuantityInput(" 2,50 ")).toBe("2.5");
    expect(parseQuantityInput("007")).toBe("7");
  });

  it("rechaza cantidades nulas, negativas, con más de 3 decimales o demasiado grandes", () => {
    for (const bad of ["", "0", "0,000", "-1", "1,2345", "1,", "abc", "1.2.3", "12.34.56", "1234567890"]) {
      expect(parseQuantityInput(bad), bad).toBeNull();
    }
  });

  it("pasa porcentajes a puntos básicos entre 0 y 100", () => {
    expect(parsePercentInput("21")).toBe(2100);
    expect(parsePercentInput("12,5")).toBe(1250);
    expect(parsePercentInput("7.25")).toBe(725);
    expect(parsePercentInput("15 %")).toBe(1500);
    expect(parsePercentInput("100")).toBe(10_000);
    expect(parsePercentInput("0")).toBe(0);
    expect(parsePercentInput("100,01")).toBeNull();
    expect(parsePercentInput("-5")).toBeNull();
    expect(parsePercentInput("12,345")).toBeNull();
    expect(parseDiscountInput("")).toBe(0);
    expect(parseDiscountInput("10")).toBe(1000);
  });

  it("los valores guardados vuelven al formulario y se leen igual", () => {
    for (const cents of [0, 5, 15_000, 123_456, -37_500, 473_000]) {
      expect(parseMoneyInput(centsToInput(cents))).toBe(cents);
    }
    expect(centsToInput(123_456)).toBe("1234,56");
    expect(centsToInput(-5)).toBe("-0,05");
    expect(bpsToInput(1250)).toBe("12,5");
    expect(bpsToInput(1205)).toBe("12,05");
    expect(bpsToInput(2100)).toBe("21");
    for (const bps of [0, 700, 1250, 1205, 10_000]) expect(parsePercentInput(bpsToInput(bps))).toBe(bps);
    expect(quantityToInput(1.5)).toBe("1,5");
    expect(parseQuantityInput(quantityToInput(0.125))).toBe("0.125");
  });

  it("separa y valida los destinatarios de un email", () => {
    expect(parseEmailList("Ana@Cliente.es, pagos@cliente.es; ana@cliente.es")).toEqual(["ana@cliente.es", "pagos@cliente.es"]);
    expect(parseEmailList("")).toBeNull();
    expect(parseEmailList("ana@cliente.es, no-es-un-email")).toBeNull();
    expect(parseEmailList(Array.from({ length: 11 }, (_, i) => `a${i}@x.es`).join(","))).toBeNull();
  });
});

describe("borrador de factura", () => {
  const ordinary = draftFormSchema({ kind: "ordinary", today: TODAY });

  it("acepta un borrador completo", () => {
    expect(messages(ordinary.safeParse(draft()))).toEqual([]);
  });

  it("exige el tipo de facturación de cada línea, también en las manuales", () => {
    const r = ordinary.safeParse(draft({ lines: [line({ billing_type: "" })] }));
    expect(messages(r)).toEqual(["lines.0.billing_type:billingTypeRequired"]);
  });

  it("marca a la vez todos los campos mal escritos de una línea", () => {
    const r = ordinary.safeParse(
      draft({ lines: [line({ description: " ", quantity: "0", unit_price: "12,345", discount: "120", tax_rate_id: "" })] }),
    );
    expect(messages(r)).toEqual([
      "lines.0.description:required",
      "lines.0.quantity:quantity",
      "lines.0.unit_price:money",
      "lines.0.discount:rate",
      "lines.0.tax_rate_id:vatRequired",
    ]);
  });

  it("un precio vacío es obligatorio y uno negativo solo vale en una rectificativa", () => {
    expect(messages(ordinary.safeParse(draft({ lines: [line({ unit_price: "" })] })))).toEqual(["lines.0.unit_price:required"]);
    expect(messages(ordinary.safeParse(draft({ lines: [line({ unit_price: "-150,00" })] })))).toEqual([
      "lines.0.unit_price:negativePrice",
    ]);
    const rectifying = draftFormSchema({ kind: "rectifying", today: TODAY });
    expect(messages(rectifying.safeParse(draft({ rectification_reason: "Precio mal aplicado", lines: [line({ unit_price: "-150,00" })] })))).toEqual([]);
  });

  it("una rectificativa necesita su motivo", () => {
    const rectifying = draftFormSchema({ kind: "rectifying", today: TODAY });
    expect(messages(rectifying.safeParse(draft({ rectification_reason: "  " })))).toEqual(["rectification_reason:required"]);
  });

  it("no admite fecha de emisión futura; vacía se emite con la fecha del día", () => {
    expect(messages(ordinary.safeParse(draft({ issued_on: "2026-09-27" })))).toEqual(["issued_on:futureDate"]);
    expect(messages(ordinary.safeParse(draft({ issued_on: TODAY })))).toEqual([]);
    expect(messages(ordinary.safeParse(draft({ issued_on: "2026-02-30" })))).toEqual(["issued_on:date"]);
  });

  it("el vencimiento va por plazo (0-365 días) o en una fecha que no sea anterior a la emisión", () => {
    expect(messages(ordinary.safeParse(draft({ payment_terms_days: "400" })))).toEqual(["payment_terms_days:days"]);
    expect(messages(ordinary.safeParse(draft({ due_mode: "date" })))).toEqual(["due_on:required"]);
    expect(messages(ordinary.safeParse(draft({ due_mode: "date", issued_on: "2026-09-20", due_on: "2026-09-10" })))).toEqual([
      "due_on:dueBeforeIssue",
    ]);
    expect(messages(ordinary.safeParse(draft({ due_mode: "date", issued_on: "2026-09-20", due_on: "2026-10-20" })))).toEqual([]);
  });

  it("el periodo de una línea lleva inicio y fin, en orden", () => {
    expect(messages(ordinary.safeParse(draft({ lines: [line({ period_end: "" })] })))).toEqual(["lines.0.period_end:periodBoth"]);
    expect(messages(ordinary.safeParse(draft({ lines: [line({ period_start: "" })] })))).toEqual([
      "lines.0.period_start:periodBoth",
    ]);
    expect(messages(ordinary.safeParse(draft({ lines: [line({ period_start: "2026-09-30", period_end: "2026-09-01" })] })))).toEqual([
      "lines.0.period_end:periodOrder",
    ]);
    expect(messages(ordinary.safeParse(draft({ lines: [line({ period_start: "", period_end: "" })] })))).toEqual([]);
  });

  it("una factura manual nace con al menos una línea; un borrador guardado puede quedarse vacío", () => {
    const create = draftFormSchema({ kind: "ordinary", today: TODAY, minLines: 1 });
    expect(messages(create.safeParse(draft({ lines: [] })))).toEqual(["lines:linesRequired"]);
    expect(messages(ordinary.safeParse(draft({ lines: [] })))).toEqual([]);
  });

  it("exige emisor y cliente", () => {
    expect(messages(ordinary.safeParse(draft({ issuer_id: "", client_id: "" })))).toEqual([
      "issuer_id:issuerRequired",
      "client_id:clientRequired",
    ]);
  });
});

describe("cobros, emails y rectificativas", () => {
  const payment = paymentFormSchema(TODAY);
  const base = { amount: "1.089,00", paid_on: TODAY, method: "transfer" as const, reference: "" };

  it("un cobro lleva importe distinto de 0 (negativo = devolución) y fecha no futura", () => {
    expect(payment.safeParse(base).success).toBe(true);
    expect(payment.safeParse({ ...base, amount: "-200" }).success).toBe(true);
    expect(messages(payment.safeParse({ ...base, amount: "0,00" }))).toEqual(["amount:amountZero"]);
    expect(messages(payment.safeParse({ ...base, amount: "" }))).toEqual(["amount:required"]);
    expect(messages(payment.safeParse({ ...base, amount: "1,2,3" }))).toEqual(["amount:money"]);
    expect(messages(payment.safeParse({ ...base, paid_on: "2026-10-01" }))).toEqual(["paid_on:paidInFuture"]);
  });

  it("un email necesita destinatarios válidos, asunto y mensaje", () => {
    expect(emailFormSchema.safeParse({ to: "ana@cliente.es", subject: "Factura 2026-0039", body: "Hola" }).success).toBe(true);
    expect(messages(emailFormSchema.safeParse({ to: "ana@", subject: "", body: "" }))).toEqual([
      "to:emails",
      "subject:required",
      "body:required",
    ]);
  });

  it("una rectificativa necesita su motivo", () => {
    expect(rectifyFormSchema.safeParse({ mode: "full", reason: "Error en el precio" }).success).toBe(true);
    expect(messages(rectifyFormSchema.safeParse({ mode: "partial", reason: " " }))).toEqual(["reason:required"]);
  });
});

describe("listado", () => {
  it("lee la pestaña de la URL; lo desconocido son todas", () => {
    expect(readListFilter("overdue")).toBe("overdue");
    expect(readListFilter("nope")).toBe("all");
    expect(readListFilter(undefined)).toBe("all");
    expect(statusesFor("draft")).toEqual(["draft", "issuing"]);
    expect(statusesFor("all")).toBeNull();
  });

  it("limpia la búsqueda de lo que tiene significado en un filtro de PostgREST", () => {
    expect(sanitizeSearch("  2026-0039 ")).toBe("2026-0039");
    expect(sanitizeSearch("Café, (del) Port*")).toBe("Café del Port");
    expect(sanitizeSearch(42)).toBe("");
    expect(sanitizeSearch("x".repeat(100))).toHaveLength(60);
  });
});
