// get_tax_provisions: IVA por emisor y trimestre (repercutido, soportado y a ingresar),
// retenciones, una estimación del Impuesto de Sociedades con la política, los plazos y la cuenta
// atrás de Verifactu. Las estimaciones y los plazos son los de src/domain/finance (los mismos que
// /finance); sin Finanzas, el IVA repercutido sale de las facturas emitidas con esas mismas
// funciones. SIEMPRE orientativo: validar con la gestoría.

import { z } from "zod";
import { compareCivil, daysBetween, type CivilDate } from "@/domain/dates/civil-date";
import {
  estimateVatQuarter,
  estimateWithholdingsQuarter,
  nextDueQuarter,
  quarterEnd,
  quarterKey,
  quarterOf,
  quarterStart,
  taxPaymentDueOn,
  type Quarter,
  type QuarterNumber,
  type TaxQuarterView,
} from "@/domain/finance";
import { verifactuCountdown } from "@/domain/fiscal/verifactu";
import { applyBps } from "@/domain/money";
import { m } from "./common";
import { closedMonths, combinedMargin, hasExpenses } from "./finance-common";
import { formatMetricValue, monthLabel, rangePeriod } from "./format";
import { defineTool, type Metric, type ToolContext, type ToolRow } from "./types";

const ISSUED = new Set(["issued", "overdue", "paid", "voided"]);

/** «3T 2026», como lo escribe la interfaz de Finanzas. */
export const quarterLabel = (q: Quarter) => `${q.quarter}T ${q.year}`;

async function issuedInvoices(ctx: ToolContext, from: CivilDate, to: CivilDate) {
  return (await ctx.data.invoices({ issuedFrom: from, issuedTo: to })).filter((i) => ISSUED.has(i.status));
}

/** Las vistas de los trimestres sin Finanzas: el repercutido de las facturas, con las funciones de Finanzas. */
async function quartersFromInvoices(ctx: ToolContext, quarters: readonly Quarter[]): Promise<TaxQuarterView[]> {
  if (quarters.length === 0) return [];
  const from = quarters.map(quarterStart).sort()[0]!;
  const invoices = await issuedInvoices(ctx, from, ctx.today);
  const output = invoices.map((i) => ({ issuerId: i.issuerId, on: i.issuedOn!, cents: i.vatCents }));
  return quarters.map((q) => {
    const vat = estimateVatQuarter(q, output, []);
    return { quarter: q, key: quarterKey(q), dueOn: vat.dueOn, closed: compareCivil(vat.to, ctx.today) < 0, vat, withholdings: estimateWithholdingsQuarter(q, []) };
  });
}

export const getTaxProvisions = defineTool({
  name: "get_tax_provisions",
  description:
    "Impuestos por emisor y trimestre (ORIENTATIVO, validar con la gestoría): IVA repercutido, soportado (de los gastos, si los hay) y a ingresar, las retenciones, las retenciones de IRPF que han practicado los clientes, una estimación del Impuesto de Sociedades del año con la política, los plazos (303, 130, 111, 115) con los días que faltan y la cuenta atrás de Verifactu de cada emisor.",
  input: z.object({ quarter: z.string().regex(/^\d{4}-[TQ][1-4]$/).optional().describe("Trimestre AAAA-Q1..Q4; por defecto el que toca pagar y el actual") }).strict(),
  async run(ctx, { quarter }) {
    const today = ctx.today;
    const [issuers, finance] = await Promise.all([ctx.data.issuers(), ctx.data.finance(today)]);
    const names = new Map(issuers.map((i) => [i.id, i.name]));
    const requested: Quarter | null = quarter ? { year: Number(quarter.slice(0, 4)), quarter: Number(quarter.slice(-1)) as QuarterNumber } : null;
    const withExpenses = hasExpenses(finance);

    let views: TaxQuarterView[];
    if (requested) {
      const inSnapshot = finance?.taxes.quarters.find((q) => q.key === quarterKey(requested));
      views = inSnapshot ? [inSnapshot] : await quartersFromInvoices(ctx, [requested]);
    } else if (finance) {
      views = finance.taxes.quarters;
    } else {
      const due = nextDueQuarter(today);
      const current = quarterOf(today);
      views = await quartersFromInvoices(ctx, quarterKey(due) === quarterKey(current) ? [current] : [due, current]);
    }

    const metrics: Metric[] = [];
    const rows: ToolRow[] = [];
    for (const view of views) {
      const q = view.quarter;
      const key = view.key;
      const to = compareCivil(quarterEnd(q), today) < 0 ? quarterEnd(q) : today;
      const period = rangePeriod(quarterStart(q), to);
      metrics.push(m.days(`tax.${key}.days_left`, `Días hasta el plazo del ${quarterLabel(q)} (${view.dueOn})`, daysBetween(today, view.dueOn), today));
      const invoices = await issuedInvoices(ctx, quarterStart(q), to);
      const clientIrpf = new Map<string, number>();
      for (const invoice of invoices) clientIrpf.set(invoice.issuerId, (clientIrpf.get(invoice.issuerId) ?? 0) + invoice.irpfCents);
      const issuerIds = [...new Set([...view.vat.issuers.map((i) => i.issuerId), ...clientIrpf.keys()])].sort();
      for (const issuerId of issuerIds) {
        const vat = view.vat.issuers.find((i) => i.issuerId === issuerId);
        const withheld = view.withholdings.issuers.find((i) => i.issuerId === issuerId);
        const issuer = issuers.find((i) => i.id === issuerId);
        const rowMetrics: Metric[] = [];
        if (vat) {
          rowMetrics.push(m.eur(`tax.${key}.${issuerId}.vat_output`, `IVA repercutido del ${quarterLabel(q)}`, vat.outputVatCents, period, "/finance"));
          if (vat.forecastOutputVatCents !== 0) rowMetrics.push(m.eur(`tax.${key}.${issuerId}.vat_output_forecast`, `De ese IVA, lo que sale de lo que aún se va a facturar`, vat.forecastOutputVatCents, period));
          if (withExpenses) {
            rowMetrics.push(
              m.eur(`tax.${key}.${issuerId}.vat_input`, `IVA soportado deducible del ${quarterLabel(q)}`, vat.inputVatCents, period, "/finance"),
              m.eur(`tax.${key}.${issuerId}.vat_result`, `Resultado del IVA del ${quarterLabel(q)} (repercutido − soportado)`, vat.resultCents, period),
              m.eur(`tax.${key}.${issuerId}.vat_payable`, `IVA a ingresar del ${quarterLabel(q)}`, vat.payableCents, period, "/finance"),
            );
          }
        }
        if (withheld && withheld.withheldCents !== 0) rowMetrics.push(m.eur(`tax.${key}.${issuerId}.withholdings`, `Retenciones practicadas a ingresar del ${quarterLabel(q)} (111 y 115)`, withheld.withheldCents, period, "/finance"));
        const irpf = clientIrpf.get(issuerId) ?? 0;
        if (irpf !== 0) rowMetrics.push(m.eur(`tax.${key}.${issuerId}.client_irpf`, `Retenciones de IRPF que han practicado los clientes en el ${quarterLabel(q)}`, irpf, period, "/invoices"));
        if (rowMetrics.length === 0) continue;
        rows.push({
          subject: `tax:${key}:${issuerId}`,
          label: `${names.get(issuerId) ?? "—"} · ${quarterLabel(q)}`,
          href: "/finance",
          fields: {
            emisor: issuer?.kind === "company" ? "sociedad" : "autónomo",
            plazo: view.dueOn,
            trimestre_cerrado: view.closed,
            modelos: issuer?.kind === "company" ? "303 (IVA), 111 y 115 (retenciones)" : "303 (IVA), 130 (IRPF), 111 y 115",
            iva_soportado: withExpenses ? null : "sin gastos registrados: el IVA a ingresar real será menor",
          },
          metrics: rowMetrics,
        });
      }
    }

    // Impuesto de Sociedades: la provisión de la política sobre el margen de los meses cerrados del año.
    if (withExpenses) {
      const year = today.slice(0, 4);
      const months = finance!.months.filter((mm) => mm.month.startsWith(year) && mm.hasExpenses && closedMonths(today, 12).includes(mm.month));
      if (months.length > 0) {
        const margin = combinedMargin(months);
        const period = rangePeriod(months[0]!.month, months.at(-1)!.month);
        metrics.push(
          m.eur("tax.is.profit_ytd", `Beneficio del año en los meses con gastos (hasta ${monthLabel(months.at(-1)!.month)})`, margin.marginCents, period, "/finance"),
          m.eur("tax.is.provision_ytd", "Provisión de Sociedades con la política (estimación)", applyBps(Math.max(0, margin.marginCents), ctx.policy.policy.corporate_tax_provision_bps), period, "/settings/council"),
        );
      }
    }

    // Verifactu: emisores con el proveedor interno cuya obligación llega en los próximos 180 días.
    for (const issuer of issuers) {
      if (issuer.fiscalProvider !== "internal") continue;
      const countdown = verifactuCountdown(issuer.verifactuFrom, today);
      if (countdown.state === "far" && countdown.daysLeft > 180) continue;
      rows.push({
        subject: `verifactu:${issuer.id}`,
        label: `${issuer.name} · Verifactu`,
        href: "/settings/issuers",
        fields: { obligado_desde: issuer.verifactuFrom, estado: countdown.state === "required" ? "ya obligado: con el proveedor interno no puede emitir" : "hay que elegir proveedor" },
        metrics: [m.days(`verifactu.${issuer.id}.days_left`, "Días hasta la obligación de Verifactu", countdown.daysLeft, today, "/settings/issuers")],
      });
    }

    const outputTotal = rows.flatMap((r) => r.metrics).filter((x) => x.key.endsWith(".vat_output")).reduce((s, x) => s + x.value, 0);
    return {
      tool: "get_tax_provisions",
      status: "ok",
      subject: `tax:${views.map((v) => v.key).join(",") || quarterKey(quarterOf(today))}`,
      period: views.length > 0 ? { from: quarterStart(views[0]!.quarter), to: today } : { from: today, to: today },
      source: finance
        ? "Estimación de Finanzas (src/domain/finance): IVA de las facturas emitidas y de lo que se va a facturar, IVA soportado y retenciones de los gastos."
        : "IVA de las facturas emitidas (invoices_overview). Sin Finanzas no hay IVA soportado ni retenciones de gastos.",
      href: "/finance",
      summary: `IVA repercutido de ${formatMetricValue(outputTotal, "eur_cents")} en ${views.map((v) => quarterLabel(v.quarter)).join(" y ")}.`,
      metrics,
      rows,
      missing: withExpenses ? null : { what: "IVA soportado y beneficio para Sociedades", needs: ["Gastos registrados con su IVA (Finanzas)"], href: "/finance" },
      notes: [
        "Cálculo orientativo, no asesoramiento fiscal: validar con la gestoría (plazos, deducibilidad y modelos).",
        `Plazos: ${views.map((v) => `${quarterLabel(v.quarter)} hasta el ${taxPaymentDueOn(v.quarter)}`).join("; ")}.`,
      ],
    };
  },
});
