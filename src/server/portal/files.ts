import "server-only";
import { randomUUID } from "node:crypto";
import { CLIENT_FILE_MAX_BYTES, isSafeUrl, resolvePortalSections, safeFileName } from "@/domain/portal";
import { createAdminClient } from "@/lib/supabase/admin";
import type { createClient } from "@/lib/supabase/server";
import { BillingRuleError, type Db, DbError } from "@/server/billing/context";
import type { PortalLink } from "./access";

/**
 * Entregables y material del cliente. Los escribe un socio con su sesión (RLS: partner) y los
 * ficheros van al bucket privado client-files: el navegador los sube directamente con una URL
 * firmada de un solo uso y el servidor confirma la subida. El cliente los descarga con una URL
 * firmada de vida corta, después de comprobar su enlace.
 */

export const CLIENT_FILES_BUCKET = "client-files";

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function ensureContract(supabase: Supabase, orgId: string, clientId: string, contractId: string | null) {
  if (!contractId) return;
  const { data, error } = await supabase.from("contracts").select("id").eq("org_id", orgId).eq("client_id", clientId).eq("id", contractId).maybeSingle();
  if (error) throw new DbError(error, "portalFiles.contract");
  if (!data) throw new BillingRuleError("portal.errors.contractNotFound");
}

/** Un enlace (Drive, Figma, la web en staging…). */
export async function addClientLink(
  supabase: Supabase,
  orgId: string,
  clientId: string,
  input: { title: string; url: string; contractId: string | null },
): Promise<string> {
  if (!isSafeUrl(input.url)) throw new BillingRuleError("portal.errors.urlInvalid");
  await ensureContract(supabase, orgId, clientId, input.contractId);
  const { data, error } = await supabase
    .from("client_files")
    .insert({ org_id: orgId, client_id: clientId, contract_id: input.contractId, kind: "link", title: input.title, url: input.url.trim() })
    .select("id")
    .single();
  if (error) throw new DbError(error, "portalFiles.addLink");
  return data.id;
}

/**
 * Primer paso de una subida: la fila (sin confirmar, así que el cliente no la ve) y una URL
 * firmada para que el navegador suba el fichero directamente a Storage.
 */
export async function prepareClientUpload(
  supabase: Supabase,
  orgId: string,
  clientId: string,
  input: { title: string; fileName: string; sizeBytes: number; contentType: string | null; contractId: string | null },
): Promise<{ fileId: string; path: string; token: string }> {
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0 || input.sizeBytes > CLIENT_FILE_MAX_BYTES) {
    throw new BillingRuleError("portal.errors.fileTooLarge");
  }
  await ensureContract(supabase, orgId, clientId, input.contractId);
  const id = randomUUID();
  const name = safeFileName(input.fileName);
  const path = `${orgId}/${clientId}/${id}/${name}`;
  const { error } = await supabase.from("client_files").insert({
    id,
    org_id: orgId,
    client_id: clientId,
    contract_id: input.contractId,
    kind: "file",
    title: input.title,
    storage_path: path,
    file_name: input.fileName.trim().slice(0, 200) || name,
    content_type: input.contentType?.slice(0, 200) || null,
    size_bytes: input.sizeBytes,
  });
  if (error) throw new DbError(error, "portalFiles.prepare");

  const { data, error: signError } = await createAdminClient().storage.from(CLIENT_FILES_BUCKET).createSignedUploadUrl(path);
  if (signError || !data) {
    await supabase.from("client_files").delete().eq("id", id).eq("org_id", orgId);
    console.error("[portal] URL de subida", signError);
    throw new BillingRuleError("portal.errors.uploadFailed");
  }
  return { fileId: id, path, token: data.token };
}

/** Segundo paso: el fichero está en Storage (se comprueba) y pasa a verse en el portal. */
export async function confirmClientUpload(supabase: Supabase, orgId: string, clientId: string, fileId: string): Promise<void> {
  const { data: file, error } = await supabase
    .from("client_files")
    .select("id, storage_path, uploaded_at")
    .eq("org_id", orgId)
    .eq("client_id", clientId)
    .eq("id", fileId)
    .eq("kind", "file")
    .maybeSingle();
  if (error) throw new DbError(error, "portalFiles.confirm.load");
  if (!file?.storage_path) throw new BillingRuleError("portal.errors.fileNotFound");
  if (file.uploaded_at) return;

  const { data: info, error: infoError } = await createAdminClient().storage.from(CLIENT_FILES_BUCKET).info(file.storage_path);
  if (infoError || !info) throw new BillingRuleError("portal.errors.uploadFailed");
  const { error: updateError } = await supabase
    .from("client_files")
    .update({
      uploaded_at: new Date().toISOString(),
      size_bytes: typeof info.size === "number" ? info.size : undefined,
      content_type: info.contentType ?? undefined,
    })
    .eq("id", file.id)
    .eq("org_id", orgId);
  if (updateError) throw new DbError(updateError, "portalFiles.confirm");
}

/** Quita un entregable: la fila (RLS) y, si era un fichero, el objeto de Storage. */
export async function removeClientFile(supabase: Supabase, orgId: string, clientId: string, fileId: string): Promise<void> {
  const { data, error } = await supabase
    .from("client_files")
    .delete()
    .eq("org_id", orgId)
    .eq("client_id", clientId)
    .eq("id", fileId)
    .select("storage_path");
  if (error) throw new DbError(error, "portalFiles.remove");
  const path = data?.[0]?.storage_path;
  if (!data?.length) throw new BillingRuleError("portal.errors.fileNotFound");
  if (path) {
    const { error: storageError } = await createAdminClient().storage.from(CLIENT_FILES_BUCKET).remove([path]);
    if (storageError) console.error("[portal] borrar fichero de Storage", storageError);
  }
}

/**
 * Descarga pública: el fichero tiene que ser del cliente del enlace, estar subido y la sección
 * encendida. Devuelve una URL firmada de un minuto que fuerza la descarga con su nombre.
 */
export async function clientFileDownloadUrl(admin: Db, link: PortalLink, fileId: string): Promise<string | null> {
  if (link.kind !== "client" || !link.clientId) return null;
  const [{ data: file, error }, { data: settings, error: settingsError }] = await Promise.all([
    admin
      .from("client_files")
      .select("storage_path, file_name, uploaded_at")
      .eq("org_id", link.orgId)
      .eq("client_id", link.clientId)
      .eq("id", fileId)
      .eq("kind", "file")
      .maybeSingle(),
    admin.from("client_portal_settings").select("sections").eq("org_id", link.orgId).eq("client_id", link.clientId).maybeSingle(),
  ]);
  if (error) throw error;
  if (settingsError) throw settingsError;
  if (!file?.storage_path || !file.uploaded_at || !resolvePortalSections(settings?.sections).files) return null;
  const { data, error: signError } = await admin.storage
    .from(CLIENT_FILES_BUCKET)
    .createSignedUrl(file.storage_path, 60, { download: file.file_name ?? true });
  if (signError || !data) {
    console.error("[portal] URL de descarga", signError);
    return null;
  }
  return data.signedUrl;
}
