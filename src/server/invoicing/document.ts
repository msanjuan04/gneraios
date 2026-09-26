// Sin "server-only": lo usa también el seed de la demo.
import type { CivilDate } from "@/domain/dates/civil-date";
import type { FiscalDocument } from "@/domain/fiscal/provider";
import { computeInvoiceTotals } from "@/domain/tax/totals";
import { nowInZone } from "@/lib/clock";
import type { Tables } from "@/lib/supabase/database.types";
import type { InvoiceDocumentData, PdfIssuer, PdfParty } from "@/pdf";
import { type Db, must } from "@/server/billing/context";

type InvoiceRow = Tables<"invoices">;
type LineRow = Tables<"invoice_lines">;

/** Snapshot congelado al emitir (ver issue_invoice_begin). */
type IssuerSnapshot = {
  kind: "company" | "self_employed";
  legal_name: string;
  trade_name: string | null;
  tax_id: string | null;
  address_line: string | null;
  postal_code: string | null;
  city: string | null;
  province: string | null;
  country_code: string;
  email: string | null;
  phone: string | null;
  iban: string | null;
  registry_info: string | null;
};
type ClientSnapshot = {
  legal_name: string;
  display_name: string;
  tax_id: string | null;
  address_line: string | null;
  postal_code: string | null;
  city: string | null;
  province: string | null;
  country_code: string;
};

export type LoadedInvoice = {
  invoice: InvoiceRow;
  lines: LineRow[];
  issuer: IssuerSnapshot;
  client: ClientSnapshot;
  rectifies: { number: string; issuedOn: CivilDate; reason: string } | null;
  /** Fecha que llevará (o lleva) la factura. */
  issuedOn: CivilDate;
};

/**
 * Carga una factura para su documento: si ya está congelada (emitiendo o emitida), con los
 * snapshots; si es borrador, con los datos vivos del emisor y del cliente.
 */
export async function loadInvoice(db: Db, invoiceId: string): Promise<LoadedInvoice> {
  const invoice = must(await db.from("invoices").select("*").eq("id", invoiceId).maybeSingle(), "loadInvoice");
  const lines = must(
    await db.from("invoice_lines").select("*").eq("invoice_id", invoiceId).order("position").order("created_at"),
    "loadInvoice.lines",
  );

  let issuer = invoice.issuer_snapshot as IssuerSnapshot | null;
  let client = invoice.client_snapshot as ClientSnapshot | null;
  if (!issuer || !client) {
    const [liveIssuer, liveClient] = await Promise.all([
      db.from("issuers").select("*").eq("id", invoice.issuer_id).single(),
      db.from("clients").select("*").eq("id", invoice.client_id).single(),
    ]);
    const i = must(liveIssuer, "loadInvoice.issuer");
    const c = must(liveClient, "loadInvoice.client");
    issuer = {
      kind: i.kind,
      legal_name: i.legal_name,
      trade_name: i.trade_name,
      tax_id: i.tax_id,
      address_line: i.address_line,
      postal_code: i.postal_code,
      city: i.city,
      province: i.province,
      country_code: i.country_code,
      email: i.email,
      phone: i.phone,
      iban: i.iban,
      registry_info: i.registry_info,
    };
    client = {
      legal_name: c.legal_name ?? c.display_name,
      display_name: c.display_name,
      tax_id: c.tax_id,
      address_line: c.address_line,
      postal_code: c.postal_code,
      city: c.city,
      province: c.province,
      country_code: c.country_code,
    };
  }

  let rectifies: LoadedInvoice["rectifies"] = null;
  if (invoice.rectifies_invoice_id) {
    const original = must(
      await db.from("invoices").select("number, issued_on").eq("id", invoice.rectifies_invoice_id).single(),
      "loadInvoice.rectifies",
    );
    rectifies = {
      number: original.number ?? "",
      issuedOn: original.issued_on ?? "",
      reason: invoice.rectification_reason ?? "",
    };
  }

  let issuedOn = invoice.issued_on;
  if (!issuedOn) {
    const org = must(await db.from("orgs").select("timezone").eq("id", invoice.org_id).single(), "loadInvoice.org");
    issuedOn = nowInZone(org.timezone).date;
  }
  return { invoice, lines, issuer, client, rectifies, issuedOn };
}

const party = (p: ClientSnapshot | IssuerSnapshot, legalName: string, tradeName: string | null): PdfParty => ({
  legalName,
  tradeName: tradeName && tradeName !== legalName ? tradeName : null,
  taxId: p.tax_id,
  addressLine: p.address_line,
  postalCode: p.postal_code,
  city: p.city,
  province: p.province,
  countryCode: p.country_code,
});

function totalsOf(lines: LineRow[]) {
  return computeInvoiceTotals(
    lines.map((l) => ({
      baseCents: l.base_cents,
      vatCents: l.vat_cents,
      irpfCents: l.irpf_cents,
      vatBps: l.vat_bps,
      vatRegime: l.vat_regime,
    })),
  );
}

/** Datos de la plantilla PDF (idioma de la factura, que es el del cliente). */
export function toPdfData(loaded: LoadedInvoice, extra: { qrDataUrl?: string; legend?: string } = {}): InvoiceDocumentData {
  const { invoice, lines, issuer, client } = loaded;
  const totals = totalsOf(lines);
  const pdfIssuer: PdfIssuer = {
    ...party(issuer, issuer.legal_name, issuer.trade_name),
    email: issuer.email,
    phone: issuer.phone,
    kind: issuer.kind,
    iban: issuer.iban,
    registryInfo: issuer.registry_info,
  };
  const legalNotes = [...new Set(lines.map((l) => l.legal_note?.trim()).filter((n): n is string => Boolean(n)))];
  return {
    locale: invoice.language,
    kind: invoice.kind,
    isDraft: invoice.lifecycle === "draft",
    number: invoice.lifecycle === "draft" ? null : invoice.number,
    issuedOn: loaded.issuedOn,
    operationOn: invoice.operation_on,
    dueOn: invoice.due_on,
    rectifies: loaded.rectifies,
    issuer: pdfIssuer,
    client: party(client, client.legal_name, client.display_name),
    lines: lines.map((l) => ({
      description: l.description,
      quantity: String(l.quantity),
      unitPriceCents: l.unit_price_cents,
      discountBps: l.discount_bps,
      baseCents: l.base_cents,
      vatBps: l.vat_bps,
      vatRegime: l.vat_regime,
      billingType: l.billing_type,
      periodStart: l.period_start,
      periodEnd: l.period_end,
    })),
    totals: {
      subtotalCents: totals.subtotalCents,
      vatCents: totals.vatCents,
      irpfCents: totals.irpfCents,
      totalCents: totals.totalCents,
      irpfBps: invoice.irpf_bps,
    },
    vatBreakdown: totals.breakdown,
    legalNotes,
    payment: { method: invoice.payment_method, iban: issuer.iban },
    notes: invoice.notes,
    verifactu: extra.qrDataUrl ? { qrDataUrl: extra.qrDataUrl, legend: extra.legend ?? "VERI*FACTU" } : null,
  };
}

/** Lo que recibe el proveedor fiscal: la factura congelada. */
export function toFiscalDocument(loaded: LoadedInvoice, seriesRef: string | null): FiscalDocument {
  const { invoice, lines, issuer, client } = loaded;
  const totals = totalsOf(lines);
  return {
    invoiceId: invoice.id,
    kind: invoice.kind,
    number: invoice.number,
    seriesRef,
    issuedOn: loaded.issuedOn,
    issuer: { taxId: issuer.tax_id ?? "", legalName: issuer.legal_name },
    client: { taxId: client.tax_id, legalName: client.legal_name, countryCode: client.country_code },
    lines: lines.map((l) => ({
      description: l.description,
      quantity: String(l.quantity),
      unitPriceCents: l.unit_price_cents,
      discountBps: l.discount_bps,
      baseCents: l.base_cents,
      vatBps: l.vat_bps,
      vatRegime: l.vat_regime,
      vatCents: l.vat_cents,
      irpfCents: l.irpf_cents,
    })),
    totals: {
      subtotalCents: totals.subtotalCents,
      vatCents: totals.vatCents,
      irpfCents: totals.irpfCents,
      totalCents: totals.totalCents,
    },
    rectifies: loaded.rectifies,
  };
}
