import { quoteLinkPdf } from "@/server/portal/downloads";

// El PDF se genera con react-pdf y lee fuentes del disco: siempre en Node, nunca estático.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tipado a mano: la ruta es nueva y los tipos de rutas de Next se regeneran con `next dev`/`next build`.
type Context = { params: Promise<{ token: string }> };

/** PDF de un presupuesto desde su enlace (el token se comprueba en cada descarga). */
export async function GET(_request: Request, ctx: Context) {
  const { token } = await ctx.params;
  return quoteLinkPdf(token);
}
