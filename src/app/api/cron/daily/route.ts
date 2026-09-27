import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { pruneAccessLog } from "@/server/auth/access-code";
import { cronAuthorized } from "@/server/cron-auth";
import { runDailyBilling } from "@/server/billing/run";
import { runSubscriptionRenewalAlerts } from "@/server/finance/renewals";
import { dispatchPendingPushes } from "@/server/push/dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Muchas orgs y PDFs no, pero sí varias consultas por org: margen amplio.
export const maxDuration = 300;

/**
 * Cron diario (Supabase Cron + pg_net lo llama a las 05:00 UTC con CRON_SECRET; ver
 * docs/CRON.md). Idempotente: si se ejecuta dos veces, o un día falla y el siguiente recupera,
 * el resultado es el mismo.
 */
export async function POST(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  const results = await runDailyBilling(admin);
  // Suscripciones de gasto que se renuevan pronto (dominios, servidores…): avisos a los socios.
  const renewals = await runSubscriptionRenewalAlerts(admin).catch((error: unknown) => {
    console.error("[cron] renewals", error);
    return { orgs: 0, due: 0, created: 0, errors: [error instanceof Error ? error.message : String(error)] };
  });
  // Los avisos que acaba de crear (renovaciones, recordatorios listos…) salen ya a los móviles.
  const push = await dispatchPendingPushes(admin).catch((error: unknown) => {
    console.error("[cron] push", error);
    return null;
  });
  await pruneAccessLog(admin).catch((error: unknown) => console.error("[cron] access log", error));
  const failed = results.filter((r) => "error" in r).length + renewals.errors.length;
  return NextResponse.json({ ok: failed === 0, results, renewals, push }, { status: failed === 0 ? 200 : 207 });
}
