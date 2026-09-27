// Sin "server-only": no lee secretos (recibe el cliente de Supabase ya creado) y lo usa también
// scripts/seed-demo-costs.ts para enseñar cómo queda la demo. Solo se importa desde código de servidor.
//
// Lecturas de la rentabilidad. Con el cliente del usuario pasan por su RLS: los costes por hora
// solo los lee un socio (partner u owner), así que quien llama tiene que comprobarlo antes; sin
// ellos, todo se valoraría con el coste por defecto. Con el de servidor (service_role), filtran por
// la org de forma explícita.
//
// - Ingresos: las facturas emitidas (lifecycle 'issued') con fecha en el periodo, vengan de donde
//   vengan (emitidas desde la app o históricas importadas con import_historical_invoice): no se
//   filtra por origen ni por serie. Y los cobros sin factura (client_receipts) del periodo, tal cual.
// - Costes: las horas, los gastos asignados al cliente y los repartidos entre las webs alojadas
//   (src/domain/profitability/other-costs.ts). La única fuente de los gastos son los gastos: las
//   suscripciones cuentan por los que generan (cada cargo hereda su asignación), nunca por su cuota.
// - Cobrado: la tabla payments (la única fuente de «cobrada» de una factura), por fecha de cobro y
//   con IVA, más los cobros sin factura.

import type { ClientProfitabilitySummary, ClientProfitabilityWindow } from "@/components/profitability/types";
import { type CivilDate, compareCivil, minCivil } from "@/domain/dates/civil-date";
import { expenseCostCents } from "@/domain/finance/expense";
import {
  buildProfitability,
  type ClientExpenseRef,
  type ClientRef,
  clientCostSplit,
  clientFigures,
  type ContractLineRevenue,
  type HostedCostRef,
  type HostedSiteRef,
  type InvoiceRevenue,
  lifetimePeriod,
  type MemberCost,
  type PaymentRef,
  type Period,
  type ProfitabilityReport,
  type ProfitabilitySettings,
  type ProjectRef,
  type ReceiptRef,
  rollingPeriod,
  type TimeEntryRef,
} from "@/domain/profitability";
import type { ProjectStatus } from "@/domain/projects";
import { type Db, fetchAll, must } from "@/server/billing/context";
import { profitabilitySettings } from "./settings";

type OrgRef = { id: string; settings: unknown };

/** Un rango de fechas civiles (los dos extremos cuentan). */
type Range = Pick<Period, "from" | "to">;

type Dated<T> = T & { on: CivilDate };

const within = (range: Range) => (row: { on: CivilDate }) => compareCivil(row.on, range.from) >= 0 && compareCivil(row.on, range.to) <= 0;

/** Lo que cabe en una URL de PostgREST: los filtros `in` largos van por tandas. */
const IN_CHUNK = 100;

function chunks<T>(items: readonly T[], size = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const earliest = (dates: readonly (CivilDate | null | undefined)[]): CivilDate | null => {
  const known = dates.filter((d): d is CivilDate => typeof d === "string" && d !== "");
  return known.length === 0 ? null : minCivil(known[0]!, ...known.slice(1));
};

/** Todo el historial de costes por hora de la org (lo anterior al periodo sigue vigente hasta el siguiente). */
export async function loadMemberCosts(db: Db, orgId: string): Promise<(MemberCost & { id: string })[]> {
  const rows = await fetchAll(
    (from, to) =>
      db
        .from("member_costs")
        .select("id, member_id, valid_from, hourly_cost_cents")
        .eq("org_id", orgId)
        .order("member_id")
        .order("valid_from")
        .range(from, to),
    "profitability.costs",
  );
  return rows.map((r) => ({ id: r.id, memberId: r.member_id, validFrom: r.valid_from, hourlyCostCents: r.hourly_cost_cents }));
}

/**
 * Facturas emitidas en el periodo (de la app o importadas: no se filtra por origen ni por serie),
 * con su base y lo que falta hoy por cobrar de cada una (invoices_overview, con IVA).
 */
async function loadInvoices(db: Db, orgId: string, range: Range, clientId?: string): Promise<Dated<InvoiceRevenue>[]> {
  const rows = await fetchAll((from, to) => {
    let query = db
      .from("invoices_overview")
      .select("id, client_id, issued_on, subtotal_cents, outstanding_cents, status")
      .eq("org_id", orgId)
      .eq("lifecycle", "issued")
      .gte("issued_on", range.from)
      .lte("issued_on", range.to);
    if (clientId) query = query.eq("client_id", clientId);
    return query.order("id").range(from, to);
  }, "profitability.invoices");
  return rows.flatMap((r) =>
    r.id && r.client_id && r.issued_on
      ? [
          {
            invoiceId: r.id,
            clientId: r.client_id,
            on: r.issued_on,
            baseCents: r.subtotal_cents ?? 0,
            // Solo lo que se debe: una factura cobrada de más o anulada no resta.
            pendingCents: r.status === "issued" || r.status === "overdue" ? Math.max(0, r.outstanding_cents ?? 0) : 0,
          },
        ]
      : [],
  );
}

/** Cobros con fecha en el periodo (con IVA), de la org o de un cliente: la tabla payments y nada más. */
async function loadPayments(db: Db, orgId: string, range: Range, clientId?: string): Promise<Dated<PaymentRef>[]> {
  const rows = await fetchAll((from, to) => {
    let query = db
      .from("payments")
      .select("id, amount_cents, paid_on, invoices!inner(client_id)")
      .eq("org_id", orgId)
      .gte("paid_on", range.from)
      .lte("paid_on", range.to);
    if (clientId) query = query.eq("invoices.client_id", clientId);
    return query.order("id").range(from, to);
  }, "profitability.payments");
  return rows.map((r) => ({ clientId: r.invoices.client_id, amountCents: r.amount_cents, on: r.paid_on }));
}

/** Cobros sin factura (client_receipts) con fecha en el periodo, de la org o de un cliente: ingreso tal cual y cobrado. */
async function loadReceipts(db: Db, orgId: string, range: Range, clientId?: string): Promise<Dated<ReceiptRef>[]> {
  const rows = await fetchAll((from, to) => {
    let query = db
      .from("client_receipts")
      .select("id, client_id, project_id, amount_cents, received_on")
      .eq("org_id", orgId)
      .gte("received_on", range.from)
      .lte("received_on", range.to);
    if (clientId) query = query.eq("client_id", clientId);
    return query.order("id").range(from, to);
  }, "profitability.receipts");
  return rows.map((r) => ({ clientId: r.client_id, projectId: r.project_id, amountCents: r.amount_cents, on: r.received_on }));
}

async function loadContractLines(db: Db, orgId: string, range: Range): Promise<ContractLineRevenue[]> {
  const rows = await fetchAll(
    (from, to) =>
      db
        .from("project_contract_revenue")
        .select("invoice_id, contract_id, base_cents, invoice_line_id")
        .eq("org_id", orgId)
        .gte("issued_on", range.from)
        .lte("issued_on", range.to)
        .order("invoice_line_id")
        .range(from, to),
    "profitability.contractLines",
  );
  return rows.flatMap((r) =>
    r.invoice_id && r.contract_id && r.base_cents !== null ? [{ invoiceId: r.invoice_id, contractId: r.contract_id, baseCents: r.base_cents }] : [],
  );
}

async function loadProjects(db: Db, orgId: string, clientId?: string): Promise<ProjectRef[]> {
  const rows = await fetchAll((from, to) => {
    let query = db.from("projects").select("id, client_id, contract_id, name, status, archived_at").eq("org_id", orgId);
    if (clientId) query = query.eq("client_id", clientId);
    return query.order("id").range(from, to);
  }, "profitability.projects");
  return rows.map((r) => ({
    id: r.id,
    clientId: r.client_id,
    contractId: r.contract_id,
    name: r.name,
    status: r.status as ProjectStatus,
    archived: r.archived_at !== null,
  }));
}

/** Registros de horas terminados (el temporizador en marcha no cuenta) del periodo, de la org o de unos proyectos. */
async function loadEntries(db: Db, orgId: string, range: Range, projectIds?: readonly string[]): Promise<TimeEntryRef[]> {
  if (projectIds && projectIds.length === 0) return [];
  const load = (ids?: readonly string[]) =>
    fetchAll((from, to) => {
      let query = db
        .from("time_entries")
        .select("id, member_id, project_id, worked_on, minutes")
        .eq("org_id", orgId)
        .gte("worked_on", range.from)
        .lte("worked_on", range.to)
        .not("minutes", "is", null);
      if (ids) query = query.in("project_id", [...ids]);
      return query.order("id").range(from, to);
    }, "profitability.entries");
  const rows = projectIds ? (await Promise.all(chunks(projectIds).map(load))).flat() : await load();
  return rows.flatMap((r) =>
    r.minutes === null ? [] : [{ memberId: r.member_id, projectId: r.project_id, workedOn: r.worked_on, minutes: r.minutes }],
  );
}

async function loadClients(db: Db, orgId: string, clientId?: string): Promise<ClientRef[]> {
  const rows = await fetchAll((from, to) => {
    let query = db.from("clients").select("id, display_name").eq("org_id", orgId);
    if (clientId) query = query.eq("id", clientId);
    return query.order("id").range(from, to);
  }, "profitability.clients");
  return rows.map((r) => ({ id: r.id, name: r.display_name }));
}

/** Gastos asignados a un cliente (o a todos) con fecha de factura en el periodo, con lo que cuestan. */
async function loadClientExpenses(db: Db, orgId: string, range: Range, clientId?: string): Promise<Dated<ClientExpenseRef>[]> {
  const rows = await fetchAll((from, to) => {
    let query = db
      .from("expenses")
      .select("id, client_id, issued_on, base_cents, vat_cents, vat_deductible, rebill, rebill_invoice_line_id")
      .eq("org_id", orgId)
      .eq("allocation", "client")
      .gte("issued_on", range.from)
      .lte("issued_on", range.to);
    if (clientId) query = query.eq("client_id", clientId);
    return query.order("id").range(from, to);
  }, "profitability.clientExpenses");
  return rows.flatMap((r) =>
    r.client_id
      ? [
          {
            clientId: r.client_id,
            on: r.issued_on,
            costCents: expenseCostCents({ baseCents: r.base_cents, vatCents: r.vat_cents, vatDeductible: r.vat_deductible }),
            rebill: r.rebill,
            rebilled: r.rebill_invoice_line_id !== null,
          },
        ]
      : [],
  );
}

/** Gastos repartidos entre las webs alojadas con fecha de factura en el periodo. */
async function loadHostedCosts(db: Db, orgId: string, range: Range): Promise<Dated<HostedCostRef>[]> {
  const rows = await fetchAll(
    (from, to) =>
      db
        .from("expenses")
        .select("id, issued_on, base_cents, vat_cents, vat_deductible")
        .eq("org_id", orgId)
        .eq("allocation", "hosted_sites")
        .gte("issued_on", range.from)
        .lte("issued_on", range.to)
        .order("id")
        .range(from, to),
    "profitability.hostedCosts",
  );
  return rows.map((r) => ({
    on: r.issued_on,
    issuedOn: r.issued_on,
    costCents: expenseCostCents({ baseCents: r.base_cents, vatCents: r.vat_cents, vatDeductible: r.vat_deductible }),
  }));
}

/**
 * Las webs que alojamos y están activas (Webs): entre ellas se reparte la infraestructura. Webs no
 * guarda desde cuándo se aloja cada una, así que el reparto de cualquier periodo usa las de hoy.
 */
async function loadHostedSites(db: Db, orgId: string): Promise<HostedSiteRef[]> {
  const rows = await fetchAll(
    (from, to) => db.from("sites").select("id, client_id").eq("org_id", orgId).eq("hosted_by_us", true).eq("is_active", true).order("id").range(from, to),
    "profitability.hostedSites",
  );
  return rows.map((r) => ({ id: r.id, clientId: r.client_id }));
}

/**
 * Desde cuándo es cliente cada uno de estos (su primera factura emitida, su primer cobro sin
 * factura o su primer gasto directo, lo que sea antes): su parte de la infraestructura cuenta desde
 * ese día. Quien no tiene ninguna de esas cosas no sale (aún no carga con nada).
 */
async function loadHostingStarts(db: Db, orgId: string, clientIds: readonly string[]): Promise<Map<string, CivilDate>> {
  const ids = [...new Set(clientIds)];
  const starts = new Map<string, CivilDate>();
  if (ids.length === 0) return starts;
  const note = (clientId: string | null, on: CivilDate | null) => {
    if (!clientId || !on) return;
    const current = starts.get(clientId);
    if (!current || compareCivil(on, current) < 0) starts.set(clientId, on);
  };
  await Promise.all(
    chunks(ids).map(async (part) => {
      const [firstInvoices, expenses, receipts] = await Promise.all([
        db.from("clients_overview").select("id, first_invoice_on").eq("org_id", orgId).in("id", part),
        fetchAll(
          (from, to) =>
            db
              .from("expenses")
              .select("id, client_id, issued_on")
              .eq("org_id", orgId)
              .eq("allocation", "client")
              .in("client_id", part)
              .order("issued_on")
              .order("id")
              .range(from, to),
          "profitability.hostingStarts.expenses",
        ),
        fetchAll(
          (from, to) =>
            db
              .from("client_receipts")
              .select("id, client_id, received_on")
              .eq("org_id", orgId)
              .in("client_id", part)
              .order("received_on")
              .order("id")
              .range(from, to),
          "profitability.hostingStarts.receipts",
        ),
      ]);
      for (const row of must(firstInvoices, "profitability.hostingStarts.invoices")) note(row.id, row.first_invoice_on);
      for (const row of expenses) note(row.client_id, row.issued_on);
      for (const row of receipts) note(row.client_id, row.received_on);
    }),
  );
  return starts;
}

/**
 * El primer día con algo que contar: la primera factura emitida, el primer cobro sin factura o el
 * primer coste (horas o gastos), de la org o de un cliente.
 */
async function firstActivityOn(db: Db, orgId: string, clientId?: string, projectIds?: readonly string[]): Promise<CivilDate | null> {
  const firstInvoice = async () => {
    let query = db.from("invoices").select("issued_on").eq("org_id", orgId).eq("lifecycle", "issued").not("issued_on", "is", null);
    if (clientId) query = query.eq("client_id", clientId);
    const { data, error } = await query.order("issued_on").limit(1);
    if (error) throw error;
    return data?.[0]?.issued_on ?? null;
  };
  const firstEntry = async () => {
    if (projectIds && projectIds.length === 0) return null;
    const first = async (ids?: readonly string[]) => {
      let query = db.from("time_entries").select("worked_on").eq("org_id", orgId).not("minutes", "is", null);
      if (ids) query = query.in("project_id", [...ids]);
      const { data, error } = await query.order("worked_on").limit(1);
      if (error) throw error;
      return data?.[0]?.worked_on ?? null;
    };
    return projectIds ? earliest(await Promise.all(chunks(projectIds).map(first))) : first();
  };
  const firstExpense = async () => {
    // Los gastos que cuentan en la rentabilidad: los de un cliente y los repartidos entre las webs.
    let query = db.from("expenses").select("issued_on").eq("org_id", orgId);
    query = clientId ? query.eq("allocation", "client").eq("client_id", clientId) : query.in("allocation", ["client", "hosted_sites"]);
    const { data, error } = await query.order("issued_on").limit(1);
    if (error) throw error;
    return data?.[0]?.issued_on ?? null;
  };
  const firstReceipt = async () => {
    let query = db.from("client_receipts").select("received_on").eq("org_id", orgId);
    if (clientId) query = query.eq("client_id", clientId);
    const { data, error } = await query.order("received_on").limit(1);
    if (error) throw error;
    return data?.[0]?.received_on ?? null;
  };
  const [invoice, receipt, entry, expense] = await Promise.all([firstInvoice(), firstReceipt(), firstEntry(), firstExpense()]);
  return earliest([invoice, receipt, entry, expense]);
}

/** «Desde siempre» con su primer día de verdad (el de la org); cualquier otro periodo, tal cual. */
export async function resolveLifetime(db: Db, orgId: string, period: Period): Promise<Period> {
  if (period.kind !== "all") return period;
  return lifetimePeriod(period.to, await firstActivityOn(db, orgId));
}

export type ProfitabilityData = {
  /** El periodo pedido; «Desde siempre», ya con su primer día. */
  period: Period;
  report: ProfitabilityReport;
  settings: ProfitabilitySettings;
  /** ¿Hay algún coste por hora guardado? Sin ninguno, todo se valora con el de la org. */
  costsConfigured: boolean;
};

/** La rentabilidad de todos los clientes (y el trabajo interno) de la org en un periodo. */
export async function loadProfitability(db: Db, org: OrgRef, requested: Period): Promise<ProfitabilityData> {
  const settings = profitabilitySettings(org.settings);
  const period = await resolveLifetime(db, org.id, requested);
  const [invoices, payments, receipts, contractLines, projects, entries, costs, clients, clientExpenses, hostedCosts, hostedSites] = await Promise.all([
    loadInvoices(db, org.id, period),
    loadPayments(db, org.id, period),
    loadReceipts(db, org.id, period),
    loadContractLines(db, org.id, period),
    loadProjects(db, org.id),
    loadEntries(db, org.id, period),
    loadMemberCosts(db, org.id),
    loadClients(db, org.id),
    loadClientExpenses(db, org.id, period),
    loadHostedCosts(db, org.id, period),
    loadHostedSites(db, org.id),
  ]);
  const hostingStarts = await loadHostingStarts(
    db,
    org.id,
    hostedSites.flatMap((s) => (s.clientId ? [s.clientId] : [])),
  );
  const report = buildProfitability({
    invoices,
    payments,
    receipts,
    contractLines,
    projects,
    entries,
    costs,
    clients,
    settings,
    clientExpenses,
    hostedCosts,
    hostedSites,
    hostingStarts,
  });
  return { period, report, settings, costsConfigured: costs.length > 0 };
}

/**
 * Las cifras de un cliente en los últimos 3 y 12 meses y desde siempre (desde su primera factura,
 * su primer cobro sin factura o su primer coste), para su ficha. Solo hacen falta sus totales, que no dependen de cómo se reparte
 * entre sus proyectos: no se leen las líneas de contrato. Su parte de la infraestructura sí necesita
 * todas las webs alojadas (se reparte entre todas). Se lee una vez lo que cubre las tres ventanas y
 * cada una se queda con lo suyo.
 */
export async function loadClientProfitability(db: Db, org: OrgRef, clientId: string, today: CivilDate): Promise<ClientProfitabilitySummary> {
  const settings = profitabilitySettings(org.settings);
  const year = rollingPeriod(today, 12);
  const quarter = rollingPeriod(today, 3);
  const [projects, costs, clients, hostedSites, hostingStarts] = await Promise.all([
    loadProjects(db, org.id, clientId),
    loadMemberCosts(db, org.id),
    loadClients(db, org.id, clientId),
    loadHostedSites(db, org.id),
    loadHostingStarts(db, org.id, [clientId]),
  ]);
  const projectIds = projects.map((p) => p.id);
  const firstOn = await firstActivityOn(db, org.id, clientId, projectIds);
  const lifetime = firstOn === null ? null : lifetimePeriod(today, firstOn);
  // Lo que cubre las tres ventanas.
  const span: Range = { from: lifetime && compareCivil(lifetime.from, year.from) < 0 ? lifetime.from : year.from, to: today };
  const [invoices, payments, receipts, entries, clientExpenses, hostedCosts] = await Promise.all([
    loadInvoices(db, org.id, span, clientId),
    loadPayments(db, org.id, span, clientId),
    loadReceipts(db, org.id, span, clientId),
    loadEntries(db, org.id, span, projectIds),
    loadClientExpenses(db, org.id, span, clientId),
    loadHostedCosts(db, org.id, span),
  ]);

  const window = (period: Period): ClientProfitabilityWindow => {
    const inWindow = within(period);
    const report = buildProfitability({
      invoices: invoices.filter(inWindow),
      payments: payments.filter(inWindow),
      receipts: receipts.filter(inWindow),
      contractLines: [],
      projects,
      entries: entries.filter((e) => compareCivil(e.workedOn, period.from) >= 0 && compareCivil(e.workedOn, period.to) <= 0),
      costs,
      clients,
      settings,
      clientExpenses: clientExpenses.filter(inWindow),
      hostedCosts: hostedCosts.filter(inWindow),
      hostedSites,
      hostingStarts,
    });
    return { ...clientFigures(report, clientId, settings), ...clientCostSplit(report, clientId), from: period.from, to: period.to };
  };
  return {
    last3m: window(quarter),
    last12m: window(year),
    lifetime: lifetime ? window(lifetime) : null,
    costsConfigured: costs.length > 0,
    minMarginBps: settings.minMarginBps,
    minHourlyRateCents: settings.minHourlyRateCents,
  };
}
