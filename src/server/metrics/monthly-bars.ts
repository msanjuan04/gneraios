import "server-only";

import type { CivilDate } from "@/domain/dates/civil-date";
import { monthOf, monthsEndingAt } from "@/domain/metrics/months";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/server/billing/context";

/**
 * Lo facturado y lo gastado mes a mes, para los dos gráficos del dashboard. Nada de esto se guarda:
 * se suma de las facturas emitidas y de los gastos, que son los documentos de verdad.
 *
 *   · Facturado: base imponible de las facturas emitidas, menos lo rectificado. Sin IVA, porque el
 *     IVA no es ingreso: se recauda para Hacienda.
 *   · Gastado: el coste de los gastos (base + el IVA que no se deduce), que es lo que cuesta de
 *     verdad. Se cuenta en el mes al que pertenece el gasto, no cuando se paga.
 */

export type MonthlyBar = {
  /** Primer día del mes, como fecha civil. */
  month: CivilDate;
  invoicedCents: number;
  expensesCents: number;
};

export async function loadMonthlyBars(orgId: string, today: CivilDate, count = 6): Promise<MonthlyBar[]> {
  const supabase = await createClient();
  const months = monthsEndingAt(monthOf(today), count);
  const from = months[0]!;

  const [invoices, expenses] = await Promise.all([
    fetchAll(
      (a, b) =>
        supabase
          .from("invoices_overview")
          .select("issued_on, subtotal_cents, rectified_cents")
          .eq("org_id", orgId)
          .eq("lifecycle", "issued")
          .gte("issued_on", from)
          .order("id")
          .range(a, b),
      "dashboard.bars.invoices",
    ),
    fetchAll(
      (a, b) => supabase.from("expenses_overview").select("month, cost_cents").eq("org_id", orgId).gte("month", from).order("id").range(a, b),
      "dashboard.bars.expenses",
    ),
  ]);

  const byMonth = new Map(months.map((month) => [month, { month, invoicedCents: 0, expensesCents: 0 } satisfies MonthlyBar]));
  for (const invoice of invoices) {
    if (!invoice.issued_on) continue;
    const bar = byMonth.get(monthOf(invoice.issued_on));
    // Lo rectificado se resta del mes en que se emitió la factura original.
    if (bar) bar.invoicedCents += (invoice.subtotal_cents ?? 0) - (invoice.rectified_cents ?? 0);
  }
  for (const expense of expenses) {
    if (!expense.month) continue;
    const bar = byMonth.get(monthOf(expense.month));
    if (bar) bar.expensesCents += expense.cost_cents ?? 0;
  }
  return months.map((month) => byMonth.get(month)!);
}
