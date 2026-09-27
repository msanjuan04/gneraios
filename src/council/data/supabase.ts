import "server-only";

// CouncilData sobre Supabase: las mismas vistas y funciones que usan el dashboard, Facturación,
// SEO, Finanzas y Proyectos, siempre filtrando por la org de forma explícita (el runner usa service_role).
// Solo SELECT y RPC de lectura: el consejo no escribe nada del negocio.

import type { CivilDate } from "@/domain/dates/civil-date";
import type { InvoiceStatus, Month, SnapshotLike } from "@/domain/metrics";
import { nowInZone } from "@/lib/clock";
import { type Db, fetchAll, must } from "@/server/billing/context";
import { getFinanceSnapshot } from "@/server/finance/snapshot";
import { loadRevenueRows } from "@/server/metrics/sources";
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

const localDate = (instant: string, timeZone: string) => nowInZone(timeZone, new Date(instant)).date;

export class SupabaseCouncilData implements CouncilData {
  private orgPromise: Promise<OrgInfo> | null = null;

  constructor(
    private readonly db: Db,
    private readonly orgId: string,
  ) {}

  org(): Promise<OrgInfo> {
    this.orgPromise ??= (async () => {
      const row = must(await this.db.from("orgs").select("id, name, slug, timezone, locale, currency, settings").eq("id", this.orgId).single(), "council.org");
      return { id: row.id, name: row.name, slug: row.slug, timezone: row.timezone, locale: row.locale, currency: row.currency, settings: row.settings };
    })();
    return this.orgPromise;
  }

  async members(): Promise<MemberInfo[]> {
    const rows = must(await this.db.from("members").select("id, full_name, initials, role").eq("org_id", this.orgId).eq("is_active", true), "council.members");
    return rows.map((m) => ({ id: m.id, fullName: m.full_name, initials: m.initials, role: m.role }));
  }

  async issuers(): Promise<IssuerInfo[]> {
    const rows = must(
      await this.db
        .from("issuers")
        .select("id, legal_name, trade_name, kind, verifactu_from, fiscal_provider, active_from, active_until")
        .eq("org_id", this.orgId)
        .is("archived_at", null),
      "council.issuers",
    );
    return rows.map((i) => ({
      id: i.id,
      name: i.trade_name || i.legal_name,
      kind: i.kind,
      verifactuFrom: i.verifactu_from,
      fiscalProvider: i.fiscal_provider,
      activeFrom: i.active_from,
      activeUntil: i.active_until,
    }));
  }

  async contractLines(): Promise<CouncilLine[]> {
    const { timezone } = await this.org();
    const contracts = await fetchAll(
      (from, to) =>
        this.db
          .from("contracts")
          .select(
            "id, title, client_id, signed_on, archived_at, contract_lines(id, description, billing_type, quantity, unit_price_cents, discount_bps, starts_on, ends_on, billing_day, prorate_first, contract_line_pauses(starts_on, ends_on))",
          )
          .eq("org_id", this.orgId)
          .not("signed_on", "is", null)
          .order("id")
          .range(from, to),
      "council.lines",
    );
    return contracts.flatMap((contract) =>
      contract.contract_lines.map(
        (line): CouncilLine => ({
          id: line.id,
          contractId: contract.id,
          contractTitle: contract.title,
          clientId: contract.client_id,
          signedOn: contract.signed_on!,
          archivedOn: contract.archived_at ? localDate(contract.archived_at, timezone) : null,
          description: line.description,
          billingType: line.billing_type,
          quantity: String(line.quantity),
          unitPriceCents: line.unit_price_cents,
          discountBps: line.discount_bps,
          startsOn: line.starts_on,
          endsOn: line.ends_on,
          billingDay: line.billing_day,
          prorateFirst: line.prorate_first,
          pauses: line.contract_line_pauses.map((p) => ({ startsOn: p.starts_on, endsOn: p.ends_on })),
        }),
      ),
    );
  }

  /** Lo mismo que carga la previsión de facturación (src/server/billing/forecast.ts), con el cliente. */
  async forecastContracts(): Promise<ForecastContractRow[]> {
    const contracts = must(
      await this.db
        .from("contracts")
        .select(
          "id, client_id, signed_on, contract_lines(id, billing_type, quantity, unit_price_cents, discount_bps, starts_on, ends_on, billing_day, prorate_first, contract_line_pauses(starts_on, ends_on)), contract_milestones(id, position, percent_bps, planned_on)",
        )
        .eq("org_id", this.orgId)
        .is("archived_at", null)
        .not("signed_on", "is", null),
      "council.forecast.contracts",
    );
    const items = await fetchAll(
      (a, b) =>
        this.db
          .from("billable_items")
          .select("contract_line_id, source, period_start, milestone_id")
          .eq("org_id", this.orgId)
          .or("invoice_line_id.not.is.null,waived_at.not.is.null")
          .order("id")
          .range(a, b),
      "council.forecast.items",
    );
    const billedStarts = new Map<string, Set<string>>();
    const billedMilestones = new Set<string>();
    for (const item of items) {
      if (item.source === "recurring" && item.period_start) {
        const set = billedStarts.get(item.contract_line_id) ?? new Set<string>();
        set.add(item.period_start);
        billedStarts.set(item.contract_line_id, set);
      }
      if (item.milestone_id) billedMilestones.add(item.milestone_id);
    }
    return contracts.map((c) => ({
      id: c.id,
      clientId: c.client_id,
      signedOn: c.signed_on,
      lines: c.contract_lines.map((l) => ({
        id: l.id,
        billingType: l.billing_type,
        quantity: String(l.quantity),
        unitPriceCents: l.unit_price_cents,
        discountBps: l.discount_bps,
        startsOn: l.starts_on,
        endsOn: l.ends_on,
        billingDay: l.billing_day,
        prorateFirst: l.prorate_first,
        pauses: l.contract_line_pauses.map((p) => ({ startsOn: p.starts_on, endsOn: p.ends_on })),
      })),
      milestones: c.contract_milestones.map((m) => ({ id: m.id, position: m.position, percentBps: m.percent_bps, plannedOn: m.planned_on })),
      billedMilestoneIds: billedMilestones,
      billedStarts,
    }));
  }

  revenueRows(from: Month, to: Month) {
    return loadRevenueRows(this.db, this.orgId, from, to);
  }

  async clientRevenue(from: Month, to: Month) {
    const rows = await fetchAll(
      (a, b) =>
        this.db
          .from("revenue_by_client_month")
          .select("client_id, month, base_cents")
          .eq("org_id", this.orgId)
          .gte("month", from)
          .lte("month", to)
          .order("client_id")
          .order("month")
          .range(a, b),
      "council.clientRevenue",
    );
    return rows.flatMap((r) => (r.client_id && r.month ? [{ clientId: r.client_id, month: r.month, cents: r.base_cents ?? 0 }] : []));
  }

  async snapshots(from: Month, to: Month): Promise<SnapshotLike[]> {
    const rows = must(
      await this.db
        .from("metrics_snapshots")
        .select("month, mrr_cents, new_mrr_cents, expansion_mrr_cents, contraction_mrr_cents, churn_mrr_cents, is_estimated")
        .eq("org_id", this.orgId)
        .gte("month", from)
        .lte("month", to)
        .order("month"),
      "council.snapshots",
    );
    return rows.map((s) => ({
      month: s.month,
      mrrCents: s.mrr_cents,
      newMrrCents: s.new_mrr_cents,
      expansionMrrCents: s.expansion_mrr_cents,
      contractionMrrCents: s.contraction_mrr_cents,
      churnMrrCents: s.churn_mrr_cents,
      isEstimated: s.is_estimated,
    }));
  }

  async clients(): Promise<CouncilClient[]> {
    const rows = await fetchAll(
      (a, b) =>
        this.db
          .from("clients_overview")
          .select("id, display_name, status, billed_net_cents, first_invoice_on, last_activity_at, owner_member_id, acquisition_source_id, created_at, archived_at")
          .eq("org_id", this.orgId)
          .order("id")
          .range(a, b),
      "council.clients",
    );
    return rows.flatMap((c) =>
      c.id
        ? [
            {
              id: c.id,
              name: c.display_name ?? "—",
              status: c.status ?? "lead",
              billedNetCents: c.billed_net_cents ?? 0,
              firstInvoiceOn: c.first_invoice_on,
              lastActivityAt: c.last_activity_at,
              ownerMemberId: c.owner_member_id,
              sourceId: c.acquisition_source_id,
              createdAt: c.created_at ?? new Date(0).toISOString(),
              archived: c.archived_at !== null,
            },
          ]
        : [],
    );
  }

  async invoices(filter: { statuses?: InvoiceStatus[]; issuedFrom?: CivilDate; issuedTo?: CivilDate } = {}): Promise<CouncilInvoice[]> {
    const rows = await fetchAll((a, b) => {
      let query = this.db
        .from("invoices_overview")
        .select("id, number, client_id, client_name, issuer_id, issuer_name, kind, status, issued_on, due_on, subtotal_cents, vat_cents, irpf_cents, total_cents, outstanding_cents, paid_cents, last_paid_on")
        .eq("org_id", this.orgId)
        .eq("lifecycle", "issued");
      if (filter.statuses) query = query.in("status", filter.statuses);
      if (filter.issuedFrom) query = query.gte("issued_on", filter.issuedFrom);
      if (filter.issuedTo) query = query.lte("issued_on", filter.issuedTo);
      return query.order("issued_on").order("id").range(a, b);
    }, "council.invoices");
    return rows.flatMap((i) =>
      i.id && i.client_id && i.issuer_id
        ? [
            {
              id: i.id,
              number: i.number,
              clientId: i.client_id,
              clientName: i.client_name ?? "—",
              issuerId: i.issuer_id,
              issuerName: i.issuer_name ?? "—",
              kind: i.kind ?? "ordinary",
              status: i.status ?? "issued",
              issuedOn: i.issued_on,
              dueOn: i.due_on,
              subtotalCents: i.subtotal_cents ?? 0,
              vatCents: i.vat_cents ?? 0,
              irpfCents: i.irpf_cents ?? 0,
              totalCents: i.total_cents ?? 0,
              outstandingCents: i.outstanding_cents ?? 0,
              paidCents: i.paid_cents ?? 0,
              lastPaidOn: i.last_paid_on,
            },
          ]
        : [],
    );
  }

  async openInvoicesOn(on: CivilDate): Promise<OpenInvoiceOn[]> {
    const rows = await fetchAll((a, b) => this.db.rpc("open_invoices_on", { p_org: this.orgId, p_on: on }).order("invoice_id").range(a, b), "council.openInvoicesOn");
    return rows.map((r) => ({ id: r.invoice_id, clientId: r.client_id, dueOn: r.due_on, outstandingCents: r.outstanding_cents, status: r.status }));
  }

  async payments(from: CivilDate, to: CivilDate): Promise<CouncilPayment[]> {
    const rows = await fetchAll(
      (a, b) =>
        this.db
          .from("payments")
          .select("invoice_id, amount_cents, paid_on, invoices!inner(client_id)")
          .eq("org_id", this.orgId)
          .gte("paid_on", from)
          .lte("paid_on", to)
          .order("id")
          .range(a, b),
      "council.payments",
    );
    return rows.map((p) => ({ invoiceId: p.invoice_id, clientId: p.invoices.client_id, amountCents: p.amount_cents, paidOn: p.paid_on }));
  }

  async deals(): Promise<CouncilDeal[]> {
    const rows = await fetchAll(
      (a, b) =>
        this.db
          .from("deals_board")
          .select("id, title, client_id, client_name, stage_id, stage_kind, est_one_off_cents, est_mrr_cents, probability_bps, source_id, brought_by_member_id, owner_member_id, next_action, next_action_on, loss_reason_id, created_at, stage_entered_at")
          .eq("org_id", this.orgId)
          .order("id")
          .range(a, b),
      "council.deals",
    );
    return rows.flatMap((d) =>
      d.id && d.client_id && d.stage_id && d.stage_kind
        ? [
            {
              id: d.id,
              title: d.title ?? "—",
              clientId: d.client_id,
              clientName: d.client_name ?? "—",
              stageId: d.stage_id,
              stageKind: d.stage_kind,
              estOneOffCents: d.est_one_off_cents ?? 0,
              estMrrCents: d.est_mrr_cents ?? 0,
              probabilityBps: d.probability_bps ?? 0,
              sourceId: d.source_id,
              broughtByMemberId: d.brought_by_member_id,
              ownerMemberId: d.owner_member_id,
              nextAction: d.next_action,
              nextActionOn: d.next_action_on,
              lossReasonId: d.loss_reason_id,
              createdAt: d.created_at ?? new Date(0).toISOString(),
              stageEnteredAt: d.stage_entered_at,
            },
          ]
        : [],
    );
  }

  async stageHistory() {
    const rows = await fetchAll(
      (a, b) =>
        this.db
          .from("deal_stage_history")
          .select("deal_id, from_stage_id, to_stage_id, changed_at")
          .eq("org_id", this.orgId)
          .order("changed_at")
          .order("id")
          .range(a, b),
      "council.history",
    );
    return rows.map((h) => ({ dealId: h.deal_id, fromStageId: h.from_stage_id, toStageId: h.to_stage_id, changedAt: h.changed_at }));
  }

  async stages() {
    const rows = must(await this.db.from("pipeline_stages").select("id, name, position, kind").eq("org_id", this.orgId).is("archived_at", null).order("position"), "council.stages");
    return rows.map((s) => ({ id: s.id, name: s.name, position: s.position, kind: s.kind }));
  }

  async sources() {
    return must(await this.db.from("acquisition_sources").select("id, name").eq("org_id", this.orgId).is("archived_at", null).order("position"), "council.sources");
  }

  async activities(since: string): Promise<CouncilActivity[]> {
    const rows = await fetchAll(
      (a, b) =>
        this.db
          .from("activities")
          .select("client_id, deal_id, occurred_at")
          .eq("org_id", this.orgId)
          .gte("occurred_at", since)
          .order("occurred_at")
          .order("id")
          .range(a, b),
      "council.activities",
    );
    return rows.map((r) => ({ clientId: r.client_id, dealId: r.deal_id, occurredAt: r.occurred_at }));
  }

  async seo(from: CivilDate, to: CivilDate): Promise<SeoData | null> {
    const properties = must(
      await this.db.from("seo_properties_overview").select("id, label, gsc_site_url, is_primary, last_metric_on").eq("org_id", this.orgId).is("client_id", null).is("archived_at", null),
      "council.seo.properties",
    );
    const property = properties.find((p) => p.is_primary) ?? properties[0];
    if (!property?.id) return null;
    const [search, web] = await Promise.all([
      fetchAll(
        (a, b) =>
          this.db
            .from("seo_daily_metrics")
            .select("metric_on, clicks, impressions, position")
            .eq("property_id", property.id!)
            .gte("metric_on", from)
            .lte("metric_on", to)
            .order("metric_on")
            .range(a, b),
        "council.seo.search",
      ),
      fetchAll(
        (a, b) =>
          this.db
            .from("web_analytics_daily")
            .select("metric_on, channel, sessions, users, engaged_sessions, conversions")
            .eq("property_id", property.id!)
            .gte("metric_on", from)
            .lte("metric_on", to)
            .order("metric_on")
            .order("channel")
            .range(a, b),
        "council.seo.web",
      ),
    ]);
    const toWeb = (r: (typeof web)[number]) => ({ date: r.metric_on, sessions: r.sessions, users: r.users, engagedSessions: r.engaged_sessions, conversions: r.conversions });
    return {
      propertyId: property.id,
      label: property.label ?? "—",
      siteUrl: property.gsc_site_url,
      searchDays: search.map((r) => ({ date: r.metric_on, clicks: r.clicks, impressions: r.impressions, position: r.position === null ? null : Number(r.position) })),
      organicDays: web.filter((r) => r.channel === "organic_search").map(toWeb),
      allDays: web.filter((r) => r.channel === "all").map(toWeb),
      lastDataOn: property.last_metric_on,
    };
  }

  /** La foto de Finanzas (src/server/finance/snapshot.ts); null si el módulo aún no está en la base de datos. */
  async finance(today: CivilDate): Promise<FinanceData | null> {
    try {
      return await getFinanceSnapshot(this.db, this.orgId, today);
    } catch (error) {
      const code = (error as { error?: { code?: string } })?.error?.code ?? (error as { code?: string })?.code;
      if (code === "42P01" || code === "PGRST205") return null;
      throw error;
    }
  }

  async projects(): Promise<CouncilProject[]> {
    const rows = await fetchAll(
      (a, b) =>
        this.db
          .from("projects")
          .select("id, name, client_id, contract_id, status, owner_member_id, archived_at")
          .eq("org_id", this.orgId)
          .order("id")
          .range(a, b),
      "council.projects",
    );
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      clientId: p.client_id,
      contractId: p.contract_id,
      status: p.status,
      ownerMemberId: p.owner_member_id,
      archived: p.archived_at !== null,
    }));
  }

  /** Lo mismo que lee la carga del equipo en Proyectos (getMemberWeeklyHours): sin temporizadores en marcha. */
  async timeEntries(from: CivilDate, to: CivilDate): Promise<CouncilTimeEntry[]> {
    const rows = await fetchAll(
      (a, b) =>
        this.db
          .from("time_entries")
          .select("member_id, project_id, worked_on, minutes, billable")
          .eq("org_id", this.orgId)
          .gte("worked_on", from)
          .lte("worked_on", to)
          .not("minutes", "is", null)
          .order("id")
          .range(a, b),
      "council.timeEntries",
    );
    return rows.flatMap((e) =>
      e.minutes === null ? [] : [{ memberId: e.member_id, projectId: e.project_id, workedOn: e.worked_on, minutes: e.minutes, billable: e.billable }],
    );
  }

  /** La vista project_contract_revenue (la única definición de lo facturado de un proyecto), con el cliente de cada contrato. */
  async contractRevenue(from: CivilDate, to: CivilDate): Promise<CouncilContractRevenue[]> {
    const [rows, contracts] = await Promise.all([
      fetchAll(
        (a, b) =>
          this.db
            .from("project_contract_revenue")
            .select("contract_id, issued_on, base_cents")
            .eq("org_id", this.orgId)
            .gte("issued_on", from)
            .lte("issued_on", to)
            .order("invoice_line_id")
            .range(a, b),
        "council.contractRevenue",
      ),
      fetchAll((a, b) => this.db.from("contracts").select("id, client_id").eq("org_id", this.orgId).order("id").range(a, b), "council.contractClients"),
    ]);
    const clientOf = new Map(contracts.map((c) => [c.id, c.client_id]));
    return rows.flatMap((r) => {
      const clientId = r.contract_id ? clientOf.get(r.contract_id) : undefined;
      return r.contract_id && clientId && r.issued_on && r.base_cents !== null
        ? [{ contractId: r.contract_id, clientId, issuedOn: r.issued_on, baseCents: r.base_cents }]
        : [];
    });
  }

  async openTasks(): Promise<CouncilOpenTask[]> {
    const rows = await fetchAll(
      (a, b) =>
        this.db
          .from("project_tasks")
          .select("id, project_id, assignee_member_id, due_on, estimate_minutes, status")
          .eq("org_id", this.orgId)
          .neq("status", "done")
          .order("id")
          .range(a, b),
      "council.openTasks",
    );
    return rows.flatMap((t) =>
      t.status === "done"
        ? []
        : [{ id: t.id, projectId: t.project_id, assigneeMemberId: t.assignee_member_id, dueOn: t.due_on, estimateMinutes: t.estimate_minutes, status: t.status }],
    );
  }
}
