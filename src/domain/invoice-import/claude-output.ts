// Lo que devuelve Claude al leer una factura en PDF (salida estructurada con este esquema) y cómo se
// convierte en la misma forma que da el lector de texto. Nada se da por bueno sin comprobarlo: las
// fechas tienen que existir, los importes ser importes, los NIF españoles llevar su carácter de
// control, y si base + IVA − IRPF no da el total, se avisa y la confianza baja.

import { z } from "zod";
import { parseCivilDate } from "../dates/civil-date";
import { classifyTaxId } from "../dataio/values";
import { applyBps } from "../money";
import { percentToBps } from "./tokens";
import {
  type Confidence,
  emptyParty,
  type ExtractedInvoice,
  type ExtractedLine,
  type ExtractedParty,
  type ExtractionWarning,
  type Field,
  field,
  minConfidence,
} from "./types";

const confidence = z.enum(["high", "medium", "low"]);
const text = z.object({ value: z.string().nullable(), confidence });
const party = z.object({
  name: text,
  tax_id: text,
  address: text,
  postal_code: text,
  city: text,
  province: text,
  country_code: text,
});

export const claudeInvoiceSchema = z.object({
  is_invoice: z.boolean(),
  rectifying: z.boolean(),
  currency: z.string().nullable(),
  invoice_number: text,
  series: text,
  issue_date: text,
  operation_date: text,
  due_date: text,
  issuer: party,
  recipient: party,
  taxable_base: text,
  vat_rate: text,
  vat_regime: z.object({ value: z.enum(["general", "exempt", "reverse_charge_eu", "not_subject"]).nullable(), confidence }),
  vat_amount: text,
  irpf_rate: text,
  irpf_amount: text,
  total: text,
  lines: z.array(
    z.object({
      description: z.string(),
      quantity: z.string().nullable(),
      unit_price: z.string().nullable(),
      discount_percent: z.string().nullable(),
      vat_percent: z.string().nullable(),
      amount: z.string(),
      period_start: z.string().nullable(),
      period_end: z.string().nullable(),
    }),
  ),
  payment_method: z.object({ value: z.enum(["transfer", "sepa_debit", "card", "cash", "other"]).nullable(), confidence }),
  paid: z.object({ value: z.boolean().nullable(), confidence }),
  paid_on: text,
});

export type ClaudeInvoice = z.infer<typeof claudeInvoiceSchema>;

/** Las instrucciones: qué es cada campo y cómo escribirlo. */
export function claudeInstructions(issuerTaxIds: readonly string[]): string {
  const own = issuerTaxIds.length > 0 ? issuerTaxIds.join(", ") : "(unknown)";
  return [
    "You read invoices (in Spanish, Catalan or English) that a small digital agency issued to its clients, and return their data with the JSON schema provided.",
    "- Copy what is printed. Never invent a value: use null when a field is not on the document.",
    "- Dates as YYYY-MM-DD. Numeric dates on these invoices are day/month/year.",
    "- Money as a plain decimal string with a dot and two decimals, without thousands separators or currency symbols (\"1234.50\"). Percentages as a number string (\"21\", \"10.5\").",
    `- The issuer is who issued the invoice (the seller); the recipient is the client. The agency invoices with these tax IDs: ${own}. If one of them appears, that party is the issuer.`,
    "- taxable_base is the base imponible (before VAT). vat_amount is the VAT charged (the sum if there are several rates) and vat_rate the rate if there is only one. irpf_amount is the IRPF withholding (retención) as a positive number. total is the amount the client has to pay.",
    "- vat_regime: exempt (exento), reverse_charge_eu (inversión del sujeto pasivo), not_subject (no sujeto) or general.",
    "- lines: one item per invoice line, with its amount before VAT and its service period if printed.",
    "- tax_id: as printed, without spaces. country_code: ISO 3166-1 alpha-2.",
    "- paid is true only if the document says it has been paid (a PAID/PAGADA/COBRADA stamp, \"Pagado el…\"), false if it says it is pending, null otherwise. paid_on is the date the client paid, only if printed; never the due date.",
    "- confidence: high when the value is printed and clearly labelled; medium when it is printed but its label is ambiguous or you inferred it from the layout; low when you are unsure.",
    "- rectifying is true for a corrective invoice (factura rectificativa, abono). is_invoice is false if the document is not an invoice.",
  ].join("\n");
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function dateField(f: ClaudeInvoice["issue_date"]): Field<string> | null {
  if (!f.value || !DATE.test(f.value.trim())) return null;
  try {
    parseCivilDate(f.value.trim());
    return field(f.value.trim(), f.confidence);
  } catch {
    return null;
  }
}

/** «1234.50» (o «1.234,50» si Claude no ha seguido la instrucción) → céntimos. */
export function decimalToCents(value: string | null): number | null {
  if (value === null) return null;
  let t = value.replace(/[\s€]|eur/gi, "");
  if (/^-?\d{1,3}(?:\.\d{3})*,\d{1,2}$/.test(t) || /^-?\d+,\d{1,2}$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
  t = t.replace(/,/g, "");
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  const cents = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) return null;
  return m[1] === "-" && cents !== 0 ? -cents : cents;
}

function moneyField(f: ClaudeInvoice["total"], absolute = false): Field<number> | null {
  const cents = decimalToCents(f.value);
  return cents === null ? null : field(absolute ? Math.abs(cents) : cents, f.confidence);
}

function rateField(f: ClaudeInvoice["vat_rate"]): Field<number> | null {
  if (!f.value) return null;
  const bps = percentToBps(f.value.replace(/\s?%$/, "").replace(/^-/, ""));
  return bps === null ? null : field(bps, f.confidence);
}

function textField(f: ClaudeInvoice["invoice_number"], max = 200): Field<string> | null {
  const value = f.value?.replace(/\s+/g, " ").trim();
  return value ? field(value.slice(0, max), f.confidence) : null;
}

function partyOf(p: ClaudeInvoice["issuer"]): ExtractedParty {
  const out = emptyParty();
  out.name = textField(p.name, 160);
  const country = p.country_code.value?.trim().toUpperCase();
  out.countryCode = country && /^[A-Z]{2}$/.test(country) ? field(country === "EL" ? "GR" : country, p.country_code.confidence) : null;
  if (p.tax_id.value) {
    // Un NIF español con el carácter de control mal no se pasa: se deja vacío para escribirlo bien.
    const classified = classifyTaxId(p.tax_id.value, out.countryCode?.value ?? null);
    if (classified.ok) {
      out.taxId = field(classified.value, p.tax_id.confidence);
      if (!out.countryCode) out.countryCode = field(classified.kind === "es" ? "ES" : classified.value.slice(0, 2), "medium");
    }
  }
  out.address = textField(p.address);
  out.postalCode = textField(p.postal_code, 12);
  out.city = textField(p.city, 80);
  out.province = textField(p.province, 80);
  return out;
}

function lineOf(l: ClaudeInvoice["lines"][number]): ExtractedLine | null {
  const amount = decimalToCents(l.amount);
  const description = l.description.replace(/\s+/g, " ").trim().slice(0, 500);
  if (amount === null || description === "") return null;
  const quantity = l.quantity ? l.quantity.replace(",", ".").replace(/^0+(?=\d)/, "") : null;
  const period = (v: string | null) => (v && DATE.test(v) ? v : null);
  const start = period(l.period_start);
  const end = period(l.period_end);
  return {
    description,
    quantity: quantity && /^\d+(?:\.\d{1,3})?$/.test(quantity) && Number(quantity) > 0 ? quantity.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1") : null,
    unitPriceCents: decimalToCents(l.unit_price),
    discountBps: l.discount_percent ? percentToBps(l.discount_percent.replace(/\s?%$/, "")) : null,
    vatBps: l.vat_percent ? percentToBps(l.vat_percent.replace(/\s?%$/, "")) : null,
    amountCents: amount,
    periodStart: start && end && start <= end ? start : null,
    periodEnd: start && end && start <= end ? end : null,
    confidence: "medium",
  };
}

/** Lo que dice Claude, comprobado y en la forma común (con los avisos que tocan). */
export function fromClaudeOutput(output: ClaudeInvoice): ExtractedInvoice {
  const warnings = new Set<ExtractionWarning>();
  if (!output.is_invoice) warnings.add("not_invoice");
  if (output.rectifying) warnings.add("rectifying");
  if (output.currency && !/^(eur|€|euros?)$/i.test(output.currency.trim())) warnings.add("foreign_currency");

  let base = moneyField(output.taxable_base);
  let vat = moneyField(output.vat_amount);
  let irpf = moneyField(output.irpf_amount, true);
  let total = moneyField(output.total);
  const vatBps = rateField(output.vat_rate);
  const irpfBps = rateField(output.irpf_rate);
  const lines = output.lines.map(lineOf).filter((l): l is ExtractedLine => l !== null);

  if (base && !vat && vatBps) vat = field(applyBps(base.value, vatBps.value), "medium");
  if (base && vat && !total) total = field(base.value + vat.value - (irpf?.value ?? 0), "medium");
  if (base && vat && total && !irpf) {
    const diff = base.value + vat.value - total.value;
    irpf = field(Math.max(0, diff), "medium");
  }
  const cap = (f: Field<number> | null, c: Confidence) => (f ? field(f.value, minConfidence(f.confidence, c)) : null);
  if (base && vat && total && Math.abs(base.value + vat.value - (irpf?.value ?? 0) - total.value) > 1) {
    warnings.add("totals_mismatch");
    base = cap(base, "medium");
    vat = cap(vat, "medium");
    irpf = cap(irpf, "medium");
    total = cap(total, "medium");
  }
  const sum = lines.reduce((s, l) => s + l.amountCents, 0);
  const linesOk = base !== null && lines.length > 0 && Math.abs(sum - base.value) <= Math.max(1, lines.length);
  if (base && lines.length > 0 && !linesOk) warnings.add("lines_mismatch");
  if (new Set(lines.map((l) => l.vatBps).filter((v) => v !== null)).size > 1) warnings.add("multiple_vat_rates");

  return {
    number: textField(output.invoice_number, 40),
    series: textField(output.series, 12),
    issuedOn: dateField(output.issue_date),
    operationOn: dateField(output.operation_date),
    dueOn: dateField(output.due_date),
    issuer: partyOf(output.issuer),
    recipient: partyOf(output.recipient),
    baseCents: base,
    vatBps,
    vatRegime: output.vat_regime.value ? field(output.vat_regime.value, output.vat_regime.confidence) : null,
    vatCents: vat,
    irpfBps,
    irpfCents: irpf,
    totalCents: total,
    lines: lines.map((l) => ({ ...l, confidence: linesOk ? "high" : "medium" })),
    paymentMethod: output.payment_method.value ? field(output.payment_method.value, output.payment_method.confidence) : null,
    paid: output.paid.value === null ? null : field(output.paid.value, output.paid.confidence),
    paidOn: dateField(output.paid_on),
    warnings: [...warnings],
  };
}
