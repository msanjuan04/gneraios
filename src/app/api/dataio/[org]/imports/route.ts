import { getTranslations } from "next-intl/server";
import { DbError } from "@/server/billing/context";
import { createImportJob, MAX_IMPORT_BYTES } from "@/server/dataio/jobs";
import { routeOrg, sameOrigin } from "@/server/dataio/route-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sube el fichero de una importación y la deja en borrador con el mapeo automático. Es una ruta
 * (y no una Server Action) porque las acciones admiten como mucho 1 MB y un CSV puede pesar más.
 * Responde { ok, jobId } o { ok: false, error } con el mensaje ya traducido.
 */
export async function POST(request: Request, ctx: { params: Promise<{ org: string }> }) {
  const t = await getTranslations("dataio.upload.errors");
  const fail = (key: string, status = 400) => Response.json({ ok: false, error: t(key) }, { status });
  if (!sameOrigin(request)) return fail("origin", 403);

  const { org: slug } = await ctx.params;
  const auth = await routeOrg(slug, "partner");
  if (auth instanceof Response) return auth.status === 403 ? fail("permission", 403) : auth;

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_IMPORT_BYTES + 64 * 1024) return fail("too_large", 413);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail("empty");
  }
  const kind = form.get("kind");
  const file = form.get("file");
  if ((kind !== "clients" && kind !== "invoices") || !(file instanceof File)) return fail("empty");
  if (file.size > MAX_IMPORT_BYTES) return fail("too_large", 413);

  try {
    const result = await createImportJob(auth.db, auth.org.id, {
      kind,
      fileName: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    if (!result.ok) return fail(result.reason, 422);
    return Response.json({ ok: true, jobId: result.jobId });
  } catch (err) {
    console.error("[dataio] upload", err instanceof DbError ? err.error : err);
    return fail("generic", 500);
  }
}
