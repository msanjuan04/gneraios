import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runDailySeoSync } from "@/server/seo/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// La sincronización con Google (Search Console + GA4) va aparte de la facturación: cada org
// puede tardar minutos en su primer relleno de 16 meses.
export const maxDuration = 800;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Cron diario del SEO (docs/CRON.md). Idempotente: repetirlo no cambia nada. */
export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const results = await runDailySeoSync(createAdminClient());
  const failed = results.filter((r) => "error" in r).length;
  return NextResponse.json({ ok: failed === 0, results }, { status: failed === 0 ? 200 : 207 });
}
