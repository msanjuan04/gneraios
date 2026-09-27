import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cronAuthorized } from "@/server/cron-auth";
import { dispatchPendingPushes } from "@/server/push/dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Reparte a los dispositivos los avisos nuevos (docs/CRON.md: cada 2 minutos). Idempotente: cada
 * aviso se reclama antes de enviarlo, así que nunca llega dos veces.
 */
export async function POST(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const result = await dispatchPendingPushes(createAdminClient());
  return NextResponse.json({ ok: true, ...result });
}
