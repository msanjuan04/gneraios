// El formulario que el socio revisa por cada PDF: se rellena con lo leído (initialForm), calcula
// los importes con la única implementación del redondeo (src/domain/tax) cuadrándolos al céntimo
// con lo que imprime el PDF, dice qué falta o no cuadra (validateForm), si la fila está «Lista» o
// hay que «Revisar» (readiness) y construye lo que recibe import_historical_invoice.

import { addDays, compareCivil, type CivilDate, parseCivilDate } from "../dates/civil-date";
import { classifyLine, type ImportBillingType } from "../dataio/classify";
import { parseInvoiceNumber } from "../dataio/invoice-number";
import { invoiceExternalId } from "../dataio/invoices-import";
import { classifyTaxId, type PaymentMethod } from "../dataio/values";
import { parseMoneyInput } from "../money";
import { computeLine, type VatRegime } from "../tax";
import {
  type ClientMatch,
  type ImportSetup,
  type IssuerMatch,
  matchClient,
  matchIssuer,
  matchSeries,
  matchVatRate,
  type SeriesMatch,
  type SetupTaxRate,
  suggestSeriesFormat,
} from "./match";
import { percentToBps, quantityOf } from "./tokens";
import { atLeast, type ExtractedInvoice } from "./types";

export const PAYMENT_STATUSES = ["pending", "paid", "partial"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const BILLING_TYPES = ["one_off", "monthly", "yearly", "usage"] as const satisfies readonly ImportBillingType[];

export type ImportLineForm = {
  key: string;
  description: string;
  /** Como lo escribe el socio: «1», «3,5». */
  quantity: string;
  /** «150,00». */
  unitPrice: string;
  /** Porcentaje, «10»; vacío = sin descuento. */
  discount: string;
  taxRateId: string;
  irpfApplies: boolean;
  billingType: ImportBillingType;
  periodStart: string;
  periodEnd: string;
};

/** El cliente que se propone dar de alta con los datos de la factura. */
export type NewClientDraft = {
  name: string;
  legalName: string;
  taxId: string;
  address: string;
  postalCode: string;
  city: string;
  province: string;
  countryCode: string;
};

export type ImportForm = {
  clientId: string | null;
  newClient: NewClientDraft | null;
  issuerId: string;
  seriesId: string;
  number: string;
  issuedOn: string;
  operationOn: string;
  dueOn: string;
  irpfBps: number;
  lines: ImportLineForm[];
  payment: {
    status: PaymentStatus;
    /** Cuándo pagó el cliente: nada que ver con la fecha de la factura. */
    paidOn: string;
    /** Solo en un cobro parcial; si no, el total. */
    amount: string;
    method: PaymentMethod;
    reference: string;
  };
  /** Lo que imprime el PDF: con qué se cuadran los céntimos y se avisa si no coincide. */
  pdf: { vatCents: number | null; irpfCents: number | null; totalCents: number | null };
};

// ---------------------------------------------------------------------------
// Texto de los campos
// ---------------------------------------------------------------------------

/** 123456 → «1234,56» (lo que `parseMoneyInput` vuelve a leer igual). */
export function centsToInput(cents: number): string {
  const abs = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}${Math.trunc(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

/** 1250 → «12,5»; 0 → «0». */
export function bpsToInput(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const fraction = String(bps % 100).padStart(2, "0").replace(/0+$/, "");
  return fraction ? `${whole},${fraction}` : String(whole);
}

/** «10», «12,5», «7.25 %» → puntos básicos; vacío → 0; null si no es un porcentaje. */
export function discountToBps(text: string): number | null {
  const value = text.trim().replace(/\s?%$/, "");
  return value === "" ? 0 : percentToBps(value);
}

const quantityInput = (quantity: string) => quantity.replace(".", ",");

// ---------------------------------------------------------------------------
// Rellenar con lo leído
// ---------------------------------------------------------------------------

export type FormMatches = { issuer: IssuerMatch; client: ClientMatch | null; series: SeriesMatch | null; locked: boolean };

export type InitialFormOptions = {
  /** Abierto desde la ficha de un cliente (o un proyecto suyo): la factura es de ese cliente. */
  lockedClientId?: string | null;
  /** Concepto de la línea cuando la factura no trae una tabla reconocible. */
  defaultDescription: string;
  /** Para las claves de las líneas (únicas en la lista de ficheros). */
  keyPrefix?: string;
};

export function initialForm(extraction: ExtractedInvoice, setup: ImportSetup, options: InitialFormOptions): { form: ImportForm; matches: FormMatches } {
  const issuer = matchIssuer(extraction, setup);
  const party = issuer.swapped ? extraction.issuer : extraction.recipient;
  const locked = Boolean(options.lockedClientId && setup.clients.some((c) => c.id === options.lockedClientId));
  const client = locked ? null : matchClient(party, setup);
  const clientId = locked ? options.lockedClientId! : (client?.clientId ?? null);

  const issuedOn = extraction.issuedOn?.value ?? "";
  const rawNumber = extraction.number?.value ?? "";
  const series = issuer.issuerId ? matchSeries({ number: rawNumber, issuerId: issuer.issuerId, issuedOn, seriesCode: extraction.series?.value }, setup) : null;
  const fallbackSeries =
    setup.series.find((s) => s.issuerId === issuer.issuerId && s.isDefault && !s.archived) ??
    setup.series.find((s) => s.issuerId === issuer.issuerId && !s.archived) ??
    setup.series.find((s) => s.issuerId === issuer.issuerId);

  const irpfBps = extraction.irpfBps?.value ?? 0;
  const regime = extraction.vatRegime?.value ?? null;
  const rateFor = (bps: number | null) => matchVatRate(bps ?? extraction.vatBps?.value ?? null, regime, setup)?.id ?? "";
  const prefix = options.keyPrefix ?? "l";

  const lines: ImportLineForm[] = extraction.lines.map((line, i) => {
    const quantity = line.quantity ?? "1";
    let unitPrice = line.unitPriceCents;
    let discountBps = line.discountBps ?? 0;
    let qty = quantity;
    // Precio × cantidad tiene que dar la base de la línea; si no cuadra, manda la base.
    if (unitPrice === null || computeLine({ quantity: qty, unitPriceCents: unitPrice, discountBps, vatBps: 0, irpfBps: 0, irpfApplies: false }).baseCents !== line.amountCents) {
      qty = "1";
      unitPrice = line.amountCents;
      discountBps = 0;
    }
    return {
      key: `${prefix}-${i}`,
      description: line.description,
      quantity: quantityInput(qty),
      unitPrice: centsToInput(unitPrice),
      discount: discountBps ? bpsToInput(discountBps) : "",
      taxRateId: rateFor(line.vatBps),
      irpfApplies: irpfBps > 0,
      billingType: classifyLine(line.description).billingType,
      periodStart: line.periodStart ?? "",
      periodEnd: line.periodEnd ?? "",
    };
  });
  if (lines.length === 0) {
    const base = extraction.baseCents?.value ?? null;
    lines.push({
      key: `${prefix}-0`,
      description: options.defaultDescription,
      quantity: "1",
      unitPrice: base !== null ? centsToInput(base) : "",
      discount: "",
      taxRateId: rateFor(null),
      irpfApplies: irpfBps > 0,
      billingType: classifyLine(options.defaultDescription).billingType,
      periodStart: "",
      periodEnd: "",
    });
  }

  const total = extraction.totalCents?.value ?? null;
  const paidHint = extraction.paid?.value === true || (extraction.paidOn !== null && extraction.paid?.value !== false);
  const mandate = clientId !== null && setup.mandates.some((m) => m.clientId === clientId && m.issuerId === issuer.issuerId);

  const form: ImportForm = {
    clientId,
    newClient: clientId ? null : newClientFrom(party),
    issuerId: issuer.issuerId ?? "",
    seriesId: series?.seriesId ?? fallbackSeries?.id ?? "",
    number: series?.number ?? rawNumber,
    issuedOn,
    operationOn: extraction.operationOn?.value ?? "",
    dueOn: extraction.dueOn?.value ?? "",
    irpfBps,
    lines,
    payment: {
      // Cobrada solo si el PDF lo dice (sello o fecha de cobro); si no, pendiente.
      status: paidHint ? "paid" : "pending",
      paidOn: extraction.paidOn?.value ?? "",
      amount: total !== null ? centsToInput(total) : "",
      method: extraction.paymentMethod?.value ?? (mandate ? "sepa_debit" : "transfer"),
      reference: "",
    },
    pdf: { vatCents: extraction.vatCents?.value ?? null, irpfCents: extraction.irpfCents?.value ?? null, totalCents: total },
  };
  return { form, matches: { issuer, client, series, locked } };
}

/** El cliente que se daría de alta con los datos de la factura (con NIF válido o sin NIF). */
export function newClientFrom(party: ExtractedInvoice["recipient"]): NewClientDraft | null {
  const name = party.name?.value ?? "";
  const taxId = party.taxId?.value ?? "";
  if (!name && !taxId) return null;
  return {
    name: name || taxId,
    legalName: name,
    taxId,
    address: party.address?.value ?? "",
    postalCode: party.postalCode?.value ?? "",
    city: party.city?.value ?? "",
    province: party.province?.value ?? "",
    countryCode: party.countryCode?.value ?? "ES",
  };
}

// ---------------------------------------------------------------------------
// Importes
// ---------------------------------------------------------------------------

export type ComputedLine = {
  quantity: string;
  unitPriceCents: number;
  discountBps: number;
  baseCents: number;
  vatCents: number;
  irpfCents: number;
  taxRate: SetupTaxRate;
};

export type FormTotals = {
  /** null si la línea tiene algún dato mal escrito. */
  lines: (ComputedLine | null)[];
  subtotalCents: number;
  vatCents: number;
  irpfCents: number;
  totalCents: number;
  /** Céntimos movidos para cuadrar con el PDF (la herramienta antigua redondeaba sobre el total). */
  adjustedCents: number;
  /** Calculado − impreso; null si el PDF no trae el total. */
  pdfDiffCents: number | null;
};

/**
 * Reparte `diff` céntimos (de uno en uno, empezando por la línea de más base) entre las líneas que
 * pueden llevarlos. Solo si es un redondeo: como mucho un céntimo por línea.
 */
function reconcile(lines: ComputedLine[], pick: "vatCents" | "irpfCents", target: number | null, eligible: (l: ComputedLine) => boolean): number {
  if (target === null) return 0;
  const current = lines.reduce((s, l) => s + l[pick], 0);
  const diff = target - current;
  const order = lines
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => eligible(l))
    .sort((a, b) => Math.abs(b.l.baseCents) - Math.abs(a.l.baseCents));
  if (diff === 0 || order.length === 0 || Math.abs(diff) > order.length) return 0;
  const step = diff > 0 ? 1 : -1;
  for (let k = 0; k < Math.abs(diff); k += 1) order[k]!.l[pick] += step;
  return Math.abs(diff);
}

export function computeTotals(form: ImportForm, setup: Pick<ImportSetup, "vatRates">): FormTotals {
  const lines = form.lines.map((line): ComputedLine | null => {
    const quantity = quantityOf(line.quantity);
    const unitPriceCents = parseMoneyInput(line.unitPrice);
    const discountBps = discountToBps(line.discount);
    const taxRate = setup.vatRates.find((r) => r.id === line.taxRateId);
    if (quantity === null || unitPriceCents === null || discountBps === null || discountBps > 10_000 || !taxRate) return null;
    const amounts = computeLine({
      quantity,
      unitPriceCents,
      discountBps,
      vatBps: taxRate.rateBps,
      irpfBps: form.irpfBps,
      irpfApplies: line.irpfApplies && form.irpfBps > 0,
    });
    return { quantity, unitPriceCents, discountBps, baseCents: amounts.baseCents, vatCents: amounts.vatCents, irpfCents: amounts.irpfCents, taxRate };
  });
  const valid = lines.filter((l): l is ComputedLine => l !== null);
  let adjustedCents = 0;
  if (valid.length === lines.length && valid.length > 0) {
    adjustedCents += reconcile(valid, "vatCents", form.pdf.vatCents, (l) => l.taxRate.rateBps > 0);
    adjustedCents += reconcile(valid, "irpfCents", form.pdf.irpfCents, (l) => l.irpfCents !== 0);
  }
  const subtotalCents = valid.reduce((s, l) => s + l.baseCents, 0);
  const vatCents = valid.reduce((s, l) => s + l.vatCents, 0);
  const irpfCents = valid.reduce((s, l) => s + l.irpfCents, 0);
  const totalCents = subtotalCents + vatCents - irpfCents;
  return {
    lines,
    subtotalCents,
    vatCents,
    irpfCents,
    totalCents,
    adjustedCents,
    pdfDiffCents: form.pdf.totalCents !== null ? totalCents - form.pdf.totalCents : null,
  };
}

// ---------------------------------------------------------------------------
// Validación
// ---------------------------------------------------------------------------

export const FORM_ISSUE_CODES = [
  "client_required",
  "issuer_required",
  "issuer_inactive",
  "series_required",
  "number_required",
  "number_format",
  // Otra factura del emisor ya tiene ese número (lo comprueba el servidor).
  "number_taken",
  "issued_on_required",
  "issued_on_future",
  "date_invalid",
  "due_before_issue",
  "lines_required",
  "line_description",
  "line_quantity",
  "line_price",
  "line_discount",
  "line_tax_rate",
  "line_negative",
  "total_negative",
  "paid_on_required",
  "paid_on_future",
  "paid_before_issue",
  "partial_amount",
  "pdf_total_mismatch",
] as const;

export type FormIssueCode = (typeof FORM_ISSUE_CODES)[number];

export type FormIssue = {
  code: FormIssueCode;
  severity: "error" | "warning";
  field?: string;
  params?: Record<string, string | number>;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
function validDate(value: string): boolean {
  if (!ISO.test(value)) return false;
  try {
    parseCivilDate(value);
    return true;
  } catch {
    return false;
  }
}

/** ¿Estaba de alta el emisor en esa fecha? La misma regla que la base de datos al importar. */
export function issuerActiveOn(issuer: ImportSetup["issuers"][number], on: CivilDate): boolean {
  if (issuer.activeFrom === null && issuer.kind === "company") return false;
  if (issuer.activeFrom !== null && compareCivil(on, issuer.activeFrom) < 0) return false;
  if (issuer.activeUntil !== null && compareCivil(on, issuer.activeUntil) > 0) return false;
  return true;
}

export function validateForm(form: ImportForm, setup: ImportSetup, totals: FormTotals = computeTotals(form, setup)): FormIssue[] {
  const issues: FormIssue[] = [];
  const error = (code: FormIssueCode, field?: string, params?: FormIssue["params"]) => issues.push({ code, severity: "error", field, params });
  const warning = (code: FormIssueCode, field?: string, params?: FormIssue["params"]) => issues.push({ code, severity: "warning", field, params });

  if (!form.clientId) error("client_required", "client");
  const issuer = setup.issuers.find((i) => i.id === form.issuerId);
  if (!issuer) error("issuer_required", "issuer");

  const issuedOk = form.issuedOn !== "" && validDate(form.issuedOn);
  if (form.issuedOn === "") error("issued_on_required", "issuedOn");
  else if (!issuedOk) error("date_invalid", "issuedOn");
  else if (compareCivil(form.issuedOn, setup.today) > 0) error("issued_on_future", "issuedOn");
  if (issuer && issuedOk && !issuerActiveOn(issuer, form.issuedOn)) error("issuer_inactive", "issuer", { name: issuer.name });

  const series = setup.series.find((s) => s.id === form.seriesId && s.issuerId === form.issuerId);
  const number = form.number.trim();
  if (!series) error("series_required", "series");
  if (number === "") error("number_required", "number");
  else if (series) {
    const year = issuedOk ? parseCivilDate(form.issuedOn).year : parseCivilDate(setup.today).year;
    if (!parseInvoiceNumber(series.format, number, year)) {
      error("number_format", "number", { format: series.format, suggested: suggestSeriesFormat(number, year) ?? "" });
    }
  }

  for (const [key, value] of [["operationOn", form.operationOn], ["dueOn", form.dueOn]] as const) {
    if (value !== "" && !validDate(value)) error("date_invalid", key);
  }
  if (issuedOk && form.dueOn !== "" && validDate(form.dueOn) && compareCivil(form.dueOn, form.issuedOn) < 0) warning("due_before_issue", "dueOn");

  if (form.lines.length === 0) error("lines_required", "lines");
  form.lines.forEach((line, i) => {
    const at = `lines.${i}`;
    if (line.description.trim() === "" || line.description.trim().length > 500) error("line_description", `${at}.description`, { line: i + 1 });
    if (quantityOf(line.quantity) === null) error("line_quantity", `${at}.quantity`, { line: i + 1 });
    const price = parseMoneyInput(line.unitPrice);
    if (price === null) error("line_price", `${at}.unitPrice`, { line: i + 1 });
    else if (price < 0) error("line_negative", `${at}.unitPrice`, { line: i + 1 });
    const discount = discountToBps(line.discount);
    if (discount === null || discount > 10_000) error("line_discount", `${at}.discount`, { line: i + 1 });
    if (!setup.vatRates.some((r) => r.id === line.taxRateId)) error("line_tax_rate", `${at}.taxRateId`, { line: i + 1 });
  });
  if (totals.lines.every((l) => l !== null) && totals.totalCents < 0) error("total_negative", "lines");

  const payment = form.payment;
  if (payment.status !== "pending") {
    if (payment.paidOn === "") error("paid_on_required", "paidOn");
    else if (!validDate(payment.paidOn)) error("date_invalid", "paidOn");
    else if (compareCivil(payment.paidOn, setup.today) > 0) error("paid_on_future", "paidOn");
    else if (issuedOk && compareCivil(payment.paidOn, form.issuedOn) < 0) warning("paid_before_issue", "paidOn");
  }
  if (payment.status === "partial") {
    const amount = parseMoneyInput(payment.amount);
    if (amount === null || amount <= 0 || amount >= totals.totalCents) error("partial_amount", "paidAmount", { total: totals.totalCents });
  }

  if (totals.pdfDiffCents !== null && totals.pdfDiffCents !== 0 && totals.lines.every((l) => l !== null)) {
    warning("pdf_total_mismatch", "total", { pdf: form.pdf.totalCents ?? 0, computed: totals.totalCents });
  }
  return issues;
}

// ---------------------------------------------------------------------------
// ¿Lista o a revisar?
// ---------------------------------------------------------------------------

export const REVIEW_REASONS = [
  "errors",
  "client_by_name",
  "client_missing",
  "issuer_guessed",
  "number_unsure",
  "date_unsure",
  "total_unknown",
  "total_mismatch",
  "document_warning",
] as const;

export type ReviewReason = (typeof REVIEW_REASONS)[number];

/**
 * «Lista» si no hay errores, el total calculado es el del PDF y lo importante se ha leído con
 * seguridad: el emisor por su NIF, el cliente por su NIF (o elegido a mano), el número encaja en el
 * formato de la serie y la fecha tiene su etiqueta. Lo que el socio ya ha revisado a mano solo
 * necesita no tener errores.
 */
export function readiness(
  form: ImportForm,
  extraction: ExtractedInvoice,
  matches: FormMatches,
  issues: readonly FormIssue[],
  totals: FormTotals,
  reviewed: boolean,
): { status: "ready" | "review"; reasons: ReviewReason[] } {
  const reasons: ReviewReason[] = [];
  if (issues.some((i) => i.severity === "error")) reasons.push("errors");
  if (!form.clientId) reasons.push("client_missing");
  if (!reviewed) {
    if (form.clientId && !matches.locked && matches.client?.by === "name" && matches.client.clientId === form.clientId) reasons.push("client_by_name");
    if (matches.issuer.confidence === "low" && matches.issuer.issuerId === form.issuerId) reasons.push("issuer_guessed");
    // Un número que encaja en el formato de la serie está confirmado por la propia serie.
    if (!matches.series && !atLeast(extraction.number?.confidence, "high")) reasons.push("number_unsure");
    if (!atLeast(extraction.issuedOn?.confidence, "medium")) reasons.push("date_unsure");
    if (form.pdf.totalCents === null) reasons.push("total_unknown");
    else if (totals.pdfDiffCents !== 0) reasons.push("total_mismatch");
    if (extraction.warnings.some((w) => w !== "multiple_vat_rates" || extraction.lines.length === 0)) reasons.push("document_warning");
  }
  // Revisada a mano y aún descuadrada con el PDF: se puede guardar, y el aviso sigue en el formulario.
  return { status: reasons.length === 0 ? "ready" : "review", reasons: [...new Set(reasons)] };
}

// ---------------------------------------------------------------------------
// Lo que recibe import_historical_invoice
// ---------------------------------------------------------------------------

export type ImportPayload = {
  external_id: string;
  issuer_id: string;
  series_id: string;
  client_id: string;
  number: string;
  sequence: number;
  number_year: number;
  kind: "ordinary";
  issued_on: string;
  operation_on: string | null;
  due_on: string | null;
  irpf_bps: number;
  payment_method: PaymentMethod;
  notes: null;
  totals: { subtotal_cents: number; vat_cents: number; irpf_cents: number; total_cents: number };
  lines: {
    position: number;
    description: string;
    quantity: string;
    unit_price_cents: number;
    discount_bps: number;
    base_cents: number;
    tax_rate_id: string;
    vat_bps: number;
    vat_regime: VatRegime;
    vat_cents: number;
    irpf_applies: boolean;
    irpf_cents: number;
    legal_note: string | null;
    billing_type: ImportBillingType;
    period_start: string | null;
    period_end: string | null;
  }[];
  payment: { paid_on: string; amount_cents: number; method: PaymentMethod; reference: string | null } | null;
};

export type BuildResult = { ok: true; payload: ImportPayload; totals: FormTotals } | { ok: false; issues: FormIssue[] };

export function buildImportPayload(form: ImportForm, setup: ImportSetup): BuildResult {
  const totals = computeTotals(form, setup);
  const issues = validateForm(form, setup, totals);
  if (issues.some((i) => i.severity === "error")) return { ok: false, issues };
  const series = setup.series.find((s) => s.id === form.seriesId)!;
  const number = form.number.trim();
  const parsed = parseInvoiceNumber(series.format, number, parseCivilDate(form.issuedOn).year)!;
  const lines = totals.lines as ComputedLine[];
  const paidAmount = form.payment.status === "partial" ? parseMoneyInput(form.payment.amount)! : totals.totalCents;
  return {
    ok: true,
    totals,
    payload: {
      external_id: invoiceExternalId(form.issuerId, number),
      issuer_id: form.issuerId,
      series_id: series.id,
      client_id: form.clientId!,
      number,
      sequence: parsed.sequence,
      number_year: parsed.year,
      kind: "ordinary",
      issued_on: form.issuedOn,
      operation_on: form.operationOn || null,
      due_on: form.dueOn || null,
      irpf_bps: form.irpfBps,
      payment_method: form.payment.method,
      notes: null,
      totals: {
        subtotal_cents: totals.subtotalCents,
        vat_cents: totals.vatCents,
        irpf_cents: totals.irpfCents,
        total_cents: totals.totalCents,
      },
      lines: form.lines.map((line, position) => {
        const computed = lines[position]!;
        const regime = computed.taxRate.regime ?? "general";
        const period = line.periodStart && line.periodEnd && validDate(line.periodStart) && validDate(line.periodEnd) && line.periodEnd >= line.periodStart;
        return {
          position,
          description: line.description.trim(),
          quantity: computed.quantity,
          unit_price_cents: computed.unitPriceCents,
          discount_bps: computed.discountBps,
          base_cents: computed.baseCents,
          tax_rate_id: computed.taxRate.id,
          vat_bps: computed.taxRate.rateBps,
          vat_regime: regime,
          vat_cents: computed.vatCents,
          irpf_applies: line.irpfApplies && form.irpfBps > 0,
          irpf_cents: computed.irpfCents,
          legal_note: regime === "general" ? null : (computed.taxRate.legalNote?.trim() || null),
          billing_type: line.billingType,
          period_start: period ? line.periodStart : null,
          period_end: period ? line.periodEnd : null,
        };
      }),
      payment:
        form.payment.status === "pending" || totals.totalCents === 0
          ? null
          : { paid_on: form.payment.paidOn, amount_cents: paidAmount, method: form.payment.method, reference: form.payment.reference.trim() || null },
    },
  };
}

/** El vencimiento que pondrá la base de datos si se deja vacío: la fecha + el plazo del cliente o de la org. */
export function defaultDueOn(form: Pick<ImportForm, "issuedOn" | "clientId">, setup: ImportSetup): CivilDate | null {
  if (!validDate(form.issuedOn)) return null;
  const terms = setup.clients.find((c) => c.id === form.clientId)?.paymentTermsDays ?? setup.orgPaymentTermsDays;
  return addDays(form.issuedOn, terms);
}

/** ¿El NIF de la propuesta de cliente se puede guardar? (vacío también vale). */
export function newClientTaxIdValid(draft: Pick<NewClientDraft, "taxId" | "countryCode">): boolean {
  if (draft.taxId.trim() === "") return true;
  return classifyTaxId(draft.taxId, draft.countryCode || "ES").ok;
}
