import "server-only";
import {
  activityEvents,
  type BuildRange,
  CALENDAR_EVENT_TYPES,
  type CalendarActivity,
  type CalendarContract,
  type CalendarDeal,
  type CalendarEvent,
  type CalendarEventType,
  type CalendarInvoice,
  type CalendarMilestone,
  type CalendarQuote,
  type CalendarReminder,
  collectionEvents,
  contractEvents,
  dealEvents,
  filterEvents,
  type FiscalIssuer,
  fiscalEvents,
  issuedEvents,
  modelsForIssuer,
  quoteEvents,
  readFiscalCalendarSettings,
  reminderEvents,
  sortEvents,
  taskEvents,
} from "@/domain/calendar";
import { addDays, type CivilDate } from "@/domain/dates/civil-date";
import { dateInZone, fromDateTimeLocal } from "@/domain/dates/zoned-time";
import { nowInZone } from "@/lib/clock";
import type { Json, Tables } from "@/lib/supabase/database.types";
import { type Db, DbError, fetchAll, must } from "@/server/billing/context";
import { getProjectCalendarItems } from "@/server/projects/calendar";

/**
 * Lecturas del calendario. Con el cliente del usuario todo pasa por RLS; el enlace ICS lo llama
 * con el cliente de servidor (sin sesión), así que TODAS las consultas filtran por `org_id`
 * explícito, también las que buscan por ids.
 */

export type CalendarOrg = Pick<Tables<"orgs">, "id" | "timezone" | "settings">;

export type CalendarQuery = {
  from: CivilDate;
  to: CivilDate;
  /** Tipos que se cargan (por defecto, todos): lo que no se pide no se consulta. */
  types?: readonly CalendarEventType[];
  /** "Solo lo mío": lo de este socio y lo que es de todos. */
  memberId?: string | null;
  /** Además del rango, lo atrasado de antes que aún pide algo (cobros, acciones, hitos…). */
  includeOverdue?: boolean;
  /** La org ya cargada; si no, se lee. */
  org?: CalendarOrg;
  /** "Ahora" (por defecto, el reloj). */
  now?: Date;
};

const DEFAULT_RENEWAL_DAYS = [60, 30, 7];
const PAGE = 1000;
/**
 * Desde dónde se buscan las tareas atrasadas: como las acciones de los deals, lo atrasado no
 * caduca. El módulo de proyectos solo filtra por fechas; lo ya hecho de antes lo descarta taskEvents.
 */
const OVERDUE_TASKS_FROM: CivilDate = "2000-01-01";

/** Ventana de avisos de renovación: la mayor de orgs.settings.renewal_alert_days (60 por defecto). */
export function renewalWindowDays(settings: Json | null | undefined): number {
  const s = (settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {}) as Record<string, unknown>;
  const alerts = Array.isArray(s.renewal_alert_days)
    ? s.renewal_alert_days.filter((d): d is number => typeof d === "number" && Number.isInteger(d) && d > 0)
    : [];
  return Math.max(...(alerts.length > 0 ? alerts : DEFAULT_RENEWAL_DAYS));
}

/** El instante en que empieza una fecha civil en la zona de la org (00:00 de ese día). */
function startOfDay(date: CivilDate, timeZone: string): string {
  const instant = fromDateTimeLocal(`${date}T00:00`, timeZone);
  if (!instant) throw new Error(`Fecha no válida: ${date}`);
  return instant.toISOString();
}

function chunks<T>(values: readonly T[], size = 200): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

type ClientRef = { name: string; ownerId: string | null };

async function loadClients(db: Db, orgId: string): Promise<Map<string, ClientRef>> {
  const rows = await fetchAll(
    (a, b) => db.from("clients").select("id, display_name, owner_member_id").eq("org_id", orgId).order("id").range(a, b),
    "calendar.clients",
    PAGE,
  );
  return new Map(rows.map((c) => [c.id, { name: c.display_name, ownerId: c.owner_member_id }]));
}

type InvoiceRow = {
  id: string | null;
  number: string | null;
  kind: "ordinary" | "rectifying" | null;
  client_id: string | null;
  client_name: string | null;
  issued_on: string | null;
  due_on: string | null;
  total_cents: number | null;
  paid_cents: number | null;
  outstanding_cents: number | null;
};

const INVOICE_COLUMNS = "id, number, kind, client_id, client_name, issued_on, due_on, total_cents, paid_cents, outstanding_cents";

function toInvoice(row: InvoiceRow, clients: Map<string, ClientRef>): CalendarInvoice[] {
  if (!row.id || !row.client_id || !row.kind) return [];
  return [
    {
      id: row.id,
      number: row.number,
      kind: row.kind,
      clientId: row.client_id,
      clientName: row.client_name ?? clients.get(row.client_id)?.name ?? "",
      ownerMemberId: clients.get(row.client_id)?.ownerId ?? null,
      issuedOn: row.issued_on,
      dueOn: row.due_on,
      totalCents: row.total_cents ?? 0,
      paidCents: row.paid_cents ?? 0,
      outstandingCents: row.outstanding_cents ?? 0,
    },
  ];
}

/** Facturas emitidas con algo por cobrar que vencen hasta `to` (desde `from`, salvo lo atrasado). */
async function loadCollections(db: Db, orgId: string, q: CalendarQuery, clients: Map<string, ClientRef>): Promise<CalendarInvoice[]> {
  const rows = await fetchAll((a, b) => {
    let query = db
      .from("invoices_overview")
      .select(INVOICE_COLUMNS)
      .eq("org_id", orgId)
      .eq("lifecycle", "issued")
      .eq("kind", "ordinary")
      .in("status", ["issued", "overdue"])
      .gt("outstanding_cents", 0)
      .lte("due_on", q.to);
    if (!q.includeOverdue) query = query.gte("due_on", q.from);
    return query.order("due_on").order("id").range(a, b);
  }, "calendar.collections");
  return rows.flatMap((row) => toInvoice(row, clients));
}

async function loadIssued(db: Db, orgId: string, q: CalendarQuery, clients: Map<string, ClientRef>): Promise<CalendarInvoice[]> {
  const rows = await fetchAll(
    (a, b) =>
      db
        .from("invoices_overview")
        .select(INVOICE_COLUMNS)
        .eq("org_id", orgId)
        .eq("lifecycle", "issued")
        .gte("issued_on", q.from)
        .lte("issued_on", q.to)
        .order("issued_on")
        .order("id")
        .range(a, b),
    "calendar.issued",
  );
  return rows.flatMap((row) => toInvoice(row, clients));
}

/** Recordatorios de cobro por aprobar (los prepara el cron y nunca salen solos), con su factura. */
async function loadReminders(
  db: Db,
  orgId: string,
  q: CalendarQuery,
  timeZone: string,
  clients: Map<string, ClientRef>,
): Promise<CalendarReminder[]> {
  const rows = await fetchAll((a, b) => {
    let query = db
      .from("outbound_emails")
      .select("id, template, invoice_id, client_id, created_at")
      .eq("org_id", orgId)
      .eq("status", "pending_approval")
      .eq("template", "payment_reminder")
      .lt("created_at", startOfDay(addDays(q.to, 1), timeZone));
    if (!q.includeOverdue) query = query.gte("created_at", startOfDay(q.from, timeZone));
    return query.order("created_at").order("id").range(a, b);
  }, "calendar.reminders");

  const invoiceIds = [...new Set(rows.flatMap((r) => (r.invoice_id ? [r.invoice_id] : [])))];
  const invoices = new Map<string, { number: string | null; outstanding: number | null; dueOn: string | null; clientId: string | null }>();
  for (const ids of chunks(invoiceIds)) {
    const found = must(
      await db.from("invoices_overview").select("id, number, outstanding_cents, due_on, client_id").eq("org_id", orgId).in("id", ids),
      "calendar.reminders.invoices",
    );
    for (const i of found) {
      if (i.id) invoices.set(i.id, { number: i.number, outstanding: i.outstanding_cents, dueOn: i.due_on, clientId: i.client_id });
    }
  }

  return rows.map((row) => {
    const invoice = row.invoice_id ? invoices.get(row.invoice_id) : undefined;
    const clientId = row.client_id ?? invoice?.clientId ?? null;
    const client = clientId ? clients.get(clientId) : undefined;
    return {
      id: row.id,
      preparedOn: dateInZone(new Date(row.created_at), timeZone),
      template: row.template,
      invoiceId: row.invoice_id,
      invoiceNumber: invoice?.number ?? null,
      clientId,
      clientName: client?.name ?? null,
      ownerMemberId: client?.ownerId ?? null,
      outstandingCents: invoice?.outstanding ?? null,
      dueOn: invoice?.dueOn ?? null,
    };
  });
}

/** Contratos firmados con sus líneas, pausas e hitos, y lo que el cron ya ha preparado. */
async function loadContracts(
  db: Db,
  orgId: string,
  today: CivilDate,
  clients: Map<string, ClientRef>,
): Promise<{ contracts: CalendarContract[]; preparedStarts: Map<string, Set<CivilDate>> }> {
  const [contracts, prepared, milestoneItems] = await Promise.all([
    fetchAll(
      (a, b) =>
        db
          .from("contracts")
          .select(
            "id, title, client_id, signed_on, contract_lines(id, description, billing_type, quantity, unit_price_cents, discount_bps, starts_on, ends_on, billing_day, prorate_first, cancelled_on, replaces_line_id, contract_line_pauses(starts_on, ends_on)), contract_milestones(id, position, label, percent_bps, planned_on, auto)",
          )
          .eq("org_id", orgId)
          .is("archived_at", null)
          .not("signed_on", "is", null)
          .order("id")
          .range(a, b),
      "calendar.contracts",
    ),
    // Los periodos que ya existen solo pueden empezar hoy o antes: basta con los de hoy en adelante.
    fetchAll(
      (a, b) =>
        db
          .from("billable_items")
          .select("contract_line_id, period_start")
          .eq("org_id", orgId)
          .eq("source", "recurring")
          .gte("period_start", today)
          .order("id")
          .range(a, b),
      "calendar.prepared",
    ),
    fetchAll(
      (a, b) =>
        db
          .from("billable_items_overview")
          .select("id, milestone_id, state, invoice_id, invoice_number")
          .eq("org_id", orgId)
          .eq("source", "milestone")
          .order("id")
          .range(a, b),
      "calendar.milestoneItems",
    ),
  ]);

  const preparedStarts = new Map<string, Set<CivilDate>>();
  for (const item of prepared) {
    if (!item.period_start) continue;
    const set = preparedStarts.get(item.contract_line_id) ?? new Set<CivilDate>();
    set.add(item.period_start);
    preparedStarts.set(item.contract_line_id, set);
  }
  const billingByMilestone = new Map<string, NonNullable<CalendarMilestone["billing"]>>();
  for (const item of milestoneItems) {
    if (!item.milestone_id || !item.state) continue;
    // Un hito se prepara una sola vez (único por línea); si hay varias líneas, manda la más avanzada.
    const current = billingByMilestone.get(item.milestone_id);
    if (!current || (current.state !== "invoiced" && item.state === "invoiced")) {
      billingByMilestone.set(item.milestone_id, { state: item.state, invoiceId: item.invoice_id, invoiceNumber: item.invoice_number });
    }
  }

  return {
    preparedStarts,
    contracts: contracts.map((c) => {
      const client = clients.get(c.client_id);
      return {
        id: c.id,
        title: c.title,
        clientId: c.client_id,
        clientName: client?.name ?? "",
        ownerMemberId: client?.ownerId ?? null,
        signedOn: c.signed_on,
        lines: c.contract_lines.map((l) => ({
          id: l.id,
          description: l.description,
          billingType: l.billing_type,
          quantity: String(l.quantity),
          unitPriceCents: l.unit_price_cents,
          discountBps: l.discount_bps,
          startsOn: l.starts_on,
          endsOn: l.ends_on,
          billingDay: l.billing_day,
          prorateFirst: l.prorate_first,
          cancelledOn: l.cancelled_on,
          replacesLineId: l.replaces_line_id,
          pauses: l.contract_line_pauses.map((p) => ({ startsOn: p.starts_on, endsOn: p.ends_on })),
        })),
        milestones: c.contract_milestones.map((m) => ({
          id: m.id,
          position: m.position,
          label: m.label,
          percentBps: m.percent_bps,
          plannedOn: m.planned_on,
          auto: m.auto,
          billing: billingByMilestone.get(m.id) ?? null,
        })),
      };
    }),
  };
}

/** Deals no perdidos con próxima acción hasta `to` (desde `from`, salvo lo atrasado). */
async function loadDeals(db: Db, orgId: string, q: CalendarQuery): Promise<CalendarDeal[]> {
  const [rows, stages] = await Promise.all([
    fetchAll((a, b) => {
      let query = db
        .from("deals_board")
        .select(
          "id, title, client_id, client_name, stage_id, stage_kind, next_action, next_action_on, owner_member_id, est_one_off_cents, est_mrr_cents, probability_bps",
        )
        .eq("org_id", orgId)
        .neq("stage_kind", "lost")
        .not("next_action_on", "is", null)
        .lte("next_action_on", q.to);
      if (!q.includeOverdue) query = query.gte("next_action_on", q.from);
      return query.order("next_action_on").order("id").range(a, b);
    }, "calendar.deals"),
    db.from("pipeline_stages").select("id, name").eq("org_id", orgId),
  ]);
  const stageNames = new Map(must(stages, "calendar.stages").map((s) => [s.id, s.name]));
  return rows.flatMap((d) =>
    d.id && d.client_id && d.next_action_on && d.stage_kind
      ? [
          {
            id: d.id,
            title: d.title ?? "",
            clientId: d.client_id,
            clientName: d.client_name ?? "",
            stageName: d.stage_id ? (stageNames.get(d.stage_id) ?? null) : null,
            stageKind: d.stage_kind,
            nextAction: d.next_action,
            nextActionOn: d.next_action_on,
            ownerMemberId: d.owner_member_id,
            estOneOffCents: d.est_one_off_cents ?? 0,
            estMrrCents: d.est_mrr_cents ?? 0,
            probabilityBps: d.probability_bps ?? 0,
          },
        ]
      : [],
  );
}

/** Presupuestos enviados (sin respuesta) que vencen hasta `to`. El responsable es el del deal o el del cliente. */
async function loadQuotes(db: Db, orgId: string, q: CalendarQuery, clients: Map<string, ClientRef>): Promise<CalendarQuote[]> {
  const rows = await fetchAll((a, b) => {
    let query = db
      .from("quotes_overview")
      .select("id, number, title, client_id, client_name, deal_id, issued_on, valid_until, one_off_cents, monthly_cents, yearly_cents, usage_lines_count")
      .eq("org_id", orgId)
      .eq("status", "sent")
      .lte("valid_until", q.to);
    if (!q.includeOverdue) query = query.gte("valid_until", q.from);
    return query.order("valid_until").order("id").range(a, b);
  }, "calendar.quotes");

  const dealIds = [...new Set(rows.flatMap((r) => (r.deal_id ? [r.deal_id] : [])))];
  const dealOwners = new Map<string, string | null>();
  for (const ids of chunks(dealIds)) {
    const found = must(await db.from("deals").select("id, owner_member_id").eq("org_id", orgId).in("id", ids), "calendar.quotes.deals");
    for (const d of found) dealOwners.set(d.id, d.owner_member_id);
  }

  return rows.flatMap((r) =>
    r.id && r.client_id && r.valid_until
      ? [
          {
            id: r.id,
            number: r.number,
            title: r.title ?? "",
            clientId: r.client_id,
            clientName: r.client_name ?? "",
            ownerMemberId: (r.deal_id ? dealOwners.get(r.deal_id) : null) ?? clients.get(r.client_id)?.ownerId ?? null,
            issuedOn: r.issued_on,
            validUntil: r.valid_until,
            oneOffCents: r.one_off_cents ?? 0,
            monthlyCents: r.monthly_cents ?? 0,
            yearlyCents: r.yearly_cents ?? 0,
            usageLinesCount: r.usage_lines_count ?? 0,
          },
        ]
      : [],
  );
}

/** Reuniones y llamadas del rango (las futuras son las que están previstas). */
async function loadActivities(
  db: Db,
  orgId: string,
  q: CalendarQuery,
  timeZone: string,
  clients: Map<string, ClientRef>,
): Promise<CalendarActivity[]> {
  const rows = await fetchAll(
    (a, b) =>
      db
        .from("activities")
        .select("id, kind, title, client_id, member_id, occurred_at")
        .eq("org_id", orgId)
        .in("kind", ["meeting", "call"])
        .gte("occurred_at", startOfDay(q.from, timeZone))
        .lt("occurred_at", startOfDay(addDays(q.to, 1), timeZone))
        .order("occurred_at")
        .order("id")
        .range(a, b),
    "calendar.activities",
  );
  return rows.flatMap((r) =>
    r.kind === "meeting" || r.kind === "call"
      ? [
          {
            id: r.id,
            kind: r.kind,
            title: r.title,
            clientId: r.client_id,
            clientName: clients.get(r.client_id)?.name ?? "",
            memberId: r.member_id,
            occurredAt: r.occurred_at,
          },
        ]
      : [],
  );
}

/**
 * Emisores para el calendario fiscal. El 349 en automático necesita saber quién ha facturado
 * operaciones intracomunitarias (inversión del sujeto pasivo) en los últimos 12 meses.
 */
async function loadFiscalIssuers(db: Db, orgId: string, today: CivilDate, settings: Json): Promise<FiscalIssuer[]> {
  const rows = must(
    await db
      .from("issuers")
      .select("id, kind, legal_name, trade_name, member_id, active_from, active_until, archived_at, verifactu_from, fiscal_provider")
      .eq("org_id", orgId)
      .is("archived_at", null),
    "calendar.issuers",
  );
  const issuers: FiscalIssuer[] = rows.map((i) => ({
    id: i.id,
    kind: i.kind,
    name: i.trade_name || i.legal_name,
    memberId: i.member_id,
    activeFrom: i.active_from,
    activeUntil: i.active_until,
    archived: i.archived_at !== null,
    verifactuFrom: i.verifactu_from,
    fiscalProvider: i.fiscal_provider,
    hasIntraEuOperations: false,
  }));

  const fiscal = readFiscalCalendarSettings(settings);
  const wants349 = fiscal.enabled && fiscal.intraEu === "auto" && issuers.some((i) => modelsForIssuer({ ...i, hasIntraEuOperations: true }, fiscal).includes("349"));
  if (wants349) {
    const lines = await fetchAll(
      (a, b) =>
        db
          .from("invoice_lines")
          .select("id, invoices!inner(issuer_id)")
          .eq("org_id", orgId)
          .eq("vat_regime", "reverse_charge_eu")
          .eq("invoices.lifecycle", "issued")
          .gte("invoices.issued_on", addDays(today, -365))
          .order("id")
          .range(a, b),
      "calendar.intraEu",
    );
    const withOps = new Set(lines.map((l) => l.invoices.issuer_id));
    for (const issuer of issuers) issuer.hasIntraEuOperations = withOps.has(issuer.id);
  }
  return issuers;
}

async function loadOrg(db: Db, orgId: string): Promise<CalendarOrg> {
  const { data, error } = await db.from("orgs").select("id, timezone, settings").eq("id", orgId).maybeSingle();
  if (error) throw new DbError(error, "calendar.org");
  if (!data) throw new Error("calendar.org: organización no encontrada");
  return data;
}

/**
 * Los eventos del calendario de una org en [from, to] (y, si se pide, lo atrasado de antes),
 * ya filtrados y ordenados. Cada evento sale de la fecha de su fuente; nada se copia.
 */
export async function getCalendarEvents(db: Db, orgId: string, query: CalendarQuery): Promise<CalendarEvent[]> {
  const org = query.org ?? (await loadOrg(db, orgId));
  const now = query.now ?? new Date();
  const timeZone = org.timezone;
  const today = nowInZone(timeZone, now).date;
  const types = new Set<CalendarEventType>(query.types ?? CALENDAR_EVENT_TYPES);
  const wants = (...list: CalendarEventType[]) => list.some((t) => types.has(t));
  const range: BuildRange = { from: query.from, to: query.to, today, includeOverdue: query.includeOverdue === true };

  const needsClients = wants("collection", "issued", "reminder", "billing", "renewal", "contract", "milestone", "quote", "meeting");
  const clients = needsClients ? await loadClients(db, orgId) : new Map<string, ClientRef>();

  const [collections, issued, reminders, contracts, deals, quotes, activities, issuers, projectItems] = await Promise.all([
    wants("collection") ? loadCollections(db, orgId, query, clients) : [],
    wants("issued") ? loadIssued(db, orgId, query, clients) : [],
    wants("reminder") ? loadReminders(db, orgId, query, timeZone, clients) : [],
    wants("billing", "renewal", "contract", "milestone") ? loadContracts(db, orgId, today, clients) : null,
    wants("deal") ? loadDeals(db, orgId, query) : [],
    wants("quote") ? loadQuotes(db, orgId, query, clients) : [],
    wants("meeting") ? loadActivities(db, orgId, query, timeZone, clients) : [],
    wants("fiscal") ? loadFiscalIssuers(db, orgId, today, org.settings) : [],
    // Tareas con fecha y entregas de proyectos: las lee el módulo de proyectos (filtra por org_id).
    wants("task") ? getProjectCalendarItems(db, orgId, query.includeOverdue ? OVERDUE_TASKS_FROM : query.from, query.to, { today }) : [],
  ]);

  const events: CalendarEvent[] = [
    ...collectionEvents(collections, range),
    ...issuedEvents(issued, range),
    ...reminderEvents(reminders, range),
    ...(contracts
      ? contractEvents(contracts.contracts, range, { preparedStarts: contracts.preparedStarts, renewalWindowDays: renewalWindowDays(org.settings) })
      : []),
    ...dealEvents(deals, range),
    ...taskEvents(projectItems, range),
    ...quoteEvents(quotes, range),
    ...activityEvents(activities, { ...range, timeZone, now: now.toISOString() }),
    ...fiscalEvents(issuers, readFiscalCalendarSettings(org.settings), range),
  ];

  return sortEvents(filterEvents(events, { types: [...types], memberId: query.memberId ?? null }));
}
