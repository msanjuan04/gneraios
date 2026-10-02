import "server-only";
import { createHash } from "node:crypto";
import type { OrgDocumentItem } from "@/domain/company/types";
import { ORG_DOCUMENT_TYPES } from "@/domain/company/types";
import type { Tables } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import type { Db } from "@/server/billing/context";

/**
 * Expediente de la sociedad: lecturas con la sesión del usuario (RLS) y helpers de Storage que
 * solo usa el servidor con la clave de servicio, siempre después de pasar por RLS.
 */

export const ORG_DOCUMENTS_BUCKET = "org-documents";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const COLUMNS = "id, category, status, title, description, effective_on, member_id, file_name, content_type, size_bytes, created_at, updated_at";

function toItem(row: Pick<Tables<"org_documents">, "id" | "category" | "status" | "title" | "description" | "effective_on" | "member_id" | "file_name" | "content_type" | "size_bytes" | "created_at" | "updated_at">): OrgDocumentItem {
  return {
    id: row.id,
    category: row.category,
    status: row.status,
    title: row.title,
    description: row.description,
    effectiveOn: row.effective_on,
    memberId: row.member_id,
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Los documentos vivos del expediente, por categoría y fecha (los más recientes primero). */
export async function listOrgDocuments(supabase: Supabase, orgId: string): Promise<OrgDocumentItem[]> {
  const { data, error } = await supabase
    .from("org_documents")
    .select(COLUMNS)
    .eq("org_id", orgId)
    .is("archived_at", null)
    .order("category")
    .order("effective_on", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toItem);
}

/** Ruta inmutable en el bucket: la huella del contenido forma parte del nombre. */
export function orgDocumentPath(orgId: string, documentId: string, sha256: string, contentType: string): string {
  const ext = ORG_DOCUMENT_TYPES[contentType] ?? "bin";
  return `${orgId}/${documentId}/${sha256}.${ext}`;
}

export function sha256Of(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Nombre con el que se subió, sin rutas ni caracteres de control. */
export function safeDocumentName(name: string): string {
  return name.split(/[\\/]/).at(-1)!.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 255) || "documento";
}

export async function uploadOrgDocument(admin: Db, path: string, bytes: Uint8Array, contentType: string) {
  return admin.storage.from(ORG_DOCUMENTS_BUCKET).upload(path, bytes, { contentType, upsert: false });
}

export async function downloadOrgDocument(admin: Db, path: string): Promise<Blob | null> {
  const { data, error } = await admin.storage.from(ORG_DOCUMENTS_BUCKET).download(path);
  if (error || !data) {
    console.error("[company] document.download", error?.name);
    return null;
  }
  return data;
}

export async function removeOrgDocumentFile(admin: Db, path: string): Promise<void> {
  const { error } = await admin.storage.from(ORG_DOCUMENTS_BUCKET).remove([path]);
  if (error) console.error("[company] document.remove", error.name);
}
