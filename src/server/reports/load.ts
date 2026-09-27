import "server-only";
import type { CivilDate } from "@/domain/dates/civil-date";
import { addMonths, monthEnd, type Month } from "@/domain/metrics/months";
import { isPortalLocale, resolvePortalSections } from "@/domain/portal";
import {
  buildClientMonthReport,
  type ClientMonthReport,
  isReportableMonth,
  monthInstants,
  type ReportActivityKind,
  type ReportContractFact,
  type ReportFileFact,
  type ReportHoursProject,
  type ReportInvoiceFact,
  type ReportLocale,
  type ReportProjectFact,
  type ReportTimeFact,
  type ReportWebFacts,
  type ReportWebGate,
} from "@/domain/reports";
import type { DataSpan, QueryStat, SearchDay, TrafficChannel, WebDay } from "@/domain/seo";
import { nowInZone } from "@/lib/clock";
import { type Db, fetchAll, must } from "@/server/billing/context";
import { getPortalProjects } from "@/server/projects/portal";

/**
 * Carga los hechos del mes de un cliente y monta su informe (src/domain/reports). Con el cliente de
 * la sesión, la RLS es la barrera (un socio ve lo de su org); aun así, todo filtra por la org y el
 * cliente, así que también sirve con la clave de servidor (el portal, más adelante). Nada se
 * guarda: se genera cada vez con los datos de ese momento.
 *
 * Qué ve el cliente sale de las mismas reglas que su portal: los proyectos y tareas de
 * getPortalProjects, las actividades marcadas como visibles, sus entregables y, de su web, solo si
 * tiene una conectada y la sección «Datos de tu web» encendida.
 */

export type LoadClientReportOptions = {
  /** Horas dedicadas del mes (por defecto no). */
  includeHours?: boolean;
  /** Idioma del PDF; por defecto, el preferido del cliente (el email lo fija al prepararse). */
  locale?: ReportLocale;
  /** Para los tests y las muestras: el día desde el que se mira (hoy en la zona de la org). */
  today?: CivilDate;
  now?: Date;
};

const INVOICE_COLUMNS = "id, number, kind, status, issued_on, due_on, total_cents, outstanding_cents";

type InvoiceRow = {
  id: string | null;
  number: string | null;
  kind: "ordinary" | "rectifying" | null;
  status: ReportInvoiceFact["status"] | null;
  issued_on: string | null;
  due_on: string | null;
  total_cents: number | null;
  outstanding_cents: number | null;
};

/** El informe del mes, o null si el cliente no existe (o no se ve) o el mes aún no ha empezado. */
export async function loadClientMonthReport(
  db: Db,
  orgId: string,
  clientId: string,
  month: Month,
  opts: LoadClientReportOptions = {},
): Promise<ClientMonthReport | null> {
  const [clientRes, orgRes] = await Promise.all([
    db.from("clients").select("id, display_name, preferred_language").eq("org_id", orgId).eq("id", clientId).maybeSingle(),
    db.from("orgs").select("name, timezone").eq("id", orgId).maybeSingle(),
  ]);
  if (clientRes.error) throw clientRes.error;
  if (orgRes.error) throw orgRes.error;
  const client = clientRes.data;
  const org = orgRes.data;
  if (!client || !org) return null;

  const now = opts.now ?? new Date();
  const today = opts.today ?? nowInZone(org.timezone, now).date;
  if (!isReportableMonth(month, today)) return null;
  const bounds = monthInstants(month, org.timezone);

  const [contracts, projects, activities, files, web, invoices, hours] = await Promise.all([
    loadContracts(db, orgId, clientId, month),
    loadProjects(db, orgId, clientId, bounds),
    loadActivities(db, orgId, clientId, bounds, now),
    loadFiles(db, orgId, clientId),
    loadWeb(db, orgId, clientId, month),
    loadInvoices(db, orgId, clientId, month),
    opts.includeHours ? loadHours(db, orgId, clientId, month) : Promise.resolve(null),
  ]);

  return buildClientMonthReport({
    month,
    today,
    timeZone: org.timezone,
    locale: opts.locale ?? (isPortalLocale(client.preferred_language) ? client.preferred_language : "es"),
    clientName: client.display_name,
    senderName: org.name,
    contracts,
    projects,
    activities,
    files,
    webGate: web.gate,
    web: web.facts,
    invoices,
    hours,
  });
}

/** Contratos firmados (no archivados) con sus líneas, pausas y cuándo se facturó cada hito. */
async function loadContracts(db: Db, orgId: string, clientId: string, month: Month): Promise<ReportContractFact[]> {
  const contracts = must(
    await db
      .from("contracts")
      .select("id, title, signed_on, archived_at")
      .eq("org_id", orgId)
      .eq("client_id", clientId)
      .not("signed_on", "is", null)
      .lte("signed_on", monthEnd(month))
      .is("archived_at", null),
    "reports.contracts",
  );
  if (contracts.length === 0) return [];
  const contractIds = contracts.map((c) => c.id);

  const [lines, milestones] = await Promise.all([
    fetchAll(
      (from, to) =>
        db
          .from("contract_lines")
          .select("id, contract_id, position, description, billing_type, starts_on, ends_on, replaces_line_id")
          .eq("org_id", orgId)
          .in("contract_id", contractIds)
          .order("id")
          .range(from, to),
      "reports.lines",
    ),
    must(
      await db.from("contract_milestones").select("id, contract_id, position").eq("org_id", orgId).in("contract_id", contractIds).order("position"),
      "reports.milestones",
    ),
  ]);
  const lineIds = lines.map((l) => l.id);
  const milestoneIds = milestones.map((m) => m.id);
  const [pauses, items] = await Promise.all([
    lineIds.length > 0
      ? must(await db.from("contract_line_pauses").select("line_id, starts_on, ends_on").eq("org_id", orgId).in("line_id", lineIds), "reports.pauses")
      : [],
    milestoneIds.length > 0
      ? must(
          await db.from("billable_items").select("contract_line_id, milestone_id, billable_on").eq("org_id", orgId).in("milestone_id", milestoneIds),
          "reports.milestoneItems",
        )
      : [],
  ]);

  const billedOn = new Map(items.map((i) => [`${i.contract_line_id}:${i.milestone_id}`, i.billable_on]));
  return contracts.map((contract) => {
    const own = milestones.filter((m) => m.contract_id === contract.id);
    return {
      id: contract.id,
      title: contract.title,
      signedOn: contract.signed_on,
      archived: contract.archived_at !== null,
      lines: lines
        .filter((line) => line.contract_id === contract.id)
        .map((line) => ({
          id: line.id,
          position: line.position,
          description: line.description,
          billingType: line.billing_type,
          startsOn: line.starts_on,
          endsOn: line.ends_on,
          replacesLineId: line.replaces_line_id,
          pauses: pauses.filter((p) => p.line_id === line.id).map((p) => ({ startsOn: p.starts_on, endsOn: p.ends_on })),
          milestonesBilledOn: line.billing_type === "one_off" ? own.map((m) => billedOn.get(`${line.id}:${m.id}`) ?? null) : [],
        })),
    };
  });
}

/** Los proyectos y tareas que el cliente ve (getPortalProjects) y cuándo se terminó cada tarea del mes. */
async function loadProjects(db: Db, orgId: string, clientId: string, bounds: { from: string; to: string }): Promise<ReportProjectFact[]> {
  const projects = await getPortalProjects(db, orgId, clientId);
  const withDone = projects.filter((p) => p.tasks.some((t) => t.status === "done")).map((p) => p.id);
  const completedAt = new Map<string, string>();
  if (withDone.length > 0) {
    const rows = await fetchAll(
      (from, to) =>
        db
          .from("project_tasks")
          .select("id, completed_at")
          .eq("org_id", orgId)
          .in("project_id", withDone)
          .eq("client_visible", true)
          .eq("status", "done")
          .gte("completed_at", bounds.from)
          .lt("completed_at", bounds.to)
          .order("id")
          .range(from, to),
      "reports.doneTasks",
    );
    for (const row of rows) if (row.completed_at) completedAt.set(row.id, row.completed_at);
  }
  return projects.map((project) => ({
    id: project.id,
    name: project.name,
    kind: project.kind,
    status: project.status,
    tasks: project.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      dueOn: task.dueOn,
      completedAt: completedAt.get(task.id) ?? null,
    })),
  }));
}

/** Las actividades visibles del mes que ya han pasado (una reunión prevista aún no es trabajo hecho). */
async function loadActivities(db: Db, orgId: string, clientId: string, bounds: { from: string; to: string }, now: Date) {
  const rows = must(
    await db
      .from("activities")
      .select("id, kind, title, body, occurred_at")
      .eq("org_id", orgId)
      .eq("client_id", clientId)
      .eq("client_visible", true)
      .gte("occurred_at", bounds.from)
      .lt("occurred_at", bounds.to)
      .lte("occurred_at", now.toISOString())
      .order("occurred_at")
      .limit(200),
    "reports.activities",
  );
  return rows.map((a) => ({ id: a.id, kind: a.kind as ReportActivityKind, title: a.title, body: a.body, occurredAt: a.occurred_at }));
}

/** Los entregables del cliente (pocos): el dominio se queda con los del mes. */
async function loadFiles(db: Db, orgId: string, clientId: string): Promise<ReportFileFact[]> {
  const rows = must(
    await db
      .from("client_files")
      .select("id, kind, title, file_name, url, uploaded_at, created_at")
      .eq("org_id", orgId)
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(500),
    "reports.files",
  );
  return rows.map((f) => ({
    id: f.id,
    kind: f.kind,
    title: f.title,
    fileName: f.file_name,
    url: f.url,
    uploadedAt: f.uploaded_at,
    createdAt: f.created_at,
  }));
}

/** Las facturas emitidas en el mes y todas las que siguen pendientes de pago hoy. */
async function loadInvoices(db: Db, orgId: string, clientId: string, month: Month): Promise<ReportInvoiceFact[]> {
  const [inMonth, open] = await Promise.all([
    db
      .from("invoices_overview")
      .select(INVOICE_COLUMNS)
      .eq("org_id", orgId)
      .eq("client_id", clientId)
      .eq("lifecycle", "issued")
      .gte("issued_on", month)
      .lte("issued_on", monthEnd(month))
      .limit(500),
    db
      .from("invoices_overview")
      .select(INVOICE_COLUMNS)
      .eq("org_id", orgId)
      .eq("client_id", clientId)
      .eq("lifecycle", "issued")
      .in("status", ["issued", "overdue"])
      .gt("outstanding_cents", 0)
      .limit(500),
  ]);
  if (inMonth.error) throw inMonth.error;
  if (open.error) throw open.error;
  const byId = new Map<string, ReportInvoiceFact>();
  for (const row of [...(inMonth.data ?? []), ...(open.data ?? [])] as InvoiceRow[]) {
    if (!row.id || !row.kind || !row.status) continue;
    byId.set(row.id, {
      id: row.id,
      number: row.number,
      kind: row.kind,
      status: row.status,
      issuedOn: row.issued_on,
      dueOn: row.due_on,
      totalCents: row.total_cents ?? 0,
      outstandingCents: row.outstanding_cents ?? 0,
    });
  }
  return [...byId.values()];
}

/** Las horas registradas en el mes en los proyectos del cliente (solo si se piden). */
async function loadHours(db: Db, orgId: string, clientId: string, month: Month): Promise<{ entries: ReportTimeFact[]; projects: ReportHoursProject[] }> {
  const projects = must(
    await db.from("projects").select("id, name, portal_visible, status, archived_at").eq("org_id", orgId).eq("client_id", clientId),
    "reports.hoursProjects",
  );
  if (projects.length === 0) return { entries: [], projects: [] };
  const entries = await fetchAll(
    (from, to) =>
      db
        .from("time_entries")
        .select("id, project_id, worked_on, minutes")
        .eq("org_id", orgId)
        .in(
          "project_id",
          projects.map((p) => p.id),
        )
        .gte("worked_on", month)
        .lte("worked_on", monthEnd(month))
        .not("minutes", "is", null)
        .order("id")
        .range(from, to),
    "reports.hours",
  );
  return {
    entries: entries.map((e) => ({ projectId: e.project_id, workedOn: e.worked_on, minutes: e.minutes ?? 0 })),
    // Se nombra lo que el cliente ve en su portal (la regla de getPortalProjects); el resto va junto.
    projects: projects.map((p) => ({ id: p.id, name: p.name, visible: p.portal_visible && p.archived_at === null && p.status !== "cancelled" })),
  };
}

// ---------------------------------------------------------------------------
// La web
// ---------------------------------------------------------------------------

type PropertyRow = {
  id: string | null;
  label: string | null;
  gsc_site_url: string | null;
  is_primary: boolean | null;
  first_metric_on: string | null;
  last_metric_on: string | null;
  first_web_on: string | null;
  last_web_on: string | null;
  metric_source: "gsc" | "ga4" | "demo" | null;
  web_source: "gsc" | "ga4" | "demo" | null;
  gsc_synced_from: string | null;
  gsc_synced_to: string | null;
  ga4_synced_from: string | null;
  ga4_synced_to: string | null;
};

const minDate = (a: string | null, b: string | null) => (a && b ? (a < b ? a : b) : (a ?? b));
const maxDate = (a: string | null, b: string | null) => (a && b ? (a > b ? a : b) : (a ?? b));

/**
 * Días que cubren los datos: los que tienen fila y los ya sincronizados (un día sincronizado sin
 * fila es un día a cero, no un día sin datos).
 */
function dataSpan(first: string | null, last: string | null, syncedFrom: string | null, syncedTo: string | null): DataSpan {
  const from = minDate(first, syncedFrom);
  const to = maxDate(last, syncedTo);
  return from && to && first && last ? { first: from, last: to } : null;
}

function siteLabel(label: string, url: string | null): string {
  if (!url) return label;
  return url.replace(/^sc-domain:/, "").replace(/^https?:\/\//, "").replace(/\/$/, "") || label;
}

type StatRow = {
  key: string;
  clicks: number;
  impressions: number;
  avg_position: number | null;
  compare_clicks: number;
  compare_impressions: number;
  compare_avg_position: number | null;
};

async function loadWeb(db: Db, orgId: string, clientId: string, month: Month): Promise<{ gate: ReportWebGate; facts: ReportWebFacts | null }> {
  const [settingsRes, propertiesRes] = await Promise.all([
    db.from("client_portal_settings").select("sections").eq("org_id", orgId).eq("client_id", clientId).maybeSingle(),
    db
      .from("seo_properties_overview")
      .select(
        "id, label, gsc_site_url, is_primary, first_metric_on, last_metric_on, first_web_on, last_web_on, metric_source, web_source, gsc_synced_from, gsc_synced_to, ga4_synced_from, ga4_synced_to",
      )
      .eq("org_id", orgId)
      .eq("client_id", clientId)
      .is("archived_at", null),
  ]);
  if (settingsRes.error) throw settingsRes.error;
  if (propertiesRes.error) throw propertiesRes.error;
  const properties = ((propertiesRes.data ?? []) as PropertyRow[]).filter((p): p is PropertyRow & { id: string } => Boolean(p.id));
  if (properties.length === 0) return { gate: "no_property", facts: null };
  if (!resolvePortalSections(settingsRes.data?.sections).web_data) return { gate: "section_off", facts: null };

  // La misma web que enseña el portal: la principal con datos o, si no, la primera con datos.
  const withData = properties.filter((p) => p.last_metric_on || p.last_web_on);
  const property = withData.find((p) => p.is_primary) ?? withData[0];
  if (!property) return { gate: "eligible", facts: null };

  const previous = addMonths(month, -1);
  const range = { from: previous, to: monthEnd(month) };
  const propertyId = property.id;
  const [searchRows, webRows, stats] = await Promise.all([
    property.last_metric_on
      ? fetchAll(
          (from, to) =>
            db
              .from("seo_daily_metrics")
              .select("metric_on, clicks, impressions, position")
              .eq("org_id", orgId)
              .eq("property_id", propertyId)
              .gte("metric_on", range.from)
              .lte("metric_on", range.to)
              .order("metric_on")
              .range(from, to),
          "reports.searchDays",
        )
      : Promise.resolve([]),
    property.last_web_on
      ? fetchAll(
          (from, to) =>
            db
              .from("web_analytics_daily")
              .select("metric_on, channel, sessions, users, engaged_sessions, conversions")
              .eq("org_id", orgId)
              .eq("property_id", propertyId)
              .gte("metric_on", range.from)
              .lte("metric_on", range.to)
              .order("metric_on")
              .order("channel")
              .range(from, to),
          "reports.webDays",
        )
      : Promise.resolve([]),
    property.last_metric_on
      ? db.rpc("seo_query_stats", {
          p_property_id: propertyId,
          p_dimension: "query",
          p_from: month,
          p_to: monthEnd(month),
          p_compare_from: previous,
          p_compare_to: monthEnd(previous),
          p_order: "clicks",
          p_limit: 10,
        })
      : Promise.resolve({ data: [] as StatRow[], error: null }),
  ]);
  if (stats.error) throw stats.error;

  const searchDays: SearchDay[] = searchRows.map((r) => ({
    date: r.metric_on,
    clicks: r.clicks,
    impressions: r.impressions,
    position: r.position === null ? null : Number(r.position),
  }));
  const toDay = (r: (typeof webRows)[number]): WebDay => ({
    date: r.metric_on,
    sessions: r.sessions,
    users: r.users,
    engagedSessions: r.engaged_sessions,
    conversions: r.conversions,
  });
  const webAll: WebDay[] = [];
  const webByChannel = new Map<TrafficChannel, WebDay[]>();
  for (const row of webRows) {
    if (row.channel === "all") {
      webAll.push(toDay(row));
      continue;
    }
    const list = webByChannel.get(row.channel) ?? [];
    list.push(toDay(row));
    webByChannel.set(row.channel, list);
  }
  const topQueries: QueryStat[] = ((stats.data ?? []) as StatRow[]).map((row) => ({
    key: row.key,
    clicks: Number(row.clicks),
    impressions: Number(row.impressions),
    position: row.avg_position === null ? null : Number(row.avg_position),
    compareClicks: Number(row.compare_clicks),
    compareImpressions: Number(row.compare_impressions),
    comparePosition: row.compare_avg_position === null ? null : Number(row.compare_avg_position),
  }));

  const source = property.metric_source ?? property.web_source ?? null;
  return {
    gate: "eligible",
    facts: {
      site: siteLabel(property.label ?? "", property.gsc_site_url),
      source,
      searchSpan: dataSpan(property.first_metric_on, property.last_metric_on, property.gsc_synced_from, property.gsc_synced_to),
      webSpan: dataSpan(property.first_web_on, property.last_web_on, property.ga4_synced_from, property.ga4_synced_to),
      searchDays,
      webAll,
      webByChannel,
      topQueries,
    },
  };
}
