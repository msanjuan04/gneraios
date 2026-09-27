import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { readCsvMapping } from "@/app/[org]/finance/bank/schema";
import { nowInZone } from "@/lib/clock";
import { bankingErrorKey } from "@/server/banking/errors";
import { commitStatementImport, type ImportFailure, MAX_STATEMENT_BYTES, previewStatementImport } from "@/server/banking/import";
import { DbError } from "@/server/billing/context";
import { routeOrg, sameOrigin } from "@/server/dataio/route-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Sube un extracto del banco (Norma 43 o CSV) de una cuenta de caja. Con mode=preview solo lo lee y
 * dice qué traería (movimientos nuevos y repetidos, saldos, avisos, y en un CSV el mapeo de columnas
 * para corregirlo); con mode=commit lo guarda. Es una ruta (y no una Server Action) porque las
 * acciones admiten como mucho 1 MB y un extracto de un año puede pesar más. El mismo control de
 * Origin y de rol (socio) que la subida de importaciones de datos.
 */
export async function POST(request: Request, ctx: { params: Promise<{ org: string }> }) {
  const t = await getTranslations("banking.upload.errors");
  const fail = (key: string, status = 400, extra: Partial<ImportFailure> = {}) =>
    Response.json({ ...extra, ok: false, reason: key, error: t(key) }, { status });
  if (!sameOrigin(request)) return fail("origin", 403);

  const { org: slug } = await ctx.params;
  const auth = await routeOrg(slug, "partner");
  if (auth instanceof Response) return auth.status === 403 ? fail("permission", 403) : auth;

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_STATEMENT_BYTES + 64 * 1024) return fail("too_large", 413);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail("empty");
  }
  const file = form.get("file");
  const accountId = form.get("account_id");
  const mode = form.get("mode");
  if (!(file instanceof File) || typeof accountId !== "string" || !GUID.test(accountId) || (mode !== "preview" && mode !== "commit")) {
    return fail("empty");
  }
  if (file.size > MAX_STATEMENT_BYTES) return fail("too_large", 413);

  const input = {
    accountId,
    fileName: file.name.slice(0, 255) || "extracto",
    bytes: new Uint8Array(await file.arrayBuffer()),
    mapping: readCsvMapping(form.get("mapping")),
    today: nowInZone(auth.org.timezone).date,
  };
  try {
    if (mode === "preview") {
      const preview = await previewStatementImport(auth.db, auth.org.id, input);
      if (!preview.ok) return fail(preview.reason, 422, preview);
      return Response.json(preview);
    }
    const tBanking = await getTranslations("banking.upload");
    const result = await commitStatementImport(auth.db, auth.org.id, { ...input, balanceNote: tBanking("balanceNote", { file: input.fileName }) });
    if (!result.ok) return fail(result.reason, 422, result);
    revalidatePath(`/${auth.org.slug}/finance`, "layout");
    revalidatePath(`/${auth.org.slug}`);
    return Response.json(result);
  } catch (err) {
    if (err instanceof DbError) {
      const key = bankingErrorKey(err.error);
      if (key) {
        const tRoot = await getTranslations();
        return Response.json({ ok: false, reason: err.error.hint || "db", error: tRoot(key) }, { status: 422 });
      }
      console.error("[banking] upload", err.error);
    } else {
      console.error("[banking] upload", err);
    }
    return fail("generic", 500);
  }
}
