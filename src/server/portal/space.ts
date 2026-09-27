import "server-only";
import type {
  SpaceContract,
  SpaceData,
  SpaceDocuments,
  SpaceFile,
  SpaceInvoice,
  SpaceProject,
  SpaceQuote,
  SpaceService,
  SpaceWorkProject,
} from "@/components/portal/types";
import type { CivilDate } from "@/domain/dates/civil-date";
import {
  clientInvoiceStatus,
  enabledPortalSections,
  isPortalLocale,
  paymentInstruction,
  phaseProgress,
  projectPhases,
  publicQuoteState,
  resolvePortalSections,
} from "@/domain/portal";
import { nowInZone } from "@/lib/clock";
import type { Db } from "@/server/billing/context";
import { getPortalProjects, type PortalProject } from "@/server/projects/portal";
import type { PortalLink } from "./access";
import { completedTaskItems, type DatedWorkItem, DONE_TASK_DAYS, mergeWorkLog, toSpaceWorkProject } from "./space-projects";
import { loadPortalWebData } from "./web-data";

/**
 * «Tu espacio»: todo lo que ve el cliente en su portal, leído con la clave de servidor y siempre
 * filtrado por la org y el cliente del enlace. Solo se carga lo de las secciones encendidas.
 * Nunca sale nada interno: ni notas de contrato, ni actividades sin marcar, ni borradores, ni
 * proyectos o tareas que un socio no haya hecho visibles (getPortalProjects), ni horas ni importes.
 */

type Contract = { id: string; title: string; signed_on: string; status: SpaceContract["status"]; issuer_id: string | null };

/** Entradas de «Lo que hemos hecho» (actividades y tareas terminadas, juntas). */
const WORK_LOG_LIMIT = 40;
const DAY_MS = 86_400_000;

function greetingAt(hour: number): SpaceData["greeting"] {
  if (hour >= 6 && hour < 14) return "morning";
  if (hour >= 14 && hour < 21) return "afternoon";
  return "evening";
}

function fail(error: unknown): never {
  throw error;
}

async function loadContracts(admin: Db, orgId: string, clientId: string): Promise<Contract[]> {
  const { data, error } = await admin
    .from("contracts_overview")
    .select("id, title, signed_on, status, issuer_id")
    .eq("org_id", orgId)
    .eq("client_id", clientId)
    .not("signed_on", "is", null)
    .is("archived_at", null)
    .order("signed_on", { ascending: false });
  if (error) fail(error);
  return (data ?? []).flatMap((c) => (c.id && c.title && c.signed_on && c.status ? [{ ...c, id: c.id, title: c.title, signed_on: c.signed_on, status: c.status }] : []));
}

/** Los proyectos por fases: los hitos de sus contratos. */
async function loadPhases(admin: Db, orgId: string, contracts: Contract[]): Promise<SpaceProject[]> {
  const ids = contracts.map((c) => c.id);
  if (ids.length === 0) return [];
  const { data: milestones, error } = await admin
    .from("contract_milestones")
    .select("id, contract_id, position, label, planned_on")
    .eq("org_id", orgId)
    .in("contract_id", ids);
  if (error) fail(error);
  const milestoneIds = (milestones ?? []).map((m) => m.id);
  const billed = new Set<string>();
  if (milestoneIds.length > 0) {
    const { data: items, error: itemsError } = await admin
      .from("billable_items")
      .select("milestone_id")
      .eq("org_id", orgId)
      .in("milestone_id", milestoneIds)
      .is("waived_at", null);
    if (itemsError) fail(itemsError);
    for (const item of items ?? []) if (item.milestone_id) billed.add(item.milestone_id);
  }
  const projects = contracts.flatMap((contract) => {
    const own = (milestones ?? []).filter((m) => m.contract_id === contract.id);
    if (own.length === 0) return [];
    const phases = projectPhases(
      own.map((m) => ({ id: m.id, position: m.position, label: m.label, plannedOn: m.planned_on })),
      billed,
    );
    return [{ contractId: contract.id, title: contract.title, phases, progress: phaseProgress(phases) }];
  });
  // Primero lo que está en marcha; lo terminado, al final.
  projects.sort((a, b) => Number(a.progress.ratio === 1) - Number(b.progress.ratio === 1));
  return projects;
}

/** Las actividades que un socio ha marcado como visibles, ya pasadas. */
async function loadActivities(admin: Db, orgId: string, clientId: string, timeZone: string): Promise<DatedWorkItem[]> {
  const { data, error } = await admin
    .from("activities")
    .select("id, kind, title, body, occurred_at")
    .eq("org_id", orgId)
    .eq("client_id", clientId)
    .eq("client_visible", true)
    .lte("occurred_at", new Date().toISOString())
    .order("occurred_at", { ascending: false })
    .limit(WORK_LOG_LIMIT);
  if (error) fail(error);
  return (data ?? []).map((a) => ({
    at: a.occurred_at,
    item: {
      id: a.id,
      kind: a.kind,
      title: a.title,
      body: a.body?.trim() || null,
      project: null,
      occurredOn: nowInZone(timeZone, new Date(a.occurred_at)).date,
    },
  }));
}

/**
 * Cuándo se terminaron las tareas visibles hechas de los últimos días. getPortalProjects no trae esa
 * fecha: aquí solo se lee `completed_at`, y completedTaskItems se queda con las tareas que él devuelve.
 */
async function loadDoneTasks(admin: Db, orgId: string, projects: PortalProject[], today: CivilDate, timeZone: string): Promise<DatedWorkItem[]> {
  const ids = projects.filter((p) => p.tasks.some((t) => t.status === "done")).map((p) => p.id);
  if (ids.length === 0) return [];
  // Un día de margen por la zona horaria: el corte exacto lo pone completedTaskItems en días civiles.
  const since = new Date(Date.now() - (DONE_TASK_DAYS + 1) * DAY_MS).toISOString();
  const { data, error } = await admin
    .from("project_tasks")
    .select("id, completed_at")
    .eq("org_id", orgId)
    .in("project_id", ids)
    .eq("client_visible", true)
    .eq("status", "done")
    .gte("completed_at", since)
    .order("completed_at", { ascending: false })
    .limit(WORK_LOG_LIMIT);
  if (error) fail(error);
  const completedAt = new Map((data ?? []).flatMap((t): [string, string][] => (t.completed_at ? [[t.id, t.completed_at]] : [])));
  return completedTaskItems(projects, completedAt, { today, timeZone });
}

/** Los proyectos visibles del cliente y, si se enseña «Lo que hemos hecho», sus tareas terminadas. */
async function loadProjects(
  admin: Db,
  orgId: string,
  clientId: string,
  opts: { today: CivilDate; timeZone: string; withDone: boolean },
): Promise<{ projects: SpaceWorkProject[]; done: DatedWorkItem[] }> {
  const projects = await getPortalProjects(admin, orgId, clientId);
  const done = opts.withDone ? await loadDoneTasks(admin, orgId, projects, opts.today, opts.timeZone) : [];
  return { projects: projects.map((p) => toSpaceWorkProject(p, opts.today)), done };
}

async function loadFiles(admin: Db, orgId: string, clientId: string, contracts: Contract[], timeZone: string): Promise<SpaceFile[]> {
  const { data, error } = await admin
    .from("client_files")
    .select("id, kind, title, file_name, size_bytes, url, uploaded_at, created_at, contract_id")
    .eq("org_id", orgId)
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });
  if (error) fail(error);
  const titles = new Map(contracts.map((c) => [c.id, c.title]));
  return (data ?? [])
    .filter((f) => f.kind === "link" || f.uploaded_at !== null)
    .map((f) => ({
      id: f.id,
      kind: f.kind,
      title: f.title,
      fileName: f.file_name,
      sizeBytes: f.size_bytes,
      url: f.kind === "link" ? f.url : null,
      addedOn: nowInZone(timeZone, new Date(f.uploaded_at ?? f.created_at)).date,
      contractTitle: f.contract_id ? (titles.get(f.contract_id) ?? null) : null,
    }));
}

async function loadServices(admin: Db, orgId: string, contracts: Contract[]): Promise<SpaceService[]> {
  const ids = contracts.map((c) => c.id);
  if (ids.length === 0) return [];
  const { data, error } = await admin
    .from("contract_lines_overview")
    .select("id, contract_id, position, description, billing_type, status, starts_on, ends_on")
    .eq("org_id", orgId)
    .in("contract_id", ids)
    .in("status", ["active", "paused", "scheduled"]);
  if (error) fail(error);
  const contractOrder = new Map(contracts.map((c, index) => [c.id, index]));
  const titles = new Map(contracts.map((c) => [c.id, c.title]));
  const statusOrder = ["active", "paused", "scheduled"];
  return (data ?? [])
    .flatMap((l) =>
      l.id && l.contract_id && l.description && l.billing_type && (l.status === "active" || l.status === "paused" || l.status === "scheduled")
        ? [{ ...l, id: l.id, contract_id: l.contract_id, description: l.description, billing_type: l.billing_type, status: l.status }]
        : [],
    )
    .sort(
      (a, b) =>
        statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status) ||
        (contractOrder.get(a.contract_id) ?? 0) - (contractOrder.get(b.contract_id) ?? 0) ||
        (a.position ?? 0) - (b.position ?? 0),
    )
    .map((l) => ({
      id: l.id,
      description: l.description,
      billingType: l.billing_type,
      status: l.status,
      startsOn: l.starts_on,
      endsOn: l.ends_on,
      contractTitle: titles.get(l.contract_id) ?? "",
    }));
}

type IssuerSnapshot = { legal_name?: string; trade_name?: string | null; iban?: string | null };

async function loadDocuments(
  admin: Db,
  orgId: string,
  clientId: string,
  contracts: Contract[],
  today: CivilDate,
  timeZone: string,
): Promise<{ documents: SpaceDocuments; issuerIds: string[] }> {
  const [invoicesRes, quotesRes] = await Promise.all([
    admin
      .from("invoices_overview")
      .select("id, number, kind, status, issued_on, due_on, total_cents, outstanding_cents, issuer_id, issuer_name")
      .eq("org_id", orgId)
      .eq("client_id", clientId)
      .eq("lifecycle", "issued")
      .order("issued_on", { ascending: false })
      .order("number", { ascending: false })
      .limit(200),
    admin
      .from("quotes")
      .select("id, number, title, status, valid_until, accepted_at, contract_id")
      .eq("org_id", orgId)
      .eq("client_id", clientId)
      .in("status", ["sent", "accepted"])
      .order("issued_on", { ascending: false }),
  ]);
  if (invoicesRes.error) fail(invoicesRes.error);
  if (quotesRes.error) fail(quotesRes.error);

  const rows = (invoicesRes.data ?? []).flatMap((r) =>
    r.id && r.number && r.kind && r.status && r.issuer_id ? [{ ...r, id: r.id, number: r.number, kind: r.kind, status: r.status, issuer_id: r.issuer_id }] : [],
  );
  // Para pagar: el método y el IBAN que imprime cada factura pendiente (su copia congelada).
  const pendingIds = rows.filter((r) => r.kind === "ordinary" && (r.status === "issued" || r.status === "overdue") && (r.outstanding_cents ?? 0) > 0).map((r) => r.id);
  const issuerIds = [...new Set(rows.map((r) => r.issuer_id))];
  const [extraRes, issuersRes] = await Promise.all([
    pendingIds.length
      ? admin.from("invoices").select("id, payment_method, issuer_snapshot").eq("org_id", orgId).in("id", pendingIds)
      : Promise.resolve({ data: [] as { id: string; payment_method: SpaceInvoiceMethod; issuer_snapshot: unknown }[], error: null }),
    issuerIds.length
      ? admin.from("issuers").select("id, legal_name, iban").eq("org_id", orgId).in("id", issuerIds)
      : Promise.resolve({ data: [] as { id: string; legal_name: string; iban: string | null }[], error: null }),
  ]);
  if (extraRes.error) fail(extraRes.error);
  if (issuersRes.error) fail(issuersRes.error);
  const extra = new Map((extraRes.data ?? []).map((x) => [x.id, x]));
  const issuers = new Map((issuersRes.data ?? []).map((i) => [i.id, i]));

  const invoices: SpaceInvoice[] = rows.flatMap((r): SpaceInvoice[] => {
    const status = clientInvoiceStatus(r.kind, r.status);
    if (!status) return [];
    const more = extra.get(r.id);
    const snapshot = (more?.issuer_snapshot ?? null) as IssuerSnapshot | null;
    const issuer = issuers.get(r.issuer_id);
    const instruction = more
      ? paymentInstruction({
          kind: r.kind,
          status: r.status,
          number: r.number,
          outstandingCents: r.outstanding_cents ?? 0,
          dueOn: r.due_on,
          paymentMethod: more.payment_method,
          iban: snapshot?.iban ?? issuer?.iban ?? null,
        })
      : null;
    return [
      {
        id: r.id,
        number: r.number,
        status,
        issuedOn: r.issued_on,
        dueOn: r.due_on,
        totalCents: r.total_cents ?? 0,
        outstandingCents: r.outstanding_cents ?? 0,
        issuerName: r.issuer_name ?? "",
        payment: instruction ? { ...instruction, holder: snapshot?.legal_name ?? issuer?.legal_name ?? r.issuer_name ?? "" } : null,
      },
    ];
  });

  const quotesByContract = new Map<string, { id: string; number: string }>();
  const quotes: SpaceQuote[] = (quotesRes.data ?? []).flatMap((q): SpaceQuote[] => {
    if (!q.number) return [];
    if (q.contract_id) quotesByContract.set(q.contract_id, { id: q.id, number: q.number });
    const state = publicQuoteState({ status: q.status, validUntil: q.valid_until }, today);
    // Lo caducado sin respuesta ya no se puede aceptar: no llena la lista.
    if (state !== "open" && state !== "accepted") return [];
    return [
      {
        id: q.id,
        number: q.number,
        title: q.title,
        state,
        validUntil: q.valid_until,
        acceptedOn: q.accepted_at ? nowInZone(timeZone, new Date(q.accepted_at)).date : null,
      },
    ];
  });
  // Primero lo que espera respuesta.
  quotes.sort((a, b) => Number(a.state !== "open") - Number(b.state !== "open"));

  const contractsView: SpaceContract[] = contracts.map((c) => ({
    id: c.id,
    title: c.title,
    signedOn: c.signed_on,
    status: c.status,
    quote: quotesByContract.get(c.id) ?? null,
  }));

  return { documents: { invoices, quotes, contracts: contractsView }, issuerIds };
}

type SpaceInvoiceMethod = "transfer" | "sepa_debit" | "card" | "cash" | "other";

async function loadFooter(admin: Db, orgId: string, issuerIds: string[]): Promise<SpaceData["footer"]> {
  let query = admin.from("issuers").select("legal_name, trade_name, email, is_primary").eq("org_id", orgId).is("archived_at", null);
  query = issuerIds.length > 0 ? query.in("id", issuerIds) : query.eq("is_primary", true);
  const { data, error } = await query.order("is_primary", { ascending: false }).order("legal_name");
  if (error) fail(error);
  const rows = data ?? [];
  return {
    issuers: rows.map((i) => i.legal_name),
    email: rows.find((i) => i.email?.trim())?.email?.trim() ?? null,
  };
}

/** Todo el portal de un cliente. null si el cliente ya no existe. */
export async function loadClientSpace(admin: Db, link: PortalLink): Promise<SpaceData | null> {
  const orgId = link.orgId;
  const clientId = link.clientId;
  if (link.kind !== "client" || !clientId) return null;

  const [clientRes, settingsRes, orgRes] = await Promise.all([
    admin.from("clients").select("id, display_name, preferred_language").eq("org_id", orgId).eq("id", clientId).maybeSingle(),
    admin.from("client_portal_settings").select("sections, next_steps").eq("org_id", orgId).eq("client_id", clientId).maybeSingle(),
    admin.from("orgs").select("timezone").eq("id", orgId).single(),
  ]);
  if (clientRes.error) fail(clientRes.error);
  if (settingsRes.error) fail(settingsRes.error);
  if (orgRes.error) fail(orgRes.error);
  const client = clientRes.data;
  if (!client) return null;

  const timeZone = orgRes.data.timezone;
  const now = nowInZone(timeZone);
  const today = now.date;
  const flags = resolvePortalSections(settingsRes.data?.sections);
  const sections = enabledPortalSections(flags);
  const on = new Set(sections);
  const nextSteps = settingsRes.data?.next_steps?.trim() || null;

  const needsContracts = on.has("progress") || on.has("services") || on.has("documents") || on.has("files");
  const contracts = needsContracts ? await loadContracts(admin, orgId, clientId) : [];
  const needsProjects = on.has("progress") || on.has("work_log");

  const [phases, activities, projects, files, services, docs, webData] = await Promise.all([
    on.has("progress") ? loadPhases(admin, orgId, contracts) : null,
    on.has("work_log") ? loadActivities(admin, orgId, clientId, timeZone) : null,
    needsProjects ? loadProjects(admin, orgId, clientId, { today, timeZone, withDone: on.has("work_log") }) : null,
    on.has("files") ? loadFiles(admin, orgId, clientId, contracts, timeZone) : null,
    on.has("services") ? loadServices(admin, orgId, contracts) : null,
    on.has("documents") ? loadDocuments(admin, orgId, clientId, contracts, today, timeZone) : null,
    on.has("web_data") ? loadPortalWebData(admin, orgId, clientId, today) : null,
  ]);
  const progress = phases ? { projects: phases, workProjects: projects?.projects ?? [], nextSteps } : null;
  const workLog = activities ? mergeWorkLog([...activities, ...(projects?.done ?? [])], WORK_LOG_LIMIT) : null;

  const issuerIds = [...new Set([...(docs?.issuerIds ?? []), ...contracts.map((c) => c.issuer_id).filter((id): id is string => Boolean(id))])];
  const footer = await loadFooter(admin, orgId, issuerIds);

  return {
    locale: isPortalLocale(client.preferred_language) ? client.preferred_language : "es",
    clientName: client.display_name,
    greeting: greetingAt(now.hour),
    today,
    sections,
    progress,
    workLog,
    files,
    services,
    documents: docs?.documents ?? null,
    webData,
    footer,
  };
}
