import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { getTranslations } from "next-intl/server";
import { companyDocumentSchema } from "@/app/[org]/finance/company-schema";
import { ORG_DOCUMENT_MAX_BYTES, ORG_DOCUMENT_TYPES } from "@/domain/company/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { orgDocumentPath, removeOrgDocumentFile, safeDocumentName, sha256Of, uploadOrgDocument } from "@/server/company/documents";
import { getSessionUser, hasRole } from "@/server/session";

// Storage y ficheros: siempre en Node y nunca estático.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Subir un documento al expediente de la sociedad (bucket privado `org-documents`). Se comprueba la
 * pertenencia y el rol con la sesión del usuario; el fichero se sube con la clave de servidor y la
 * fila se guarda con la sesión del usuario (RLS lo vuelve a comprobar). Si la fila no se puede guardar,
 * el fichero recién subido se quita.
 */

type Route = { params: Promise<{ org: string }> };
const SLUG = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/;

async function json(status: number, key: string | null, extra: Record<string, unknown> = {}) {
  if (key === null) return Response.json({ ok: true, ...extra }, { status });
  const t = await getTranslations();
  return Response.json({ ok: false, error: t(key) }, { status });
}

export async function POST(request: NextRequest, ctx: Route) {
  const { org: slug } = await ctx.params;
  const user = await getSessionUser();
  if (!user) return json(401, "common.errorPermission");
  if (!SLUG.test(slug)) return json(404, "common.errorGeneric");
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > ORG_DOCUMENT_MAX_BYTES + 64 * 1024) return json(413, "finance.company.errors.tooLarge");

  const supabase = await createClient();
  const { data: member } = await supabase
    .from("members")
    .select("id, role, orgs!inner(id, slug)")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .eq("orgs.slug", slug)
    .maybeSingle();
  if (!member || !hasRole(member.role, "partner")) return json(403, "common.errorPermission");
  const orgId = member.orgs.id;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json(400, "finance.company.errors.missingFile");
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return json(400, "finance.company.errors.missingFile");
  if (file.size > ORG_DOCUMENT_MAX_BYTES) return json(413, "finance.company.errors.tooLarge");
  if (!ORG_DOCUMENT_TYPES[file.type]) return json(415, "finance.company.errors.type");
  const parsed = companyDocumentSchema.safeParse({
    title: form.get("title") ?? "",
    category: form.get("category") ?? "other",
    status: form.get("status") ?? "draft",
    effective_on: form.get("effective_on") ?? "",
    member_id: form.get("member_id") ?? "",
    description: form.get("description") ?? "",
  });
  if (!parsed.success) return json(400, "common.errorInvalid");

  const bytes = new Uint8Array(await file.arrayBuffer());
  const sha256 = sha256Of(bytes);
  const id = randomUUID();
  const path = orgDocumentPath(orgId, id, sha256, file.type);
  const admin = createAdminClient();
  const uploaded = await uploadOrgDocument(admin, path, bytes, file.type);
  if (uploaded.error) {
    console.error("[company] upload document", uploaded.error);
    return json(502, "finance.company.errors.uploadFailed");
  }
  const { error } = await supabase.from("org_documents").insert({
    id,
    org_id: orgId,
    category: parsed.data.category,
    status: parsed.data.status,
    title: parsed.data.title,
    description: parsed.data.description || null,
    effective_on: parsed.data.effective_on || null,
    member_id: parsed.data.member_id || null,
    storage_path: path,
    file_name: safeDocumentName(file.name),
    content_type: file.type,
    size_bytes: file.size,
    sha256,
  });
  if (error) {
    console.error("[company] save document", error.code, error.hint);
    await removeOrgDocumentFile(admin, path);
    return json(error.code === "42501" ? 403 : 500, error.code === "42501" ? "common.errorPermission" : "common.errorGeneric");
  }
  return json(200, null, { id });
}
