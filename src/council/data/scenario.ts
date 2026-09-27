// Escenarios compactos para tests y evals: clientes con sus líneas de contrato y, a partir de
// ellas, las facturas que habría emitido el motor (periodsDue con los mismos prorrateos), cobradas
// a los 15 días salvo las que el escenario marca como impagadas. Así un escenario describe el
// negocio una sola vez y las facturas, los ingresos y los cobros salen de ahí. Los proyectos
// describen sus horas en forma compacta (tantos minutos cada día laborable entre dos fechas).

import { periodAmountCents, periodsDue } from "@/domain/billing/schedule";
import { addDays, compareCivil, parseCivilDate, type CivilDate } from "@/domain/dates/civil-date";
import { lineBaseCents } from "@/domain/metrics";
import type { CouncilFixture, FixtureFinance, FixtureInvoice, FixtureLine, FixtureProject, FixtureTask } from "./fixture";
import type { CouncilActivity, CouncilClient, CouncilTimeEntry, IssuerInfo, MemberInfo, SeoData } from "./types";
import type { FixtureDeal } from "./fixture";
import type { FunnelStage, StageChange } from "@/domain/pipeline";
import type { SnapshotLike } from "@/domain/metrics";

export type ScenarioLine = Omit<FixtureLine, "clientId"> & {
  /** Líneas por uso: fechas en que se registró un uso (se factura ese día). */
  usages?: CivilDate[];
};

export type ScenarioClient = Partial<Omit<CouncilClient, "id" | "name">> & {
  id: string;
  name: string;
  lines?: ScenarioLine[];
  /** Facturas sin cobrar: `<id de línea>@<AAAA-MM>` (la del periodo que empieza ese mes). */
  unpaid?: string[];
};

export type ScenarioProject = FixtureProject & {
  /** Horas: `minutesPerDay` cada día laborable (de lunes a viernes) entre `from` y `to`, ambos incluidos. */
  hours?: { memberId: string; from: CivilDate; to: CivilDate; minutesPerDay: number; billable?: boolean }[];
  /** Registros sueltos. */
  entries?: { memberId: string; on: CivilDate; minutes: number; billable?: boolean }[];
  tasks?: Omit<FixtureTask, "projectId">[];
};

export type Scenario = {
  today: CivilDate;
  clients: ScenarioClient[];
  org?: CouncilFixture["org"];
  members?: MemberInfo[];
  issuers?: IssuerInfo[];
  milestones?: CouncilFixture["milestones"];
  invoices?: FixtureInvoice[];
  snapshots?: SnapshotLike[];
  deals?: FixtureDeal[];
  stages?: FunnelStage[];
  sources?: { id: string; name: string }[];
  history?: StageChange[];
  activities?: CouncilActivity[];
  seo?: SeoData | null;
  finance?: FixtureFinance | null;
  /** Proyectos con sus horas y sus tareas. */
  projects?: ScenarioProject[];
  /** Días que se tarda en cobrar cada factura (15 por defecto). */
  paymentDays?: number;
};

const monthKey = (date: CivilDate) => date.slice(0, 7);

/** Las facturas que el motor habría emitido para las líneas del escenario hasta hoy. */
function invoicesFor(client: ScenarioClient, today: CivilDate, paymentDays: number, counter: { n: number }): FixtureInvoice[] {
  const invoices: FixtureInvoice[] = [];
  const unpaid = new Set(client.unpaid ?? []);
  const push = (lineId: string, issuedOn: CivilDate, billingType: FixtureLine["billingType"], baseCents: number) => {
    if (compareCivil(issuedOn, today) > 0 || baseCents === 0) return;
    counter.n += 1;
    const paidOn = addDays(issuedOn, paymentDays);
    const isUnpaid = unpaid.has(`${lineId}@${monthKey(issuedOn)}`);
    invoices.push({
      id: `inv-${lineId}-${issuedOn}`,
      number: `F${issuedOn.slice(0, 4)}-${String(counter.n).padStart(4, "0")}`,
      clientId: client.id,
      issuedOn,
      dueOn: addDays(issuedOn, 30),
      lines: [{ billingType, baseCents, contractLineId: lineId }],
      payments: isUnpaid || compareCivil(paidOn, today) > 0 ? [] : [{ paidOn, amountCents: Math.round(baseCents * 1.21) }],
    });
  };
  for (const line of client.lines ?? []) {
    const quantity = line.quantity ?? "1";
    const discountBps = line.discountBps ?? 0;
    if (line.billingType === "monthly" || line.billingType === "yearly") {
      const startsOn = line.startsOn ?? line.signedOn;
      const periods = periodsDue(
        { billingType: line.billingType, startsOn, endsOn: line.endsOn ?? null, billingDay: line.billingDay ?? 1, prorateFirst: line.prorateFirst ?? false },
        line.pauses ?? [],
        new Set(),
        today,
      );
      for (const period of periods) {
        const unit = period.activeDays === period.cycleDays ? line.unitPriceCents : periodAmountCents(line.unitPriceCents, period);
        push(line.id, period.billableOn, line.billingType, lineBaseCents({ quantity, unitPriceCents: unit, discountBps }));
      }
    } else if (line.billingType === "usage") {
      for (const day of line.usages ?? []) push(line.id, day, "usage", lineBaseCents({ quantity, unitPriceCents: line.unitPriceCents, discountBps }));
    } else {
      push(line.id, line.startsOn ?? line.signedOn, "one_off", lineBaseCents({ quantity, unitPriceCents: line.unitPriceCents, discountBps }));
    }
  }
  return invoices;
}

const isWorkday = (date: CivilDate) => {
  const { year, month, day } = parseCivilDate(date);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0 = domingo
  return weekday >= 1 && weekday <= 5;
};

/** Los registros de horas de un proyecto del escenario (nunca después de hoy). */
function entriesFor(project: ScenarioProject, today: CivilDate): CouncilTimeEntry[] {
  const out: CouncilTimeEntry[] = [];
  for (const block of project.hours ?? []) {
    for (let day = block.from; compareCivil(day, block.to) <= 0 && compareCivil(day, today) <= 0; day = addDays(day, 1)) {
      if (isWorkday(day)) out.push({ memberId: block.memberId, projectId: project.id, workedOn: day, minutes: block.minutesPerDay, billable: block.billable ?? true });
    }
  }
  for (const entry of project.entries ?? []) {
    if (compareCivil(entry.on, today) <= 0) out.push({ memberId: entry.memberId, projectId: project.id, workedOn: entry.on, minutes: entry.minutes, billable: entry.billable ?? true });
  }
  return out;
}

/** Del escenario compacto al fixture completo que lee FixtureCouncilData. */
export function buildFixture(scenario: Scenario): CouncilFixture {
  const counter = { n: 0 };
  const generated = scenario.clients.flatMap((c) => invoicesFor(c, scenario.today, scenario.paymentDays ?? 15, counter));
  const projects = scenario.projects ?? [];
  return {
    today: scenario.today,
    org: scenario.org,
    members: scenario.members,
    issuers: scenario.issuers,
    clients: scenario.clients.map((c) => {
      const client: Partial<ScenarioClient> = { ...c };
      delete client.lines;
      delete client.unpaid;
      return client as Omit<ScenarioClient, "lines" | "unpaid">;
    }),
    lines: scenario.clients.flatMap((c) =>
      (c.lines ?? []).map((l) => {
        const line: Partial<typeof l> = { ...l };
        delete line.usages;
        return { ...(line as Omit<typeof l, "usages">), clientId: c.id };
      }),
    ),
    milestones: scenario.milestones,
    invoices: [...generated, ...(scenario.invoices ?? [])].sort((a, b) => compareCivil(a.issuedOn, b.issuedOn)),
    snapshots: scenario.snapshots,
    deals: scenario.deals,
    stages: scenario.stages,
    sources: scenario.sources,
    history: scenario.history,
    activities: scenario.activities,
    seo: scenario.seo,
    finance: scenario.finance,
    projects: projects.map((p) => {
      const project: Partial<ScenarioProject> = { ...p };
      delete project.hours;
      delete project.entries;
      delete project.tasks;
      return project as FixtureProject;
    }),
    timeEntries: projects.flatMap((p) => entriesFor(p, scenario.today)),
    tasks: projects.flatMap((p) => (p.tasks ?? []).map((t) => ({ ...t, projectId: p.id }))),
  };
}
