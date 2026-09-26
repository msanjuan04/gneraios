// Datos del dashboard tal como los pinta la UI (serializables: pasan de servidor a cliente).
// Los carga src/server/metrics/dashboard.ts con la sesión del usuario (RLS).

import type { VerifactuCountdown } from "@/domain/fiscal/verifactu";
import type {
  CollectionStats,
  CronHealth,
  HistorySource,
  MonthMovements,
  MonthRevenue,
  Receivables,
  WeightedPipeline,
} from "@/domain/metrics";

export type MoneyFormat = { locale: string; currency: string };

export type HistoryPoint = MonthRevenue & {
  mrrCents: number;
  mrrSource: HistorySource;
  mrrEstimated: boolean;
};

export type ClientShareRow = {
  clientId: string;
  name: string;
  cents: number;
  shareBps: number;
};

export type ConcentrationView = {
  rows: ClientShareRow[];
  totalCents: number;
  top1ShareBps: number;
  top3ShareBps: number;
  alert: boolean;
  /** Clientes con facturación en el periodo (la lista muestra solo los primeros). */
  clientsCount: number;
};

export type RenewalRow = {
  lineId: string;
  contractId: string;
  clientName: string;
  description: string;
  renewsOn: string;
  daysLeft: number;
  amountCents: number;
};

export type OverdueRow = {
  invoiceId: string;
  number: string;
  clientName: string;
  dueOn: string;
  daysOverdue: number;
  outstandingCents: number;
};

export type StageRow = {
  stageId: string;
  name: string;
  deals: number;
  oneOffCents: number;
  mrrCents: number;
  weightedOneOffCents: number;
  weightedMrrCents: number;
};

export type VerifactuRow = {
  issuerId: string;
  name: string;
  verifactuFrom: string;
  countdown: VerifactuCountdown;
};

export type DashboardView = {
  basePath: string;
  firstName: string;
  /** Hoy en la zona de la org (YYYY-MM-DD) y la hora local, para el saludo. */
  today: string;
  hour: number;
  money: MoneyFormat;
  mrr: {
    cents: number;
    /** Al cierre del mes anterior (foto o reconstrucción). */
    previousCents: number;
    previousEstimated: boolean;
    /** Últimos 12 meses, el último es hoy. */
    sparkline: { month: string; cents: number; estimated: boolean }[];
  };
  arr: {
    cents: number;
    /** ARR al cierre del mismo mes del año anterior; null si no había MRR. */
    yearAgoCents: number | null;
  };
  revenue: { current: MonthRevenue; previous: MonthRevenue; lastYear: MonthRevenue };
  receivables: Receivables;
  collection: CollectionStats;
  pipeline: WeightedPipeline;
  clients: {
    active: number;
    paused: number;
    former: number;
    leads: number;
    /** Activos al cierre del mes anterior. */
    activePrevious: number | null;
  };
  /** 24 meses, el último es el mes en curso. */
  history: HistoryPoint[];
  /** Movimientos de MRR de los mismos 24 meses. */
  movements: MonthMovements[];
  topClients: { lastYear: ConcentrationView; allTime: ConcentrationView; thresholdBps: number };
  renewals: RenewalRow[];
  renewalWindowDays: number;
  overdue: { rows: OverdueRow[]; count: number };
  stages: StageRow[];
  health: {
    /** Instante (ISO) en que se calcularon estos datos: la referencia de "hace X h". */
    checkedAt: string;
    cron: CronHealth;
    verifactu: VerifactuRow[];
    drafts: number;
    remindersToApprove: number;
  };
};
