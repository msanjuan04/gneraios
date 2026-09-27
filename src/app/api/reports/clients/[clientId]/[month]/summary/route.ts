import type { NextRequest } from "next/server";
import { parseReportMonth } from "@/domain/reports";
import { createClient } from "@/lib/supabase/server";
import { partnerClientAccess } from "@/server/reports/access";
import { getClientReportSummary } from "@/server/reports/summary";
import { getSessionUser } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tipado a mano: la ruta es nueva y los tipos de rutas de Next se regeneran con `next dev`/`next build`.
type Context = { params: Promise<{ clientId: string; month: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Lo que saldrá en el informe de un mes, contado, y cómo va su email (ClientReportSummary). Es una
 * lectura, así que va por GET y no por server action. `?hours=1` cuenta también las horas.
 */
export async function GET(request: NextRequest, ctx: Context) {
  const { clientId, month: monthParam } = await ctx.params;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const month = parseReportMonth(monthParam);
  if (!UUID.test(clientId) || !month) return Response.json({ error: "not_found" }, { status: 404 });

  const db = await createClient();
  const access = await partnerClientAccess(db, user.id, clientId);
  if (!access) return Response.json({ error: "not_found" }, { status: 404 });

  const summary = await getClientReportSummary(db, access.orgId, clientId, month, {
    includeHours: request.nextUrl.searchParams.get("hours") === "1",
  });
  if (!summary) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json(summary, { headers: { "Cache-Control": "private, no-store" } });
}
