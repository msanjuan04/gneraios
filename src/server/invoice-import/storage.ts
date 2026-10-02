// Sin `import "server-only"`: lo usa también el test de guardado. Solo se importa desde el servidor.
//
// El PDF original de una factura importada, tal cual se subió, en el bucket privado
// `invoice-attachments` (<org>/<factura>/<huella>.pdf) y enlazado en `invoice_attachments`
// (supabase/migrations/20260927110000_facturas_adjuntas.sql). Solo el servidor lee y escribe
// Storage con la clave de servidor, y siempre después de comprobar con la sesión del usuario (RLS)
// que la factura es de su org; el enlace se guarda con esa sesión, así que RLS lo vuelve a comprobar.
//
// La ruta lleva la huella SHA-256 del contenido y los objetos nunca se sobrescriben: dos subidas a
// la vez (auditoría A08) no pueden dejar los bytes de una con los metadatos de la otra. Gana el
// primer enlace; el objeto del que pierde, si es distinto, se borra porque nadie lo referencia.

import type { Db } from "@/server/billing/context";

export const ORIGINALS_BUCKET = "invoice-attachments";

/** Por debajo del límite del proxy (10 MB), que corta los cuerpos más grandes sin avisar. */
export const MAX_PDF_BYTES = 8 * 1024 * 1024;

/** Ruta inmutable del original: la huella del contenido forma parte del nombre. */
export const originalPath = (orgId: string, invoiceId: string, sha256: string) => `${orgId}/${invoiceId}/${sha256}.pdf`;

export type OriginalFile = { bytes: Uint8Array; name: string; sha256: string };

/** Nombre del fichero para guardarlo (sin rutas ni caracteres de control, con su .pdf). */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).at(-1)!.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200) || "factura.pdf";
  return /\.pdf$/i.test(base) ? base : `${base}.pdf`;
}

/** Storage devuelve 409 (o «already exists») cuando el objeto ya está y no se sobrescribe. */
function isAlreadyThere(error: { message?: string; statusCode?: string | number }): boolean {
  return String(error.statusCode ?? "") === "409" || /already exists|duplicate/i.test(error.message ?? "");
}

/**
 * Sube el PDF y lo enlaza con la factura. Si ya tenía su original, no hace nada (reintentar es
 * seguro). Si el enlace falla, se quita el fichero recién subido.
 */
export async function attachOriginal(
  db: Db,
  admin: Db,
  input: { orgId: string; invoiceId: string; file: OriginalFile },
): Promise<{ ok: true; attached: boolean } | { ok: false; reason: "upload" | "link" }> {
  const { data: existing, error: readError } = await db
    .from("invoice_attachments")
    .select("id")
    .eq("org_id", input.orgId)
    .eq("invoice_id", input.invoiceId)
    .eq("kind", "original")
    .maybeSingle();
  if (readError) {
    console.error("[invoice-import] attach.read", readError.code);
    return { ok: false, reason: "link" };
  }
  if (existing) return { ok: true, attached: false };

  const path = originalPath(input.orgId, input.invoiceId, input.file.sha256);
  // Sin sobrescribir: si ya hay un objeto en esa ruta, es este mismo contenido (misma huella).
  const upload = await admin.storage.from(ORIGINALS_BUCKET).upload(path, input.file.bytes, { contentType: "application/pdf", upsert: false });
  const uploadedNow = !upload.error;
  if (upload.error && !isAlreadyThere(upload.error)) {
    console.error("[invoice-import] attach.upload", upload.error.name);
    return { ok: false, reason: "upload" };
  }
  const { error } = await db.from("invoice_attachments").insert({
    org_id: input.orgId,
    invoice_id: input.invoiceId,
    kind: "original",
    storage_path: path,
    file_name: safeFileName(input.file.name),
    content_type: "application/pdf",
    size_bytes: input.file.bytes.byteLength,
    sha256: input.file.sha256,
  });
  if (error) {
    if (error.code === "23505") {
      // Otro lo ha enlazado entretanto: vale ese. Si subió otro contenido, el objeto de esta llamada
      // no lo referencia nadie: se borra (nunca el del ganador).
      const { data: winner } = await db
        .from("invoice_attachments")
        .select("storage_path")
        .eq("org_id", input.orgId)
        .eq("invoice_id", input.invoiceId)
        .eq("kind", "original")
        .maybeSingle();
      if (uploadedNow && winner && winner.storage_path !== path) await admin.storage.from(ORIGINALS_BUCKET).remove([path]);
      return { ok: true, attached: false };
    }
    console.error("[invoice-import] attach.link", error.code, error.hint);
    if (uploadedNow) await admin.storage.from(ORIGINALS_BUCKET).remove([path]);
    return { ok: false, reason: "link" };
  }
  return { ok: true, attached: true };
}

/** El PDF original de una factura, si lo tiene y el usuario la ve (RLS). */
export async function loadOriginal(db: Db, admin: Db, invoiceId: string): Promise<{ bytes: ArrayBuffer; fileName: string } | null> {
  const { data } = await db
    .from("invoice_attachments")
    .select("storage_path, file_name")
    .eq("invoice_id", invoiceId)
    .eq("kind", "original")
    .maybeSingle();
  if (!data) return null;
  const { data: blob, error } = await admin.storage.from(ORIGINALS_BUCKET).download(data.storage_path);
  if (error || !blob) {
    console.error("[invoice-import] original.download", error?.name);
    return null;
  }
  return { bytes: await blob.arrayBuffer(), fileName: data.file_name };
}
