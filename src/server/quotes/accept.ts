import "server-only";
import { readStoredPlan } from "@/app/[org]/quotes/schema";
import type { CivilDate } from "@/domain/dates/civil-date";
import { BillingRuleError, type Db, DbError, must } from "@/server/billing/context";
import { billingErrorKey } from "@/server/billing/errors";
import { billMilestone } from "@/server/billing/manual";

export type AcceptQuoteResult = {
  contractId: string;
  /** El borrador de la factura del primer pago, si era a la aceptación. */
  invoiceId: string | null;
  /** Si ese borrador no se ha podido preparar: la clave de i18n del motivo (el cron lo reintenta). */
  billingErrorKey: string | null;
};

/**
 * Aceptar en un clic (ARCHITECTURE.md §7.3). accept_quote hace en una transacción lo que tiene
 * que ser atómico: presupuesto aceptado y congelado, contrato firmado hoy con emisor, líneas e
 * hitos, y el deal ganado. Después, si el primer pago es «a la aceptación», se factura ese hito
 * (billMilestone) y el socio aterriza en el borrador. Ese hito nace automático y con fecha de
 * hoy: si este paso fallara, el cron del día siguiente lo completa.
 */
export async function acceptQuoteFlow(db: Db, orgId: string, quoteId: string, today: CivilDate): Promise<AcceptQuoteResult> {
  const quote = must(
    await db.from("quotes").select("id, payment_plan, quote_lines(billing_type, base_cents)").eq("id", quoteId).eq("org_id", orgId).maybeSingle(),
    "acceptQuote.load",
  );
  const { data: contractId, error } = await db.rpc("accept_quote", { p_quote_id: quote.id });
  if (error) throw new DbError(error, "acceptQuote");

  // Sin nada puntual que cobrar (o todo a 0 €), no hay factura que preparar.
  const oneOffCents = quote.quote_lines.filter((l) => l.billing_type === "one_off").reduce((sum, l) => sum + l.base_cents, 0);
  const plan = readStoredPlan(quote.payment_plan);
  if (plan[0]?.when !== "on_accept" || oneOffCents <= 0) return { contractId, invoiceId: null, billingErrorKey: null };
  const { data: first, error: firstError } = await db
    .from("contract_milestones")
    .select("id")
    .eq("contract_id", contractId)
    .eq("position", 0)
    .maybeSingle();
  if (firstError || !first) return { contractId, invoiceId: null, billingErrorKey: firstError ? "common.errorGeneric" : null };

  try {
    const billed = await billMilestone(db, orgId, first.id, today);
    return { contractId, invoiceId: billed.invoiceId, billingErrorKey: null };
  } catch (billingError) {
    if (billingError instanceof BillingRuleError) return { contractId, invoiceId: null, billingErrorKey: billingError.key };
    if (billingError instanceof DbError) {
      console.error(`[quotes] ${billingError.where}`, billingError.error);
      return { contractId, invoiceId: null, billingErrorKey: billingErrorKey(billingError.error) ?? "common.errorGeneric" };
    }
    throw billingError;
  }
}
