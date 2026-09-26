import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runDailyBilling } from "@/server/billing/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Muchas orgs y PDFs no, pero sí varias consultas por org: margen amplio.
export const maxDuration = 300;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Cron diario (Supabase Cron + pg_net lo llama a las 05:00 UTC con CRON_SECRET; ver
 * docs/CRON.md). Idempotente: si se ejecuta dos veces, o un día falla y el siguiente recupera,
 * el resultado es el mismo.
 */
export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const results = await runDailyBilling(createAdminClient());
  const failed = results.filter((r) => "error" in r).length;
  return NextResponse.json({ ok: failed === 0, results }, { status: failed === 0 ? 200 : 207 });
}
