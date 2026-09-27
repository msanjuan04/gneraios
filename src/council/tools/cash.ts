// Caja y gastos (fase de control, CONSEJO.md §3): get_expenses, get_cash_position,
// get_cash_forecast y get_runway, sobre la foto financiera de src/domain/finance (la misma de
// /finance: caja estimada de hoy, margen por mes, burn, costes fijos, runway y previsión). Sin
// saldos o sin gastos, devuelven missing_data con lo que falta: nunca una cifra inventada.

import { z } from "zod";
import { daysBetween } from "@/domain/dates/civil-date";
import type { ExpenseGroup, FinanceSnapshot } from "@/domain/finance";
import { monthEnd } from "@/domain/metrics";
import { m } from "./common";
import { closedMonths, hasCash, hasExpenses, monthPnl, taxesDue } from "./finance-common";
import { formatMetricValue, monthLabel, monthPeriod, rangePeriod } from "./format";
import { defineTool, type Metric, type ToolContext, type ToolResultInput, type ToolRow } from "./types";

const FINANCE_SOURCE = "Foto financiera de Finanzas (src/domain/finance): saldos, cobros y pagos, gastos por mes y suscripciones.";
const CASH_NEEDS = ["Registrar el saldo de las cuentas de caja (manual o importado)"];
const EXPENSE_NEEDS = ["Registrar los gastos de los últimos meses (alta manual o importación del banco)"];

export const GROUP_LABELS: Record<ExpenseGroup, string> = {
  operating: "operativos",
  payroll: "nóminas",
  partner_compensation: "retribución de socios",
  cost_of_sales: "coste de ventas",
  taxes: "impuestos",
  financial: "financieros",
  other: "otros",
};

function missingFinance(tool: string, subject: string, what: string, needs: string[]): ToolResultInput {
  return {
    tool,
    status: "missing_data",
    subject,
    period: null,
    source: FINANCE_SOURCE,
    href: "/finance",
    summary: `Sin datos de Finanzas: ${what.toLowerCase()}.`,
    metrics: [],
    missing: { what, needs, href: "/finance" },
  };
}

const finance = (ctx: ToolContext) => ctx.data.finance(ctx.today);

function burnMetrics(snapshot: FinanceSnapshot, prefix: string): Metric[] {
  const b = snapshot.burn;
  if (!b) return [];
  const period = rangePeriod(b.months[0]!, monthEnd(b.months.at(-1)!));
  const n = b.months.length;
  return [
    m.eur(`${prefix}.expenses_avg`, `Gasto medio al mes (${n} meses cerrados)`, b.expensesCents, period, "/finance"),
    m.eur(`${prefix}.fixed_avg`, `Gastos fijos medios al mes (${n} meses cerrados)`, b.fixedCents, period, "/finance"),
    m.eur(`${prefix}.revenue_avg`, `Ingreso medio al mes, sin IVA (${n} meses cerrados)`, b.revenueCents, period, "/"),
    m.eur(`${prefix}.margin_avg`, `Margen medio al mes (${n} meses cerrados)`, b.marginCents, period, "/finance"),
    m.eur(`${prefix}.net_burn`, "Consumo neto de caja al mes (lo que se gasta por encima de lo que se ingresa)", b.netBurnCents, period, "/finance"),
  ];
}

export const getExpenses = defineTool({
  name: "get_expenses",
  description:
    "Gastos por mes cerrado (coste, fijos y por grupo: operativos, nóminas, retribución de socios, coste de ventas, impuestos, financieros), el margen de cada mes, las medias de los últimos meses (burn) y los costes fijos mensuales. missing_data si no hay gastos registrados.",
  input: z.object({ months: z.number().int().min(1).max(12).default(3) }).strict(),
  async run(ctx, { months }) {
    const snapshot = await finance(ctx);
    if (!hasExpenses(snapshot)) return missingFinance("get_expenses", "expenses", "Gastos de los últimos meses", EXPENSE_NEEDS);
    const metrics: Metric[] = [];
    for (const month of closedMonths(ctx.today, months)) {
      const pnl = monthPnl(snapshot, month);
      if (!pnl) continue;
      const mp = monthPeriod(month);
      metrics.push(
        m.eur(`expenses.${mp}.total`, `Gastos de ${monthLabel(month)}`, pnl.expensesCents, mp, "/finance"),
        m.eur(`expenses.${mp}.fixed`, `Gastos fijos de ${monthLabel(month)}`, pnl.fixedCents, mp, "/finance"),
        m.eur(`expenses.${mp}.margin`, `Margen de ${monthLabel(month)} (ingresos − gastos)`, pnl.marginCents, mp, "/finance"),
        ...(Object.entries(pnl.byGroup) as [ExpenseGroup, number][])
          .filter(([, cents]) => cents !== 0)
          .map(([group, cents]) => m.eur(`expenses.${mp}.group.${group}`, `Gastos ${GROUP_LABELS[group]} de ${monthLabel(month)}`, cents, mp, "/finance")),
      );
      if (pnl.marginBps !== null) metrics.push(m.bps(`expenses.${mp}.margin_pct`, `Margen de ${monthLabel(month)} sobre ingresos`, pnl.marginBps, mp));
    }
    metrics.push(
      ...burnMetrics(snapshot, "expenses"),
      m.eur("expenses.fixed_monthly", `Costes fijos mensuales (${snapshot.fixedCosts.source === "history" ? "media de los gastos fijos" : "suscripciones fijas activas"})`, snapshot.fixedCosts.monthlyCents, ctx.today, "/finance"),
    );
    return {
      tool: "get_expenses",
      status: "ok",
      subject: "expenses",
      period: { from: snapshot.burn!.months[0]!, to: ctx.today },
      source: FINANCE_SOURCE,
      href: "/finance",
      summary: `Gasto medio de ${formatMetricValue(snapshot.burn!.expensesCents, "eur_cents")} al mes.`,
      metrics,
      notes: ["El coste de un gasto es su base más el IVA no deducible (definición de Finanzas)."],
    };
  },
});

export const getCashPosition = defineTool({
  name: "get_cash_position",
  description:
    "Caja estimada de hoy (último saldo de cada cuenta + cobros − pagos desde entonces), el IVA y las retenciones por ingresar con plazo pendiente, la caja después de esos impuestos y los meses de costes fijos que cubre. missing_data si no hay saldos.",
  input: z.object({}).strict(),
  async run(ctx) {
    const snapshot = await finance(ctx);
    if (!hasCash(snapshot)) return missingFinance("get_cash_position", "cash", "Saldo de caja", CASH_NEEDS);
    const cash = snapshot.cash;
    const taxes = taxesDue(snapshot, ctx.today);
    const metrics: Metric[] = [
      m.eur("cash.estimated", "Caja estimada hoy", cash.estimatedCents, ctx.today, "/finance"),
      m.eur("cash.recorded", `Saldo registrado (último saldo de cada cuenta)`, cash.recordedCents, cash.latestOn!, "/finance"),
      m.eur("cash.movements", "Cobros menos pagos desde el último saldo", cash.movementsCents, rangePeriod(cash.oldestOn ?? cash.latestOn!, ctx.today)),
      m.days("cash.age", "Días desde el saldo más antiguo de las cuentas", daysBetween(cash.oldestOn ?? cash.latestOn!, ctx.today), ctx.today, "/finance"),
      m.eur("cash.taxes_due", `IVA y retenciones por ingresar (${taxes.quarters.join(", ") || "ninguno"})`, taxes.cents, taxes.to ?? ctx.today, "/finance"),
      m.eur("cash.after_taxes", "Caja después de esos impuestos", cash.estimatedCents - taxes.cents, ctx.today, "/finance"),
      m.months("cash.cushion_target", "Colchón objetivo de la política", ctx.policy.policy.cushion_months, ctx.today, "/settings/council"),
    ];
    if (cash.accountsWithoutBalance > 0) metrics.push(m.count("cash.accounts_without_balance", "Cuentas activas sin ningún saldo apuntado", cash.accountsWithoutBalance, ctx.today, "/finance"));
    if (snapshot.fixedCosts.monthlyCents > 0) metrics.push(m.eur("cash.fixed_monthly", "Costes fijos mensuales", snapshot.fixedCosts.monthlyCents, ctx.today, "/finance"));
    if (snapshot.runwayMonths !== null) metrics.push(m.months("cash.runway_months", "Meses de costes fijos que cubre la caja", snapshot.runwayMonths, ctx.today, "/finance"));
    const rows: ToolRow[] = cash.accounts
      .filter((a) => a.isActive)
      .map((a) => ({
        subject: `cash_account:${a.accountId}`,
        label: a.name,
        href: "/finance",
        fields: { fecha_del_saldo: a.balanceOn },
        metrics: a.balanceCents === null ? [] : [m.eur(`cash.account.${a.accountId}`, "Último saldo", a.balanceCents, a.balanceOn ?? ctx.today, "/finance")],
      }));
    return {
      tool: "get_cash_position",
      status: "ok",
      subject: "cash",
      period: { from: cash.oldestOn ?? cash.latestOn!, to: ctx.today },
      source: FINANCE_SOURCE,
      href: "/finance",
      summary: `Caja estimada hoy: ${formatMetricValue(cash.estimatedCents, "eur_cents")}.`,
      metrics,
      rows,
      missing: snapshot.fixedCosts.monthlyCents > 0 ? null : { what: "Costes fijos (para medir el colchón)", needs: EXPENSE_NEEDS, href: "/finance" },
    };
  },
});

const FLOW_LABELS: Record<string, string> = {
  receivable: "cobros pendientes",
  billing: "cobros de lo que se va a facturar",
  expense: "gastos pendientes de pago",
  subscription: "suscripciones",
  vat: "IVA",
  withholding: "retenciones",
};

export const getCashForecast = defineTool({
  name: "get_cash_forecast",
  description:
    "Previsión de caja de Finanzas para los próximos días (90 por defecto): de la caja estimada de hoy, sumando cobros pendientes y de lo que se va a facturar, y restando gastos pendientes, suscripciones, IVA y retenciones en su plazo. Saldo final, punto más bajo (y cuándo), primer día en negativo y totales por tipo. missing_data sin saldos.",
  input: z.object({}).strict(),
  async run(ctx) {
    const snapshot = await finance(ctx);
    if (!hasCash(snapshot)) return missingFinance("get_cash_forecast", "cash_forecast", "Saldo de caja", CASH_NEEDS);
    const f = snapshot.forecast;
    const period = rangePeriod(f.from, f.until);
    const metrics: Metric[] = [
      m.days("forecast.days", "Días de la previsión", f.days, period),
      m.eur("forecast.start", "Caja estimada hoy", f.startCents, f.from, "/finance"),
      m.eur("forecast.end", `Caja prevista el ${f.until}`, f.endCents, f.until, "/finance"),
      m.eur("forecast.min", `Punto más bajo de caja (el ${f.minOn})`, f.minCents, f.minOn, "/finance"),
      m.eur("forecast.inflows", "Entradas previstas", f.inflowsCents, period),
      m.eur("forecast.outflows", "Salidas previstas", f.outflowsCents, period),
      m.flag("forecast.goes_negative", "La caja se queda en negativo en el periodo", f.negativeOn !== null, period),
      ...Object.entries(f.byKind)
        .filter(([, cents]) => cents !== 0)
        .map(([kind, cents]) => m.eur(`forecast.kind.${kind}`, `Neto de ${FLOW_LABELS[kind] ?? kind}`, cents, period)),
    ];
    const rows: ToolRow[] = [...f.flows]
      .sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents))
      .slice(0, 10)
      .map((flow, i) => ({
        subject: `cash_flow:${flow.kind}:${flow.refId ?? i}`,
        label: flow.label || FLOW_LABELS[flow.kind] || flow.kind,
        href: "/finance",
        fields: { tipo: FLOW_LABELS[flow.kind] ?? flow.kind, fecha: flow.on, vencido: flow.overdue },
        metrics: [m.eur(`forecast.flow.${i}`, flow.cents >= 0 ? "Entrada" : "Salida", flow.cents, flow.on)],
      }));
    return {
      tool: "get_cash_forecast",
      status: "ok",
      subject: "cash_forecast",
      period: { from: f.from, to: f.until },
      source: `${FINANCE_SOURCE} Calendario de facturación con IVA y plazos de los impuestos.`,
      href: "/finance",
      summary: `Caja prevista el ${f.until}: ${formatMetricValue(f.endCents, "eur_cents")}; punto más bajo, ${formatMetricValue(f.minCents, "eur_cents")}.`,
      metrics,
      rows,
      notes: [
        "Previsión con los datos de hoy: no incluye ventas nuevas ni gastos que aún no existen.",
        ...(f.negativeOn ? [`La caja se queda en negativo el ${f.negativeOn}.`] : []),
      ],
    };
  },
});

export const getRunway = defineTool({
  name: "get_runway",
  description:
    "Runway con la definición de Finanzas: meses de costes fijos que cubre la caja estimada de hoy, frente al colchón de la política, con el gasto, el ingreso y el margen medios de los últimos meses cerrados y el consumo neto de caja. missing_data sin saldos o sin gastos.",
  input: z.object({}).strict(),
  async run(ctx) {
    const snapshot = await finance(ctx);
    if (!hasCash(snapshot) || !hasExpenses(snapshot)) {
      return missingFinance("get_runway", "runway", "Saldo de caja y gastos de los últimos meses", [...(hasCash(snapshot) ? [] : CASH_NEEDS), ...(hasExpenses(snapshot) ? [] : EXPENSE_NEEDS)]);
    }
    const cushion = ctx.policy.policy.cushion_months;
    const metrics: Metric[] = [
      m.eur("runway.cash", "Caja estimada hoy", snapshot.cash.estimatedCents, ctx.today, "/finance"),
      m.eur("runway.fixed_monthly", "Costes fijos mensuales", snapshot.fixedCosts.monthlyCents, ctx.today, "/finance"),
      m.months("runway.cushion_target", "Colchón objetivo de la política", cushion, ctx.today, "/settings/council"),
      ...burnMetrics(snapshot, "runway"),
    ];
    if (snapshot.runwayMonths !== null) {
      metrics.push(
        m.months("runway.months", "Meses de costes fijos que cubre la caja (runway)", snapshot.runwayMonths, ctx.today, "/finance"),
        m.flag("runway.below_cushion", "Por debajo del colchón de la política", snapshot.runwayMonths < cushion, ctx.today),
      );
    }
    return {
      tool: "get_runway",
      status: "ok",
      subject: "runway",
      period: { from: snapshot.burn!.months[0]!, to: ctx.today },
      source: FINANCE_SOURCE,
      href: "/finance",
      summary: snapshot.runwayMonths === null ? "Sin costes fijos no hay runway que medir." : `La caja cubre ${formatMetricValue(snapshot.runwayMonths, "months")} de costes fijos.`,
      metrics,
      notes: snapshot.burn!.netBurnCents > 0 ? [] : ["Consumo neto cero: en los últimos meses se ha ingresado más de lo que se ha gastado."],
    };
  },
});
