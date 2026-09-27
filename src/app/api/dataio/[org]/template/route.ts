import type { NextRequest } from "next/server";
import { getTranslations } from "next-intl/server";
import { toCsv } from "@/domain/dataio/csv";
import { TEMPLATE_HEADERS } from "@/domain/dataio/fields";
import { attachment, routeOrg } from "@/server/dataio/route-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Plantilla CSV de una importación (`?kind=clients|invoices`): los títulos que se reconocen solos y una fila de ejemplo. */
export async function GET(request: NextRequest, ctx: { params: Promise<{ org: string }> }) {
  const { org: slug } = await ctx.params;
  const auth = await routeOrg(slug, "viewer");
  if (auth instanceof Response) return auth;
  const kind = request.nextUrl.searchParams.get("kind");
  if (kind !== "clients" && kind !== "invoices") return new Response("Bad request", { status: 400 });

  const t = await getTranslations("dataio.template");
  const columns = TEMPLATE_HEADERS[kind];
  const example = columns.map(([field]) => (t.has(`${kind}.${field}`) ? t(`${kind}.${field}`) : ""));
  const csv = toCsv([columns.map(([, header]) => header), example], { delimiter: ";", bom: true, eol: "\r\n" });
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": attachment(t(`fileName.${kind}`)),
      "Cache-Control": "private, no-store",
    },
  });
}
