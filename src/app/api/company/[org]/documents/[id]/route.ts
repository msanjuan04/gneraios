import type { NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { downloadOrgDocument } from "@/server/company/documents";
import { getSessionUser } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Descarga de un documento del expediente: la fila pasa por RLS con la sesión; el fichero lo lee el servidor. */
export async function GET(request: NextRequest, ctx: { params: Promise<{ org: string; id: string }> }) {
  const { id } = await ctx.params;
  if (!(await getSessionUser())) return new Response("Unauthorized", { status: 401 });
  if (!z.guid().safeParse(id).success) return new Response("Not found", { status: 404 });
  const supabase = await createClient();
  const { data } = await supabase.from("org_documents").select("storage_path, file_name, content_type").eq("id", id).maybeSingle();
  if (!data) return new Response("Not found", { status: 404 });
  const file = await downloadOrgDocument(createAdminClient(), data.storage_path);
  if (!file) return new Response("Document not available", { status: 502 });
  const download = request.nextUrl.searchParams.get("download") === "1";
  const name = data.file_name.replace(/["\r\n]/g, "_");
  return new Response(await file.arrayBuffer(), {
    headers: {
      "Content-Type": data.content_type,
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
