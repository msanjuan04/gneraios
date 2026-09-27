import type { NextRequest } from "next/server";
import { parseFeedToken, renderFeedByToken } from "@/server/calendar/feeds";

// Lee la base de datos con la clave de servidor: siempre en Node y nunca estático ni cacheado.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Enlace privado de suscripción (ICS) de un socio: lo leen Google Calendar, Apple Calendar u
 * Outlook, sin sesión. El token de la URL es el secreto (se guarda su hash); si no existe, está
 * revocado o su socio ya no está activo, 404, sin decir cuál de las tres.
 */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token: param } = await ctx.params;
  const token = parseFeedToken(param);
  const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  if (!token) return notFound();

  let ics: string | null;
  try {
    ics = await renderFeedByToken(token);
  } catch (error) {
    console.error("[calendar] feed", error);
    return new Response("Calendar unavailable", { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "300" } });
  }
  if (ics === null) return notFound();

  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="gnerai-os.ics"',
      // Privado: el enlace es un secreto; ningún proxy intermedio debe guardarlo.
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
