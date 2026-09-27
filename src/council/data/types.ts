// Lo que las tools pueden leer del negocio: un puerto de SOLO LECTURA. No hay ningún método que
// escriba, así que ninguna tool puede crear facturas, mover dinero ni cambiar nada. Dos
// implementaciones: la de Supabase (data/supabase.ts, filtrando siempre por org) y la de fixtures
// (data/fixture.ts) para los tests y los evals.
//
// Las filas son las de las vistas que ya existen (invoices_overview, clients_overview,
// deals_board, revenue_by_month, project_contract_revenue…), ya con sus estados derivados.

import type { ForecastContract } from "@/domain/billing/forecast";
import type { FinanceSnapshot } from "@/domain/finance";
import type { CivilDate } from "@/domain/dates/civil-date";
import type { ClientStatus, InvoiceStatus, MetricsLine, Month, RevenueRow, SnapshotLike } from "@/domain/metrics";
import type { FunnelStage, StageChange, StageKind } from "@/domain/pipeline";
import type { ProjectStatus, TaskStatus } from "@/domain/projects";
import type { SearchDay, WebDay } from "@/domain/seo";

export type OrgInfo = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  locale: string;
  currency: string;
  settings: unknown;
};

export type MemberInfo = { id: string; fullName: string; initials: string; role: "owner" | "partner" | "viewer" };

export type IssuerInfo = {
  id: string;
  name: string;
  kind: "company" | "self_employed";
  verifactuFrom: CivilDate;
  fiscalProvider: string;
  activeFrom: CivilDate | null;
  activeUntil: CivilDate | null;
};

/** Línea de contrato firmado con lo que necesitan el MRR, las renovaciones y la simulación. */
export type CouncilLine = MetricsLine & {
  id: string;
  contractId: string;
  description: string;
  contractTitle: string;
  billingDay: number | null;
  prorateFirst: boolean;
};

export type CouncilClient = {
  id: string;
  name: string;
  status: ClientStatus;
  /** Facturación neta emitida desde siempre (base sin IVA). */
  billedNetCents: number;
  firstInvoiceOn: CivilDate | null;
  /** Instante ISO de la última actividad humana (llamada, reunión, email, nota). */
  lastActivityAt: string | null;
  ownerMemberId: string | null;
  sourceId: string | null;
  createdAt: string;
  archived: boolean;
};

export type CouncilInvoice = {
  id: string;
  number: string | null;
  clientId: string;
  clientName: string;
  issuerId: string;
  issuerName: string;
  kind: "ordinary" | "rectifying";
  status: InvoiceStatus;
  issuedOn: CivilDate | null;
  dueOn: CivilDate | null;
  subtotalCents: number;
  vatCents: number;
  irpfCents: number;
  totalCents: number;
  outstandingCents: number;
  paidCents: number;
  lastPaidOn: CivilDate | null;
};

/** Factura emitida no cobrada en una fecha de corte (función open_invoices_on). */
export type OpenInvoiceOn = { id: string; clientId: string; dueOn: CivilDate | null; outstandingCents: number; status: InvoiceStatus };

export type CouncilPayment = { invoiceId: string; clientId: string; amountCents: number; paidOn: CivilDate };

export type CouncilDeal = {
  id: string;
  title: string;
  clientId: string;
  clientName: string;
  stageId: string;
  stageKind: StageKind;
  estOneOffCents: number;
  estMrrCents: number;
  /** La del deal o, si no tiene, la de su etapa. */
  probabilityBps: number;
  sourceId: string | null;
  broughtByMemberId: string | null;
  ownerMemberId: string | null;
  nextAction: string | null;
  nextActionOn: CivilDate | null;
  lossReasonId: string | null;
  /** Instantes ISO. */
  createdAt: string;
  stageEnteredAt: string | null;
};

export type CouncilActivity = { clientId: string; dealId: string | null; occurredAt: string };

export type ForecastContractRow = ForecastContract & { clientId: string };

/** La web propia principal con sus series diarias (Search Console y GA4). */
export type SeoData = {
  propertyId: string;
  label: string;
  siteUrl: string | null;
  searchDays: SearchDay[];
  organicDays: WebDay[];
  allDays: WebDay[];
  /** Último día con datos (Google publica con 2-3 días de retraso). */
  lastDataOn: CivilDate | null;
};

/**
 * Lo que el consejo lee de la fase de control (gastos, caja, IVA y socios): la foto financiera de
 * src/domain/finance, la misma que pinta /finance. Una sola definición de caja, burn, costes fijos,
 * runway, IVA y previsión. null si la org no tiene el módulo de Finanzas (las tools lo dicen y
 * nunca se inventan la cifra); una foto sin saldos ni gastos también cuenta como "sin datos".
 */
export type FinanceData = FinanceSnapshot;

/** Un proyecto (tabla projects): de un cliente y, si lo hay, del contrato que lo paga; o interno. */
export type CouncilProject = {
  id: string;
  name: string;
  /** null: proyecto interno. */
  clientId: string | null;
  /** El contrato que lo paga: de él sale lo facturado (vista project_contract_revenue). */
  contractId: string | null;
  status: ProjectStatus;
  ownerMemberId: string | null;
  archived: boolean;
};

/** Un registro de horas cerrado (time_entries con minutos: los temporizadores en marcha no cuentan). */
export type CouncilTimeEntry = { memberId: string; projectId: string; workedOn: CivilDate; minutes: number; billable: boolean };

/**
 * Una línea facturada de un contrato: la vista project_contract_revenue, la ÚNICA definición de lo
 * facturado de un proyecto (base sin IVA de lo emitido; las rectificativas restan). Con el cliente
 * del contrato.
 */
export type CouncilContractRevenue = { contractId: string; clientId: string; issuedOn: CivilDate; baseCents: number };

/** Una tarea sin hacer (project_tasks con estado distinto de done). */
export type CouncilOpenTask = {
  id: string;
  projectId: string;
  assigneeMemberId: string | null;
  dueOn: CivilDate | null;
  estimateMinutes: number | null;
  status: Exclude<TaskStatus, "done">;
};

export interface CouncilData {
  org(): Promise<OrgInfo>;
  members(): Promise<MemberInfo[]>;
  issuers(): Promise<IssuerInfo[]>;
  contractLines(): Promise<CouncilLine[]>;
  forecastContracts(): Promise<ForecastContractRow[]>;
  revenueRows(from: Month, to: Month): Promise<RevenueRow[]>;
  clientRevenue(from: Month, to: Month): Promise<{ clientId: string; month: Month; cents: number }[]>;
  snapshots(from: Month, to: Month): Promise<SnapshotLike[]>;
  clients(): Promise<CouncilClient[]>;
  invoices(filter?: { statuses?: InvoiceStatus[]; issuedFrom?: CivilDate; issuedTo?: CivilDate }): Promise<CouncilInvoice[]>;
  openInvoicesOn(on: CivilDate): Promise<OpenInvoiceOn[]>;
  payments(from: CivilDate, to: CivilDate): Promise<CouncilPayment[]>;
  deals(): Promise<CouncilDeal[]>;
  stageHistory(): Promise<StageChange[]>;
  stages(): Promise<FunnelStage[]>;
  sources(): Promise<{ id: string; name: string }[]>;
  activities(since: string): Promise<CouncilActivity[]>;
  seo(from: CivilDate, to: CivilDate): Promise<SeoData | null>;
  finance(today: CivilDate): Promise<FinanceData | null>;
  /** Todos los proyectos de la org, también los archivados (sus horas se dedicaron igual). */
  projects(): Promise<CouncilProject[]>;
  /** Horas registradas entre dos fechas (ambas incluidas). */
  timeEntries(from: CivilDate, to: CivilDate): Promise<CouncilTimeEntry[]>;
  /** Lo facturado de cada contrato con fecha de emisión entre dos fechas (ambas incluidas). */
  contractRevenue(from: CivilDate, to: CivilDate): Promise<CouncilContractRevenue[]>;
  openTasks(): Promise<CouncilOpenTask[]>;
}
