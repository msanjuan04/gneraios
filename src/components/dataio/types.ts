import type { ImportOptions } from "@/app/[org]/settings/data/schema";
import type { ClassificationSource, ImportBillingType, RevenueCategory } from "@/domain/dataio/classify";
import type { ImportField, ImportKind } from "@/domain/dataio/fields";
import type { ActionCounts, Issue, RowAction } from "@/domain/dataio/issues";

/** Lo que la página de Datos y la de una importación pasan a sus componentes (serializable). */

export type ImportStatus = "draft" | "simulated" | "committed" | "failed";

export type ImportJobListItem = {
  id: string;
  kind: ImportKind;
  fileName: string;
  status: ImportStatus;
  rows: number;
  createdAt: string;
  committedAt: string | null;
  counts: ActionCounts | null;
};

export type MappingColumn = { index: number; header: string; samples: string[] };
export type IssuerOption = { id: string; name: string; taxId: string | null; archived: boolean };
export type VatRateOption = { bps: number; label: string };

export type MappingView = {
  kind: ImportKind;
  columns: MappingColumn[];
  mapping: Partial<Record<ImportField, number>>;
  options: ImportOptions;
  /** Campos (o grupos) imprescindibles sin columna. */
  missing: string[];
  issuers: IssuerOption[];
  vatRates: VatRateOption[];
  /** Separador decimal y orden de fechas deducidos del fichero (si la opción está en automático). */
  inferred: { decimal: "," | "."; dateOrder: "dmy" | "mdy" };
};

export type ClientRowView = {
  rowNumber: number;
  action: RowAction;
  name: string | null;
  taxId: string | null;
  contact: { name: string; email: string | null } | null;
  issues: Issue[];
  existingId: string | null;
};

export type LineView = {
  rowNumber: number;
  description: string;
  baseCents: number;
  vatBps: number;
  billingType: ImportBillingType;
  manual: boolean;
  suggested: { billingType: ImportBillingType; source: ClassificationSource; ruleId: string | null; keyword: string | null; ambiguous: boolean };
};

export type InvoiceRowView = {
  key: string;
  action: "create" | "skip" | "error";
  number: string;
  kind: "ordinary" | "rectifying";
  issuedOn: string | null;
  seriesLabel: string | null;
  clientName: string | null;
  clientIsNew: boolean;
  rowNumbers: number[];
  issues: Issue[];
  lines: LineView[];
  totals: { subtotalCents: number; vatCents: number; irpfCents: number; totalCents: number } | null;
  paidOn: string | null;
  existingId: string | null;
};

export type CounterView = { label: string; year: number; from: number; to: number };
export type GapView = { label: string; year: number; ranges: [number, number][]; count: number };

export type ClientSimulationView = { kind: "clients"; counts: ActionCounts; rows: ClientRowView[] };

export type InvoiceSimulationView = {
  kind: "invoices";
  /** Por factura. */
  counts: ActionCounts;
  invoices: InvoiceRowView[];
  /** Filas sin número (no se pueden agrupar en ninguna factura). */
  orphanRows: { rowNumber: number; issues: Issue[] }[];
  totals: { subtotalCents: number; vatCents: number; irpfCents: number; totalCents: number };
  byCategory: Record<RevenueCategory, number>;
  counters: CounterView[];
  gaps: GapView[];
  newClients: number;
  /** La app `facturas` llegó más lejos que el fichero: hay que fijar el último número a mano. */
  legacyCounters: { year: number; lastNumber: number; imported: number }[];
};

export type SimulationView = ClientSimulationView | InvoiceSimulationView;

export type ResultRowView = {
  rowNumber: number;
  action: RowAction | null;
  label: string | null;
  issues: Issue[];
  href: string | null;
};

export type ResultView = {
  counts: ActionCounts;
  rows: ResultRowView[];
  newClients: number;
  committedAt: string | null;
};

export type ImportJobView = {
  id: string;
  kind: ImportKind;
  fileName: string;
  status: ImportStatus;
  rows: number;
  format: "csv" | "json";
  encoding: string | null;
  delimiter: string | null;
  createdAt: string;
  error: string | null;
  /** Otra importación confirmada del mismo fichero (reimportarlo no cambiará nada). */
  sameFileCommittedAt: string | null;
};

export type ExportIssuerOption = { id: string; name: string; taxId: string | null };
