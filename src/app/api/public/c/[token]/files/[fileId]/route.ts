import { spaceFileRedirect } from "@/server/portal/downloads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tipado a mano: la ruta es nueva y los tipos de rutas de Next se regeneran con `next dev`/`next build`.
type Context = { params: Promise<{ token: string; fileId: string }> };

/** Un entregable del cliente: redirige a una URL firmada de Storage de un minuto. */
export async function GET(_request: Request, ctx: Context) {
  const { token, fileId } = await ctx.params;
  return spaceFileRedirect(token, fileId);
}
