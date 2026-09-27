import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cronAuthorized } from "@/server/cron-auth";
import { runWeeklyDigest } from "@/server/digest/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Resumen semanal (docs/CRON.md: los lunes a primera hora). Idempotente: una vez por org y semana.
 * `{"force": true}` lo manda aunque no sea lunes (para probarlo), pero tampoco lo repite.
 */
export async function POST(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { force?: unknown };
  const results = await runWeeklyDigest(createAdminClient(), { force: body.force === true });
  const failed = results.filter((r) => r.error).length;
  return NextResponse.json({ ok: failed === 0, results }, { status: failed === 0 ? 200 : 207 });
}
