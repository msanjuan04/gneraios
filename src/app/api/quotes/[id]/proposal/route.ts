import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { renderProposalPdf } from "@/pdf";
import { loadQuoteDocument, quotePdfFilename } from "@/server/quotes/document";
import { getSessionUser } from "@/server/session";

// El PDF se genera con react-pdf y lee fuentes e imágenes del disco: siempre en Node, nunca estático.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tipado a mano: la ruta es nueva y los tipos de rutas de Next se regeneran con `next dev`/`next build`.
type Context = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * La propuesta comercial de un presupuesto (portada oscura, resumen, alcance y condiciones), generada
 * al momento con sus datos de hoy. No sustituye al presupuesto formal: ese es el que se acepta, se
 * congela y se factura. La lectura pasa por RLS: solo la ve un miembro de su org.
 */
export async function GET(request: NextRequest, ctx: Context) {
  const { id } = await ctx.params;
  if (!(await getSessionUser())) return new Response("Unauthorized", { status: 401 });
  if (!UUID.test(id)) return new Response("Not found", { status: 404 });

  const loaded = await loadQuoteDocument(await createClient(), id);
  if (!loaded) return new Response("Not found", { status: 404 });

  const pdf = await renderProposalPdf(loaded.document);
  const download = request.nextUrl.searchParams.get("download") === "1";
  const filename = quotePdfFilename(loaded.quote).replace(/\.pdf$/i, "-propuesta.pdf");
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
