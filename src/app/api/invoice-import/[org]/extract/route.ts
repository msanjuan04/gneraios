import { getTranslations } from "next-intl/server";
import type { ExtractResponse } from "@/components/invoice-import/types";
import { DbError } from "@/server/billing/context";
import { routeOrg, sameOrigin } from "@/server/dataio/route-auth";
import { extractInvoice } from "@/server/invoice-import/engine";
import { findExisting } from "@/server/invoice-import/existing";
import { PdfReadError } from "@/server/invoice-import/pdf-text";
import { loadIssuers } from "@/server/invoice-import/setup";
import { readPdfUpload } from "@/server/invoice-import/upload";

// pdf.js y Claude: siempre en Node y nunca estático.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lee un PDF de factura (campo `file`) y devuelve lo leído, con qué lector (Claude o el texto del
 * PDF), su huella y, si ya está en la org (el mismo PDF, o el mismo emisor y número), cuál es.
 * No guarda nada. Solo socios. Responde { ok: false, error } con el mensaje ya traducido.
 */
export async function POST(request: Request, ctx: { params: Promise<{ org: string }> }) {
  const t = await getTranslations("invoiceImport.errors");
  const fail = (key: string, status: number) => Response.json({ ok: false, error: t(key) } satisfies ExtractResponse, { status });
  if (!sameOrigin(request)) return fail("origin", 403);

  const { org: slug } = await ctx.params;
  const auth = await routeOrg(slug, "partner");
  if (auth instanceof Response) return auth.status === 403 ? fail("permission", 403) : auth;

  const upload = await readPdfUpload(request);
  if (!upload.ok) return fail(upload.error, upload.status);

  try {
    const issuers = await loadIssuers(auth.db, auth.org.id);
    const hints = { issuerTaxIds: issuers.flatMap((i) => (i.taxId ? [i.taxId] : [])) };
    const { engine, extraction } = await extractInvoice(upload.file.bytes, hints);
    const existing = await findExisting(auth.db, auth.org.id, { sha256: upload.file.sha256, extraction, issuers });
    return Response.json({ ok: true, engine, extraction, sha256: upload.file.sha256, existing } satisfies ExtractResponse);
  } catch (error) {
    if (error instanceof PdfReadError) return fail(error.reason === "encrypted" ? "pdf_encrypted" : "pdf_invalid", 422);
    // Nunca el contenido: solo dónde ha fallado.
    console.error("[invoice-import] extract", error instanceof DbError ? error.where : error instanceof Error ? error.name : "unknown");
    return fail("generic", 500);
  }
}
