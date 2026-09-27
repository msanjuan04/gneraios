import "server-only";
import type {
  ExportIssuerOption,
  ImportJobListItem,
  ImportJobView,
  ImportStatus,
  MappingView,
  ResultView,
  SimulationView,
} from "@/components/dataio/types";
import type { ActionCounts } from "@/domain/dataio/issues";
import { formatBps } from "@/domain/money";
import { cellOf } from "@/domain/dataio/table";
import type { Tables } from "@/lib/supabase/database.types";
import { type Db, DbError } from "@/server/billing/context";
import { findCommittedTwin, type LoadedJob, listImportJobs, loadImportJob } from "./jobs";
import { mappingView, simulateJob, simulationView, storedIssues } from "./simulate";

type Org = Pick<Tables<"orgs">, "id" | "slug" | "timezone" | "settings">;

function countsOf(summary: unknown): ActionCounts | null {
  const counts = (summary as { counts?: Partial<ActionCounts> } | null)?.counts;
  if (!counts) return null;
  return { create: counts.create ?? 0, update: counts.update ?? 0, skip: counts.skip ?? 0, error: counts.error ?? 0 };
}

/** Lo que enseña la página de Datos: las últimas importaciones y los emisores para exportar. */
export async function loadDataPage(db: Db, orgId: string): Promise<{ jobs: ImportJobListItem[]; issuers: ExportIssuerOption[] }> {
  const [jobs, issuers] = await Promise.all([
    listImportJobs(db, orgId),
    db.from("issuers").select("id, legal_name, trade_name, tax_id, is_primary, archived_at").eq("org_id", orgId).order("is_primary", { ascending: false }).order("legal_name"),
  ]);
  if (issuers.error) throw new DbError(issuers.error, "dataio.page.issuers");
  return {
    jobs: jobs.map((j) => ({
      id: j.id,
      kind: j.kind,
      fileName: j.file_name,
      status: j.status as ImportStatus,
      rows: Number((j.file_meta as { rows?: number } | null)?.rows ?? 0),
      createdAt: j.created_at,
      committedAt: j.committed_at,
      counts: countsOf(j.summary),
    })),
    issuers: issuers.data.map((i) => ({ id: i.id, name: i.trade_name ?? i.legal_name, taxId: i.tax_id })),
  };
}

function jobView(loaded: LoadedJob, twin: string | null): ImportJobView {
  const job = loaded.job;
  return {
    id: job.id,
    kind: job.kind,
    fileName: job.file_name,
    status: job.status as ImportStatus,
    rows: loaded.rows.length,
    format: loaded.meta.format ?? "csv",
    encoding: loaded.meta.encoding ?? null,
    delimiter: loaded.meta.delimiter ?? null,
    createdAt: job.created_at,
    error: job.error,
    sameFileCommittedAt: twin,
  };
}

/** Etiqueta de una fila en el resultado: el nombre del cliente o el número de la factura. */
function rowLabel(loaded: LoadedJob, cells: readonly string[]): string | null {
  const m = loaded.mapping.columns;
  const value =
    loaded.job.kind === "clients"
      ? cellOf(cells, m, "display_name") || cellOf(cells, m, "legal_name")
      : [cellOf(cells, m, "number"), cellOf(cells, m, "client_name")].filter(Boolean).join(" · ");
  return value || null;
}

function resultView(loaded: LoadedJob, slug: string): ResultView {
  const counts: ActionCounts = { create: 0, update: 0, skip: 0, error: 0 };
  const base = loaded.job.kind === "clients" ? `/${slug}/clients/` : `/${slug}/invoices/`;
  const rows = loaded.rows.map((row, i) => {
    if (row.action) counts[row.action] += 1;
    return {
      rowNumber: row.row_number,
      action: row.action,
      label: rowLabel(loaded, loaded.table.rows[i] ?? []),
      issues: storedIssues(row.issues),
      href: row.entity_id ? `${base}${row.entity_id}` : null,
    };
  });
  const summary = (loaded.job.summary ?? {}) as { newClients?: number };
  return { counts, rows, newClients: summary.newClients ?? 0, committedAt: loaded.job.committed_at };
}

export type JobPage = {
  job: ImportJobView;
  mapping: MappingView;
  /** Simulación con el estado actual (si el mapeo tiene lo imprescindible y no está confirmada). */
  simulation: SimulationView | null;
  /** Resultado guardado (si se ha confirmado o ha fallado). */
  result: ResultView | null;
};

/** Todo lo que enseña la página de una importación. null si no existe (o no se ve). */
export async function loadJobPage(db: Db, org: Org, memberId: string, jobId: string): Promise<JobPage | null> {
  const loaded = await loadImportJob(db, org.id, jobId);
  if (!loaded) return null;
  const [twin, issuers, rates] = await Promise.all([
    findCommittedTwin(db, loaded.job),
    db.from("issuers").select("id, legal_name, trade_name, tax_id, archived_at, is_primary").eq("org_id", org.id).order("is_primary", { ascending: false }).order("legal_name"),
    db.from("tax_rates").select("rate_bps, name, regime, archived_at, is_default").eq("org_id", org.id).eq("kind", "vat").is("archived_at", null).order("position"),
  ]);
  if (issuers.error) throw new DbError(issuers.error, "dataio.jobPage.issuers");
  if (rates.error) throw new DbError(rates.error, "dataio.jobPage.rates");

  const vatRates = [...new Map(rates.data.filter((r) => r.regime === "general").map((r) => [r.rate_bps, { bps: r.rate_bps, label: `${r.name} (${formatBps(r.rate_bps)})` }])).values()];
  const mapping = mappingView(loaded, {
    issuers: issuers.data.map((i) => ({ id: i.id, name: i.trade_name ?? i.legal_name, taxId: i.tax_id, archived: i.archived_at !== null })),
    vatRates,
  });

  const status = loaded.job.status as ImportStatus;
  const done = status === "committed";
  const simulation =
    !done && mapping.missing.length === 0 ? simulationView(await simulateJob(db, org, memberId, loaded), loaded.meta) : null;
  const result = done || status === "failed" ? resultView(loaded, org.slug) : null;
  return { job: jobView(loaded, twin), mapping, simulation, result };
}
