import { NextResponse } from "next/server";
import { runBackup } from "@/server/backup/run";
import { cronAuthorized } from "@/server/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Copia nocturna de los datos en el disco del servidor (docs/CRON.md). Necesita BACKUP_DIR; guarda
 * BACKUP_KEEP_DAYS días (14 por defecto) y nunca menos de las 3 últimas copias.
 */
export async function POST(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const dir = process.env.BACKUP_DIR;
  if (!dir) return NextResponse.json({ error: "BACKUP_DIR no configurado" }, { status: 503 });
  const keepDays = Math.max(1, Number(process.env.BACKUP_KEEP_DAYS) || 14);
  try {
    const summary = await runBackup({ dir, keepDays });
    const ok = Object.keys(summary.errors).length === 0;
    return NextResponse.json({ ok, ...summary }, { status: ok ? 200 : 207 });
  } catch (error) {
    console.error("[cron] backup", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "error" }, { status: 500 });
  }
}
