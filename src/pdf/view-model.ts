import { formatBps, formatMoney } from "@/domain/money";
import { formatIban } from "@/domain/tax-id";
import { formatPdfDate, formatPeriod, formatQuantity, intlLocale, pdfText, postalLine } from "./format";
import { countryName, getPdfLabels, interpolate, type PdfLabels } from "./labels";
import type { InvoiceDocumentData, PdfLine, PdfLocale, PdfParty, PdfVatGroup } from "./types";

// Todo lo que imprime la plantilla, ya resuelto a texto en el idioma del documento. La
// plantilla solo maqueta; las reglas (qué se imprime y cómo) viven aquí y se prueban sin
// generar el PDF.

export type LabeledValue = { label: string; value: string };

export type PartyView = { heading: string; name: string; tradeName: string | null; lines: string[] };

export type LineView = {
  description: string;
  /** Tipo de facturación y periodo: "Mensual · 01/10/2026 – 31/10/2026". */
  detail: string | null;
  quantity: string;
  unitPrice: string;
  discount: string;
  vat: string;
  base: string;
};

export type TotalRowView = { label: string; hint: string | null; value: string };

export type InvoiceView = {
  /** Etiqueta BCP 47 del documento ("es-ES"). */
  language: string;
  /** Título del PDF y de la cabecera de las páginas siguientes. */
  title: string;
  author: string;
  documentType: string;
  /** El número, o "Borrador" si aún no lo tiene. */
  headline: string;
  draft: { mark: string; notice: string } | null;
  dates: LabeledValue[];
  issuer: PartyView;
  client: PartyView;
  rectifies: { number: LabeledValue; issuedOn: LabeledValue; reason: LabeledValue } | null;
  table: {
    headers: {
      description: string;
      quantity: string;
      unitPrice: string;
      /** null: ninguna línea lleva descuento y la columna no se imprime. */
      discount: string | null;
      /** null: todas las líneas van al mismo tipo, que ya sale en el desglose. */
      vat: string | null;
      base: string;
    };
    rows: LineView[];
  };
  totals: { rows: TotalRowView[]; total: LabeledValue };
  payment: { title: string; rows: LabeledValue[] } | null;
  legalNotes: { title: string; items: string[] } | null;
  notes: { title: string; text: string } | null;
  runningHeader: string;
  footer: { registryInfo: string | null; pageLabel: (current: number, total: number) => string };
  verifactu: { qrDataUrl: string; legend: string } | null;
};

function clean(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? pdfText(text) : null;
}

function isDomestic(party: PdfParty): boolean {
  return party.countryCode.trim().toUpperCase() === "ES";
}

function partyView(
  party: PdfParty,
  heading: string,
  labels: PdfLabels,
  locale: PdfLocale,
  showCountry: boolean,
): PartyView {
  const taxId = clean(party.taxId);
  const contact = [clean(party.email), clean(party.phone)].filter(Boolean).join(" · ");
  const lines = [
    taxId && `${labels.parties.taxId} ${taxId}`,
    clean(party.addressLine),
    clean(postalLine(party)),
    showCountry ? countryName(party.countryCode, locale) : null,
    contact || null,
  ].filter((line): line is string => Boolean(line));
  const name = clean(party.legalName) ?? "";
  const tradeName = clean(party.tradeName);
  return { heading, name, tradeName: tradeName && tradeName !== name ? tradeName : null, lines };
}

function lineDetail(line: PdfLine, labels: PdfLabels): string | null {
  const period = formatPeriod(line.periodStart, line.periodEnd);
  if (!period) return null;
  return line.billingType === "one_off" ? period : `${labels.billingType[line.billingType]} · ${period}`;
}

function vatGroupLabel(group: PdfVatGroup, labels: PdfLabels, percent: (bps: number) => string): string {
  if (group.vatBps === 0 && group.vatRegime !== "general") return labels.vatRegime[group.vatRegime];
  return interpolate(labels.totals.vat, { rate: percent(group.vatBps) });
}

function paymentView(data: InvoiceDocumentData, labels: PdfLabels): InvoiceView["payment"] {
  const { payment } = data;
  if (!payment) return null;
  const rows: LabeledValue[] = [{ label: labels.payment.method, value: labels.payment.methods[payment.method] }];
  if (payment.method === "transfer") {
    const iban = clean(payment.iban) ?? clean(data.issuer.iban);
    if (iban) {
      rows.push({ label: labels.payment.iban, value: formatIban(iban) });
      rows.push({ label: labels.payment.holder, value: clean(data.issuer.legalName) ?? "" });
    }
  }
  if (payment.method === "sepa_debit") {
    const iban = clean(payment.iban);
    if (iban) rows.push({ label: labels.payment.debitAccount, value: formatIban(iban) });
  }
  if (data.dueOn) rows.push({ label: labels.payment.dueOn, value: formatPdfDate(data.dueOn) });
  return { title: labels.payment.title, rows };
}

/**
 * Resuelve el documento. Lanza si falta algo que una factura emitida no puede omitir: el
 * número, o la factura que corrige una rectificativa. Un borrador no lleva número aunque
 * lo traiga.
 */
export function buildInvoiceView(data: InvoiceDocumentData): InvoiceView {
  const labels = getPdfLabels(data.locale);
  const language = intlLocale(data.locale);
  const money = (cents: number) => pdfText(formatMoney(cents, { locale: language }));
  const percent = (bps: number) => pdfText(formatBps(bps, language));

  const number = data.isDraft ? null : clean(data.number);
  if (!data.isDraft && !number) throw new Error("Una factura emitida necesita número.");
  if (!data.isDraft && data.kind === "rectifying" && !data.rectifies) {
    throw new Error("Una factura rectificativa emitida debe indicar la factura que rectifica.");
  }

  const documentType = data.kind === "rectifying" ? labels.document.rectifying : labels.document.ordinary;
  const headline = number ?? labels.document.draft;

  const dates: LabeledValue[] = [{ label: labels.header.issuedOn, value: formatPdfDate(data.issuedOn) }];
  if (data.operationOn && data.operationOn !== data.issuedOn) {
    dates.push({ label: labels.header.operationOn, value: formatPdfDate(data.operationOn) });
  }
  if (data.dueOn) dates.push({ label: labels.header.dueOn, value: formatPdfDate(data.dueOn) });

  // En una operación con el extranjero se imprime el país de las dos partes; entre dos
  // partes españolas, ninguno.
  const crossBorder = !isDomestic(data.issuer) || !isDomestic(data.client);
  const issuer = partyView(data.issuer, labels.parties.issuer, labels, data.locale, crossBorder);
  const client = partyView(data.client, labels.parties.client, labels, data.locale, crossBorder);

  const rectifies =
    data.kind === "rectifying" && data.rectifies
      ? {
          number: { label: labels.rectifies.number, value: pdfText(data.rectifies.number.trim()) },
          issuedOn: { label: labels.rectifies.issuedOn, value: formatPdfDate(data.rectifies.issuedOn) },
          reason: { label: labels.rectifies.reason, value: pdfText(data.rectifies.reason.trim()) },
        }
      : null;

  const showDiscount = data.lines.some((line) => line.discountBps !== 0);
  const showVat = new Set(data.lines.map((line) => `${line.vatBps}:${line.vatRegime}`)).size > 1;
  const rows: LineView[] = data.lines.map((line) => ({
    description: pdfText(line.description.trim()),
    detail: lineDetail(line, labels),
    quantity: formatQuantity(line.quantity, data.locale),
    unitPrice: money(line.unitPriceCents),
    discount: line.discountBps !== 0 ? percent(line.discountBps) : "",
    vat: percent(line.vatBps),
    base: money(line.baseCents),
  }));

  const { totals } = data;
  const withGroupBase = data.vatBreakdown.length > 1;
  const totalRows: TotalRowView[] = [
    { label: labels.totals.subtotal, hint: null, value: money(totals.subtotalCents) },
    ...data.vatBreakdown.map((group) => ({
      label: vatGroupLabel(group, labels, percent),
      hint: withGroupBase ? interpolate(labels.totals.groupBase, { base: money(group.baseCents) }) : null,
      value: money(group.vatCents),
    })),
  ];
  if (totals.irpfCents !== 0) {
    // La retención se resta: se imprime con el signo contrario al importe retenido.
    totalRows.push({
      label: interpolate(labels.totals.irpf, { rate: percent(totals.irpfBps) }),
      hint: null,
      value: money(-totals.irpfCents),
    });
  }
  const total = {
    label: totals.totalCents < 0 ? labels.totals.totalNegative : labels.totals.total,
    value: money(totals.totalCents),
  };

  const legalItems = data.legalNotes.map((note) => clean(note)).filter((note): note is string => Boolean(note));
  const notesText = clean(data.notes);
  const title = number ? `${documentType} ${number}` : `${documentType} · ${labels.document.draft}`;

  return {
    language,
    title,
    author: issuer.name,
    documentType,
    headline,
    draft: data.isDraft
      ? { mark: labels.document.draft.toLocaleUpperCase(language), notice: labels.document.draftNotice }
      : null,
    dates,
    issuer,
    client,
    rectifies,
    table: {
      headers: {
        description: labels.lines.description,
        quantity: labels.lines.quantity,
        unitPrice: labels.lines.unitPrice,
        discount: showDiscount ? labels.lines.discount : null,
        vat: showVat ? labels.lines.vat : null,
        base: labels.lines.base,
      },
      rows,
    },
    totals: { rows: totalRows, total },
    payment: paymentView(data, labels),
    legalNotes: legalItems.length > 0 ? { title: labels.legalNotes, items: legalItems } : null,
    notes: notesText ? { title: labels.notes, text: notesText } : null,
    runningHeader: `${title} · ${client.name}`,
    footer: {
      registryInfo: clean(data.issuer.registryInfo),
      pageLabel: (current, pages) => interpolate(labels.footer.page, { current, total: pages }),
    },
    verifactu: data.verifactu
      ? { qrDataUrl: data.verifactu.qrDataUrl, legend: pdfText(data.verifactu.legend.trim()) }
      : null,
  };
}
