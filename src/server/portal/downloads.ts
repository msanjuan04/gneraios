import "server-only";
import { resolvePortalSections } from "@/domain/portal";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderInvoicePdf, renderQuotePdf } from "@/pdf";
import type { Db } from "@/server/billing/context";
import { loadInvoice, toPdfData } from "@/server/invoicing/document";
import { quotePdfFilename } from "@/server/quotes/document";
import { ACCEPTANCE_BUCKET } from "./accept";
import { type LinkKind, type PortalLink, resolvePortalLink } from "./access";
import { clientFileDownloadUrl } from "./files";
import { loadPublicQuote } from "./quote";

/**
 * Descargas públicas (/api/public/**): el token se comprueba en cada petición, lo que se sirve
 * es solo lo que ese enlace cubre, y nada se cachea ni se indexa.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const;

export const notFoundResponse = () => new Response("Not found", { status: 404, headers: PRIVATE_HEADERS });

function pdfResponse(bytes: ArrayBuffer | Uint8Array, filename: string): Response {
  const body = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return new Response(body as BodyInit, {
    headers: {
      ...PRIVATE_HEADERS,
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename.replace(/[^\w.-]+/g, "_")}"`,
    },
  });
}

/** El enlace vivo del token, si es del tipo que pide la ruta. */
async function liveLink(admin: Db, token: string, kind: LinkKind): Promise<PortalLink | null> {
  const resolved = await resolvePortalLink(token, { admin });
  return resolved.status === "active" && resolved.link.kind === kind ? resolved.link : null;
}

/** Desde el portal, los documentos se descargan si su sección está encendida. */
async function documentsOn(admin: Db, link: PortalLink): Promise<boolean> {
  if (link.kind !== "client" || !link.clientId) return false;
  const { data, error } = await admin.from("client_portal_settings").select("sections").eq("org_id", link.orgId).eq("client_id", link.clientId).maybeSingle();
  if (error) throw error;
  return resolvePortalSections(data?.sections).documents;
}

async function quotePdf(admin: Db, link: PortalLink, quoteId: string): Promise<Response> {
  const quote = await loadPublicQuote(admin, link, quoteId);
  if (!quote) return notFoundResponse();
  const filename = quotePdfFilename({ id: quote.quoteId, number: quote.number });
  // Aceptado online: la copia exacta que se aceptó (su SHA-256 está en la evidencia).
  if (quote.state === "accepted" && quote.acceptance?.pdfPath) {
    const { data } = await admin.storage.from(ACCEPTANCE_BUCKET).download(quote.acceptance.pdfPath);
    if (data) return pdfResponse(await data.arrayBuffer(), filename);
  }
  return pdfResponse(await renderQuotePdf(quote.loaded.document), filename);
}

/** /api/public/q/<token>/pdf */
export async function quoteLinkPdf(token: string): Promise<Response> {
  const admin = createAdminClient();
  const link = await liveLink(admin, token, "quote");
  if (!link?.quoteId) return notFoundResponse();
  return quotePdf(admin, link, link.quoteId);
}

/** /api/public/c/<token>/quotes/<id> */
export async function spaceQuotePdf(token: string, quoteId: string): Promise<Response> {
  if (!UUID.test(quoteId)) return notFoundResponse();
  const admin = createAdminClient();
  const link = await liveLink(admin, token, "client");
  if (!link || !(await documentsOn(admin, link))) return notFoundResponse();
  return quotePdf(admin, link, quoteId);
}

/** /api/public/c/<token>/invoices/<id>: la copia legal emitida, byte a byte. */
export async function spaceInvoicePdf(token: string, invoiceId: string): Promise<Response> {
  if (!UUID.test(invoiceId)) return notFoundResponse();
  const admin = createAdminClient();
  const link = await liveLink(admin, token, "client");
  if (!link?.clientId || !(await documentsOn(admin, link))) return notFoundResponse();
  const { data: invoice, error } = await admin
    .from("invoices")
    .select("id, org_id, number, lifecycle, pdf_path")
    .eq("org_id", link.orgId)
    .eq("client_id", link.clientId)
    .eq("id", invoiceId)
    .eq("lifecycle", "issued")
    .maybeSingle();
  if (error) throw error;
  if (!invoice?.number) return notFoundResponse();
  const filename = `${invoice.number}.pdf`;
  const expectedPath = `${invoice.org_id}/${invoice.id}.pdf`;
  if (invoice.pdf_path === expectedPath) {
    const { data } = await admin.storage.from("invoices").download(expectedPath);
    if (data) return pdfResponse(await data.arrayBuffer(), filename);
  }
  // Sin copia guardada (p. ej. un histórico importado): el documento con sus datos congelados.
  return pdfResponse(await renderInvoicePdf(toPdfData(await loadInvoice(admin, invoice.id))), filename);
}

/** /api/public/c/<token>/files/<id>: a una URL firmada de un minuto. */
export async function spaceFileRedirect(token: string, fileId: string): Promise<Response> {
  if (!UUID.test(fileId)) return notFoundResponse();
  const admin = createAdminClient();
  const link = await liveLink(admin, token, "client");
  if (!link) return notFoundResponse();
  const url = await clientFileDownloadUrl(admin, link, fileId);
  if (!url) return notFoundResponse();
  return new Response(null, { status: 302, headers: { ...PRIVATE_HEADERS, Location: url } });
}
