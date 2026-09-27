import "server-only";
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { idSchema } from "@/server/action-utils";
import { looksLikePdf } from "./pdf-text";
import { MAX_PDF_BYTES, type OriginalFile } from "./storage";

export type UploadError = "too_large" | "missing" | "not_pdf";

const PDF_TYPES = new Set(["", "application/pdf", "application/x-pdf", "application/octet-stream"]);

/**
 * El PDF de una subida (campo `file` del multipart), con su huella. Es una ruta y no una Server
 * Action porque las acciones admiten como mucho 1 MB. Se comprueba el tamaño antes de leer el
 * cuerpo y que de verdad sea un PDF (por sus bytes, no solo por su tipo).
 */
export async function readPdfUpload(
  request: Request,
): Promise<{ ok: true; file: OriginalFile; form: FormData } | { ok: false; error: UploadError; status: number }> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_PDF_BYTES + 256 * 1024) return { ok: false, error: "too_large", status: 413 };
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { ok: false, error: "missing", status: 400 };
  }
  const value = form.get("file");
  if (!(value instanceof File) || value.size === 0) return { ok: false, error: "missing", status: 400 };
  if (value.size > MAX_PDF_BYTES) return { ok: false, error: "too_large", status: 413 };
  const bytes = new Uint8Array(await value.arrayBuffer());
  if (!PDF_TYPES.has(value.type) || !looksLikePdf(bytes)) return { ok: false, error: "not_pdf", status: 415 };
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return { ok: true, file: { bytes, name: value.name || "factura.pdf", sha256 }, form };
}

/** Un id opcional del formulario (p. ej. el proyecto desde el que se importa). */
export function optionalId(form: FormData, key: string): string | null {
  const value = form.get(key);
  return typeof value === "string" && idSchema.safeParse(value).success ? value : null;
}

/** Vuelve a pintar las facturas, las tocadas, las fichas de sus clientes, el proyecto y el dashboard. */
export function revalidateImport(slug: string, opts: { invoiceIds?: string[]; clientIds?: string[]; projectId?: string | null }) {
  revalidatePath(`/${slug}/invoices`);
  for (const id of new Set(opts.invoiceIds ?? [])) revalidatePath(`/${slug}/invoices/${id}`);
  for (const id of new Set(opts.clientIds ?? [])) revalidatePath(`/${slug}/clients/${id}`);
  if (opts.projectId) revalidatePath(`/${slug}/projects/${opts.projectId}`);
  revalidatePath(`/${slug}`);
}
