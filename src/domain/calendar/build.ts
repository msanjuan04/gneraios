// De las filas de cada fuente a eventos del calendario. Cada evento sale de una fecha que ya
// existe en una sola tabla (o que se deriva, como la facturación prevista con el mismo
// calendario que factura el cron), así que no hay nada que mantener sincronizado.
//
// Los estados se derivan aquí con `today` (fecha civil de la org), como en el resto de la app.

import { splitByMilestones, validateMilestones } from "../billing/milestones";
import { periodAmountCents, periodsDue, type Pause } from "../billing/schedule";
import { compareCivil, daysBetween, maxCivil, type CivilDate } from "../dates/civil-date";
import { dateInZone, toDateTimeLocal } from "../dates/zoned-time";
import { lineBaseCents } from "../metrics/mrr";
import type { Cents } from "../money";
import type { ProjectStatus, TaskStatus } from "../projects/types";
import type { CalendarEvent, CalendarEventStatus, CalendarFact, CalendarLink } from "./types";

export type BuildRange = {
  from: CivilDate;
  to: CivilDate;
  /** Hoy en la zona de la org. */
  today: CivilDate;
  /** Además del rango, lo atrasado de antes que aún pide algo (la agenda lo enseña arriba). */
  includeOverdue?: boolean;
};

type BillingType = "one_off" | "monthly" | "yearly" | "usage";

const clientLink = (clientId: string): CalendarLink => ({ key: "client", href: `/clients/${clientId}` });
const within = (date: CivilDate, { from, to }: BuildRange) => compareCivil(date, from) >= 0 && compareCivil(date, to) <= 0;

/** Algo que pide una acción en su fecha: vencido si ya pasó, pendiente si es hoy. */
function actionStatus(date: CivilDate, today: CivilDate): CalendarEventStatus {
  const diff = compareCivil(date, today);
  return diff < 0 ? "overdue" : diff === 0 ? "pending" : "scheduled";
}

/** En el rango o, si se pide, atrasado de antes (y aún sin resolver: lo decide quien llama). */
function inWindow(date: CivilDate, range: BuildRange): boolean {
  return within(date, range) || (range.includeOverdue === true && compareCivil(date, range.from) < 0 && compareCivil(date, range.today) < 0);
}

function event(fields: Omit<CalendarEvent, "kind" | "time" | "startsAt" | "amountPeriod" | "movable" | "links"> & Partial<CalendarEvent>): CalendarEvent {
  return { kind: null, time: null, startsAt: null, amountPeriod: null, movable: false, links: [], ...fields };
}

/**
 * Un evento movible en su nueva fecha, con el estado que tendrá (para la vista optimista mientras
 * se guarda). Solo tiene sentido para los movibles: los que piden algo en su fecha. El retraso
 * se recalcula (o desaparece) con la fecha nueva.
 */
export function moveEvent(calendarEvent: CalendarEvent, date: CivilDate, today: CivilDate): CalendarEvent {
  if (!calendarEvent.movable) return calendarEvent;
  const late = daysBetween(date, today);
  const facts = calendarEvent.facts.flatMap((fact): CalendarFact[] => {
    if (fact.type === "date" && fact.value === calendarEvent.date) return [{ ...fact, value: date }];
    if (fact.type === "number" && fact.key === "daysOverdue") return late > 0 ? [{ ...fact, value: late }] : [];
    return [fact];
  });
  return { ...calendarEvent, date, status: actionStatus(date, today), facts };
}

// ---------------------------------------------------------------------------
// Facturas: cobros previstos y, como capa opcional, las emitidas
// ---------------------------------------------------------------------------

export type CalendarInvoice = {
  id: string;
  number: string | null;
  kind: "ordinary" | "rectifying";
  clientId: string;
  clientName: string;
  ownerMemberId: string | null;
  issuedOn: CivilDate | null;
  dueOn: CivilDate | null;
  /** Con IVA y neto de IRPF, como en invoices_overview. */
  totalCents: Cents;
  paidCents: Cents;
  outstandingCents: Cents;
};

/** Cobros previstos: el vencimiento de cada factura emitida con algo pendiente (vencida, en rojo). */
export function collectionEvents(invoices: readonly CalendarInvoice[], range: BuildRange): CalendarEvent[] {
  return invoices.flatMap((invoice) => {
    const { dueOn } = invoice;
    if (invoice.kind !== "ordinary" || invoice.outstandingCents <= 0 || dueOn === null || !inWindow(dueOn, range)) return [];
    const daysOverdue = daysBetween(dueOn, range.today);
    const facts: CalendarFact[] = [{ key: "client", type: "text", value: invoice.clientName }];
    if (invoice.issuedOn) facts.push({ key: "issuedOn", type: "date", value: invoice.issuedOn });
    facts.push({ key: "dueOn", type: "date", value: dueOn }, { key: "total", type: "money", value: invoice.totalCents });
    if (invoice.paidCents !== 0) facts.push({ key: "paid", type: "money", value: invoice.paidCents });
    facts.push({ key: "outstanding", type: "money", value: invoice.outstandingCents });
    if (daysOverdue > 0) facts.push({ key: "daysOverdue", type: "number", value: daysOverdue });
    return [
      event({
        id: `collection:${invoice.id}`,
        type: "collection",
        date: dueOn,
        title: invoice.number ?? "",
        subtitle: invoice.clientName,
        amountCents: invoice.outstandingCents,
        amountBasis: "gross",
        status: actionStatus(dueOn, range.today),
        ownerMemberId: invoice.ownerMemberId,
        href: `/invoices/${invoice.id}`,
        source: { table: "invoices", id: invoice.id },
        facts,
        links: [clientLink(invoice.clientId)],
      }),
    ];
  });
}

/** Facturas emitidas en su fecha de emisión (capa opcional: es historia, no pide nada). */
export function issuedEvents(invoices: readonly CalendarInvoice[], range: BuildRange): CalendarEvent[] {
  return invoices.flatMap((invoice) => {
    const { issuedOn } = invoice;
    if (issuedOn === null || !within(issuedOn, range)) return [];
    const facts: CalendarFact[] = [
      { key: "client", type: "text", value: invoice.clientName },
      { key: "total", type: "money", value: invoice.totalCents },
    ];
    if (invoice.kind === "ordinary" && invoice.dueOn) facts.push({ key: "dueOn", type: "date", value: invoice.dueOn });
    return [
      event({
        id: `issued:${invoice.id}`,
        type: "issued",
        kind: invoice.kind,
        date: issuedOn,
        title: invoice.number ?? "",
        subtitle: invoice.clientName,
        amountCents: invoice.totalCents,
        amountBasis: "gross",
        status: "done",
        ownerMemberId: invoice.ownerMemberId,
        href: `/invoices/${invoice.id}`,
        source: { table: "invoices", id: invoice.id },
        facts,
        links: [clientLink(invoice.clientId)],
      }),
    ];
  });
}

// ---------------------------------------------------------------------------
// Recordatorios de cobro por aprobar (outbound_emails en pending_approval)
// ---------------------------------------------------------------------------

export type CalendarReminder = {
  id: string;
  /** Día (en la zona de la org) en que el cron lo preparó. */
  preparedOn: CivilDate;
  template: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  clientId: string | null;
  clientName: string | null;
  ownerMemberId: string | null;
  outstandingCents: Cents | null;
  dueOn: CivilDate | null;
};

/** Un recordatorio por aprobar pide algo desde el día en que se preparó: nunca sale solo. */
export function reminderEvents(reminders: readonly CalendarReminder[], range: BuildRange): CalendarEvent[] {
  return reminders.flatMap((reminder) => {
    if (!inWindow(reminder.preparedOn, range)) return [];
    const facts: CalendarFact[] = [];
    if (reminder.clientName) facts.push({ key: "client", type: "text", value: reminder.clientName });
    if (reminder.invoiceNumber) facts.push({ key: "invoice", type: "text", value: reminder.invoiceNumber });
    if (reminder.dueOn) facts.push({ key: "dueOn", type: "date", value: reminder.dueOn });
    if (reminder.outstandingCents !== null) facts.push({ key: "outstanding", type: "money", value: reminder.outstandingCents });
    facts.push({ key: "preparedOn", type: "date", value: reminder.preparedOn });
    const links: CalendarLink[] = [];
    if (reminder.invoiceId) links.push({ key: "invoice", href: `/invoices/${reminder.invoiceId}` });
    if (reminder.clientId) links.push(clientLink(reminder.clientId));
    return [
      event({
        id: `reminder:${reminder.id}`,
        type: "reminder",
        kind: reminder.template,
        date: reminder.preparedOn,
        title: reminder.invoiceNumber ?? "",
        subtitle: reminder.clientName,
        amountCents: reminder.outstandingCents,
        amountBasis: reminder.outstandingCents === null ? null : "gross",
        status: actionStatus(reminder.preparedOn, range.today),
        ownerMemberId: reminder.ownerMemberId,
        href: "/invoices/outbox",
        source: { table: "outbound_emails", id: reminder.id },
        facts,
        links,
      }),
    ];
  });
}

// ---------------------------------------------------------------------------
// Contratos: facturación prevista, renovaciones, altas y bajas de líneas, hitos
// ---------------------------------------------------------------------------

export type CalendarContractLine = {
  id: string;
  description: string;
  billingType: BillingType;
  quantity: string | number;
  unitPriceCents: Cents;
  discountBps: number;
  startsOn: CivilDate | null;
  endsOn: CivilDate | null;
  billingDay: number | null;
  prorateFirst: boolean;
  cancelledOn: CivilDate | null;
  replacesLineId: string | null;
  pauses: readonly Pause[];
};

export type CalendarMilestone = {
  id: string;
  position: number;
  label: string;
  percentBps: number;
  plannedOn: CivilDate | null;
  auto: boolean;
  /** Lo que ya se ha preparado para facturarlo (billable_items), o null si aún nada. */
  billing: { state: "pending" | "drafted" | "invoiced" | "waived"; invoiceId: string | null; invoiceNumber: string | null } | null;
};

export type CalendarContract = {
  id: string;
  title: string;
  clientId: string;
  clientName: string;
  ownerMemberId: string | null;
  /** Solo se factura (y solo sale en el calendario) un contrato firmado. */
  signedOn: CivilDate | null;
  lines: readonly CalendarContractLine[];
  milestones: readonly CalendarMilestone[];
};

export type ContractEventOptions = {
  /** Periodos recurrentes que el cron ya ha preparado (billable_items.period_start), por línea. */
  preparedStarts: ReadonlyMap<string, ReadonlySet<CivilDate>>;
  /** Ventana de los avisos de renovación (la mayor de orgs.settings.renewal_alert_days). */
  renewalWindowDays: number;
};

const isRecurring = (type: BillingType): type is "monthly" | "yearly" => type === "monthly" || type === "yearly";

function linePeriodFor(type: BillingType): "month" | "year" | undefined {
  return type === "monthly" ? "month" : type === "yearly" ? "year" : undefined;
}

/**
 * La facturación que el cron va a preparar (el mismo calendario que factura: periodsDue), desde
 * hoy: la mensual (y el primer periodo de una anual) agrupada por contrato y día, y cada
 * renovación anual por separado. Lo ya preparado por el cron no se repite.
 */
function billingEvents(contract: CalendarContract, range: BuildRange, options: ContractEventOptions): CalendarEvent[] {
  const lower = maxCivil(range.from, range.today);
  if (compareCivil(lower, range.to) > 0) return [];
  const events: CalendarEvent[] = [];
  const byDay = new Map<CivilDate, { cents: Cents; items: CalendarFact[]; start: CivilDate; end: CivilDate }>();

  for (const line of contract.lines) {
    if (!isRecurring(line.billingType) || line.startsOn === null) continue;
    const recurring = {
      billingType: line.billingType,
      startsOn: line.startsOn,
      endsOn: line.endsOn,
      billingDay: line.billingDay ?? 1,
      prorateFirst: line.prorateFirst,
    };
    const periods = periodsDue(recurring, line.pauses, options.preparedStarts.get(line.id) ?? new Set(), range.to);
    for (const period of periods) {
      if (compareCivil(period.billableOn, lower) < 0) continue;
      const unit = period.activeDays === period.cycleDays ? line.unitPriceCents : periodAmountCents(line.unitPriceCents, period);
      const cents = lineBaseCents({ quantity: line.quantity, unitPriceCents: unit, discountBps: line.discountBps });

      if (line.billingType === "yearly" && period.start !== line.startsOn) {
        const daysLeft = daysBetween(range.today, period.billableOn);
        events.push(
          event({
            id: `renewal:${line.id}:${period.start}`,
            type: "renewal",
            date: period.billableOn,
            title: line.description,
            subtitle: contract.clientName,
            amountCents: cents,
            amountPeriod: "year",
            amountBasis: "base",
            // Dentro de la ventana de avisos hay margen para hablar con el cliente (y subir precio).
            status: daysLeft <= options.renewalWindowDays ? "pending" : "scheduled",
            ownerMemberId: contract.ownerMemberId,
            href: `/contracts/${contract.id}`,
            source: { table: "contract_lines", id: line.id },
            facts: [
              { key: "client", type: "text", value: contract.clientName },
              { key: "contract", type: "text", value: contract.title },
              { key: "period", type: "range", from: period.start, to: period.end },
              { key: "amount", type: "money", value: cents, period: "year" },
            ],
            links: [clientLink(contract.clientId)],
          }),
        );
        continue;
      }

      const day = byDay.get(period.billableOn) ?? { cents: 0, items: [], start: period.start, end: period.end };
      day.cents += cents;
      day.items.push({ key: "line", type: "item", label: line.description, cents, period: linePeriodFor(line.billingType) });
      if (compareCivil(period.end, day.end) > 0) day.end = period.end;
      byDay.set(period.billableOn, day);
    }
  }

  for (const [date, day] of byDay) {
    events.push(
      event({
        id: `billing:${contract.id}:${date}`,
        type: "billing",
        date,
        title: contract.title,
        subtitle: contract.clientName,
        amountCents: day.cents,
        amountBasis: "base",
        status: "scheduled",
        ownerMemberId: contract.ownerMemberId,
        href: `/contracts/${contract.id}`,
        source: { table: "contracts", id: contract.id },
        facts: [
          { key: "client", type: "text", value: contract.clientName },
          { key: "period", type: "range", from: day.start, to: day.end },
          ...day.items,
          { key: "amount", type: "money", value: day.cents },
        ],
        links: [clientLink(contract.clientId)],
      }),
    );
  }
  return events;
}

/**
 * Altas y bajas de líneas, agrupadas por contrato, día y tipo. Un cambio de precio (una línea que
 * sustituye a otra desde una fecha) es un "cambio", no una baja y un alta.
 */
function lineChangeEvents(contract: CalendarContract, range: BuildRange): CalendarEvent[] {
  const replaced = new Set(contract.lines.flatMap((line) => (line.replacesLineId ? [line.replacesLineId] : [])));
  const groups = new Map<string, { kind: "start" | "change" | "end" | "cancel"; date: CivilDate; lines: CalendarContractLine[] }>();
  const add = (kind: "start" | "change" | "end" | "cancel", date: CivilDate, line: CalendarContractLine) => {
    const key = `${kind}:${date}`;
    const group = groups.get(key) ?? { kind, date, lines: [] };
    group.lines.push(line);
    groups.set(key, group);
  };
  for (const line of contract.lines) {
    if (line.startsOn && within(line.startsOn, range)) add(line.replacesLineId ? "change" : "start", line.startsOn, line);
    if (line.endsOn && within(line.endsOn, range) && !replaced.has(line.id)) add(line.cancelledOn ? "cancel" : "end", line.endsOn, line);
  }

  return [...groups.values()].map(({ kind, date, lines }) => {
    const bases = lines.map((line) => lineBaseCents(line));
    // Un importe solo si todas las líneas son del mismo tipo: lo puntual y lo recurrente no se suman.
    const types = new Set(lines.map((line) => line.billingType));
    const single = types.size === 1 ? [...types][0]! : null;
    return event({
      id: `contract:${contract.id}:${kind}:${date}`,
      type: "contract",
      kind,
      date,
      title: contract.title,
      subtitle: contract.clientName,
      amountCents: single && single !== "usage" ? bases.reduce((sum, cents) => sum + cents, 0) : null,
      amountPeriod: single ? (linePeriodFor(single) ?? null) : null,
      amountBasis: "base",
      status: compareCivil(date, range.today) < 0 ? "past" : "scheduled",
      ownerMemberId: contract.ownerMemberId,
      href: `/contracts/${contract.id}`,
      source: { table: "contracts", id: contract.id },
      facts: [
        { key: "client", type: "text", value: contract.clientName },
        ...lines.map((line, i): CalendarFact => ({
          key: "line",
          type: "item",
          label: line.description,
          cents: line.billingType === "usage" ? null : bases[i]!,
          period: linePeriodFor(line.billingType),
        })),
      ],
      links: [clientLink(contract.clientId)],
    });
  });
}

/**
 * Hitos con fecha prevista, con lo que factura cada uno (el último, el resto, al céntimo). Uno sin
 * facturar se puede mover; uno ya preparado o facturado, no.
 */
function milestoneEvents(contract: CalendarContract, range: BuildRange): CalendarEvent[] {
  const milestones = [...contract.milestones].sort((a, b) => a.position - b.position);
  const oneOff = contract.lines.filter((line) => line.billingType === "one_off");
  const shares =
    oneOff.length > 0 && milestones.length > 0 && validateMilestones(milestones.map((m) => m.percentBps)) === null
      ? splitByMilestones(
          oneOff.map((line) => ({ id: line.id, baseCents: lineBaseCents(line) })),
          milestones.map((m) => ({ id: m.id, percentBps: m.percentBps })),
        )
      : null;

  return milestones.flatMap((milestone) => {
    const { plannedOn, billing } = milestone;
    if (plannedOn === null) return [];
    if (!within(plannedOn, range) && !(billing === null && inWindow(plannedOn, range))) return [];
    const amount = shares ? Object.values(shares[milestone.id] ?? {}).reduce((sum, cents) => sum + cents, 0) : null;
    const status: CalendarEventStatus =
      billing === null
        ? actionStatus(plannedOn, range.today)
        : billing.state === "invoiced"
          ? "done"
          : billing.state === "waived"
            ? "past"
            : "pending";
    const facts: CalendarFact[] = [
      { key: "client", type: "text", value: contract.clientName },
      { key: "contract", type: "text", value: contract.title },
      { key: "percent", type: "bps", value: milestone.percentBps },
    ];
    if (amount !== null) facts.push({ key: "amount", type: "money", value: amount });
    facts.push({ key: "auto", type: "label", value: milestone.auto ? "yes" : "no" });
    if (billing) facts.push({ key: "state", type: "label", value: `billable.${billing.state}` });
    const links: CalendarLink[] = [clientLink(contract.clientId)];
    if (billing?.invoiceId) links.unshift({ key: "invoice", href: `/invoices/${billing.invoiceId}` });
    return [
      event({
        id: `milestone:${milestone.id}`,
        type: "milestone",
        kind: milestone.auto ? "auto" : "manual",
        date: plannedOn,
        title: milestone.label,
        subtitle: contract.clientName,
        amountCents: amount,
        amountBasis: "base",
        status,
        ownerMemberId: contract.ownerMemberId,
        href: `/contracts/${contract.id}`,
        source: { table: "contract_milestones", id: milestone.id },
        movable: billing === null,
        facts,
        links,
      }),
    ];
  });
}

/** Todo lo que sale de los contratos firmados. */
export function contractEvents(
  contracts: readonly CalendarContract[],
  range: BuildRange,
  options: ContractEventOptions,
): CalendarEvent[] {
  return contracts.flatMap((contract) =>
    contract.signedOn === null
      ? []
      : [...billingEvents(contract, range, options), ...lineChangeEvents(contract, range), ...milestoneEvents(contract, range)],
  );
}

// ---------------------------------------------------------------------------
// Deals: la próxima acción
// ---------------------------------------------------------------------------

export type CalendarDeal = {
  id: string;
  title: string;
  clientId: string;
  clientName: string;
  stageName: string | null;
  stageKind: "open" | "won" | "lost";
  nextAction: string | null;
  nextActionOn: CivilDate;
  ownerMemberId: string | null;
  estOneOffCents: Cents;
  estMrrCents: Cents;
  probabilityBps: number;
};

/** La próxima acción de cada deal no perdido, en rojo si está atrasada. Se mueve arrastrándola. */
export function dealEvents(deals: readonly CalendarDeal[], range: BuildRange): CalendarEvent[] {
  return deals.flatMap((deal) => {
    if (deal.stageKind === "lost" || !inWindow(deal.nextActionOn, range)) return [];
    const facts: CalendarFact[] = [
      { key: "client", type: "text", value: deal.clientName },
      { key: "deal", type: "text", value: deal.title },
    ];
    if (deal.stageName) facts.push({ key: "stage", type: "text", value: deal.stageName });
    if (deal.estOneOffCents > 0) facts.push({ key: "estOneOff", type: "money", value: deal.estOneOffCents });
    if (deal.estMrrCents > 0) facts.push({ key: "estMrr", type: "money", value: deal.estMrrCents, period: "month" });
    if (deal.stageKind === "open") facts.push({ key: "probability", type: "bps", value: deal.probabilityBps });
    return [
      event({
        id: `deal:${deal.id}`,
        type: "deal",
        kind: deal.stageKind,
        date: deal.nextActionOn,
        title: deal.nextAction ?? "",
        subtitle: deal.title,
        amountCents: null,
        amountBasis: null,
        status: actionStatus(deal.nextActionOn, range.today),
        ownerMemberId: deal.ownerMemberId,
        href: `/pipeline?deal=${deal.id}`,
        source: { table: "deals", id: deal.id },
        movable: true,
        facts,
        links: [clientLink(deal.clientId)],
      }),
    ];
  });
}

// ---------------------------------------------------------------------------
// Proyectos: la fecha de cada tarea y la entrega de cada proyecto
// ---------------------------------------------------------------------------

/** Lo que el módulo de proyectos da para el calendario (getProjectCalendarItems). */
export type CalendarProjectItem = {
  /** Una tarea con fecha o la entrega de un proyecto. */
  kind: "task" | "project";
  /** La tarea o el proyecto: la fila que guarda la fecha. */
  sourceId: string;
  date: CivilDate;
  /** El de la tarea o el nombre del proyecto. */
  title: string;
  /** Ruta dentro de la org: la tarea abierta en su proyecto, o el proyecto. */
  href: string;
  status: TaskStatus | ProjectStatus;
  /** Quién tiene la tarea asignada, o quién lleva el proyecto. */
  assigneeMemberId: string | null;
  projectId: string;
  projectName: string;
  clientId: string | null;
  clientName: string | null;
};

/**
 * Tareas con fecha y entregas de proyectos. Lo hecho, hecho; lo abierto pide algo en su fecha
 * (atrasado si ya pasó, pendiente hoy, previsto después). El responsable es quien tiene la tarea
 * (sin asignar, de todos). Solo se mueve una tarea sin hacer: su fecha vive en su fila y nada
 * más depende de ella. La entrega de un proyecto se cambia en su ficha.
 */
export function taskEvents(items: readonly CalendarProjectItem[], range: BuildRange): CalendarEvent[] {
  return items.flatMap((item) => {
    const open = item.status !== "done" && item.status !== "cancelled";
    if (!within(item.date, range) && !(open && inWindow(item.date, range))) return [];
    const isTask = item.kind === "task";
    const status: CalendarEventStatus = open ? actionStatus(item.date, range.today) : item.status === "done" ? "done" : "past";
    const daysOverdue = open ? daysBetween(item.date, range.today) : 0;
    const facts: CalendarFact[] = [];
    if (item.clientName) facts.push({ key: "client", type: "text", value: item.clientName });
    if (isTask) facts.push({ key: "project", type: "text", value: item.projectName });
    facts.push({ key: "state", type: "label", value: `${item.kind}.${item.status}` });
    if (daysOverdue > 0) facts.push({ key: "daysOverdue", type: "number", value: daysOverdue });
    return [
      event({
        id: `${item.kind}:${item.sourceId}`,
        type: "task",
        kind: item.kind,
        date: item.date,
        title: item.title,
        subtitle: isTask ? item.projectName : item.clientName,
        amountCents: null,
        amountBasis: null,
        status,
        ownerMemberId: item.assigneeMemberId,
        href: item.href,
        source: { table: isTask ? "project_tasks" : "projects", id: item.sourceId },
        movable: isTask && open,
        facts,
        links: item.clientId ? [clientLink(item.clientId)] : [],
      }),
    ];
  });
}

// ---------------------------------------------------------------------------
// Presupuestos enviados: hasta cuándo valen
// ---------------------------------------------------------------------------

export type CalendarQuote = {
  id: string;
  number: string | null;
  title: string;
  clientId: string;
  clientName: string;
  ownerMemberId: string | null;
  issuedOn: CivilDate | null;
  validUntil: CivilDate;
  /** Bases sin IVA por tipo, como en quotes_overview: nunca sumadas. */
  oneOffCents: Cents;
  monthlyCents: Cents;
  yearlyCents: Cents;
  usageLinesCount: number;
};

/** La validez de cada presupuesto enviado: caducado sin respuesta, en rojo (hay que llamar). */
export function quoteEvents(quotes: readonly CalendarQuote[], range: BuildRange): CalendarEvent[] {
  return quotes.flatMap((quote) => {
    if (!inWindow(quote.validUntil, range)) return [];
    const facts: CalendarFact[] = [{ key: "client", type: "text", value: quote.clientName }];
    if (quote.number) facts.push({ key: "quote", type: "text", value: quote.number });
    if (quote.issuedOn) facts.push({ key: "issuedOn", type: "date", value: quote.issuedOn });
    facts.push({ key: "validUntil", type: "date", value: quote.validUntil });
    if (quote.oneOffCents > 0) facts.push({ key: "oneOff", type: "money", value: quote.oneOffCents });
    if (quote.monthlyCents > 0) facts.push({ key: "monthly", type: "money", value: quote.monthlyCents, period: "month" });
    if (quote.yearlyCents > 0) facts.push({ key: "yearly", type: "money", value: quote.yearlyCents, period: "year" });
    if (quote.usageLinesCount > 0) facts.push({ key: "usageLines", type: "number", value: quote.usageLinesCount });
    const [amountCents, amountPeriod] =
      quote.oneOffCents > 0
        ? [quote.oneOffCents, null]
        : quote.monthlyCents > 0
          ? [quote.monthlyCents, "month" as const]
          : quote.yearlyCents > 0
            ? [quote.yearlyCents, "year" as const]
            : [null, null];
    const expired = compareCivil(quote.validUntil, range.today) < 0;
    return [
      event({
        id: `quote:${quote.id}`,
        type: "quote",
        kind: expired ? "expired" : "sent",
        date: quote.validUntil,
        title: quote.title,
        subtitle: quote.clientName,
        amountCents,
        amountPeriod,
        amountBasis: amountCents === null ? null : "base",
        status: actionStatus(quote.validUntil, range.today),
        ownerMemberId: quote.ownerMemberId,
        href: `/quotes/${quote.id}`,
        source: { table: "quotes", id: quote.id },
        facts,
        links: [clientLink(quote.clientId)],
      }),
    ];
  });
}

// ---------------------------------------------------------------------------
// Reuniones y llamadas (actividades con fecha y hora; las futuras son las previstas)
// ---------------------------------------------------------------------------

export type CalendarActivity = {
  id: string;
  kind: "meeting" | "call";
  title: string;
  clientId: string;
  clientName: string;
  memberId: string | null;
  /** Instante (ISO 8601). */
  occurredAt: string;
};

/** Reuniones y llamadas en su día y hora de la zona de la org. Las pasadas, hechas. */
export function activityEvents(
  activities: readonly CalendarActivity[],
  range: BuildRange & { timeZone: string; now: string },
): CalendarEvent[] {
  const now = Date.parse(range.now);
  return activities.flatMap((activity) => {
    const instant = new Date(activity.occurredAt);
    const date = dateInZone(instant, range.timeZone);
    if (!within(date, range)) return [];
    const time = toDateTimeLocal(instant, range.timeZone).slice(11, 16);
    return [
      event({
        id: `meeting:${activity.id}`,
        type: "meeting",
        kind: activity.kind,
        date,
        time,
        startsAt: instant.toISOString(),
        title: activity.title,
        subtitle: activity.clientName,
        amountCents: null,
        amountBasis: null,
        status: instant.getTime() < now ? "done" : "scheduled",
        ownerMemberId: activity.memberId,
        href: `/clients/${activity.clientId}`,
        source: { table: "activities", id: activity.id },
        facts: [
          { key: "client", type: "text", value: activity.clientName },
          { key: "kind", type: "label", value: `activity.${activity.kind}` },
          { key: "time", type: "text", value: time },
        ],
      }),
    ];
  });
}
