import { formatMoney } from "@/domain/money";
import { formatPdfDate, intlLocale } from "./format";
import type { QuoteDocumentData, QuotePdfLine } from "./quote-types";
import type { PdfLocale, PdfParty } from "./types";

// Lo que imprime la propuesta (la del PDF oscuro con portada, no el presupuesto formal): todo
// resuelto a texto, para que la plantilla solo maquete y las reglas se prueben sin generar el PDF.
// Sale del mismo presupuesto que el formal: las cifras no se calculan aquí, se leen de lo ya hecho.

export type ProposalPrice = { label: string; name: string; amount: string; suffix: string };

export type ProposalScopeItem = { number: string; title: string; points: string[] };

export type ProposalSection = {
  kicker: string;
  title: string;
  price: { amount: string; suffix: string; lines: string[] };
  items: ProposalScopeItem[];
};

export type ProposalView = {
  language: PdfLocale;
  coverKicker: string;
  title: string;
  preparedFor: string;
  prices: ProposalPrice[];
  footerLeft: string;
  footerRight: string;
  intro: { kicker: string; title: string; paragraphs: string[] } | null;
  sections: ProposalSection[];
  payments: { title: string; rows: { label: string; detail: string; amount: string }[] } | null;
  conditions: { title: string; lines: string[] } | null;
  contactLine: string;
};

const COPY: Record<PdfLocale, Record<string, string>> = {
  es: {
    kicker: "PROPUESTA · PRECIO CERRADO", preparedFor: "Preparada para {client}", oneOff: "Pago único", monthly: "Cuota mensual",
    yearly: "Cuota anual", vat: "+ IVA", vatMonth: "+ IVA / mes", vatYear: "+ IVA / año", validity: "Validez {days} días",
    summary: "RESUMEN", scope: "ALCANCE", payments: "PLAN DE PAGOS", conditions: "CONDICIONES", option: "OPCIÓN",
    atAccept: "A la aceptación", atDelivery: "A la entrega", priceClosed: "Precio cerrado", included: "Incluye lo que ves a continuación.",
    hello: "Hola {client}, te presentamos nuestra propuesta con precio cerrado.",
  },
  ca: {
    kicker: "PROPOSTA · PREU TANCAT", preparedFor: "Preparada per a {client}", oneOff: "Pagament únic", monthly: "Quota mensual",
    yearly: "Quota anual", vat: "+ IVA", vatMonth: "+ IVA / mes", vatYear: "+ IVA / any", validity: "Validesa {days} dies",
    summary: "RESUM", scope: "ABAST", payments: "PLA DE PAGAMENTS", conditions: "CONDICIONS", option: "OPCIÓ",
    atAccept: "A l'acceptació", atDelivery: "Al lliurament", priceClosed: "Preu tancat", included: "Inclou el que veus a continuació.",
    hello: "Hola {client}, et presentem la nostra proposta amb preu tancat.",
  },
  en: {
    kicker: "PROPOSAL · FIXED PRICE", preparedFor: "Prepared for {client}", oneOff: "One-off", monthly: "Monthly fee",
    yearly: "Yearly fee", vat: "+ VAT", vatMonth: "+ VAT / month", vatYear: "+ VAT / year", validity: "Valid for {days} days",
    summary: "SUMMARY", scope: "SCOPE", payments: "PAYMENT PLAN", conditions: "TERMS", option: "OPTION",
    atAccept: "On acceptance", atDelivery: "On delivery", priceClosed: "Fixed price", included: "Includes what you see below.",
    hello: "Hi {client}, here is our proposal with a fixed price.",
  },
};

const fill = (text: string, values: Record<string, string | number>): string =>
  text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));

/** El importe sin decimales si es redondo («690 €»), con ellos si no («690,50 €»). */
const money = (cents: number, locale: PdfLocale): string => formatMoney(cents, { locale: intlLocale(locale), wholeUnits: true });

/** Cómo se llama una parte en el documento: el nombre comercial si lo hay, y si no el legal. */
const nameOf = (party: PdfParty): string => party.tradeName?.trim() || party.legalName;

/**
 * Una línea del presupuesto en puntos: la primera línea de su descripción es el título y las
 * siguientes son lo que incluye (se les quita la viñeta que ya traigan).
 */
export function scopeItem(description: string, index: number): ProposalScopeItem {
  const rows = description
    .split(/\r?\n/)
    .map((row) => row.replace(/^\s*[-•·◦*]\s*/, "").trim())
    .filter(Boolean);
  return { number: String(index + 1).padStart(2, "0"), title: rows[0] ?? "", points: rows.slice(1) };
}

/** Las líneas de un tipo (puntual, mensual…), en el orden del presupuesto. */
const linesOf = (lines: readonly QuotePdfLine[], type: QuotePdfLine["billingType"]) => lines.filter((line) => line.billingType === type);

export function buildProposalView(data: QuoteDocumentData): ProposalView {
  const t = COPY[data.locale];
  const oneOff = data.totals.oneOff;
  const monthly = data.totals.monthly;
  const yearly = data.totals.yearly;

  const prices: ProposalPrice[] = [];
  const sections: ProposalSection[] = [];
  const add = (
    totals: { subtotalCents: number } | null,
    type: QuotePdfLine["billingType"],
    name: string,
    suffix: string,
  ) => {
    if (!totals) return;
    const lines = linesOf(data.lines, type);
    prices.push({ label: `${t.option} ${String.fromCharCode(65 + prices.length)}`, name, amount: money(totals.subtotalCents, data.locale), suffix });
    sections.push({
      kicker: `${String(sections.length + 2).padStart(2, "0")} · ${name.toUpperCase()}`,
      title: name,
      price: { amount: money(totals.subtotalCents, data.locale), suffix, lines: [t.priceClosed] },
      items: lines.map((line, index) => scopeItem(line.description, index)),
    });
  };
  add(oneOff, "one_off", t.oneOff, t.vat);
  add(monthly, "monthly", t.monthly, t.vatMonth);
  add(yearly, "yearly", t.yearly, t.vatYear);

  // Si solo hay un tipo de precio no son «opciones»: no se rotula «Opción A».
  if (prices.length === 1) prices[0]!.label = t.priceClosed.toUpperCase();

  const notes = (data.notes ?? "").split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const intro = {
    kicker: `01 · ${t.summary}`,
    title: data.title,
    paragraphs: [fill(t.hello, { client: nameOf(data.client) }), ...notes],
  };

  const payments =
    data.payments.length > 1 || (data.payments[0] && data.payments[0].when !== "on_accept")
      ? {
          title: t.payments,
          rows: data.payments.map((payment) => ({
            label: payment.label,
            detail:
              payment.when === "date" && payment.plannedOn
                ? formatPdfDate(payment.plannedOn)
                : payment.when === "on_delivery"
                  ? t.atDelivery
                  : t.atAccept,
            amount: `${Math.round(payment.percentBps / 100)} % · ${money(payment.baseCents, data.locale)}`,
          })),
        }
      : null;

  const validity = data.validUntil ? formatPdfDate(data.validUntil) : null;
  return {
    language: data.locale,
    coverKicker: t.kicker,
    title: data.title,
    preparedFor: fill(t.preparedFor, { client: nameOf(data.client) }),
    prices,
    footerLeft: [data.issuer.legalName, data.issuer.taxId ? `CIF ${data.issuer.taxId}` : null].filter(Boolean).join(" · "),
    footerRight: [formatPdfDate(data.issuedOn), validity ? fill(t.validity, { days: daysBetweenIso(data.issuedOn, data.validUntil!) }) : null]
      .filter(Boolean)
      .join(" · "),
    intro,
    sections,
    payments,
    conditions: data.legalNotes.length > 0 ? { title: t.conditions, lines: data.legalNotes } : null,
    contactLine: [data.issuer.legalName, data.issuer.email, data.issuer.phone].filter(Boolean).join(" · "),
  };
}

/** Días entre dos fechas civiles (`YYYY-MM-DD`), para «Validez 30 días». */
function daysBetweenIso(from: string, to: string): number {
  return Math.max(0, Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000));
}
