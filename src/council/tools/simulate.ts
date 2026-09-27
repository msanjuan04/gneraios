// simulate: el "¿y si…?" del consejo (CONSEJO.md §8, simulador). Mismo cálculo que usaría la
// interfaz: MRR con la definición v1 y facturación prevista con el mismo calendario que factura
// (forecastBilling). El impacto en caja y runway solo aparece cuando hay datos de gastos y caja.

import { z } from "zod";
import { forecastBilling, type ForecastContract } from "@/domain/billing/forecast";
import { addMonthsClamped } from "@/domain/dates/civil-date";
import { orgMrrCents } from "@/domain/metrics";
import { applyBps } from "@/domain/money";
import type { CouncilLine, ForecastContractRow } from "../data/types";
import { clientHref, m } from "./common";
import { hasCash, hasExpenses } from "./finance-common";
import { runwayMonths } from "@/domain/finance";
import { formatMetricValue, rangePeriod } from "./format";
import { defineTool, type Metric } from "./types";

const KINDS = ["price_change", "hire", "lose_client", "raise_partner_pay"] as const;

const input = z
  .object({
    kind: z.enum(KINDS).describe("price_change: subir o bajar precios · hire: contratar · lose_client: perder un cliente · raise_partner_pay: subir la retribución de los socios"),
    percent_bps: z.number().int().min(-5000).max(10_000).optional().describe("price_change: variación en puntos básicos (500 = +5 %)"),
    client_id: z.string().min(1).optional().describe("price_change: solo este cliente (sin él, todos) · lose_client: el cliente que se pierde"),
    monthly_cost_cents: z.number().int().min(1).max(100_000_000).optional().describe("hire: coste mensual total en céntimos"),
    monthly_increase_cents: z.number().int().min(1).max(100_000_000).optional().describe("raise_partner_pay: aumento mensual total en céntimos"),
    horizon_months: z.number().int().min(1).max(24).default(12),
  })
  .strict()
  .superRefine((v, ctx) => {
    const need = (field: keyof typeof v) => {
      if (v[field] === undefined) ctx.addIssue({ code: "custom", path: [field], message: `Falta ${String(field)} para ${v.kind}` });
    };
    if (v.kind === "price_change") need("percent_bps");
    if (v.kind === "lose_client") need("client_id");
    if (v.kind === "hire") need("monthly_cost_cents");
    if (v.kind === "raise_partner_pay") need("monthly_increase_cents");
  });

const isRecurring = (billingType: string) => billingType === "monthly" || billingType === "yearly";

function scaleLines<T extends { billingType: string; unitPriceCents: number }>(lines: readonly T[], bps: number, pick: (line: T) => boolean): T[] {
  return lines.map((line) => (isRecurring(line.billingType) && pick(line) ? { ...line, unitPriceCents: applyBps(line.unitPriceCents, 10_000 + bps) } : line));
}

function forecastTotal(contracts: readonly ForecastContract[], today: string, months: number): number {
  return forecastBilling(contracts, today, months).reduce((sum, month) => sum + month.recurringCents + month.oneOffCents, 0);
}

export const simulate = defineTool({
  name: "simulate",
  description:
    "Simula un escenario y devuelve su impacto: subir/bajar precios un % (todos o un cliente), contratar a X €/mes, perder un cliente o subir la retribución de los socios W €/mes. Da el MRR antes y después, la facturación prevista del horizonte antes y después (el mismo calendario que factura) y, si hay datos de gastos y caja, el resultado mensual y los meses de gastos que cubre la caja. Nunca calcules un escenario a mano: usa esta tool.",
  input,
  async run(ctx, args) {
    const today = ctx.today;
    const horizon = args.horizon_months;
    const [lines, contracts, clients] = await Promise.all([ctx.data.contractLines(), ctx.data.forecastContracts(), ctx.data.clients()]);
    const period = rangePeriod(today, addMonthsClamped(today, horizon));
    const mrrBefore = orgMrrCents(lines, today);
    const billedBefore = forecastTotal(contracts, today, horizon);
    let linesAfter: CouncilLine[] = lines;
    let contractsAfter: ForecastContractRow[] = contracts;
    let monthlyCost = 0;
    let subject = `simulate:${args.kind}`;
    let label: string;

    switch (args.kind) {
      case "price_change": {
        const bps = args.percent_bps!;
        const only = args.client_id;
        if (only && !clients.some((c) => c.id === only)) throw new Error(`No existe el cliente ${only}`);
        linesAfter = scaleLines(lines, bps, (l) => !only || l.clientId === only);
        contractsAfter = contracts.map((c) => (!only || c.clientId === only ? { ...c, lines: scaleLines(c.lines, bps, () => true) } : c));
        subject = only ? `simulate:price_change:client:${only}` : "simulate:price_change";
        label = `Cambio de precio de ${formatMetricValue(bps, "bps")}${only ? ` a ${clients.find((c) => c.id === only)?.name ?? "—"}` : " a todos los clientes"}`;
        break;
      }
      case "lose_client": {
        const clientId = args.client_id!;
        const client = clients.find((c) => c.id === clientId);
        if (!client) throw new Error(`No existe el cliente ${clientId}`);
        linesAfter = lines.filter((l) => l.clientId !== clientId);
        contractsAfter = contracts.filter((c) => c.clientId !== clientId);
        subject = `simulate:lose_client:client:${clientId}`;
        label = `Perder a ${client.name}`;
        break;
      }
      case "hire":
        monthlyCost = args.monthly_cost_cents!;
        label = `Contratar con un coste de ${formatMetricValue(monthlyCost, "eur_cents")}/mes`;
        break;
      case "raise_partner_pay":
        monthlyCost = args.monthly_increase_cents!;
        label = `Subir la retribución de los socios ${formatMetricValue(monthlyCost, "eur_cents")}/mes`;
        break;
    }

    const mrrAfter = orgMrrCents(linesAfter, today);
    const billedAfter = forecastTotal(contractsAfter, today, horizon);
    const metrics: Metric[] = [
      m.eur("simulate.mrr.before", "MRR hoy", mrrBefore, today),
      m.eur("simulate.mrr.after", "MRR con el escenario", mrrAfter, today),
      m.eur("simulate.mrr.delta", "Cambio de MRR (€/mes)", mrrAfter - mrrBefore, today),
      m.eur("simulate.billing.before", `Facturación prevista en ${horizon} meses (sin IVA)`, billedBefore, period),
      m.eur("simulate.billing.after", `Facturación prevista en ${horizon} meses con el escenario`, billedAfter, period),
      m.eur("simulate.billing.delta", `Cambio de facturación en ${horizon} meses`, billedAfter - billedBefore, period),
      m.months("simulate.horizon", "Horizonte", horizon, period),
    ];
    if (monthlyCost > 0) {
      metrics.push(
        m.eur("simulate.cost.monthly", "Coste mensual del escenario", monthlyCost, today),
        m.eur("simulate.cost.horizon", `Coste en ${horizon} meses`, monthlyCost * horizon, period),
      );
    }

    const finance = await ctx.data.finance(today);
    let missing = null;
    if (hasCash(finance) && hasExpenses(finance)) {
      const b = finance.burn!;
      const deltaMonthly = monthlyCost > 0 ? -monthlyCost : mrrAfter - mrrBefore;
      const avgPeriod = rangePeriod(b.months[0]!, b.months.at(-1)!);
      metrics.push(
        m.eur("simulate.result.before", `Margen medio al mes (${b.months.length} meses cerrados)`, b.marginCents, avgPeriod, "/finance"),
        m.eur("simulate.result.after", "Margen medio al mes con el escenario", b.marginCents + deltaMonthly, avgPeriod, "/finance"),
      );
      if (finance.runwayMonths !== null) metrics.push(m.months("simulate.cover.before", "Meses de costes fijos que cubre la caja hoy", finance.runwayMonths, today, "/finance"));
      if (monthlyCost > 0) {
        const after = runwayMonths(finance.cash.estimatedCents, finance.fixedCosts.monthlyCents + monthlyCost);
        if (after !== null) metrics.push(m.months("simulate.cover.after", "Meses de costes fijos que cubriría con el escenario", after, today, "/finance"));
      }
    } else {
      missing = {
        what: "Impacto en caja y runway",
        needs: ["Gastos registrados de los últimos meses", "Saldo de caja"],
        href: "/finance",
      };
    }

    return {
      tool: "simulate",
      status: "ok",
      subject,
      period: { from: today, to: addMonthsClamped(today, horizon) },
      source: "Simulación determinista: MRR v1 sobre las líneas de contrato y el calendario de facturación (forecastBilling); caja y gastos de Finanzas.",
      href: args.client_id ? clientHref(args.client_id) : "/",
      summary: `${label}: MRR ${formatMetricValue(mrrBefore, "eur_cents")} → ${formatMetricValue(mrrAfter, "eur_cents")}.`,
      metrics,
      missing,
      notes: args.kind === "price_change" ? ["El nuevo precio se aplica a todo lo que queda por facturar en el horizonte (línea a línea, con el redondeo de la facturación)."] : [],
    };
  },
});
