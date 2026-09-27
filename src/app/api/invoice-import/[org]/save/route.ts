import { getTranslations } from "next-intl/server";
import type { SaveResponse } from "@/components/invoice-import/types";
import type { ImportForm } from "@/domain/invoice-import/form";
import { createAdminClient } from "@/lib/supabase/admin";
import { DbError } from "@/server/billing/context";
import { routeOrg, sameOrigin } from "@/server/dataio/route-auth";
import { importFormSchema, saveImportedInvoice } from "@/server/invoice-import/save";
import { optionalId, readPdfUpload, revalidateImport } from "@/server/invoice-import/upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FORM_BYTES = 64 * 1024;

/**
 * Guarda una factura leída de un PDF: multipart con el PDF (`file`), el formulario revisado
 * (`form`, JSON) y, si se importa desde un proyecto, `projectId` (solo para volver a pintarlo). La
 * factura entra ya emitida con import_historical_invoice, con su cobro si lo tiene, y su PDF queda
 * guardado y enlazado. Solo socios.
 */
export async function POST(request: Request, ctx: { params: Promise<{ org: string }> }) {
  const t = await getTranslations("invoiceImport.errors");
  const fail = (key: string, status: number, extra: Partial<Extract<SaveResponse, { ok: false }>> = {}, values?: Record<string, string>) =>
    Response.json({ ok: false, error: t(key, values), code: extra.code ?? key, ...extra } satisfies SaveResponse, { status });
  if (!sameOrigin(request)) return fail("origin", 403);

  const { org: slug } = await ctx.params;
  const auth = await routeOrg(slug, "partner");
  if (auth instanceof Response) return auth.status === 403 ? fail("permission", 403) : auth;

  const upload = await readPdfUpload(request);
  if (!upload.ok) return fail(upload.error, upload.status);
  const raw = upload.form.get("form");
  if (typeof raw !== "string" || raw.length > MAX_FORM_BYTES) return fail("invalid", 400);
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return fail("invalid", 400);
  }
  const parsed = importFormSchema.safeParse(json);
  if (!parsed.success) return fail("invalid", 400);
  const form = { ...parsed.data, newClient: null } as ImportForm;
  const projectId = optionalId(upload.form, "projectId");

  try {
    const outcome = await saveImportedInvoice({ db: auth.db, admin: createAdminClient(), org: auth.org }, form, upload.file);
    if (outcome.ok) {
      revalidateImport(auth.org.slug, { invoiceIds: [outcome.invoiceId], clientIds: [outcome.clientId], projectId });
      return Response.json({ ok: true, invoiceId: outcome.invoiceId, number: outcome.number, clientId: outcome.clientId, attached: outcome.attached } satisfies SaveResponse);
    }
    switch (outcome.code) {
      case "invalid":
        return fail("invalid", 422, { code: outcome.issues[0]?.code ?? "invalid" });
      case "duplicate":
        return fail("duplicate", 409, { code: "duplicate", existing: outcome.existing ?? undefined }, { number: form.number });
      case "forbidden":
        return fail("permission", 403);
      case "db_error":
        return fail("generic", 500);
      default:
        return fail(`db.${outcome.code}`, 422, { code: outcome.code }, { detail: outcome.detail ?? "" });
    }
  } catch (error) {
    console.error("[invoice-import] save", error instanceof DbError ? error.where : error instanceof Error ? error.name : "unknown");
    return fail("generic", 500);
  }
}
