// get_monthly_close: las cifras del cierre de un mes y la propuesta de reparto de la política
// (impuestos → colchón → reinversión → socios), calculada aquí y no por el modelo. Sin gastos del
// mes o sin saldo de caja no hay propuesta: la tool lo dice y da solo el lado de los ingresos.

import { z } from "zod";
import { compareCivil } from "@/domain/dates/civil-date";
import { addMonths, monthEnd, monthOf, movementsHistory, receivables, revenueByMonth, type Month } from "@/domain/metrics";
import { DISTRIBUTION_BUCKETS, proposeDistribution } from "../policy/distribution";
import { m } from "./common";
import { hasCash, monthPnl, taxesDue } from "./finance-common";
import { formatMetricValue, monthLabel, monthPeriod, rangePeriod } from "./format";
import { defineTool, type Metric } from "./types";

const BUCKET_LABELS: Record<(typeof DISTRIBUTION_BUCKETS)[number], string> = {
  taxes: "Impuestos (provisión de Sociedades)",
  cushion: "Colchón (se queda en la empresa)",
  reinvestment: "Reinversión",
  partners: "Socios",
};

export const getMonthlyClose = defineTool({
  name: "get_monthly_close",
  description:
    "Cierre de un mes cerrado (por defecto, el anterior): ingresos por categoría, cobros, pendiente y vencido al cierre, MRR y sus movimientos y, si hay gastos y caja, el beneficio, el colchón y la PROPUESTA DE REPARTO de la política (impuestos → colchón → reinversión → socios) calculada al céntimo. Si faltan gastos o caja, lo dice.",
  input: z
    .object({ month: z.string().regex(/^\d{4}-\d{2}(-01)?$/).optional().describe("Mes a cerrar, AAAA-MM; por defecto el anterior") })
    .strict(),
  async run(ctx, { month: requested }) {
    const today = ctx.today;
    const month: Month = requested ? `${requested.slice(0, 7)}-01` : addMonths(monthOf(today), -1);
    const end = monthEnd(month);
    if (compareCivil(end, today) >= 0) throw new Error(`${monthLabel(month)} todavía no ha cerrado.`);
    const mp = monthPeriod(month);
    const periodRange = rangePeriod(month, end);

    const [revenueRows, payments, open, lines, snapshots, finance] = await Promise.all([
      ctx.data.revenueRows(month, month),
      ctx.data.payments(month, end),
      ctx.data.openInvoicesOn(end),
      ctx.data.contractLines(),
      ctx.data.snapshots(addMonths(month, -1), month),
      ctx.data.finance(today),
    ]);
    const [revenue] = revenueByMonth(revenueRows, [month]);
    const income = revenue!.recurringCents + revenue!.usageCents + revenue!.oneOffCents;
    const collected = payments.reduce((sum, p) => sum + p.amountCents, 0);
    const money = receivables(open.map((i) => ({ kind: "ordinary" as const, status: i.status, outstandingCents: i.outstandingCents })));
    const [mv] = movementsHistory([month], new Map(snapshots.map((s) => [s.month, s])), lines, today);

    const metrics: Metric[] = [
      m.eur("close.revenue.recurring", `Ingresos recurrentes · ${monthLabel(month)}`, revenue!.recurringCents, mp, "/"),
      m.eur("close.revenue.usage", `Ingresos por uso · ${monthLabel(month)}`, revenue!.usageCents, mp, "/"),
      m.eur("close.revenue.one_off", `Ingresos one-off · ${monthLabel(month)}`, revenue!.oneOffCents, mp, "/"),
      m.eur("close.revenue.total", `Ingresos totales (suma de las tres) · ${monthLabel(month)}`, income, mp, "/"),
      m.eur("close.collected", `Cobrado en ${monthLabel(month)} (con IVA)`, collected, mp, "/invoices"),
      m.eur("close.outstanding", `Pendiente de cobro al cierre (con IVA)`, money.outstandingCents, end, "/invoices?status=issued"),
      m.eur("close.overdue", `Vencido al cierre (con IVA)`, money.overdueCents, end, "/invoices?status=overdue"),
      m.eur("close.mrr", `MRR al cierre de ${monthLabel(month)}`, mv!.endCents, end, "/"),
      m.eur("close.mrr.new", "MRR nuevo del mes", mv!.newCents, mp),
      m.eur("close.mrr.expansion", "Expansión de MRR del mes", mv!.expansionCents, mp),
      m.eur("close.mrr.contraction", "Contracción de MRR del mes", mv!.contractionCents, mp),
      m.eur("close.mrr.churn", "Churn de MRR del mes", mv!.churnCents, mp),
    ];

    const pnl = finance ? monthPnl(finance, month) : null;
    const cash = hasCash(finance) ? finance.cash : null;
    const fixed = finance && finance.fixedCosts.monthlyCents > 0 ? finance.fixedCosts : null;
    const needs = [
      pnl ? null : `Gastos de ${monthLabel(month)}`,
      cash ? null : "Saldo de caja actualizado",
      fixed ? null : "Gastos fijos de los últimos meses (para el colchón)",
    ].filter((x): x is string => x !== null);

    let distributionData: Record<string, unknown> | null = null;
    if (finance && pnl && cash && fixed) {
      const members = new Map((await ctx.data.members()).map((mm) => [mm.id, mm.fullName]));
      const taxes = taxesDue(finance, today);
      const d = proposeDistribution({
        profitCents: pnl.marginCents,
        cashCents: cash.estimatedCents,
        reservedCents: Math.max(0, taxes.cents),
        monthlyFixedCostsCents: fixed.monthlyCents,
        shareholdings: finance.shareholdings.rows.map((r) => ({ name: members.get(r.memberId) ?? "—", memberId: r.memberId, shareBps: r.percentBps })),
        policy: ctx.policy.policy,
      });
      metrics.push(
        m.eur("close.expenses", `Gastos de ${monthLabel(month)}`, pnl.expensesCents, mp, "/finance"),
        m.eur("close.expenses.fixed", `Gastos fijos de ${monthLabel(month)}`, pnl.fixedCents, mp, "/finance"),
        m.eur("close.profit", `Beneficio de ${monthLabel(month)} antes de Sociedades (ingresos − gastos)`, pnl.marginCents, mp, "/finance"),
        m.eur("close.cash", "Caja estimada hoy", cash.estimatedCents, today, "/finance"),
        m.eur("close.taxes_due", `IVA y retenciones por ingresar (${taxes.quarters.join(", ") || "ninguno"})`, taxes.cents, taxes.to ?? today, "/finance"),
        m.eur("close.fixed_monthly", "Costes fijos mensuales", fixed.monthlyCents, today, "/finance"),
        m.eur("close.cushion_target", "Colchón objetivo (meses de la política × costes fijos)", d.cushionTargetCents, today, "/settings/council"),
        m.eur("close.free_cash", "Caja libre (caja − impuestos por ingresar − impuestos del mes − colchón objetivo)", d.freeCashCents, today),
        m.eur("close.available", "Disponible para repartir (beneficio antes de Sociedades)", d.availableCents, mp),
        ...DISTRIBUTION_BUCKETS.map((bucket) => m.eur(`close.distribution.${bucket}`, `Propuesta · ${BUCKET_LABELS[bucket]}`, d.buckets[bucket], mp, "/council/close")),
        ...d.partners.map((p, i) => m.eur(`close.distribution.partner.${p.memberId ?? i}`, `Propuesta · socios · ${p.name}`, p.cents, mp, "/council/close")),
      );
      distributionData = {
        available_cents: d.availableCents,
        buckets: d.buckets,
        cushion_target_cents: d.cushionTargetCents,
        free_cash_cents: d.freeCashCents,
        cash_limited: d.cashLimited,
        loss: d.loss,
        partners: d.partners.map((p) => ({ name: p.name, member_id: p.memberId, share_bps: p.shareBps, cents: p.cents })),
      };
    }

    return {
      tool: "get_monthly_close",
      status: distributionData ? "ok" : "missing_data",
      subject: `close:${mp}`,
      period: { from: month, to: end },
      source: "Facturas y cobros (invoices_overview, payments), MRR v1, y gastos, caja y participaciones de Finanzas.",
      href: "/council/close",
      summary: distributionData
        ? `${monthLabel(month)}: ingresos ${formatMetricValue(income, "eur_cents")} y propuesta de reparto calculada con la política${ctx.policy.isExample ? " de EJEMPLO" : ""}.`
        : `${monthLabel(month)}: ingresos ${formatMetricValue(income, "eur_cents")}. Sin ${needs.join(", ").toLowerCase()} no hay propuesta de reparto.`,
      metrics,
      missing: needs.length > 0 ? { what: "Datos para proponer el reparto del mes", needs, href: "/finance" } : null,
      notes: [
        "Recomendación orientativa, no asesoramiento fiscal: validar con la gestoría.",
        "La caja libre descuenta el IVA y las retenciones por ingresar, no las provisiones de Sociedades de meses anteriores que sigan en la cuenta.",
        ...(ctx.policy.isExample ? ["Calculado con la política de EJEMPLO: los socios aún no han fijado la suya."] : []),
      ],
      data: { month, period: periodRange, distribution: distributionData, policy_version: ctx.policy.version },
    };
  },
});
