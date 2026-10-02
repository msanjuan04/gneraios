// CouncilData en memoria para los tests y los evals: un negocio descrito en JSON (clientes, líneas
// de contrato, facturas, deals…). Lo que en la base de datos es una vista derivada aquí también se
// deriva de los mismos datos (ingresos por mes desde las facturas, estado del cliente desde sus
// líneas, pendiente desde los cobros, lo facturado de cada contrato desde las líneas de sus
// facturas), para que un escenario no escriba nada dos veces.

import type { ForecastContract } from "@/domain/billing/forecast";
import { buildFinanceSnapshot, type ExpenseGroup } from "@/domain/finance";
import { periodsDue, type Pause } from "@/domain/billing/schedule";
import { addDays, compareCivil, type CivilDate } from "@/domain/dates/civil-date";
import type { BillingType, ClientStatus, InvoiceStatus, Month, RevenueRow, SnapshotLike } from "@/domain/metrics";
import { monthOf, monthsEndingAt } from "@/domain/metrics";
import type { FunnelStage, StageChange } from "@/domain/pipeline";
import type { TaskStatus } from "@/domain/projects";
import type {
  CouncilActivity,
  CouncilClient,
  CouncilContractRevenue,
  CouncilData,
  CouncilDeal,
  CouncilInvoice,
  CouncilLine,
  CouncilOpenTask,
  CouncilPayment,
  CouncilProject,
  CouncilTimeEntry,
  FinanceData,
  ForecastContractRow,
  IssuerInfo,
  MemberInfo,
  OpenInvoiceOn,
  OrgInfo,
  SeoData,
} from "./types";

export type FixtureLine = {
  id: string;
  clientId: string;
  contractId?: string;
  contractTitle?: string;
  signedOn: CivilDate;
  archivedOn?: CivilDate | null;
  description: string;
  billingType: BillingType;
  quantity?: string;
  unitPriceCents: number;
  discountBps?: number;
  startsOn?: CivilDate | null;
  endsOn?: CivilDate | null;
  billingDay?: number;
  prorateFirst?: boolean;
  pauses?: Pause[];
};

export type FixtureInvoice = {
  id: string;
  number?: string;
  clientId: string;
  issuerId?: string;
  kind?: "ordinary" | "rectifying";
  issuedOn: CivilDate;
  dueOn?: CivilDate;
  /**
   * Líneas (base sin IVA por tipo). El IVA es el 21 % salvo que se diga. `contractLineId`: la línea
   * de contrato de la que sale (lo facturado de un proyecto se deriva de aquí, como en la vista
   * project_contract_revenue).
   */
  lines: { billingType: BillingType; baseCents: number; vatBps?: number; irpfBps?: number; contractLineId?: string }[];
  payments?: { paidOn: CivilDate; amountCents: number }[];
};

export type FixtureProject = Partial<Omit<CouncilProject, "id" | "name">> & { id: string; name: string };

/** Una tarea de un proyecto (también las hechas: openTasks las deja fuera, como la consulta de verdad). */
export type FixtureTask = Partial<Omit<CouncilOpenTask, "id" | "projectId" | "status">> & { id: string; projectId: string; status?: TaskStatus };

export type FixtureDeal = Partial<CouncilDeal> & { id: string; title: string; clientId: string; stageId: string };

/**
 * Finanzas de un escenario en forma compacta: saldos, gastos por mes y participaciones. La foto se
 * construye con buildFinanceSnapshot (src/domain/finance), la misma función que usa /finance.
 */
export type FixtureFinance = {
  accounts: { id: string; name: string; issuerId?: string; balanceOn: CivilDate; balanceCents: number; isActive?: boolean }[];
  expenses: { month: Month; group?: ExpenseGroup; isFixed?: boolean; costCents: number; inputVatCents?: number; withheldCents?: number; issuerId?: string }[];
  shareholdings?: { memberId: string; percentBps: number }[];
  pendingExpenses?: { id: string; label: string; payableOn: CivilDate; totalCents: number; issuerId?: string }[];
};

export type CouncilFixture = {
  today: CivilDate;
  org?: Partial<OrgInfo>;
  members?: MemberInfo[];
  issuers?: IssuerInfo[];
  clients?: (Partial<CouncilClient> & { id: string; name: string })[];
  lines?: FixtureLine[];
  milestones?: { id: string; contractId: string; position: number; percentBps: number; plannedOn: CivilDate | null; billed?: boolean }[];
  invoices?: FixtureInvoice[];
  snapshots?: SnapshotLike[];
  deals?: FixtureDeal[];
  stages?: FunnelStage[];
  sources?: { id: string; name: string }[];
  history?: StageChange[];
  activities?: CouncilActivity[];
  seo?: SeoData | null;
  finance?: FixtureFinance | null;
  projects?: FixtureProject[];
  timeEntries?: CouncilTimeEntry[];
  tasks?: FixtureTask[];
};

export const DEFAULT_STAGES: FunnelStage[] = [
  { id: "stage-lead", name: "Lead", position: 1, kind: "open" },
  { id: "stage-meeting", name: "Reunión", position: 2, kind: "open" },
  { id: "stage-proposal", name: "Propuesta enviada", position: 3, kind: "open" },
  { id: "stage-negotiation", name: "Negociación", position: 4, kind: "open" },
  { id: "stage-won", name: "Ganado", position: 5, kind: "won" },
  { id: "stage-lost", name: "Perdido", position: 6, kind: "lost" },
  { id: "stage-active", name: "Activo", position: 7, kind: "won" },
];

const STAGE_PROBABILITY: Record<string, number> = {
  "stage-lead": 1000,
  "stage-meeting": 2500,
  "stage-proposal": 5000,
  "stage-negotiation": 7500,
  "stage-won": 10_000,
  "stage-lost": 0,
  "stage-active": 10_000,
};

const DEFAULT_ISSUER: IssuerInfo = {
  id: "issuer-sl",
  name: "GNERAI SL",
  kind: "company",
  verifactuFrom: "2027-01-01",
  fiscalProvider: "internal",
  activeFrom: "2026-01-01",
  activeUntil: null,
};

const roundBps = (cents: number, bps: number) => Math.round((cents * bps) / 10_000);

function toLine(line: FixtureLine): CouncilLine {
  return {
    id: line.id,
    contractId: line.contractId ?? `contract-${line.id}`,
    contractTitle: line.contractTitle ?? line.description,
    clientId: line.clientId,
    signedOn: line.signedOn,
    archivedOn: line.archivedOn ?? null,
    description: line.description,
    billingType: line.billingType,
    quantity: line.quantity ?? "1",
    unitPriceCents: line.unitPriceCents,
    discountBps: line.discountBps ?? 0,
    startsOn: line.startsOn === undefined ? (line.billingType === "one_off" || line.billingType === "usage" ? null : line.signedOn) : line.startsOn,
    endsOn: line.endsOn ?? null,
    pauses: line.pauses ?? [],
    billingDay: line.billingDay ?? 1,
    prorateFirst: line.prorateFirst ?? false,
  };
}

/** Estado de un cliente con las reglas de clients_overview, desde sus líneas recurrentes. */
function statusFrom(lines: readonly CouncilLine[], today: CivilDate): ClientStatus {
  const live = lines.filter((l) => compareCivil(l.signedOn, today) <= 0 && l.archivedOn === null);
  if (live.length === 0) return "lead";
  const recurring = live.filter((l) => l.billingType === "monthly" || l.billingType === "yearly");
  const alive = recurring.filter((l) => l.endsOn === null || compareCivil(today, l.endsOn) <= 0);
  const paused = (l: CouncilLine) => l.pauses.some((p) => compareCivil(p.startsOn, today) <= 0 && (p.endsOn === null || compareCivil(today, p.endsOn) <= 0));
  if (alive.some((l) => !paused(l))) return "active";
  if (alive.length > 0) return "paused";
  return "former";
}

export class FixtureCouncilData implements CouncilData {
  private readonly lines: CouncilLine[];
  private readonly invoicesAll: CouncilInvoice[];
  private readonly paymentsAll: CouncilPayment[];
  /** Facturas del escenario con las rectificativas en negativo. */
  private readonly source: FixtureInvoice[];

  constructor(private readonly fixture: CouncilFixture) {
    this.lines = (fixture.lines ?? []).map(toLine);
    this.source = (fixture.invoices ?? []).map((inv) => {
      const sign = inv.kind === "rectifying" ? -1 : 1;
      return { ...inv, lines: inv.lines.map((l) => ({ ...l, baseCents: sign * Math.abs(l.baseCents) })) };
    });
    const clientName = (id: string) => fixture.clients?.find((c) => c.id === id)?.name ?? "—";
    const issuerName = (id: string) => (fixture.issuers ?? [DEFAULT_ISSUER]).find((i) => i.id === id)?.name ?? "—";
    this.paymentsAll = [];
    this.invoicesAll = this.source.map((inv) => {
      const subtotal = inv.lines.reduce((s, l) => s + l.baseCents, 0);
      const vat = inv.lines.reduce((s, l) => s + roundBps(l.baseCents, l.vatBps ?? 2100), 0);
      const irpf = inv.lines.reduce((s, l) => s + roundBps(l.baseCents, l.irpfBps ?? 0), 0);
      const total = subtotal + vat - irpf;
      const paid = (inv.payments ?? []).filter((p) => compareCivil(p.paidOn, fixture.today) <= 0);
      for (const p of paid) this.paymentsAll.push({ invoiceId: inv.id, clientId: inv.clientId, amountCents: p.amountCents, paidOn: p.paidOn });
      const paidCents = paid.reduce((s, p) => s + p.amountCents, 0);
      const kind = inv.kind ?? "ordinary";
      const dueOn = inv.dueOn ?? addDays(inv.issuedOn, 30);
      const status: InvoiceStatus =
        kind === "rectifying"
          ? "issued"
          : total === 0
            ? "voided"
            : paidCents >= total
              ? "paid"
              : compareCivil(dueOn, fixture.today) < 0
                ? "overdue"
                : "issued";
      return {
        id: inv.id,
        number: inv.number ?? inv.id,
        clientId: inv.clientId,
        clientName: clientName(inv.clientId),
        issuerId: inv.issuerId ?? DEFAULT_ISSUER.id,
        issuerName: issuerName(inv.issuerId ?? DEFAULT_ISSUER.id),
        kind,
        status,
        issuedOn: inv.issuedOn,
        dueOn,
        subtotalCents: subtotal,
        vatCents: vat,
        irpfCents: irpf,
        totalCents: total,
        outstandingCents: kind === "ordinary" ? total - paidCents : 0,
        paidCents,
        lastPaidOn: paid.map((p) => p.paidOn).sort().at(-1) ?? null,
      };
    });
  }

  async org(): Promise<OrgInfo> {
    return { id: "org-fixture", name: "GNERAI", slug: "gnerai", timezone: "Europe/Madrid", locale: "es-ES", currency: "EUR", settings: {}, ...this.fixture.org };
  }

  async members(): Promise<MemberInfo[]> {
    return this.fixture.members ?? [];
  }

  async issuers(): Promise<IssuerInfo[]> {
    return this.fixture.issuers ?? [DEFAULT_ISSUER];
  }

  async contractLines(): Promise<CouncilLine[]> {
    return this.lines;
  }

  async forecastContracts(): Promise<ForecastContractRow[]> {
    const byContract = new Map<string, CouncilLine[]>();
    for (const line of this.lines) {
      if (line.archivedOn !== null) continue;
      byContract.set(line.contractId, [...(byContract.get(line.contractId) ?? []), line]);
    }
    const yesterday = addDays(this.fixture.today, -1);
    return [...byContract].map(([contractId, lines]): ForecastContractRow => {
      // Lo vencido hasta ayer ya lo facturó el cron; la previsión empieza hoy.
      const billedStarts = new Map<string, Set<string>>();
      for (const line of lines) {
        if ((line.billingType !== "monthly" && line.billingType !== "yearly") || !line.startsOn) continue;
        const periods = periodsDue(
          { billingType: line.billingType, startsOn: line.startsOn, endsOn: line.endsOn, billingDay: line.billingDay ?? 1, prorateFirst: line.prorateFirst },
          line.pauses,
          new Set(),
          yesterday,
        );
        billedStarts.set(line.id, new Set(periods.map((p) => p.start)));
      }
      const milestones = (this.fixture.milestones ?? []).filter((mm) => mm.contractId === contractId);
      const contract: ForecastContract = {
        id: contractId,
        signedOn: lines[0]!.signedOn,
        lines: lines.map((l) => ({
          id: l.id,
          billingType: l.billingType,
          quantity: l.quantity,
          unitPriceCents: l.unitPriceCents,
          discountBps: l.discountBps,
          startsOn: l.startsOn,
          endsOn: l.endsOn,
          billingDay: l.billingDay,
          prorateFirst: l.prorateFirst,
          pauses: l.pauses.map((p) => ({ ...p })),
        })),
        milestones: milestones.map((mm) => ({ id: mm.id, position: mm.position, percentBps: mm.percentBps, plannedOn: mm.plannedOn })),
        billedMilestoneIds: new Set(milestones.filter((mm) => mm.billed).map((mm) => mm.id)),
        billedStarts,
      };
      return { ...contract, clientId: lines[0]!.clientId };
    });
  }

  private issued(): CouncilInvoice[] {
    return this.invoicesAll.filter((i) => i.issuedOn !== null && compareCivil(i.issuedOn, this.fixture.today) <= 0);
  }

  async revenueRows(from: Month, to: Month): Promise<RevenueRow[]> {
    const rows = new Map<string, RevenueRow>();
    for (const inv of this.source) {
      if (compareCivil(inv.issuedOn, this.fixture.today) > 0) continue;
      const month = monthOf(inv.issuedOn);
      if (compareCivil(month, from) < 0 || compareCivil(month, to) > 0) continue;
      for (const line of inv.lines) {
        const key = `${month}:${line.billingType}`;
        const row = rows.get(key) ?? { month, billingType: line.billingType, baseCents: 0 };
        row.baseCents += line.baseCents;
        rows.set(key, row);
      }
    }
    return [...rows.values()];
  }

  async clientRevenue(from: Month, to: Month): Promise<{ clientId: string; month: Month; cents: number }[]> {
    const rows = new Map<string, { clientId: string; month: Month; cents: number }>();
    for (const inv of this.issued()) {
      const month = monthOf(inv.issuedOn!);
      if (compareCivil(month, from) < 0 || compareCivil(month, to) > 0) continue;
      const key = `${inv.clientId}:${month}`;
      const row = rows.get(key) ?? { clientId: inv.clientId, month, cents: 0 };
      row.cents += inv.subtotalCents;
      rows.set(key, row);
    }
    return [...rows.values()];
  }

  async snapshots(from: Month, to: Month): Promise<SnapshotLike[]> {
    return (this.fixture.snapshots ?? []).filter((s) => compareCivil(s.month, from) >= 0 && compareCivil(s.month, to) <= 0);
  }

  async clients(): Promise<CouncilClient[]> {
    return (this.fixture.clients ?? []).map((c) => {
      const lines = this.lines.filter((l) => l.clientId === c.id);
      const invoices = this.issued().filter((i) => i.clientId === c.id);
      return {
        id: c.id,
        name: c.name,
        status: c.status ?? statusFrom(lines, this.fixture.today),
        billedNetCents: c.billedNetCents ?? invoices.reduce((s, i) => s + i.subtotalCents, 0),
        firstInvoiceOn: c.firstInvoiceOn ?? invoices.map((i) => i.issuedOn!).sort()[0] ?? null,
        lastActivityAt:
          c.lastActivityAt ??
          (this.fixture.activities ?? [])
            .filter((a) => a.clientId === c.id)
            .map((a) => a.occurredAt)
            .sort()
            .at(-1) ??
          null,
        ownerMemberId: c.ownerMemberId ?? null,
        sourceId: c.sourceId ?? null,
        createdAt: c.createdAt ?? "2025-01-01T09:00:00Z",
        archived: c.archived ?? false,
      };
    });
  }

  async invoices(filter: { statuses?: InvoiceStatus[]; issuedFrom?: CivilDate; issuedTo?: CivilDate } = {}): Promise<CouncilInvoice[]> {
    return this.issued().filter(
      (i) =>
        (!filter.statuses || filter.statuses.includes(i.status)) &&
        (!filter.issuedFrom || compareCivil(i.issuedOn!, filter.issuedFrom) >= 0) &&
        (!filter.issuedTo || compareCivil(i.issuedOn!, filter.issuedTo) <= 0),
    );
  }

  async openInvoicesOn(on: CivilDate): Promise<OpenInvoiceOn[]> {
    const out: OpenInvoiceOn[] = [];
    for (const inv of this.source) {
      if ((inv.kind ?? "ordinary") !== "ordinary" || compareCivil(inv.issuedOn, on) > 0) continue;
      const row = this.invoicesAll.find((i) => i.id === inv.id)!;
      const paid = (inv.payments ?? []).filter((p) => compareCivil(p.paidOn, on) <= 0).reduce((s, p) => s + p.amountCents, 0);
      const outstanding = row.totalCents - paid;
      if (outstanding <= 0) continue;
      out.push({ id: inv.id, clientId: inv.clientId, dueOn: row.dueOn, outstandingCents: outstanding, status: row.dueOn && compareCivil(row.dueOn, on) < 0 ? "overdue" : "issued" });
    }
    return out;
  }

  async payments(from: CivilDate, to: CivilDate): Promise<CouncilPayment[]> {
    return this.paymentsAll.filter((p) => compareCivil(p.paidOn, from) >= 0 && compareCivil(p.paidOn, to) <= 0);
  }

  async deals(): Promise<CouncilDeal[]> {
    const stages = this.fixture.stages ?? DEFAULT_STAGES;
    return (this.fixture.deals ?? []).map((d) => ({
      clientName: this.fixture.clients?.find((c) => c.id === d.clientId)?.name ?? "—",
      stageKind: stages.find((s) => s.id === d.stageId)?.kind ?? "open",
      estOneOffCents: 0,
      estMrrCents: 0,
      probabilityBps: STAGE_PROBABILITY[d.stageId] ?? 0,
      sourceId: null,
      broughtByMemberId: null,
      ownerMemberId: null,
      nextAction: null,
      nextActionOn: null,
      lossReasonId: null,
      createdAt: "2026-01-01T09:00:00Z",
      stageEnteredAt: d.createdAt ?? "2026-01-01T09:00:00Z",
      ...d,
    }));
  }

  async stageHistory(): Promise<StageChange[]> {
    return this.fixture.history ?? [];
  }

  async stages(): Promise<FunnelStage[]> {
    return this.fixture.stages ?? DEFAULT_STAGES;
  }

  async sources(): Promise<{ id: string; name: string }[]> {
    return this.fixture.sources ?? [];
  }

  async activities(since: string): Promise<CouncilActivity[]> {
    return (this.fixture.activities ?? []).filter((a) => a.occurredAt >= since);
  }

  async seo(): Promise<SeoData | null> {
    return this.fixture.seo ?? null;
  }

  async finance(today: CivilDate): Promise<FinanceData | null> {
    const f = this.fixture.finance;
    if (!f) return null;
    const months = monthsEndingAt(monthOf(today), 12);
    const issuerOf = new Map(this.invoicesAll.map((i) => [i.id, i.issuerId]));
    const issued = this.issued();
    const open = issued.filter((i) => i.kind === "ordinary" && (i.status === "issued" || i.status === "overdue"));
    return buildFinanceSnapshot({
      today,
      months,
      revenueRows: await this.revenueRows(months[0]!, months.at(-1)!),
      expenseRows: f.expenses.map((e) => ({ month: e.month, expenseGroup: e.group ?? "operating", isFixed: e.isFixed ?? false, costCents: e.costCents })),
      outputVat: issued.map((i) => ({ issuerId: i.issuerId, on: i.issuedOn!, cents: i.vatCents })),
      inputVat: f.expenses.filter((e) => e.inputVatCents).map((e) => ({ issuerId: e.issuerId ?? DEFAULT_ISSUER.id, on: e.month, cents: e.inputVatCents! })),
      withholdings: f.expenses.filter((e) => e.withheldCents).map((e) => ({ issuerId: e.issuerId ?? DEFAULT_ISSUER.id, on: e.month, cents: e.withheldCents! })),
      accounts: f.accounts.map((a) => ({ accountId: a.id, issuerId: a.issuerId ?? DEFAULT_ISSUER.id, isActive: a.isActive ?? true, balanceOn: a.balanceOn, balanceCents: a.balanceCents, name: a.name })),
      movements: this.paymentsAll.map((p) => ({ accountId: null, issuerId: issuerOf.get(p.invoiceId) ?? DEFAULT_ISSUER.id, on: p.paidOn, cents: p.amountCents })),
      subscriptions: [],
      generatedStarts: new Map(),
      fixedCategoryIds: new Set(),
      pendingExpenses: (f.pendingExpenses ?? []).map((x) => ({ id: x.id, issuerId: x.issuerId ?? DEFAULT_ISSUER.id, label: x.label, payableOn: x.payableOn, totalCents: x.totalCents })),
      receivables: open.map((i) => ({ invoiceId: i.id, issuerId: i.issuerId, number: i.number, clientName: i.clientName, dueOn: i.dueOn, outstandingCents: i.outstandingCents })),
      billing: [],
      shareholdings: { validFrom: null, rows: f.shareholdings ?? [] },
    });
  }

  async projects(): Promise<CouncilProject[]> {
    return (this.fixture.projects ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      clientId: p.clientId ?? null,
      contractId: p.contractId ?? null,
      status: p.status ?? "active",
      ownerMemberId: p.ownerMemberId ?? null,
      archived: p.archived ?? false,
    }));
  }

  async timeEntries(from: CivilDate, to: CivilDate): Promise<CouncilTimeEntry[]> {
    return (this.fixture.timeEntries ?? []).filter((e) => compareCivil(e.workedOn, from) >= 0 && compareCivil(e.workedOn, to) <= 0);
  }

  /** Como la vista project_contract_revenue: la base de cada línea emitida que sale de una línea de contrato. */
  async contractRevenue(from: CivilDate, to: CivilDate): Promise<CouncilContractRevenue[]> {
    const contractOf = new Map(this.lines.map((l) => [l.id, l.contractId]));
    const out: CouncilContractRevenue[] = [];
    for (const inv of this.source) {
      if (compareCivil(inv.issuedOn, this.fixture.today) > 0 || compareCivil(inv.issuedOn, from) < 0 || compareCivil(inv.issuedOn, to) > 0) continue;
      for (const line of inv.lines) {
        const contractId = line.contractLineId ? contractOf.get(line.contractLineId) : undefined;
        if (contractId) out.push({ contractId, clientId: inv.clientId, issuedOn: inv.issuedOn, baseCents: line.baseCents });
      }
    }
    return out;
  }

  async openTasks(): Promise<CouncilOpenTask[]> {
    return (this.fixture.tasks ?? []).flatMap((t) => {
      const status = t.status ?? "todo";
      if (status === "done") return [];
      return [{ id: t.id, projectId: t.projectId, assigneeMemberId: t.assigneeMemberId ?? null, dueOn: t.dueOn ?? null, estimateMinutes: t.estimateMinutes ?? null, status }];
    });
  }
}
