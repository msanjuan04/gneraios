import "server-only";
import { randomUUID } from "node:crypto";
import type { SaveQuotePayload } from "@/app/[org]/quotes/schema";
import { quoteLineBaseCents } from "@/app/[org]/quotes/summary";
import type { Json } from "@/lib/supabase/database.types";
import { type Db, DbError, must } from "@/server/billing/context";

/**
 * Escrituras de presupuestos: siempre con las RPC (authenticated no tiene insert/update sobre las
 * tablas). Las bases de las líneas llegan ya calculadas con el dominio (schema.ts).
 */

/** Guarda cabecera y líneas (conjunto completo) y devuelve el id y el updated_at nuevo. */
export async function saveQuoteRpc(db: Db, payload: SaveQuotePayload): Promise<{ id: string; updatedAt: string }> {
  const { data, error } = await db.rpc("save_quote", { p: payload as unknown as Json });
  if (error) throw new DbError(error, "saveQuote");
  const fresh = must(await db.from("quotes").select("updated_at").eq("id", data).single(), "saveQuote.reload");
  return { id: data, updatedAt: fresh.updated_at };
}

/**
 * «Duplicar»: un borrador nuevo con la misma cabecera (sin número ni fechas), las mismas líneas
 * (con ids nuevos y sin enlace a ningún contrato) y el mismo plan de pagos.
 */
export async function duplicateQuote(db: Db, orgId: string, quoteId: string): Promise<string> {
  const quote = must(await db.from("quotes").select("*").eq("id", quoteId).eq("org_id", orgId).maybeSingle(), "duplicateQuote.load");
  const lines = must(
    await db.from("quote_lines").select("*").eq("quote_id", quote.id).order("position").order("created_at"),
    "duplicateQuote.lines",
  );
  const payload: SaveQuotePayload = {
    quote_id: null,
    expected_updated_at: null,
    header: {
      client_id: quote.client_id,
      deal_id: quote.deal_id,
      issuer_id: quote.issuer_id,
      title: quote.title,
      issued_on: null,
      valid_until: null,
      language: quote.language,
      notes: quote.notes,
      payment_plan: lines.some((l) => l.billing_type === "one_off") ? (quote.payment_plan as SaveQuotePayload["header"]["payment_plan"]) : [],
    },
    lines: lines.map((line, position) => ({
      id: randomUUID(),
      position,
      description: line.description,
      billing_type: line.billing_type,
      quantity: String(line.quantity),
      unit_price_cents: line.unit_price_cents,
      discount_bps: line.discount_bps,
      tax_rate_id: line.tax_rate_id,
      irpf_applies: line.irpf_applies,
      starts_on: line.starts_on,
      ends_on: line.ends_on,
      billing_day: line.billing_day,
      prorate_first: line.prorate_first,
      base_cents: quoteLineBaseCents({ quantity: String(line.quantity), unitPriceCents: line.unit_price_cents, discountBps: line.discount_bps }),
    })),
  };
  return (await saveQuoteRpc(db, payload)).id;
}
