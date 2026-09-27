import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cronAuthorized } from "@/server/cron-auth";
import { dispatchPendingPushes } from "@/server/push/dispatch";
import { runSiteChecks } from "@/server/sites/engine";

// node:tls para leer los certificados.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Unas decenas de webs, 5 a la vez y 10 s como mucho cada una: sobra con 2 minutos.
export const maxDuration = 120;

/**
 * Vigila las webs (docs/CRON.md: cada 5 minutos, con `Authorization: Bearer <CRON_SECRET>`).
 * Comprueba todas las webs activas de todas las orgs, guarda las comprobaciones, avisa a los socios
 * de lo que ha cambiado (bandeja y push) y borra las comprobaciones de más de 30 días. Repetirlo no
 * duplica avisos: cada uno lleva su clave.
 */
export async function POST(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  try {
    const summary = await runSiteChecks(admin, { prune: true });
    // Una caída no espera al reparto de cada 2 minutos.
    const push =
      summary.alerts > 0
        ? await dispatchPendingPushes(admin).catch((error: unknown) => {
            console.error("[cron] sites push", error);
            return null;
          })
        : null;
    const ok = summary.errors.length === 0;
    return NextResponse.json({ ok, ...summary, push }, { status: ok ? 200 : 207 });
  } catch (error) {
    console.error("[cron] sites", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
