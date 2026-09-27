import "server-only";
import type { CivilDate } from "@/domain/dates/civil-date";
import { isPortalLocale, type PortalLocale, publicQuoteState, type PublicQuoteState } from "@/domain/portal";
import { nowInZone } from "@/lib/clock";
import { buildQuoteView, type QuoteView } from "@/pdf";
import type { Db } from "@/server/billing/context";
import { type LoadedQuote, loadQuoteDocument } from "@/server/quotes/document";
import type { PortalLink } from "./access";

/**
 * Un presupuesto tal como lo ve el cliente: el mismo documento que el PDF (buildQuoteView, en el
 * idioma del presupuesto) y lo que puede hacer con él. Se lee con la clave de servidor, así que
 * primero se comprueba que el enlace da acceso a ese presupuesto (el suyo, o uno de su cliente
 * desde el portal) y nunca se enseña un borrador.
 */

export type PublicQuote = {
  quoteId: string;
  orgId: string;
  clientId: string;
  locale: PortalLocale;
  number: string;
  title: string;
  state: PublicQuoteState;
  /** updated_at: la versión que ve el cliente, y la única que puede aceptar. */
  version: string;
  issuedOn: CivilDate;
  validUntil: CivilDate | null;
  view: QuoteView;
  clientName: string;
  issuerName: string;
  issuerEmail: string | null;
  /** El primer pago, si es a la aceptación: lo que se facturará al aceptar (IVA incluido). */
  firstPayment: { label: string; totalCents: number } | null;
  acceptance: { signerName: string; acceptedAt: string; pdfPath: string | null } | null;
  /** Fecha civil (zona de la org) de la aceptación o del rechazo. */
  answeredOn: CivilDate | null;
  loaded: LoadedQuote;
};

type QuoteRef = { id: string; org_id: string; client_id: string; status: "draft" | "sent" | "accepted" | "rejected" };

/** ¿Da acceso el enlace a este presupuesto? La misma regla que private.portal_link_covers. */
export function linkCoversQuote(link: Pick<PortalLink, "kind" | "orgId" | "quoteId" | "clientId">, quote: Pick<QuoteRef, "id" | "org_id" | "client_id">): boolean {
  if (link.orgId !== quote.org_id) return false;
  return link.kind === "quote" ? link.quoteId === quote.id : link.clientId === quote.client_id;
}

export async function loadPublicQuote(admin: Db, link: PortalLink, quoteId: string): Promise<PublicQuote | null> {
  const { data: ref, error } = await admin
    .from("quotes")
    .select("id, org_id, client_id, status")
    .eq("org_id", link.orgId)
    .eq("id", quoteId)
    .maybeSingle();
  if (error) throw error;
  if (!ref || !linkCoversQuote(link, ref) || ref.status === "draft") return null;

  const loaded = await loadQuoteDocument(admin, ref.id);
  const number = loaded?.quote.number;
  const issuedOn = loaded?.quote.issued_on;
  if (!loaded || !number || !issuedOn) return null;
  const { quote, document } = loaded;

  const [{ data: acceptance, error: acceptanceError }, { data: org, error: orgError }] = await Promise.all([
    admin
      .from("quote_acceptances")
      .select("signer_name, accepted_at, pdf_path")
      .eq("org_id", link.orgId)
      .eq("quote_id", quote.id)
      .maybeSingle(),
    admin.from("orgs").select("timezone").eq("id", link.orgId).single(),
  ]);
  if (acceptanceError) throw acceptanceError;
  if (orgError) throw orgError;

  const answeredAt = quote.accepted_at ?? quote.rejected_at;
  const first = document.payments[0];
  return {
    quoteId: quote.id,
    orgId: quote.org_id,
    clientId: quote.client_id,
    locale: isPortalLocale(quote.language) ? quote.language : "es",
    number,
    title: quote.title,
    state: publicQuoteState({ status: quote.status, validUntil: quote.valid_until }, loaded.today),
    version: quote.updated_at,
    issuedOn,
    validUntil: quote.valid_until,
    view: buildQuoteView(document),
    clientName: loaded.client.display_name,
    issuerName: document.issuer.tradeName?.trim() || document.issuer.legalName,
    issuerEmail: document.issuer.email?.trim() || null,
    firstPayment: first && first.when === "on_accept" && first.totalCents > 0 ? { label: first.label, totalCents: first.totalCents } : null,
    acceptance: acceptance ? { signerName: acceptance.signer_name, acceptedAt: acceptance.accepted_at, pdfPath: acceptance.pdf_path } : null,
    answeredOn: answeredAt ? nowInZone(org.timezone, new Date(answeredAt)).date : null,
    loaded,
  };
}
