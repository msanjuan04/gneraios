import { spaceInvoicePdf } from "@/server/portal/downloads";

// Copia legal desde Storage o, si no la hay, react-pdf (fuentes del disco): siempre en Node.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tipado a mano: la ruta es nueva y los tipos de rutas de Next se regeneran con `next dev`/`next build`.
type Context = { params: Promise<{ token: string; invoiceId: string }> };

/** PDF de una factura emitida del cliente, desde su portal. */
export async function GET(_request: Request, ctx: Context) {
  const { token, invoiceId } = await ctx.params;
  return spaceInvoicePdf(token, invoiceId);
}
