import { describe, expect, it, vi } from "vitest";
import type { ClaudeInvoice } from "@/domain/invoice-import/claude-output";
import { decimalToCents, fromClaudeOutput } from "@/domain/invoice-import/claude-output";
import { emptyExtraction } from "@/domain/invoice-import/types";
import { buildRequest, ClaudeReadError, INVOICE_READER_MODEL, type MessagesApi, readWithClaude } from "./claude";
import { extractInvoice } from "./engine";

// El lector con Claude con un doble de la API: la petición (modelo, PDF como documento, salida
// estructurada, fallback por política), la validación de lo que vuelve y la vuelta al lector de
// texto ante cualquier fallo, sin registrar nada de la factura.

const t = (value: string | null, confidence: "high" | "medium" | "low" = "high") => ({ value, confidence });
const party = (name: string | null, taxId: string | null) => ({
  name: t(name),
  tax_id: t(taxId),
  address: t(null),
  postal_code: t(null),
  city: t(null),
  province: t(null),
  country_code: t(null),
});

const output: ClaudeInvoice = {
  is_invoice: true,
  rectifying: false,
  currency: "EUR",
  invoice_number: t("2025-0036"),
  series: t(null),
  issue_date: t("2025-03-15"),
  operation_date: t(null),
  due_date: t("2025-04-14"),
  issuer: party("Marc Sanjuan Sard", "12345678Z"),
  recipient: { ...party("Restaurant del Port SL", "B-12345674"), city: t("Mataró"), postal_code: t("08301") },
  taxable_base: t("900.00"),
  vat_rate: t("21"),
  vat_regime: { value: "general", confidence: "high" },
  vat_amount: t("189.00"),
  irpf_rate: t("15"),
  irpf_amount: t("-135.00"),
  total: t("954.00"),
  lines: [
    { description: "Mantenimiento web", quantity: "1", unit_price: "150.00", discount_percent: null, vat_percent: "21", amount: "150.00", period_start: null, period_end: null },
    { description: "Campaña Meta Ads", quantity: "1.000", unit_price: "750.00", discount_percent: null, vat_percent: "21", amount: "750.00", period_start: "2025-03-01", period_end: "2025-03-31" },
  ],
  payment_method: { value: "transfer", confidence: "high" },
  paid: { value: true, confidence: "high" },
  paid_on: t("2025-04-20"),
};

function message(content: unknown[], stop_reason = "end_turn") {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: INVOICE_READER_MODEL,
    content,
    stop_reason,
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 1000, output_tokens: 200 },
  } as unknown as Awaited<ReturnType<MessagesApi["create"]>>;
}

function fakeApi(response: Awaited<ReturnType<MessagesApi["create"]>> | Error): MessagesApi & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    async create(params, options) {
      calls.push({ params, options });
      if (response instanceof Error) throw response;
      return response;
    },
  };
}

const pdf = new TextEncoder().encode("%PDF-1.7 factura inventada");

describe("la petición a Claude", () => {
  it("el modelo por defecto, el PDF como documento, salida estructurada y fallback por política", () => {
    const request = buildRequest(pdf, { issuerTaxIds: ["12345678Z"] });
    expect(request.model).toBe("claude-opus-5-5");
    expect(request.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(request.fallbacks).toBe("default");
    expect(request.thinking).toEqual({ type: "adaptive" });
    expect(request.output_config?.format?.type).toBe("json_schema");
    expect(request.system).toContain("12345678Z");
    const content = request.messages[0]!.content as { type: string; source?: { type: string; media_type: string; data: string } }[];
    expect(content[0]).toMatchObject({ type: "document", source: { type: "base64", media_type: "application/pdf" } });
    expect(Buffer.from(content[0]!.source!.data, "base64").toString()).toBe("%PDF-1.7 factura inventada");
    expect(content[1]!.type).toBe("text");
  });
});

describe("lo que vuelve Claude", () => {
  it("se valida y se convierte a la forma común", async () => {
    const api = fakeApi(message([{ type: "text", text: JSON.stringify(output) }]));
    const e = await readWithClaude(pdf, { issuerTaxIds: ["12345678Z"] }, api);
    expect(e.number).toEqual({ value: "2025-0036", confidence: "high" });
    expect(e.recipient.taxId).toEqual({ value: "B12345674", confidence: "high" });
    expect(e.recipient.countryCode?.value).toBe("ES");
    expect([e.baseCents?.value, e.vatCents?.value, e.irpfCents?.value, e.totalCents?.value]).toEqual([90_000, 18_900, 13_500, 95_400]);
    expect([e.vatBps?.value, e.irpfBps?.value]).toEqual([2100, 1500]);
    expect(e.lines.map((l) => [l.quantity, l.amountCents, l.periodStart, l.confidence])).toEqual([
      ["1", 15_000, null, "high"],
      ["1", 75_000, "2025-03-01", "high"],
    ]);
    expect(e.paid).toEqual({ value: true, confidence: "high" });
    expect(e.paidOn).toEqual({ value: "2025-04-20", confidence: "high" });
    expect(e.warnings).toEqual([]);
    expect(api.calls).toHaveLength(1);
    expect((api.calls[0] as { options: { timeout: number } }).options.timeout).toBeGreaterThan(0);
  });

  it("un NIF con el carácter de control mal o una fecha imposible no se dan por buenos", () => {
    const e = fromClaudeOutput({ ...output, recipient: party("Uno SL", "B12345670"), issue_date: t("2025-02-30") });
    expect(e.recipient.taxId).toBeNull();
    expect(e.issuedOn).toBeNull();
  });

  it("si no cuadra, lo avisa y baja la confianza", () => {
    const e = fromClaudeOutput({ ...output, total: t("999.00") });
    expect(e.warnings).toContain("totals_mismatch");
    expect(e.totalCents?.confidence).toBe("medium");
    expect(fromClaudeOutput({ ...output, rectifying: true, currency: "USD" }).warnings).toEqual(["rectifying", "foreign_currency"]);
  });

  it("importes con o sin decimales, a la española si Claude se despista", () => {
    expect(decimalToCents("1234.5")).toBe(123_450);
    expect(decimalToCents("1.234,56")).toBe(123_456);
    expect(decimalToCents("1,234.56")).toBe(123_456);
    expect(decimalToCents("-90.00")).toBe(-9000);
    expect(decimalToCents("abc")).toBeNull();
  });

  it.each([
    ["un rechazo por política", message([], "refusal")],
    ["una respuesta cortada", message([{ type: "text", text: "{" }], "max_tokens")],
    ["un JSON que no es el esquema", message([{ type: "text", text: JSON.stringify({ hola: 1 }) }])],
    ["algo que no es JSON", message([{ type: "text", text: "no" }])],
  ])("%s no se da por bueno", async (_, response) => {
    await expect(readWithClaude(pdf, {}, fakeApi(response))).rejects.toBeInstanceOf(ClaudeReadError);
  });
});

describe("extractInvoice: Claude y, si falla, el lector de texto", () => {
  it("con Claude", async () => {
    const outcome = await extractInvoice(pdf, {}, { claude: async () => fromClaudeOutput(output), text: async () => emptyExtraction() });
    expect(outcome.engine).toBe("claude");
    expect(outcome.extraction.number?.value).toBe("2025-0036");
  });

  it("si Claude falla, el texto; y en el registro solo el tipo de error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const outcome = await extractInvoice(pdf, {}, {
      claude: async () => {
        throw new ClaudeReadError("refusal");
      },
      text: async () => ({ ...emptyExtraction(), number: { value: "T-1", confidence: "high" } }),
    });
    expect(outcome).toMatchObject({ engine: "text", extraction: { number: { value: "T-1" } } });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("refusal");
    expect(String(warn.mock.calls[0]![0])).not.toContain("factura inventada");
    warn.mockRestore();
  });

  it("sin clave de Claude, directamente el texto", async () => {
    const outcome = await extractInvoice(pdf, {}, { claude: null, text: async () => emptyExtraction(["no_text"]) });
    expect(outcome).toEqual({ engine: "text", extraction: emptyExtraction(["no_text"]) });
  });
});
