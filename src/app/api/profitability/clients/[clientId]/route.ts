import type { NextRequest } from "next/server";
import { nowInZone } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { loadClientProfitability } from "@/server/profitability/load";
import { partnerClientAccess } from "@/server/reports/access";
import { getSessionUser } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tipado a mano: la ruta es nueva y los tipos de rutas de Next se regeneran con `next dev`/`next build`.
type Context = { params: Promise<{ clientId: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * La rentabilidad de un cliente en los últimos 3 y 12 meses (ClientProfitabilitySummary), para la
 * tarjeta de su ficha: su coste suma las horas, sus gastos y su parte de la infraestructura de las
 * webs alojadas, con el desglose. Es una lectura, así que va por GET y no por server action. Solo
 * para un socio de la org del cliente (el coste por hora es un dato sensible), y la lectura pasa por
 * su RLS.
 */
export async function GET(_request: NextRequest, ctx: Context) {
  const { clientId } = await ctx.params;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!UUID.test(clientId)) return Response.json({ error: "not_found" }, { status: 404 });

  const db = await createClient();
  const access = await partnerClientAccess(db, user.id, clientId);
  if (!access) return Response.json({ error: "not_found" }, { status: 404 });
  const { data: org, error } = await db.from("orgs").select("id, settings, timezone").eq("id", access.orgId).maybeSingle();
  if (error) throw error;
  if (!org) return Response.json({ error: "not_found" }, { status: 404 });

  const summary = await loadClientProfitability(db, org, clientId, nowInZone(org.timezone).date);
  return Response.json(summary, { headers: { "Cache-Control": "private, no-store" } });
}
