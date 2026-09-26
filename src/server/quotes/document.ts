import "server-only";
import {
  effectiveDates,
  milestoneAmounts,
  type QuoteCalcLine,
  quoteTotals,
  quoteValidityDays,
  type SectionTotals,
} from "@/app/[org]/quotes/summary";
import { readStoredPlan } from "@/app/[org]/quotes/schema";
import type { CivilDate } from "@/domain/dates/civil-date";
import { nowInZone } from "@/lib/clock";
import type { Tables } from "@/lib/supabase/database.types";
import type { PdfIssuer, PdfParty, QuoteDocumentData, QuotePdfTotals } from "@/pdf";
import { type Db, must } from "@/server/billing/context";

/**
 * Datos del PDF de un presupuesto, en su idioma. Un presupuesto no es un documento legal: no se
 * congela una copia de emisor y cliente, se imprimen sus datos de hoy. Las cifras salen de
 * `quotes/summary.ts`, la misma implementación que ve el editor.
 */

export type LoadedQuote = {
  quote: Tables<"quotes">;
  lines: Tables<"quote_lines">[];
  client: Tables<"clients">;
  document: QuoteDocumentData;
  /** Hoy en la zona de la org. */
  today: CivilDate;
  totals: ReturnType<typeof quoteTotals>;
};

const pdfTotals = (totals: SectionTotals | null): QuotePdfTotals | null =>
  totals && {
    subtotalCents: totals.subtotalCents,
    vatCents: totals.vatCents,
    totalCents: totals.totalCents,
    vatBreakdown: totals.breakdown,
  };

/** Carga el presupuesto (con la RLS de quien lo pide) y monta su documento; null si no lo ve. */
export async function loadQuoteDocument(db: Db, quoteId: string): Promise<LoadedQuote | null> {
  const { data: quote, error } = await db.from("quotes").select("*").eq("id", quoteId).maybeSingle();
  if (error) throw error;
  if (!quote) return null;

  const [linesRes, issuerRes, clientRes, orgRes] = await Promise.all([
    db.from("quote_lines").select("*").eq("quote_id", quote.id).order("position").order("created_at"),
    db.from("issuers").select("*").eq("id", quote.issuer_id).single(),
    db.from("clients").select("*").eq("id", quote.client_id).single(),
    db.from("orgs").select("timezone, settings").eq("id", quote.org_id).single(),
  ]);
  const lines = must(linesRes, "loadQuoteDocument.lines");
  const issuer = must(issuerRes, "loadQuoteDocument.issuer");
  const client = must(clientRes, "loadQuoteDocument.client");
  const org = must(orgRes, "loadQuoteDocument.org");

  const rateIds = [...new Set(lines.map((l) => l.tax_rate_id))];
  const rates =
    rateIds.length > 0
      ? must(await db.from("tax_rates").select("id, rate_bps, regime, legal_note").in("id", rateIds), "loadQuoteDocument.rates")
      : [];
  const rateById = new Map(rates.map((r) => [r.id, r]));

  const calc: QuoteCalcLine[] = lines.map((line) => {
    const rate = rateById.get(line.tax_rate_id);
    return {
      billingType: line.billing_type,
      quantity: String(line.quantity),
      unitPriceCents: line.unit_price_cents,
      discountBps: line.discount_bps,
      vatBps: rate?.rate_bps ?? 0,
      vatRegime: rate?.regime ?? "general",
    };
  });
  const totals = quoteTotals(calc);
  const payments = milestoneAmounts(calc, readStoredPlan(quote.payment_plan)) ?? [];
  const today = nowInZone(org.timezone).date;
  const dates = effectiveDates(quote.issued_on, quote.valid_until, today, quoteValidityDays(org.settings));
  const legalNotes = [
    ...new Set(lines.map((l) => rateById.get(l.tax_rate_id)?.legal_note?.trim()).filter((n): n is string => Boolean(n))),
  ];

  const pdfIssuer: PdfIssuer = {
    kind: issuer.kind,
    legalName: issuer.legal_name,
    tradeName: issuer.trade_name,
    taxId: issuer.tax_id,
    addressLine: issuer.address_line,
    postalCode: issuer.postal_code,
    city: issuer.city,
    province: issuer.province,
    countryCode: issuer.country_code,
    email: issuer.email,
    phone: issuer.phone,
    iban: issuer.iban,
    registryInfo: issuer.registry_info,
  };
  const legalName = client.legal_name ?? client.display_name;
  const pdfClient: PdfParty = {
    legalName,
    tradeName: client.display_name !== legalName ? client.display_name : null,
    taxId: client.tax_id,
    addressLine: client.address_line,
    postalCode: client.postal_code,
    city: client.city,
    province: client.province,
    countryCode: client.country_code,
  };

  const document: QuoteDocumentData = {
    locale: quote.language,
    isDraft: quote.status === "draft",
    number: quote.status === "draft" ? null : quote.number,
    title: quote.title,
    issuedOn: dates.issuedOn,
    validUntil: dates.validUntil,
    issuer: pdfIssuer,
    client: pdfClient,
    lines: lines.map((line, index) => ({
      description: line.description,
      billingType: line.billing_type,
      quantity: String(line.quantity),
      unitPriceCents: line.unit_price_cents,
      discountBps: line.discount_bps,
      baseCents: line.base_cents,
      vatBps: calc[index]!.vatBps,
      vatRegime: calc[index]!.vatRegime,
      startsOn: line.starts_on,
      endsOn: line.ends_on,
    })),
    totals: { oneOff: pdfTotals(totals.oneOff), monthly: pdfTotals(totals.monthly), yearly: pdfTotals(totals.yearly) },
    payments: totals.oneOff
      ? payments.map((payment) => ({
          label: payment.label,
          percentBps: payment.percentBps,
          when: payment.when,
          plannedOn: payment.plannedOn,
          baseCents: payment.baseCents,
          totalCents: payment.totalCents,
        }))
      : [],
    legalNotes,
    notes: quote.notes,
    acceptedOn: quote.accepted_at ? nowInZone(org.timezone, new Date(quote.accepted_at)).date : null,
  };
  return { quote, lines, client, document, today, totals };
}

/** Nombre del fichero del PDF: el número o, en un borrador, "borrador-<id>". */
export function quotePdfFilename(quote: Pick<Tables<"quotes">, "id" | "number">): string {
  return `${(quote.number ?? `borrador-${quote.id.slice(0, 8)}`).replace(/[^\w.-]+/g, "_")}.pdf`;
}
