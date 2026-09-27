import { describe, expect, it } from "vitest";
import { INVOICE_FIXTURES } from "./fixtures";
import { buildImportPayload, computeTotals, type ImportForm, initialForm, readiness, validateForm } from "./form";
import { type ImportSetup, matchClient, matchIssuer, matchSeries, matchVatRate, suggestSeriesFormat, taxIdKey } from "./match";
import { parseInvoiceText } from "./parse";
import { emptyExtraction, emptyParty, field } from "./types";

const setup: ImportSetup = {
  today: "2026-09-27",
  orgPaymentTermsDays: 30,
  issuers: [
    {
      id: "iss-marc",
      name: "Marc Sanjuan",
      legalName: "Marc Sanjuan Sard",
      taxId: "12345678Z",
      kind: "self_employed",
      activeFrom: "2020-01-01",
      activeUntil: null,
      archived: false,
      isPrimary: false,
      defaultIrpfBps: 1500,
    },
    {
      id: "iss-sl",
      name: "GNERAI",
      legalName: "GNERAI SL",
      taxId: "B09876541",
      kind: "company",
      activeFrom: "2024-01-01",
      activeUntil: null,
      archived: false,
      isPrimary: true,
      defaultIrpfBps: 0,
    },
  ],
  series: [
    { id: "ser-marc", issuerId: "iss-marc", code: "F", name: "Facturas", format: "{yyyy}-{n:4}", resetYearly: true, isDefault: true, archived: false },
    { id: "ser-marc-old", issuerId: "iss-marc", code: "MS", name: "Antigua", format: "MS-{yyyy}/{n:3}", resetYearly: true, isDefault: false, archived: true },
    { id: "ser-sl", issuerId: "iss-sl", code: "A", name: "Facturas SL", format: "A-{yyyy}-{n:4}", resetYearly: true, isDefault: true, archived: false },
  ],
  vatRates: [
    { id: "vat21", name: "IVA 21 %", rateBps: 2100, regime: "general", legalNote: null, isDefault: true },
    { id: "vat10", name: "IVA 10 %", rateBps: 1000, regime: "general", legalNote: null, isDefault: false },
    { id: "exempt", name: "Exento", rateBps: 0, regime: "exempt", legalNote: "Operación exenta de IVA (art. 20 LIVA)", isDefault: false },
    { id: "isp", name: "Inversión del sujeto pasivo", rateBps: 0, regime: "reverse_charge_eu", legalNote: "Inversión del sujeto pasivo", isDefault: false },
  ],
  irpfRates: [{ id: "irpf15", name: "IRPF 15 %", rateBps: 1500, regime: null, legalNote: null, isDefault: true }],
  clients: [
    { id: "cli-port", name: "Restaurant del Port", legalName: "Restaurant del Port SL", taxId: "B12345674", paymentTermsDays: 15 },
    { id: "cli-llevant", name: "Hotel Llevant", legalName: null, taxId: null, paymentTermsDays: null },
  ],
  mandates: [],
};

const app = INVOICE_FIXTURES.find((f) => f.name === "app de facturas")!;
const appExtraction = parseInvoiceText(app.text, { issuerTaxIds: ["12345678Z", "B09876541"] });

function formFor(overrides: Partial<ImportForm> = {}) {
  const { form, matches } = initialForm(appExtraction, setup, { defaultDescription: "Servicios profesionales" });
  return { form: { ...form, ...overrides }, matches };
}

describe("emparejar con la org", () => {
  it("el NIF se compara sin separadores ni el prefijo ES", () => {
    expect(taxIdKey("ES-B12345674")).toBe("B12345674");
    expect(taxIdKey(" b-1234567-4 ")).toBe("B12345674");
    expect(taxIdKey("FR12345678901")).toBe("FR12345678901");
    expect(taxIdKey("")).toBeNull();
  });

  it("emisor por su NIF; si el lector los cruzó, también; si no, el único o el principal (a revisar)", () => {
    const party = (taxId: string) => ({ ...emptyParty(), taxId: field(taxId, "high" as const) });
    expect(matchIssuer({ issuer: party("12345678Z"), recipient: party("B12345674") }, setup)).toEqual({ issuerId: "iss-marc", confidence: "high", swapped: false });
    expect(matchIssuer({ issuer: party("B12345674"), recipient: party("ESB09876541") }, setup)).toEqual({ issuerId: "iss-sl", confidence: "medium", swapped: true });
    expect(matchIssuer({ issuer: emptyParty(), recipient: emptyParty() }, setup)).toEqual({ issuerId: "iss-sl", confidence: "low", swapped: false });
  });

  it("cliente por NIF o por nombre exacto y único (sin contradecir el NIF)", () => {
    expect(matchClient({ ...emptyParty(), taxId: field("B12345674", "high") }, setup)).toEqual({ clientId: "cli-port", confidence: "high", by: "taxId" });
    expect(matchClient({ ...emptyParty(), name: field("HOTEL LLEVANT", "medium") }, setup)).toEqual({ clientId: "cli-llevant", confidence: "medium", by: "name" });
    expect(matchClient({ ...emptyParty(), name: field("Restaurant del Port SL", "medium"), taxId: field("B65432106", "high") }, setup)).toBeNull();
    expect(matchClient({ ...emptyParty(), name: field("Otro", "low") }, setup)).toBeNull();
  });

  it("serie por el formato del número (también una archivada, y con la serie impresa aparte)", () => {
    expect(matchSeries({ number: "2025-0036", issuerId: "iss-marc", issuedOn: "2025-03-15" }, setup)).toEqual({ seriesId: "ser-marc", number: "2025-0036", sequence: 36, year: 2025 });
    expect(matchSeries({ number: "MS-2023/007", issuerId: "iss-marc", issuedOn: "2023-05-01" }, setup)?.seriesId).toBe("ser-marc-old");
    expect(matchSeries({ number: "2025-0007", issuerId: "iss-sl", issuedOn: "2025-01-10", seriesCode: "A" }, setup)).toEqual({ seriesId: "ser-sl", number: "A-2025-0007", sequence: 7, year: 2025 });
    expect(matchSeries({ number: "F25/12", issuerId: "iss-marc", issuedOn: "2025-01-10" }, setup)).toBeNull();
  });

  it.each([
    ["2025-0042", 2025, "{yyyy}-{n:4}"],
    ["MS-2025/007", 2025, "MS-{yyyy}/{n:3}"],
    ["F25/12", 2025, "F{yy}/{n}"],
    ["INV-2025-007", 2025, "INV-{yyyy}-{n:3}"],
    ["42", 2025, "{n}"],
    ["2024/118", 2024, "{yyyy}/{n}"],
  ])("formato de serie para «%s» → %s", (number, year, format) => {
    expect(suggestSeriesFormat(number, year)).toBe(format);
  });

  it("tipo de IVA de la org por porcentaje y régimen", () => {
    expect(matchVatRate(2100, null, setup)?.id).toBe("vat21");
    expect(matchVatRate(1000, "general", setup)?.id).toBe("vat10");
    expect(matchVatRate(0, "reverse_charge_eu", setup)?.id).toBe("isp");
    expect(matchVatRate(0, null, setup)?.id).toBe("exempt");
    expect(matchVatRate(null, null, setup)?.id).toBe("vat21");
  });
});

describe("el formulario rellenado con lo leído", () => {
  it("emisor, cliente, serie, líneas y cobro pendiente (el PDF no dice que esté cobrada)", () => {
    const { form, matches } = formFor();
    expect(matches.issuer.issuerId).toBe("iss-marc");
    expect(form).toMatchObject({
      clientId: "cli-port",
      newClient: null,
      issuerId: "iss-marc",
      seriesId: "ser-marc",
      number: "2025-0036",
      issuedOn: "2025-03-15",
      dueOn: "2025-04-14",
      irpfBps: 1500,
      payment: { status: "pending", paidOn: "", amount: "954,00", method: "transfer" },
      pdf: { vatCents: 18_900, irpfCents: 13_500, totalCents: 95_400 },
    });
    expect(form.lines.map((l) => [l.description, l.quantity, l.unitPrice, l.taxRateId, l.irpfApplies, l.billingType])).toEqual([
      ["Mantenimiento web marzo 2025", "1", "150,00", "vat21", true, "monthly"],
      ["Campaña Meta Ads · marzo", "1", "750,00", "vat21", true, "usage"],
    ]);
    const totals = computeTotals(form, setup);
    expect(totals).toMatchObject({ subtotalCents: 90_000, vatCents: 18_900, irpfCents: 13_500, totalCents: 95_400, pdfDiffCents: 0, adjustedCents: 0 });
    expect(validateForm(form, setup)).toEqual([]);
    expect(readiness(form, appExtraction, matches, [], totals, false)).toEqual({ status: "ready", reasons: [] });
  });

  it("cobrada con su fecha de cobro cuando el PDF la trae", () => {
    const catalan = INVOICE_FIXTURES.find((f) => f.name === "catalán con fecha de cobro")!;
    const { form } = initialForm(parseInvoiceText(catalan.text), setup, { defaultDescription: "Servicios" });
    expect(form.payment).toMatchObject({ status: "paid", paidOn: "2024-03-28" });
    expect(form.issuedOn).toBe("2024-03-03");
  });

  it("sin cliente con ese NIF: propone darlo de alta con los datos de la factura", () => {
    const holded = INVOICE_FIXTURES.find((f) => f.name === "Holded")!;
    const { form } = initialForm(parseInvoiceText(holded.text, { issuerTaxIds: ["B09876541"] }), setup, { defaultDescription: "Servicios" });
    expect(form.clientId).toBeNull();
    expect(form.newClient).toEqual({
      name: "Clínica Dental Mar Blau SL",
      legalName: "Clínica Dental Mar Blau SL",
      taxId: "B65432106",
      address: "Avinguda del Maresme 45",
      postalCode: "08302",
      city: "Mataró",
      province: "Barcelona",
      countryCode: "ES",
    });
  });

  it("abierto desde la ficha de un cliente: ese cliente, aunque el PDF diga otro", () => {
    const { form, matches } = initialForm(appExtraction, setup, { defaultDescription: "Servicios", lockedClientId: "cli-llevant" });
    expect(form.clientId).toBe("cli-llevant");
    expect(matches.locked).toBe(true);
  });

  it("sin tabla: una línea con la base y el concepto por defecto", () => {
    const pending = INVOICE_FIXTURES.find((f) => f.name === "pendiente, sin tabla ni total")!;
    const { form } = initialForm(parseInvoiceText(pending.text, { issuerTaxIds: ["12345678Z"] }), setup, { defaultDescription: "Servicios profesionales" });
    expect(form.lines).toHaveLength(1);
    expect(form.lines[0]).toMatchObject({ description: "Servicios profesionales", quantity: "1", unitPrice: "640,00", taxRateId: "vat21", irpfApplies: true });
    expect(computeTotals(form, setup).totalCents).toBe(67_840);
  });
});

describe("importes, validación y lo que se guarda", () => {
  it("cuadra al céntimo con el PDF un redondeo de la herramienta antigua (IVA sobre el total)", () => {
    const { form } = formFor({
      irpfBps: 0,
      lines: [
        { key: "a", description: "Uno", quantity: "1", unitPrice: "1,25", discount: "", taxRateId: "vat21", irpfApplies: false, billingType: "one_off", periodStart: "", periodEnd: "" },
        { key: "b", description: "Dos", quantity: "1", unitPrice: "1,25", discount: "", taxRateId: "vat21", irpfApplies: false, billingType: "one_off", periodStart: "", periodEnd: "" },
      ],
      pdf: { vatCents: 53, irpfCents: 0, totalCents: 303 },
    });
    const totals = computeTotals(form, setup);
    expect(totals).toMatchObject({ vatCents: 53, totalCents: 303, adjustedCents: 1, pdfDiffCents: 0 });
    // Más de un céntimo por línea no es un redondeo: no se toca y se avisa.
    const off = computeTotals({ ...form, pdf: { vatCents: 60, irpfCents: 0, totalCents: 310 } }, setup);
    expect(off).toMatchObject({ vatCents: 52, adjustedCents: 0, pdfDiffCents: -8 });
    expect(validateForm({ ...form, pdf: { vatCents: 60, irpfCents: 0, totalCents: 310 } }, setup).map((i) => i.code)).toContain("pdf_total_mismatch");
  });

  it("errores que impiden guardar", () => {
    const { form } = formFor({ clientId: null, number: "25-36", issuedOn: "2027-01-01" });
    const codes = validateForm(form, setup).map((i) => [i.code, i.severity]);
    expect(codes).toEqual(
      expect.arrayContaining([
        ["client_required", "error"],
        ["issued_on_future", "error"],
        ["number_format", "error"],
      ]),
    );
    const numberIssue = validateForm({ ...form, issuedOn: "2025-03-15" }, setup).find((i) => i.code === "number_format")!;
    expect(numberIssue.params).toEqual({ format: "{yyyy}-{n:4}", suggested: "{yy}-{n}" });
  });

  it("el emisor tenía que estar de alta en la fecha de la factura", () => {
    const { form } = formFor({ issuerId: "iss-sl", seriesId: "ser-sl", number: "A-2023-0001", issuedOn: "2023-05-01" });
    expect(validateForm(form, setup).map((i) => i.code)).toContain("issuer_inactive");
  });

  it("cobrada exige su fecha de cobro; parcial, un importe entre 0 y el total", () => {
    const { form } = formFor();
    const paid = { ...form, payment: { ...form.payment, status: "paid" as const, paidOn: "" } };
    expect(validateForm(paid, setup).map((i) => i.code)).toEqual(["paid_on_required"]);
    const future = { ...form, payment: { ...form.payment, status: "paid" as const, paidOn: "2026-10-01" } };
    expect(validateForm(future, setup).map((i) => i.code)).toEqual(["paid_on_future"]);
    const early = { ...form, payment: { ...form.payment, status: "paid" as const, paidOn: "2025-03-01" } };
    expect(validateForm(early, setup)).toEqual([{ code: "paid_before_issue", severity: "warning", field: "paidOn" }]);
    const partial = { ...form, payment: { ...form.payment, status: "partial" as const, paidOn: "2025-04-01", amount: "954,00" } };
    expect(validateForm(partial, setup).map((i) => i.code)).toEqual(["partial_amount"]);
  });

  it("lo que recibe import_historical_invoice: número con su secuencia, líneas calculadas y el cobro con su fecha", () => {
    const { form } = formFor({ payment: { status: "partial", paidOn: "2025-04-30", amount: "500,00", method: "transfer", reference: "Transf. 123" } });
    const result = buildImportPayload(form, setup);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload).toMatchObject({
      external_id: "invoice:iss-marc:2025-0036",
      issuer_id: "iss-marc",
      series_id: "ser-marc",
      client_id: "cli-port",
      number: "2025-0036",
      sequence: 36,
      number_year: 2025,
      kind: "ordinary",
      issued_on: "2025-03-15",
      due_on: "2025-04-14",
      irpf_bps: 1500,
      totals: { subtotal_cents: 90_000, vat_cents: 18_900, irpf_cents: 13_500, total_cents: 95_400 },
      payment: { paid_on: "2025-04-30", amount_cents: 50_000, method: "transfer", reference: "Transf. 123" },
    });
    expect(result.payload.lines[0]).toEqual({
      position: 0,
      description: "Mantenimiento web marzo 2025",
      quantity: "1",
      unit_price_cents: 15_000,
      discount_bps: 0,
      base_cents: 15_000,
      tax_rate_id: "vat21",
      vat_bps: 2100,
      vat_regime: "general",
      vat_cents: 3150,
      irpf_applies: true,
      irpf_cents: 2250,
      legal_note: null,
      billing_type: "monthly",
      period_start: null,
      period_end: null,
    });
    // Cobrada: el cobro es el total, en su propia fecha. Pendiente: sin cobro.
    const paid = buildImportPayload({ ...form, payment: { ...form.payment, status: "paid", paidOn: "2025-05-02" } }, setup);
    expect(paid.ok && paid.payload.payment).toEqual({ paid_on: "2025-05-02", amount_cents: 95_400, method: "transfer", reference: "Transf. 123" });
    const pending = buildImportPayload({ ...form, payment: { ...form.payment, status: "pending" } }, setup);
    expect(pending.ok && pending.payload.payment).toBeNull();
  });

  it("un tipo al 0 % con régimen lleva su mención legal", () => {
    const { form } = formFor({ irpfBps: 0, lines: [{ key: "x", description: "Web", quantity: "1", unitPrice: "100,00", discount: "", taxRateId: "isp", irpfApplies: false, billingType: "one_off", periodStart: "", periodEnd: "" }], pdf: { vatCents: 0, irpfCents: 0, totalCents: 10_000 } });
    const result = buildImportPayload(form, setup);
    expect(result.ok && result.payload.lines[0]).toMatchObject({ vat_bps: 0, vat_regime: "reverse_charge_eu", vat_cents: 0, legal_note: "Inversión del sujeto pasivo" });
  });

  it("con errores no hay payload", () => {
    const result = buildImportPayload(formFor({ clientId: null }).form, setup);
    expect(result.ok).toBe(false);
  });

  it("a revisar: cliente por nombre, emisor supuesto, total que no cuadra o documento raro", () => {
    const { form, matches } = formFor();
    const totals = computeTotals(form, setup);
    expect(readiness(form, appExtraction, { ...matches, client: { clientId: "cli-port", confidence: "medium", by: "name" } }, [], totals, false).reasons).toEqual(["client_by_name"]);
    expect(readiness(form, appExtraction, { ...matches, issuer: { ...matches.issuer, confidence: "low" } }, [], totals, false).reasons).toEqual(["issuer_guessed"]);
    expect(readiness(form, { ...appExtraction, warnings: ["rectifying"] }, matches, [], totals, false).reasons).toEqual(["document_warning"]);
    const noClient = { ...form, clientId: null };
    expect(readiness(noClient, appExtraction, matches, validateForm(noClient, setup), computeTotals(noClient, setup), false).reasons).toEqual(["errors", "client_missing"]);
    const unknown = emptyExtraction();
    expect(readiness(form, unknown, matches, [], totals, false).reasons).toEqual(expect.arrayContaining(["date_unsure"]));
    // Revisada a mano: basta con que no tenga errores.
    expect(readiness(form, unknown, matches, [], totals, true)).toEqual({ status: "ready", reasons: [] });
  });
});
