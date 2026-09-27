import type { NextRequest } from "next/server";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_TYPES,
  attachmentContentType,
  attachmentPath,
  downloadAttachment,
  removeAttachments,
  uploadAttachment,
} from "@/server/finance/attachments";
import { getSessionUser, hasRole } from "@/server/session";

// Storage y ficheros: siempre en Node y nunca estático.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Justificante de un gasto (bucket privado `expenses`). La lectura del gasto pasa por RLS con la
 * sesión del usuario; solo después se usa la clave de servidor para Storage. Para subir o quitar
 * hace falta ser socio de esa org (se comprueba antes de tocar el fichero, y RLS vuelve a
 * comprobarlo al guardar la ruta en el gasto).
 */

const idSchema = z.guid();

type Supabase = Awaited<ReturnType<typeof createClient>>;
/** Los parámetros de la ruta (tipados a mano: no dependen de los tipos que genera `next build`). */
type AttachmentRoute = { params: Promise<{ id: string }> };

async function json(status: number, key: string | null) {
  if (key === null) return Response.json({ ok: true }, { status });
  const t = await getTranslations();
  return Response.json({ ok: false, error: t(key) }, { status });
}

/** El gasto, si el usuario lo ve (RLS), con su org y su justificante. */
async function loadExpense(supabase: Supabase, id: string) {
  const { data } = await supabase.from("expenses").select("id, org_id, attachment_path").eq("id", id).maybeSingle();
  return data;
}

/** ¿El usuario es socio u owner activo de la org? */
async function canWrite(supabase: Supabase, orgId: string, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  return Boolean(data && hasRole(data.role, "partner"));
}

export async function GET(request: NextRequest, ctx: AttachmentRoute) {
  const { id } = await ctx.params;
  if (!(await getSessionUser())) return new Response("Unauthorized", { status: 401 });
  if (!idSchema.safeParse(id).success) return new Response("Not found", { status: 404 });
  const expense = await loadExpense(await createClient(), id);
  if (!expense?.attachment_path) return new Response("Not found", { status: 404 });

  const file = await downloadAttachment(createAdminClient(), expense.attachment_path);
  if (!file) return new Response("Attachment not available", { status: 502 });
  const download = request.nextUrl.searchParams.get("download") === "1";
  const name = expense.attachment_path.split("/").at(-1) ?? "justificante";
  return new Response(await file.arrayBuffer(), {
    headers: {
      "Content-Type": attachmentContentType(expense.attachment_path),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${name}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function POST(request: NextRequest, ctx: AttachmentRoute) {
  const { id } = await ctx.params;
  const user = await getSessionUser();
  if (!user) return json(401, "common.errorPermission");
  if (!idSchema.safeParse(id).success) return json(404, "finance.errors.expenseNotFound");
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > ATTACHMENT_MAX_BYTES + 64 * 1024) return json(413, "finance.attachment.tooLarge");

  const supabase = await createClient();
  const expense = await loadExpense(supabase, id);
  if (!expense) return json(404, "finance.errors.expenseNotFound");
  if (!(await canWrite(supabase, expense.org_id, user.id))) return json(403, "common.errorPermission");

  let file: File | null = null;
  try {
    const form = await request.formData();
    const value = form.get("file");
    file = value instanceof File ? value : null;
  } catch {
    file = null;
  }
  if (!file || file.size === 0) return json(400, "finance.attachment.missing");
  if (file.size > ATTACHMENT_MAX_BYTES) return json(413, "finance.attachment.tooLarge");
  const ext = ATTACHMENT_TYPES[file.type];
  if (!ext) return json(415, "finance.attachment.type");

  const admin = createAdminClient();
  const path = attachmentPath(expense.org_id, expense.id, ext);
  const uploaded = await uploadAttachment(admin, path, file, file.type);
  if (uploaded.error) {
    console.error("[finance] upload attachment", uploaded.error);
    return json(502, "finance.attachment.uploadFailed");
  }
  const { data, error } = await supabase.from("expenses").update({ attachment_path: path }).eq("id", expense.id).select("id");
  if (error || data.length === 0) {
    if (error) console.error("[finance] save attachment path", error);
    // El fichero de otro formato que ya había sigue siendo el bueno: solo se quita el nuevo.
    if (path !== expense.attachment_path) await removeAttachments(admin, [path]);
    return json(error ? 500 : 403, error ? "common.errorGeneric" : "common.errorPermission");
  }
  // Un PDF que sustituye a una foto (o al revés) deja el anterior huérfano: fuera.
  if (expense.attachment_path && expense.attachment_path !== path) await removeAttachments(admin, [expense.attachment_path]);
  return json(200, null);
}

export async function DELETE(_request: NextRequest, ctx: AttachmentRoute) {
  const { id } = await ctx.params;
  const user = await getSessionUser();
  if (!user) return json(401, "common.errorPermission");
  if (!idSchema.safeParse(id).success) return json(404, "finance.errors.expenseNotFound");
  const supabase = await createClient();
  const expense = await loadExpense(supabase, id);
  if (!expense) return json(404, "finance.errors.expenseNotFound");
  if (!(await canWrite(supabase, expense.org_id, user.id))) return json(403, "common.errorPermission");
  if (!expense.attachment_path) return json(200, null);

  const { data, error } = await supabase.from("expenses").update({ attachment_path: null }).eq("id", expense.id).select("id");
  if (error || data.length === 0) return json(error ? 500 : 403, error ? "common.errorGeneric" : "common.errorPermission");
  await removeAttachments(createAdminClient(), [expense.attachment_path]);
  return json(200, null);
}
