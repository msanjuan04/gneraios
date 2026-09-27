import "server-only";
import type { Db } from "@/server/billing/context";

/**
 * Justificantes de gastos en Storage (bucket privado `expenses`, `<org>/<gasto>.<ext>`). Solo el
 * servidor lee y escribe con la clave de servidor, y siempre después de comprobar con la sesión
 * del usuario (RLS) que el gasto es de su org y que puede tocarlo.
 */

export const ATTACHMENT_BUCKET = "expenses";

/** Por debajo del límite del proxy (10 MB), que corta los cuerpos más grandes sin avisar. */
export const ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;

export const ATTACHMENT_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const CONTENT_TYPES: Record<string, string> = Object.fromEntries(Object.entries(ATTACHMENT_TYPES).map(([type, ext]) => [ext, type]));

export function attachmentPath(orgId: string, expenseId: string, ext: string): string {
  return `${orgId}/${expenseId}.${ext}`;
}

/** Tipo del fichero guardado, por su extensión. */
export function attachmentContentType(path: string): string {
  return CONTENT_TYPES[path.split(".").at(-1) ?? ""] ?? "application/octet-stream";
}

export async function uploadAttachment(admin: Db, path: string, file: Blob, contentType: string): Promise<{ error: string | null }> {
  const { error } = await admin.storage.from(ATTACHMENT_BUCKET).upload(path, file, { contentType, upsert: true });
  return { error: error?.message ?? null };
}

/** Borra justificantes (los errores se registran: un fichero huérfano no rompe nada). */
export async function removeAttachments(admin: Db, paths: readonly string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await admin.storage.from(ATTACHMENT_BUCKET).remove([...paths]);
  if (error) console.error("[finance] removeAttachments", error);
}

export async function downloadAttachment(admin: Db, path: string): Promise<Blob | null> {
  const { data, error } = await admin.storage.from(ATTACHMENT_BUCKET).download(path);
  if (error) {
    console.error("[finance] downloadAttachment", error);
    return null;
  }
  return data;
}
