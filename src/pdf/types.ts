import type { CivilDate } from "@/domain/dates/civil-date";
export type PdfLocale = "es" | "ca" | "en";
export type PdfVatRegime = "general" | "exempt" | "reverse_charge_eu" | "not_subject";
export type PdfBillingType = "one_off" | "monthly" | "yearly" | "usage";
export type PdfParty = {
  legalName: string; tradeName?: string | null; taxId?: string | null;
  addressLine?: string | null; postalCode?: string | null; city?: string | null; province?: string | null;
  countryCode: string; email?: string | null; phone?: string | null;
};
export type PdfIssuer = PdfParty & { kind: "company" | "self_employed"; iban?: string | null; registryInfo?: string | null };
export type PdfLine = {
  description: string; quantity: string; unitPriceCents: number; discountBps: number;
  baseCents: number; vatBps: number; vatRegime: PdfVatRegime; billingType: PdfBillingType;
  periodStart?: CivilDate | null; periodEnd?: CivilDate | null;
};
export type PdfVatGroup = { vatBps: number; vatRegime: PdfVatRegime; baseCents: number; vatCents: number };
export type InvoiceDocumentData = {
  locale: PdfLocale;
  kind: "ordinary" | "rectifying";
  isDraft: boolean;                 // draft: visible "BORRADOR / ESBORRANY / DRAFT" mark, no number
  number: string | null;
  issuedOn: CivilDate;
  operationOn?: CivilDate | null;   // print only if different from issuedOn
  dueOn?: CivilDate | null;
  rectifies?: { number: string; issuedOn: CivilDate; reason: string } | null;
  issuer: PdfIssuer;
  client: PdfParty;
  lines: PdfLine[];
  totals: { subtotalCents: number; vatCents: number; irpfCents: number; totalCents: number; irpfBps: number };
  vatBreakdown: PdfVatGroup[];      // already grouped by the caller
  legalNotes: string[];             // already-resolved mentions (e.g. reverse charge), printed as-is
  payment?: { method: "transfer" | "sepa_debit" | "card" | "cash" | "other"; iban?: string | null } | null;
  notes?: string | null;
  verifactu?: { qrDataUrl: string; legend: string } | null; // reserved slot, top of page 1, 30-40 mm
};
