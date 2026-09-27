import { createClient } from "@/lib/supabase/server";
import { memberContext } from "@/server/action-utils";
import { renderDigestForMember } from "@/server/digest/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Vista previa del resumen semanal del socio que lo abre (con su sesión: la RLS aplica). */
export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get("org");
  const ctx = await memberContext(slug);
  if (!ctx) return new Response("Not found", { status: 404 });
  const rendered = await renderDigestForMember(await createClient(), ctx.org, {
    id: ctx.member.id,
    user_id: ctx.user.id,
    full_name: ctx.member.fullName,
    locale: ctx.member.locale,
  });
  return new Response(rendered.html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" },
  });
}
