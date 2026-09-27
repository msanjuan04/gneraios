import "server-only";
import { getTranslations } from "next-intl/server";
import { type ClientImportPlan, planClientImport } from "@/domain/dataio/clients-import";
import { missingRequired } from "@/domain/dataio/fields";
import { inferInvoiceFormats, type InvoiceImportOptions, type InvoiceImportPlan, planInvoiceImport } from "@/domain/dataio/invoices-import";
import { type Issue, primaryIssue } from "@/domain/dataio/issues";
import type { Json, Tables } from "@/lib/supabase/database.types";
import type {
  ClientSimulationView,
  InvoiceSimulationView,
  MappingView,
  SimulationView,
} from "@/components/dataio/types";
import type { Db } from "@/server/billing/context";
import { loadClientImportContext, loadInvoiceImportContext } from "./context";
import type { LoadedJob, RowResult } from "./jobs";
import { sampleValues } from "@/domain/dataio/table";

type Org = Pick<Tables<"orgs">, "id" | "timezone" | "settings">;

export type Simulation =
  | { kind: "clients"; plan: ClientImportPlan }
  | { kind: "invoices"; plan: InvoiceImportPlan; options: InvoiceImportOptions; seriesLabels: Map<string, string> };

/** Opciones efectivas de una importación de facturas: las guardadas y, en automático, lo deducido del fichero. */
async function invoiceOptions(loaded: LoadedJob): Promise<InvoiceImportOptions> {
  const t = await getTranslations("dataio.defaults");
  const inferred = inferInvoiceFormats(loaded.table, loaded.mapping.columns, loaded.meta.decimalHint ?? ",");
  const o = loaded.mapping.options;
  return {
    issuerId: o.issuerId,
    defaultVatBps: o.defaultVatBps,
    paidMode: o.paidMode,
    lineTypes: loaded.mapping.lineTypes,
    decimal: o.decimal ?? inferred.decimal,
    dateOrder: o.dateOrder ?? inferred.dateOrder,
    defaultDescription: t("description"),
    defaultRectificationReason: t("rectificationReason"),
  };
}

/** Simula la importación con el estado actual de la org (se repite al confirmar: nada se da por supuesto). */
export async function simulateJob(db: Db, org: Org, memberId: string, loaded: LoadedJob): Promise<Simulation> {
  if (loaded.job.kind === "clients") {
    const ctx = await loadClientImportContext(db, org.id, memberId);
    return { kind: "clients", plan: planClientImport(loaded.table, loaded.mapping.columns, ctx) };
  }
  const ctx = await loadInvoiceImportContext(db, org);
  const options = await invoiceOptions(loaded);
  return { kind: "invoices", plan: planInvoiceImport(loaded.table, loaded.mapping.columns, options, ctx), options, seriesLabels: ctx.seriesLabels };
}

/** Lo que se guarda de cada fila tras simular. */
export function simulationRowResults(sim: Simulation): Map<number, Omit<RowResult, "id">> {
  const out = new Map<number, Omit<RowResult, "id">>();
  if (sim.kind === "clients") {
    for (const r of sim.plan.rows) {
      out.set(r.rowNumber, { action: r.action, message: primaryIssue(r.issues)?.code ?? null, issues: r.issues as unknown as Json, entity_id: r.existingId });
    }
    return out;
  }
  const existingByKey = new Map(sim.plan.invoices.map((i) => [i.externalId, i.existingId]));
  for (const r of sim.plan.rows) {
    out.set(r.rowNumber, {
      action: r.action,
      message: primaryIssue(r.issues)?.code ?? null,
      issues: r.issues as unknown as Json,
      entity_id: r.externalId ? (existingByKey.get(r.externalId) ?? null) : null,
    });
  }
  return out;
}

/** Recuento y totales que se guardan en `import_jobs.summary` (y enseña el listado). */
export function simulationSummary(sim: Simulation): Json {
  const rowCounts = { create: 0, update: 0, skip: 0, error: 0 };
  for (const r of sim.plan.rows) rowCounts[r.action] += 1;
  if (sim.kind === "clients") return { counts: rowCounts, rows: rowCounts } as unknown as Json;
  return {
    counts: rowCounts,
    invoices: sim.plan.counts,
    totals: sim.plan.totals,
    byCategory: sim.plan.byCategory,
    newClients: sim.plan.newClients.length,
  } as unknown as Json;
}

/** Vista del mapeo: columnas con ejemplos, el mapeo actual, lo que falta y las opciones. */
export function mappingView(
  loaded: LoadedJob,
  extras: { issuers: MappingView["issuers"]; vatRates: MappingView["vatRates"] },
): MappingView {
  const inferred = inferInvoiceFormats(loaded.table, loaded.mapping.columns, loaded.meta.decimalHint ?? ",");
  return {
    kind: loaded.job.kind,
    columns: loaded.table.headers.map((header, index) => ({ index, header, samples: sampleValues(loaded.table, index) })),
    mapping: loaded.mapping.columns,
    options: loaded.mapping.options,
    missing: missingRequired(loaded.job.kind, loaded.mapping.columns),
    issuers: extras.issuers,
    vatRates: extras.vatRates,
    inferred,
  };
}

/** Vista de la simulación para la UI (serializable, sin datos que la UI no enseña). */
export function simulationView(sim: Simulation, meta: LoadedJob["meta"]): SimulationView {
  if (sim.kind === "clients") {
    const view: ClientSimulationView = {
      kind: "clients",
      counts: sim.plan.counts,
      rows: sim.plan.rows.map((r) => ({
        rowNumber: r.rowNumber,
        action: r.action,
        name: r.name,
        taxId: r.taxId,
        contact: r.contact,
        issues: r.issues,
        existingId: r.existingId,
      })),
    };
    return view;
  }
  const plan = sim.plan;
  const byRow = new Map(plan.rows.map((r) => [r.rowNumber, r]));
  const legacy = (meta.legacyCounters ?? []).flatMap((c) => {
    const imported = Math.max(
      0,
      ...plan.invoices.filter((i) => i.kind === "ordinary" && i.numberYear === c.year && i.action !== "error").map((i) => i.sequence ?? 0),
    );
    return c.lastNumber > imported ? [{ year: c.year, lastNumber: c.lastNumber, imported }] : [];
  });
  const view: InvoiceSimulationView = {
    kind: "invoices",
    counts: plan.counts,
    invoices: plan.invoices.map((i) => ({
      key: i.externalId,
      action: i.action,
      number: i.number,
      kind: i.kind,
      issuedOn: i.issuedOn,
      seriesLabel: i.seriesId ? (sim.seriesLabels.get(i.seriesId) ?? null) : null,
      clientName: i.client?.name ?? i.clientParty?.legal_name ?? null,
      clientIsNew: i.client?.kind === "new",
      rowNumbers: i.rowNumbers,
      issues: i.issues,
      lines: i.lines.map((l) => ({
        rowNumber: l.rowNumber,
        description: l.description,
        baseCents: l.baseCents,
        vatBps: l.vatBps,
        billingType: l.classification.billingType,
        manual: l.classification.source === "manual",
        suggested: {
          billingType: l.suggested.billingType,
          source: l.suggested.source,
          ruleId: l.suggested.rule?.id ?? null,
          keyword: l.suggested.rule?.keyword ?? null,
          ambiguous: l.suggested.ambiguous,
        },
      })),
      totals: i.totals,
      paidOn: i.payment?.paidOn ?? null,
      existingId: i.existingId,
    })),
    orphanRows: [...byRow.values()].filter((r) => r.externalId === null).map((r) => ({ rowNumber: r.rowNumber, issues: r.issues })),
    totals: plan.totals,
    byCategory: plan.byCategory,
    counters: plan.counters.map((c) => ({ label: sim.seriesLabels.get(c.seriesId) ?? "", year: c.year, from: c.from, to: c.to })),
    gaps: plan.gaps.map((g) => ({ label: sim.seriesLabels.get(g.seriesId) ?? "", year: g.year, ranges: g.ranges, count: g.count })),
    newClients: plan.newClients.length,
    legacyCounters: legacy,
  };
  return view;
}

/** Los motivos guardados de una fila (lo que llega de la base de datos es JSON sin tipo). */
export function storedIssues(value: Json): Issue[] {
  return Array.isArray(value) ? (value.filter((v) => v && typeof v === "object" && "code" in (v as object)) as unknown as Issue[]) : [];
}
