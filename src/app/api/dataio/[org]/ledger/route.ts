import type { NextRequest } from "next/server";
import { parseExportPeriod } from "@/domain/dataio/period";
import { createAdminClient } from "@/lib/supabase/admin";
import { idSchema } from "@/server/action-utils";
import { DbError } from "@/server/billing/context";
import { ledgerBaseName, ledgerFiles, ledgerZip, loadLedger } from "@/server/dataio/export";
import { attachment, routeOrg } from "@/server/dataio/route-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  zip: "application/zip",
} as const;

/**
 * Exportación por emisor y periodo. CSV/XLSX: libro expedido; ZIP: libro, gastos, cobros y adjuntos
 * disponibles, con manifiesto de faltantes y registros sin asignación.
 * Las facturas se leen con la sesión (RLS: cualquier miembro ve las de su org); solo después, y
 * solo para esas, se usa la clave de servidor para leer sus PDF de Storage.
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ org: string }> }) {
  const { org: slug } = await ctx.params;
  const auth = await routeOrg(slug, "viewer");
  if (auth instanceof Response) return auth;

  const params = request.nextUrl.searchParams;
  const issuer = idSchema.safeParse(params.get("issuer"));
  const period = parseExportPeriod(params.get("period") ?? "");
  const format = params.get("format") ?? "csv";
  if (!issuer.success || !period || !(format in TYPES)) return new Response("Bad request", { status: 400 });

  try {
    const data = await loadLedger(auth.db, auth.org.id, issuer.data, period);
    if (!data) return new Response("Not found", { status: 404 });
    const base = ledgerBaseName(data, period);
    const headers = (ext: keyof typeof TYPES) => ({
      "Content-Type": TYPES[ext],
      "Content-Disposition": attachment(`${base}.${ext}`),
      "Cache-Control": "private, no-store",
    });
    if (format === "zip") {
      const zip = await ledgerZip(createAdminClient(), data, period, auth.org.timezone);
      return new Response(new Uint8Array(zip), { headers: headers("zip") });
    }
    const files = await ledgerFiles(data, auth.org.timezone);
    const body = format === "xlsx" ? files.xlsx : files.csv;
    return new Response(new Uint8Array(body), { headers: headers(format as "csv" | "xlsx") });
  } catch (err) {
    console.error("[dataio] ledger", err instanceof DbError ? err.error : err);
    return new Response("Error", { status: 500 });
  }
}
