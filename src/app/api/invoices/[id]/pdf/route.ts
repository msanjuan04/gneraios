import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { renderInvoicePdf } from "@/pdf";
import { loadOriginal } from "@/server/invoice-import/storage";
import { loadInvoice, toPdfData } from "@/server/invoicing/document";
import { getSessionUser } from "@/server/session";

// El PDF se genera con react-pdf y lee fuentes del disco: siempre en Node, nunca estático.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PDF de una factura. Emitida: la copia legal guardada en Storage, byte a byte (nunca se
 * regenera con una plantilla nueva); importada de otra herramienta, su PDF original si se guardó
 * al importarla. Borrador: vista previa con la marca de borrador.
 * La lectura de la factura pasa por RLS; solo después se usa la clave de servidor para Storage.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/invoices/[id]/pdf">) {
  const { id } = await ctx.params;
  if (!(await getSessionUser())) return new Response("Unauthorized", { status: 401 });
  const supabase = await createClient();
  const { data: invoice } = await supabase.from("invoices").select("id, lifecycle, number, pdf_path, source").eq("id", id).maybeSingle();
  if (!invoice) return new Response("Not found", { status: 404 });

  const download = request.nextUrl.searchParams.get("download") === "1";
  const filename = `${(invoice.number ?? `borrador-${id.slice(0, 8)}`).replace(/[^\w.-]+/g, "_")}.pdf`;
  const headers = {
    "Content-Type": "application/pdf",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
    "Cache-Control": "private, no-store",
  };

  // Histórica importada con su PDF: el documento que recibió el cliente, tal cual.
  if (invoice.lifecycle === "issued" && invoice.source === "import") {
    const original = await loadOriginal(supabase, createAdminClient(), invoice.id);
    if (original) return new Response(original.bytes, { headers });
  }

  if (invoice.lifecycle === "issued" && invoice.pdf_path) {
    const { data, error } = await createAdminClient().storage.from("invoices").download(invoice.pdf_path);
    if (error || !data) return new Response("PDF not available", { status: 502 });
    return new Response(await data.arrayBuffer(), { headers });
  }

  const pdf = await renderInvoicePdf(toPdfData(await loadInvoice(supabase, id)));
  return new Response(new Uint8Array(pdf), { headers });
}
