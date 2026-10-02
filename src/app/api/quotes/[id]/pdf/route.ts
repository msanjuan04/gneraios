import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { renderQuotePdf } from "@/pdf";
import { loadQuoteDocument, quotePdfFilename } from "@/server/quotes/document";
import { getSessionUser } from "@/server/session";

// El PDF se genera con react-pdf y lee fuentes del disco: siempre en Node, nunca estático.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tipado a mano: la ruta es nueva y los tipos de rutas de Next se regeneran con `next dev`/`next build`.
type Context = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PDF de un presupuesto, generado al momento con sus datos de hoy (no es un documento legal:
 * no se guarda copia). Un borrador sale con la marca de borrador y sin número. La lectura pasa
 * por RLS: solo lo ve un miembro de su org.
 */
export async function GET(request: NextRequest, ctx: Context) {
  const { id } = await ctx.params;
  if (!(await getSessionUser())) return new Response("Unauthorized", { status: 401 });
  if (!UUID.test(id)) return new Response("Not found", { status: 404 });

  const loaded = await loadQuoteDocument(await createClient(), id);
  if (!loaded) return new Response("Not found", { status: 404 });

  const versionId = request.nextUrl.searchParams.get("version");
  if (versionId && UUID.test(versionId)) {
    const supabase = await createClient();
    const emailSnapshot = await supabase.from("outbound_emails").select("quote_pdf_snapshot, quote_pdf_sha256").eq("org_id", loaded.quote.org_id).eq("quote_id", id).eq("id", versionId).not("quote_pdf_snapshot", "is", null).maybeSingle();
    const manualSnapshot = emailSnapshot.data ? null : await supabase.from("quote_sent_versions").select("pdf_snapshot, pdf_sha256").eq("org_id", loaded.quote.org_id).eq("quote_id", id).eq("id", versionId).maybeSingle();
    const snapshot = emailSnapshot.data ?? (manualSnapshot?.data ? { quote_pdf_snapshot: manualSnapshot.data.pdf_snapshot, quote_pdf_sha256: manualSnapshot.data.pdf_sha256 } : null);
    if (!snapshot?.quote_pdf_snapshot || !snapshot.quote_pdf_sha256) return new Response("Not found", { status: 404 });
    const encoded = snapshot.quote_pdf_snapshot;
    const bytes = Buffer.from(encoded.startsWith("\\x") ? encoded.slice(2) : encoded, "hex");
    const { createHash } = await import("node:crypto");
    if (createHash("sha256").update(bytes).digest("hex") !== snapshot.quote_pdf_sha256) return new Response("Stored proposal failed integrity check", { status: 500 });
    const download = request.nextUrl.searchParams.get("download") === "1";
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${quotePdfFilename(loaded.quote)}"`, "Cache-Control": "private, no-store" } });
  }

  const pdf = await renderQuotePdf(loaded.document);
  const download = request.nextUrl.searchParams.get("download") === "1";
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${quotePdfFilename(loaded.quote)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
