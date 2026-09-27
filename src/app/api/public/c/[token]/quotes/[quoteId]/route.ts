import { spaceQuotePdf } from "@/server/portal/downloads";

// El PDF se genera con react-pdf y lee fuentes del disco: siempre en Node, nunca estático.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tipado a mano: la ruta es nueva y los tipos de rutas de Next se regeneran con `next dev`/`next build`.
type Context = { params: Promise<{ token: string; quoteId: string }> };

/** PDF de un presupuesto del cliente (el aceptado online, su copia exacta), desde su portal. */
export async function GET(_request: Request, ctx: Context) {
  const { token, quoteId } = await ctx.params;
  return spaceQuotePdf(token, quoteId);
}
