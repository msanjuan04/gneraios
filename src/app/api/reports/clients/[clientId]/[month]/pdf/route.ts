import type { NextRequest } from "next/server";
import { parseReportMonth } from "@/domain/reports";
import { createClient } from "@/lib/supabase/server";
import { renderClientReportPdf, reportPdfFilename } from "@/pdf";
import { partnerClientAccess } from "@/server/reports/access";
import { loadClientMonthReport } from "@/server/reports/load";
import { getSessionUser } from "@/server/session";

// El PDF se genera con react-pdf y lee fuentes del disco: siempre en Node, nunca estático.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tipado a mano: la ruta es nueva y los tipos de rutas de Next se regeneran con `next dev`/`next build`.
type Context = { params: Promise<{ clientId: string; month: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Informe mensual de un cliente en PDF (`month` = "2026-08"), generado al momento con los datos de
 * hoy: no se guarda copia. `?download=1` lo descarga y `?hours=1` añade las horas dedicadas. Solo
 * para un socio de la org del cliente, y la lectura pasa por su RLS.
 */
export async function GET(request: NextRequest, ctx: Context) {
  const { clientId, month: monthParam } = await ctx.params;
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const month = parseReportMonth(monthParam);
  if (!UUID.test(clientId) || !month) return new Response("Not found", { status: 404 });

  const db = await createClient();
  const access = await partnerClientAccess(db, user.id, clientId);
  if (!access) return new Response("Not found", { status: 404 });

  const search = request.nextUrl.searchParams;
  const report = await loadClientMonthReport(db, access.orgId, clientId, month, { includeHours: search.get("hours") === "1" });
  if (!report) return new Response("Not found", { status: 404 });

  const pdf = await renderClientReportPdf(report);
  const download = search.get("download") === "1";
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${reportPdfFilename(report)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
