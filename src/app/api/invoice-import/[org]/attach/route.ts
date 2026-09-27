import { getTranslations } from "next-intl/server";
import type { AttachResponse } from "@/components/invoice-import/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { idSchema } from "@/server/action-utils";
import { routeOrg, sameOrigin } from "@/server/dataio/route-auth";
import { attachOriginal } from "@/server/invoice-import/storage";
import { optionalId, readPdfUpload, revalidateImport } from "@/server/invoice-import/upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Guarda el PDF original de una factura importada que aún no lo tiene (p. ej. una importada desde
 * un CSV): multipart con `file`, `invoiceId` y, opcional, `projectId`. Solo socios.
 */
export async function POST(request: Request, ctx: { params: Promise<{ org: string }> }) {
  const t = await getTranslations("invoiceImport.errors");
  const fail = (key: string, status: number) => Response.json({ ok: false, error: t(key) } satisfies AttachResponse, { status });
  if (!sameOrigin(request)) return fail("origin", 403);

  const { org: slug } = await ctx.params;
  const auth = await routeOrg(slug, "partner");
  if (auth instanceof Response) return auth.status === 403 ? fail("permission", 403) : auth;

  const upload = await readPdfUpload(request);
  if (!upload.ok) return fail(upload.error, upload.status);
  const invoiceId = upload.form.get("invoiceId");
  if (typeof invoiceId !== "string" || !idSchema.safeParse(invoiceId).success) return fail("not_found", 404);

  const { data: invoice } = await auth.db
    .from("invoices")
    .select("id, client_id, source, lifecycle")
    .eq("org_id", auth.org.id)
    .eq("id", invoiceId)
    .maybeSingle();
  if (!invoice) return fail("not_found", 404);
  if (invoice.source !== "import" || invoice.lifecycle !== "issued") return fail("attach_not_imported", 422);

  const result = await attachOriginal(auth.db, createAdminClient(), { orgId: auth.org.id, invoiceId: invoice.id, file: upload.file });
  if (!result.ok) return fail("attach_failed", 502);
  revalidateImport(auth.org.slug, { invoiceIds: [invoice.id], clientIds: [invoice.client_id], projectId: optionalId(upload.form, "projectId") });
  return Response.json({ ok: true } satisfies AttachResponse);
}
