// Sin "server-only": lo llaman el cron diario (runDailyBilling) y el seed de la demo.
//
// Gastos de las suscripciones: crea los cargos que tocan hasta `today` y aún no existen, con el
// mismo calendario que factura (src/domain/finance/subscriptions.ts). Es idempotente por
// construcción: el dominio solo devuelve lo que falta y (subscription_id, period_start) es único
// en la base de datos, así que dos ejecuciones a la vez tampoco duplican nada. Cada gasto hereda
// a quién sirve la suscripción (empresa, un cliente o las webs alojadas) y si se le repercute.
//
// Uso en el cron (una vez por org, con el "hoy" de la org):
//     await generateSubscriptionExpenses(admin, orgId, today);
// Con el cliente de un socio (RLS) también funciona: lo usa la pantalla de suscripciones al guardar.

import type { CivilDate } from "@/domain/dates/civil-date";
import { planSubscriptionExpenses } from "@/domain/finance/subscriptions";
import type { TablesInsert } from "@/lib/supabase/database.types";
import { type Db, DbError } from "@/server/billing/context";
import { loadGeneratedStarts, loadSubscriptions } from "./sources";

export type GenerateSubscriptionExpensesResult = {
  orgId: string;
  today: CivilDate;
  /** Suscripciones activas de la org. */
  subscriptions: number;
  /** Gastos que faltaban según el calendario. */
  planned: number;
  /** Gastos insertados (menos que `planned` si otra ejecución se adelantó). */
  created: number;
};

const CHUNK = 500;

export async function generateSubscriptionExpenses(db: Db, orgId: string, today: CivilDate): Promise<GenerateSubscriptionExpensesResult> {
  const [subscriptions, generated] = await Promise.all([loadSubscriptions(db, orgId), loadGeneratedStarts(db, orgId)]);
  const planned = planSubscriptionExpenses(subscriptions, generated, today);
  const rows = planned.map(
    (p): TablesInsert<"expenses"> => ({
      org_id: orgId,
      issuer_id: p.issuerId,
      vendor_id: p.vendorId,
      category_id: p.categoryId,
      member_id: p.memberId,
      description: p.description,
      issued_on: p.issuedOn,
      // Vencimiento vacío = el mismo día del cargo.
      due_on: p.dueOn === p.issuedOn ? null : p.dueOn,
      base_cents: p.baseCents,
      vat_bps: p.vatBps,
      vat_cents: p.vatCents,
      vat_deductible: p.vatDeductible,
      irpf_bps: p.irpfBps,
      irpf_cents: p.irpfCents,
      total_cents: p.totalCents,
      paid_on: p.paidOn,
      payment_method: p.paymentMethod,
      subscription_id: p.subscriptionId,
      period_start: p.periodStart,
      source: "subscription",
      // A quién sirve y si se repercute: lo que diga la suscripción al generar el cargo.
      allocation: p.allocation,
      client_id: p.clientId,
      rebill: p.rebill,
      rebill_markup_bps: p.rebillMarkupBps,
    }),
  );

  let created = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { data, error } = await db
      .from("expenses")
      .upsert(rows.slice(i, i + CHUNK), { onConflict: "subscription_id,period_start", ignoreDuplicates: true })
      .select("id");
    if (error) throw new DbError(error, "finance.generate");
    created += data.length;
  }
  return { orgId, today, subscriptions: subscriptions.filter((s) => s.isActive).length, planned: planned.length, created };
}
