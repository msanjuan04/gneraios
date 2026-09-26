import { formatBps, formatMoney } from "@/domain/money";
import { formatPdfDate, formatQuantity, intlLocale, pdfText, postalLine } from "./format";
import { countryName, getPdfLabels, interpolate, type PdfLabels } from "./labels";
import type { QuoteDocumentData, QuotePdfBillingType, QuotePdfLine, QuotePdfPayment, QuotePdfTotals } from "./quote-types";
import type { PdfLocale, PdfParty, PdfVatGroup } from "./types";
import type { LabeledValue, PartyView, TotalRowView } from "./view-model";

// Todo lo que imprime la plantilla de presupuesto, ya resuelto a texto en el idioma del
// documento. Como en la factura, la plantilla solo maqueta: las reglas viven aquí y se prueban
// sin generar el PDF. Lo puntual, lo recurrente y lo de uso van en secciones distintas y sus
// totales nunca se suman entre sí.

export type QuoteRowView = {
  description: string;
  /** Tipo y vigencia: "Mensual · Desde la aceptación". */
  detail: string | null;
  quantity: string;
  unitPrice: string;
  discount: string;
  vat: string;
  /** Base de la línea: "1.500,00 €", "150,00 €/mes" o "375,00 €/uso". */
  amount: string;
};

export type QuoteTableView = {
  headers: {
    description: string;
    quantity: string;
    unitPrice: string;
    /** null: ninguna línea de la tabla lleva descuento. */
    discount: string | null;
    /** null: todas las líneas de la tabla van al mismo tipo, que ya sale en los totales. */
    vat: string | null;
    amount: string;
  };
  rows: QuoteRowView[];
};

export type QuoteTotalsView = { rows: TotalRowView[]; total: LabeledValue };

export type QuotePlanRowView = { label: string; when: string; percent: string; amount: string; total: string };

export type QuoteView = {
  language: string;
  title: string;
  author: string;
  documentType: string;
  /** El número, o "Borrador" si aún no lo tiene. */
  headline: string;
  subtitle: string;
  draft: { mark: string; notice: string } | null;
  dates: LabeledValue[];
  issuer: PartyView;
  client: PartyView;
  /** «1.815,00 € + 423,50 €/mes», cada cosa por su lado. null si no hay líneas. */
  summary: { title: string; items: LabeledValue[]; note: string } | null;
  oneOff: {
    title: string;
    table: QuoteTableView;
    totals: QuoteTotalsView;
    plan: { title: string; headers: QuotePlanRowView; rows: QuotePlanRowView[] } | null;
  } | null;
  recurring: { title: string; table: QuoteTableView; totals: QuoteTotalsView[] } | null;
  usage: { title: string; note: string; table: QuoteTableView } | null;
  validity: { title: string; text: string } | null;
  acceptance: { title: string; text: string | null; fields: string[]; accepted: string | null };
  legalNotes: { title: string; items: string[] } | null;
  notes: { title: string; text: string } | null;
  runningHeader: string;
  footer: { registryInfo: string | null; pageLabel: (current: number, total: number) => string };
};

type Formatters = {
  labels: PdfLabels;
  locale: PdfLocale;
  money: (cents: number) => string;
  percent: (bps: number) => string;
};

function clean(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? pdfText(text) : null;
}

function partyView(party: PdfParty, heading: string, f: Formatters, showCountry: boolean): PartyView {
  const taxId = clean(party.taxId);
  const contact = [clean(party.email), clean(party.phone)].filter(Boolean).join(" · ");
  const lines = [
    taxId && `${f.labels.parties.taxId} ${taxId}`,
    clean(party.addressLine),
    clean(postalLine(party)),
    showCountry ? countryName(party.countryCode, f.locale) : null,
    contact || null,
  ].filter((line): line is string => Boolean(line));
  const name = clean(party.legalName) ?? "";
  const tradeName = clean(party.tradeName);
  return { heading, name, tradeName: tradeName && tradeName !== name ? tradeName : null, lines };
}

/** "150,00 €/mes", "1.200,00 €/año", "375,00 €/uso"; lo puntual, solo el importe. */
function perCycle(cents: number, type: QuotePdfBillingType, f: Formatters): string {
  const amount = f.money(cents);
  return type === "one_off" ? amount : interpolate(f.labels.quote.cycle[type], { amount });
}

function lineDetail(line: QuotePdfLine, f: Formatters): string | null {
  if (line.billingType === "one_off") return null;
  const q = f.labels.quote.recurring;
  const since = line.startsOn ? interpolate(q.from, { date: formatPdfDate(line.startsOn) }) : q.fromAcceptance;
  const until = line.endsOn ? interpolate(q.until, { date: formatPdfDate(line.endsOn) }) : null;
  const type = line.billingType === "usage" ? f.labels.quote.summary.usage : f.labels.billingType[line.billingType];
  return [type, since, until].filter(Boolean).join(" · ");
}

function tableView(lines: readonly QuotePdfLine[], f: Formatters): QuoteTableView {
  const { labels } = f;
  const showDiscount = lines.some((line) => line.discountBps !== 0);
  const showVat = new Set(lines.map((line) => `${line.vatBps}:${line.vatRegime}`)).size > 1;
  return {
    headers: {
      description: labels.lines.description,
      quantity: labels.lines.quantity,
      unitPrice: labels.lines.unitPrice,
      discount: showDiscount ? labels.lines.discount : null,
      vat: showVat ? labels.lines.vat : null,
      amount: labels.lines.base,
    },
    rows: lines.map((line) => ({
      description: pdfText(line.description.trim()),
      detail: lineDetail(line, f),
      quantity: formatQuantity(line.quantity, f.locale),
      unitPrice: f.money(line.unitPriceCents),
      discount: line.discountBps !== 0 ? f.percent(line.discountBps) : "",
      vat: f.percent(line.vatBps),
      amount: perCycle(line.baseCents, line.billingType, f),
    })),
  };
}

function vatGroupLabel(group: PdfVatGroup, f: Formatters): string {
  if (group.vatBps === 0 && group.vatRegime !== "general") return f.labels.vatRegime[group.vatRegime];
  return interpolate(f.labels.totals.vat, { rate: f.percent(group.vatBps) });
}

function totalsView(
  totals: QuotePdfTotals,
  type: QuotePdfBillingType,
  labels: { base: string; total: string },
  f: Formatters,
): QuoteTotalsView {
  const withGroupBase = totals.vatBreakdown.length > 1;
  return {
    rows: [
      { label: labels.base, hint: null, value: perCycle(totals.subtotalCents, type, f) },
      ...totals.vatBreakdown.map((group) => ({
        label: vatGroupLabel(group, f),
        hint: withGroupBase ? interpolate(f.labels.totals.groupBase, { base: f.money(group.baseCents) }) : null,
        value: perCycle(group.vatCents, type, f),
      })),
    ],
    total: { label: labels.total, value: perCycle(totals.totalCents, type, f) },
  };
}

function whenText(payment: QuotePdfPayment, f: Formatters): string {
  const plan = f.labels.quote.plan;
  if (payment.when === "on_accept") return plan.onAccept;
  if (payment.when === "on_delivery") return plan.onDelivery;
  return payment.plannedOn ? interpolate(plan.onDate, { date: formatPdfDate(payment.plannedOn) }) : plan.onDelivery;
}

/**
 * Resuelve el presupuesto. Lanza si a uno ya enviado le falta el número. Un borrador no lleva
 * número aunque lo traiga.
 */
export function buildQuoteView(data: QuoteDocumentData): QuoteView {
  const labels = getPdfLabels(data.locale);
  const language = intlLocale(data.locale);
  const f: Formatters = {
    labels,
    locale: data.locale,
    money: (cents) => pdfText(formatMoney(cents, { locale: language })),
    percent: (bps) => pdfText(formatBps(bps, language)),
  };
  const q = labels.quote;

  const number = data.isDraft ? null : clean(data.number);
  if (!data.isDraft && !number) throw new Error("Un presupuesto enviado necesita número.");

  const documentType = q.document;
  const dates: LabeledValue[] = [{ label: q.issuedOn, value: formatPdfDate(data.issuedOn) }];
  if (data.validUntil) dates.push({ label: q.validUntil, value: formatPdfDate(data.validUntil) });

  const crossBorder = data.issuer.countryCode.trim().toUpperCase() !== "ES" || data.client.countryCode.trim().toUpperCase() !== "ES";
  const issuer = partyView(data.issuer, q.parties.issuer, f, crossBorder);
  const client = partyView(data.client, q.parties.client, f, crossBorder);

  const byType = (...types: QuotePdfBillingType[]) => data.lines.filter((line) => types.includes(line.billingType));
  const oneOffLines = byType("one_off");
  const recurringLines = byType("monthly", "yearly");
  const usageLines = byType("usage");
  const { totals } = data;

  const oneOff =
    oneOffLines.length > 0 && totals.oneOff
      ? {
          title: q.oneOff.title,
          table: tableView(oneOffLines, f),
          totals: totalsView(totals.oneOff, "one_off", { base: labels.totals.subtotal, total: q.oneOff.total }, f),
          plan:
            data.payments.length > 0
              ? {
                  title: q.plan.title,
                  headers: { label: q.plan.label, when: q.plan.when, percent: q.plan.percent, amount: q.plan.amount, total: q.plan.total },
                  rows: data.payments.map((payment) => ({
                    label: pdfText(payment.label.trim()),
                    when: whenText(payment, f),
                    percent: f.percent(payment.percentBps),
                    amount: f.money(payment.baseCents),
                    total: f.money(payment.totalCents),
                  })),
                }
              : null,
        }
      : null;

  const recurringTotals: QuoteTotalsView[] = [];
  if (totals.monthly) {
    recurringTotals.push(totalsView(totals.monthly, "monthly", { base: q.recurring.monthlyBase, total: q.recurring.monthlyTotal }, f));
  }
  if (totals.yearly) {
    recurringTotals.push(totalsView(totals.yearly, "yearly", { base: q.recurring.yearlyBase, total: q.recurring.yearlyTotal }, f));
  }
  const recurring =
    recurringLines.length > 0 ? { title: q.recurring.title, table: tableView(recurringLines, f), totals: recurringTotals } : null;
  const usage = usageLines.length > 0 ? { title: q.usage.title, note: q.usage.note, table: tableView(usageLines, f) } : null;

  const summaryItems: LabeledValue[] = [];
  if (oneOff && totals.oneOff) summaryItems.push({ label: q.summary.oneOff, value: f.money(totals.oneOff.totalCents) });
  if (totals.monthly) summaryItems.push({ label: q.summary.monthly, value: perCycle(totals.monthly.totalCents, "monthly", f) });
  if (totals.yearly) summaryItems.push({ label: q.summary.yearly, value: perCycle(totals.yearly.totalCents, "yearly", f) });
  if (usage) summaryItems.push({ label: q.summary.usage, value: q.summary.usageValue });

  const accepted = data.acceptedOn ? interpolate(q.acceptance.accepted, { date: formatPdfDate(data.acceptedOn) }) : null;
  const legalItems = data.legalNotes.map((note) => clean(note)).filter((note): note is string => Boolean(note));
  const notesText = clean(data.notes);
  const subtitle = clean(data.title) ?? "";
  const title = number ? `${documentType} ${number}` : `${documentType} · ${labels.document.draft}`;

  return {
    language,
    title,
    author: issuer.name,
    documentType,
    headline: number ?? labels.document.draft,
    subtitle,
    draft: data.isDraft ? { mark: labels.document.draft.toLocaleUpperCase(language), notice: q.draftNotice } : null,
    dates,
    issuer,
    client,
    summary: summaryItems.length > 0 ? { title: q.summary.title, items: summaryItems, note: q.summary.vatIncluded } : null,
    oneOff,
    recurring,
    usage,
    validity: data.validUntil ? { title: q.validUntil, text: interpolate(q.validity, { date: formatPdfDate(data.validUntil) }) } : null,
    acceptance: {
      title: q.acceptance.title,
      text: accepted ? null : q.acceptance.text,
      fields: accepted ? [] : [q.acceptance.name, q.acceptance.date, q.acceptance.signature],
      accepted,
    },
    legalNotes: legalItems.length > 0 ? { title: labels.legalNotes, items: legalItems } : null,
    notes: notesText ? { title: labels.notes, text: notesText } : null,
    runningHeader: `${title} · ${client.name}`,
    footer: {
      registryInfo: clean(data.issuer.registryInfo),
      pageLabel: (current, pages) => interpolate(labels.footer.page, { current, total: pages }),
    },
  };
}
