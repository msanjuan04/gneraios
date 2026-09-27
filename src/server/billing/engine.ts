// Sin "server-only": el seed de la demo simula 18 meses con este mismo motor.
import { randomUUID } from "node:crypto";
import {
  type BillingState,
  type Locale,
  type PaymentMethod,
  type PlanOverdueInvoice,
  planBillingRun,
} from "@/domain/billing/plan";
import type { CivilDate } from "@/domain/dates/civil-date";
import type { DraftLinePayload } from "@/domain/invoicing/draft-line";
import { nowInZone } from "@/lib/clock";
import type { Json } from "@/lib/supabase/database.types";
import { renderEmail } from "@/server/email/templates";
import { type Db, DbError, fetchAll, loadVatRates, must, orgSettings } from "./context";

export const BILLING_JOB = "daily_billing";

/** Ya hay una ejecución en curso para esa org (índice único de job_runs). */
export class BillingBusyError extends Error {
  constructor() {
    super("billing_run_busy");
    this.name = "BillingBusyError";
  }
}

export type BillingRunSummary = {
  orgId: string;
  runOn: CivilDate;
  itemsCreated: number;
  drafts: number;
  notifications: number;
  emails: number;
  dealsMoved: number;
  skipped: number;
};

const isActiveOn = (i: { active_from: string | null; active_until: string | null; archived_at: string | null; kind: string }, day: CivilDate) =>
  !i.archived_at &&
  (i.active_from ? i.active_from <= day : i.kind === "self_employed") &&
  (!i.active_until || i.active_until >= day);

/** Lee todo lo que el planificador necesita de una org (con la clave de servidor). */
async function loadBillingState(admin: Db, org: { id: string; settings: unknown }, today: CivilDate): Promise<BillingState> {
  const orgId = org.id;
  const [issuers, vatRates, contracts, stages] = await Promise.all([
    admin
      .from("issuers")
      .select("id, kind, legal_name, trade_name, default_irpf_bps, fiscal_provider, verifactu_from, active_from, active_until, archived_at")
      .eq("org_id", orgId),
    loadVatRates(admin, orgId),
    admin
      .from("contracts")
      .select(
        "id, client_id, deal_id, title, signed_on, payment_terms_days, payment_method, invoice_grouping, contract_issuers(issuer_id, valid_from), contract_lines(id, position, description, billing_type, quantity, unit_price_cents, discount_bps, tax_rate_id, irpf_applies, starts_on, ends_on, billing_day, prorate_first, contract_line_pauses(starts_on, ends_on)), contract_milestones(id, position, label, percent_bps, planned_on, auto)",
      )
      .eq("org_id", orgId)
      .is("archived_at", null)
      .not("signed_on", "is", null)
      .lte("signed_on", today),
    admin.from("pipeline_stages").select("id, kind, position, archived_at").eq("org_id", orgId),
  ]);
  const issuerRows = must(issuers, "billing.issuers");
  const contractRows = must(contracts, "billing.contracts");
  const stageRows = must(stages, "billing.stages");

  const items = await fetchAll(
    (from, to) =>
      admin
        .from("billable_items")
        .select("id, contract_line_id, source, period_start, period_end, milestone_id, description, quantity, unit_price_cents, discount_bps, amount_cents, billable_on, invoice_line_id, waived_at")
        .eq("org_id", orgId)
        .order("id")
        .range(from, to),
    "billing.items",
  );

  const drafts = must(
    await admin
      .from("invoices")
      .select("id, issuer_id, client_id, grouping_key, updated_at, irpf_bps, invoice_lines(*)")
      .eq("org_id", orgId)
      .eq("lifecycle", "draft")
      .not("grouping_key", "is", null),
    "billing.drafts",
  );

  const overdue = must(
    await admin
      .from("invoices_overview")
      .select("id, number, client_id, issuer_name, issued_on, due_on, total_cents, outstanding_cents, language")
      .eq("org_id", orgId)
      .eq("status", "overdue"),
    "billing.overdue",
  );
  const overdueExtra = overdue.length
    ? must(
        await admin.from("invoices").select("id, payment_method, issuer_snapshot").in("id", overdue.map((o) => o.id!)),
        "billing.overdueExtra",
      )
    : [];
  const extraById = new Map(overdueExtra.map((x) => [x.id, x]));

  const clientIds = [...new Set([...contractRows.map((c) => c.client_id), ...overdue.map((o) => o.client_id!)])];
  const clients = clientIds.length
    ? must(
        await admin
          .from("clients")
          .select("id, display_name, is_business, tax_id_kind, country_code, preferred_language, payment_terms_days, owner_member_id, contacts(email, is_billing, is_primary, archived_at)")
          .in("id", clientIds),
        "billing.clients",
      )
    : [];

  const dealIds = contractRows.map((c) => c.deal_id).filter((d): d is string => Boolean(d));
  const deals = dealIds.length ? must(await admin.from("deals").select("id, stage_id").in("id", dealIds), "billing.deals") : [];
  const stageKind = new Map(stageRows.map((s) => [s.id, s.kind]));
  const activeStage = stageRows
    .filter((s) => s.kind === "won" && !s.archived_at)
    .sort((a, b) => b.position - a.position)[0];

  const settings = orgSettings({ settings: org.settings as Json });
  return {
    orgId,
    today,
    settings: {
      paymentTermsDays: settings.paymentTermsDays,
      dunningDays: settings.dunningDays,
      renewalAlertDays: settings.renewalAlertDays,
    },
    issuers: issuerRows.map((i) => ({
      id: i.id,
      name: i.trade_name || i.legal_name,
      defaultIrpfBps: i.default_irpf_bps,
      fiscalProvider: i.fiscal_provider,
      verifactuFrom: i.verifactu_from,
      active: isActiveOn(i, today),
    })),
    vatRates,
    clients: clients.map((c) => {
      const contacts = c.contacts.filter((x) => !x.archived_at && x.email);
      const billing = contacts.filter((x) => x.is_billing).map((x) => x.email!);
      return {
        id: c.id,
        name: c.display_name,
        isBusiness: c.is_business,
        taxIdKind: c.tax_id_kind,
        countryCode: c.country_code,
        language: c.preferred_language,
        paymentTermsDays: c.payment_terms_days,
        ownerMemberId: c.owner_member_id,
        billingEmails: billing.length ? billing : contacts.filter((x) => x.is_primary).map((x) => x.email!).slice(0, 1),
      };
    }),
    contracts: contractRows.map((c) => ({
      id: c.id,
      clientId: c.client_id,
      dealId: c.deal_id,
      title: c.title,
      signedOn: c.signed_on!,
      paymentTermsDays: c.payment_terms_days,
      paymentMethod: c.payment_method,
      invoiceGrouping: c.invoice_grouping,
      issuers: c.contract_issuers.map((ci) => ({ issuerId: ci.issuer_id, validFrom: ci.valid_from })),
      lines: c.contract_lines.map((l) => ({
        id: l.id,
        position: l.position,
        description: l.description,
        billingType: l.billing_type,
        quantity: String(l.quantity),
        unitPriceCents: l.unit_price_cents,
        discountBps: l.discount_bps,
        taxRateId: l.tax_rate_id,
        irpfApplies: l.irpf_applies,
        startsOn: l.starts_on,
        endsOn: l.ends_on,
        billingDay: l.billing_day,
        prorateFirst: l.prorate_first,
        pauses: l.contract_line_pauses.map((p) => ({ startsOn: p.starts_on, endsOn: p.ends_on })),
      })),
      milestones: c.contract_milestones.map((m) => ({
        id: m.id,
        position: m.position,
        label: m.label,
        percentBps: m.percent_bps,
        plannedOn: m.planned_on,
        auto: m.auto,
      })),
    })),
    items: items.map((i) => ({
      id: i.id,
      contractLineId: i.contract_line_id,
      source: i.source,
      periodStart: i.period_start,
      periodEnd: i.period_end,
      milestoneId: i.milestone_id,
      description: i.description,
      quantity: String(i.quantity),
      unitPriceCents: i.unit_price_cents,
      discountBps: i.discount_bps,
      amountCents: i.amount_cents,
      billableOn: i.billable_on,
      invoiceLineId: i.invoice_line_id,
      waived: Boolean(i.waived_at),
    })),
    openDrafts: drafts.map((d) => ({
      id: d.id,
      issuerId: d.issuer_id,
      clientId: d.client_id,
      groupingKey: d.grouping_key!,
      updatedAt: d.updated_at,
      irpfBps: d.irpf_bps,
      lines: d.invoice_lines
        .sort((a, b) => a.position - b.position)
        .map(
          (l): DraftLinePayload => ({
            id: l.id,
            position: l.position,
            description: l.description,
            quantity: String(l.quantity),
            unit_price_cents: l.unit_price_cents,
            discount_bps: l.discount_bps,
            base_cents: l.base_cents,
            tax_rate_id: l.tax_rate_id,
            vat_bps: l.vat_bps,
            vat_regime: l.vat_regime,
            vat_cents: l.vat_cents,
            irpf_applies: l.irpf_applies,
            irpf_cents: l.irpf_cents,
            legal_note: l.legal_note,
            billing_type: l.billing_type,
            period_start: l.period_start,
            period_end: l.period_end,
            contract_line_id: l.contract_line_id,
            rectifies_line_id: l.rectifies_line_id,
          }),
        ),
    })),
    overdueInvoices: overdue.map((o): PlanOverdueInvoice => {
      const extra = extraById.get(o.id!);
      const snapshot = (extra?.issuer_snapshot ?? {}) as { iban?: string | null };
      return {
        id: o.id!,
        number: o.number ?? "",
        clientId: o.client_id!,
        issuerName: o.issuer_name ?? "",
        issuedOn: o.issued_on!,
        dueOn: o.due_on!,
        totalCents: o.total_cents ?? 0,
        outstandingCents: o.outstanding_cents ?? 0,
        language: (o.language ?? "es") as Locale,
        paymentMethod: (extra?.payment_method ?? "transfer") as PaymentMethod,
        iban: snapshot.iban ?? null,
      };
    }),
    deals: deals.map((d) => ({ id: d.id, stageId: d.stage_id, stageKind: stageKind.get(d.stage_id) ?? "open" })),
    activeStageId: activeStage?.id ?? null,
  };
}

/**
 * Ejecución diaria para una org: crea los pendientes vencidos, monta los borradores, prepara
 * avisos y recordatorios, y lo registra en job_runs. Una sola a la vez por org; si el estado
 * cambia mientras se calcula (alguien edita un borrador), se recalcula (hasta 3 intentos).
 */
export async function runBillingForOrg(admin: Db, orgId: string, opts: { today?: CivilDate } = {}): Promise<BillingRunSummary> {
  const org = must(await admin.from("orgs").select("id, timezone, settings").eq("id", orgId).single(), "billing.org");
  const today = opts.today ?? nowInZone(org.timezone).date;

  // Una ejecución colgada más de 15 minutos se da por fallida para no bloquear la siguiente.
  await admin
    .from("job_runs")
    .update({ status: "failed", finished_at: new Date().toISOString(), error: "timeout" })
    .eq("org_id", orgId)
    .eq("job", BILLING_JOB)
    .eq("status", "running")
    .lt("started_at", new Date(Date.now() - 15 * 60_000).toISOString());
  const started = await admin.from("job_runs").insert({ org_id: orgId, job: BILLING_JOB, run_on: today }).select("id").single();
  if (started.error) {
    if (started.error.code === "23505") throw new BillingBusyError();
    throw new DbError(started.error, "billing.lock");
  }

  try {
    for (let attempt = 1; ; attempt += 1) {
      const state = await loadBillingState(admin, org, today);
      const plan = planBillingRun(state, {
        newId: randomUUID,
        renderReminder: (invoice) =>
          renderEmail("payment_reminder", invoice.language, {
            number: invoice.number,
            issuerName: invoice.issuerName,
            totalCents: invoice.totalCents,
            outstandingCents: invoice.outstandingCents,
            issuedOn: invoice.issuedOn,
            dueOn: invoice.dueOn,
            paymentMethod: invoice.paymentMethod,
            iban: invoice.iban,
          }),
      });
      const { data, error } = await admin.rpc("apply_billing_run", { p: plan.payload as unknown as Json });
      if (error) {
        if ((error.hint === "draft_changed" || error.hint === "item_taken") && attempt < 3) continue;
        throw new DbError(error, "billing.apply");
      }
      const result = data as { items_created: number; drafts: string[]; notifications_created: number; emails_created: number; deals_moved: number };
      const summary: BillingRunSummary = {
        orgId,
        runOn: today,
        itemsCreated: result.items_created,
        drafts: result.drafts.length,
        notifications: result.notifications_created,
        emails: result.emails_created,
        dealsMoved: result.deals_moved,
        skipped: plan.skipped.length,
      };
      await admin
        .from("job_runs")
        .update({ status: "succeeded", finished_at: new Date().toISOString(), summary: { ...summary, skippedDetail: plan.skipped } as unknown as Json })
        .eq("id", started.data.id);
      return summary;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await admin
      .from("job_runs")
      .update({ status: "failed", finished_at: new Date().toISOString(), error: message.slice(0, 1000) })
      .eq("id", started.data.id);
    await admin.from("notifications").upsert(
      {
        org_id: orgId,
        kind: "job_failed",
        params: { job: BILLING_JOB, date: today },
        href: "/invoices",
        dedupe_key: `job_failed:${BILLING_JOB}:${today}`,
      },
      { onConflict: "org_id,dedupe_key", ignoreDuplicates: true },
    );
    throw error;
  }
}

/**
 * El cron de todas las orgs (cada una con su "hoy" y su transacción). Después de facturar,
 * guarda la foto del mes anterior si aún no existe (idempotente: recupera un día 1 fallido).
 */
export async function runDailyBilling(admin: Db): Promise<Array<BillingRunSummary | { orgId: string; error: string }>> {
  const { savePreviousMonthSnapshot } = await import("@/server/metrics/snapshot");
  const { generateSubscriptionExpenses } = await import("@/server/finance/generate");
  const orgs = must(await admin.from("orgs").select("id, timezone"), "billing.orgs");
  const results: Array<BillingRunSummary | { orgId: string; error: string }> = [];
  for (const org of orgs) {
    try {
      results.push(await runBillingForOrg(admin, org.id));
    } catch (error) {
      console.error("[cron] billing", org.id, error);
      results.push({ orgId: org.id, error: error instanceof Error ? error.message : String(error) });
    }
    // Los cargos de las suscripciones (software, hosting…) del día, con el "hoy" de la org.
    try {
      await generateSubscriptionExpenses(admin, org.id, nowInZone(org.timezone).date);
    } catch (error) {
      console.error("[cron] subscription expenses", org.id, error);
    }
    try {
      await savePreviousMonthSnapshot(admin, org.id);
    } catch (error) {
      console.error("[cron] metrics snapshot", org.id, error);
    }
  }
  return results;
}
