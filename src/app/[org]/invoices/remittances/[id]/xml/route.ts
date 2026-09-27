import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/server/action-utils";
import { getSessionUser } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ org: string; id: string }> };

/**
 * Fichero pain.008 de una remesa, byte a byte como se generó (la copia de lo que va al banco). La
 * remesa se lee con RLS; solo después se usa la clave de servidor para bajar el fichero de Storage.
 */
export async function GET(_request: Request, ctx: Context) {
  const { org: slug, id } = await ctx.params;
  if (!(await getSessionUser())) return new Response("Unauthorized", { status: 401 });
  if (!idSchema.safeParse(id).success) return new Response("Not found", { status: 404 });

  const supabase = await createClient();
  const { data: org } = await supabase.from("orgs").select("id").eq("slug", slug).maybeSingle();
  if (!org) return new Response("Not found", { status: 404 });
  const { data: remittance } = await supabase
    .from("sepa_remittances")
    .select("file_path, message_id")
    .eq("org_id", org.id)
    .eq("id", id)
    .maybeSingle();
  if (!remittance?.file_path) return new Response("Not found", { status: 404 });

  const { data, error } = await createAdminClient().storage.from("remittances").download(remittance.file_path);
  if (error || !data) return new Response("File not available", { status: 502 });
  const filename = `${(remittance.message_id ?? id).replace(/[^\w.-]+/g, "_")}.xml`;
  return new Response(await data.arrayBuffer(), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
