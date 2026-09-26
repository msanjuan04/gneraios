// Planificador del cron diario (ARCHITECTURE.md §7.2, §7.10): a partir del estado de una org
// y del día, decide qué se factura, qué borradores se montan, qué avisos y recordatorios se
// preparan y qué deals pasan a Activo. Es puro: el servidor carga el estado, llama aquí y
// aplica el resultado en una transacción (RPC apply_billing_run). Ejecutarlo dos veces sobre
// el mismo estado da el mismo plan, y un día perdido se recupera al siguiente.

import { addDays, compareCivil, daysBetween, type CivilDate } from "../dates/civil-date";
import {
  buildDraftLine,
  defaultIrpfBps,
  resolvePaymentTermsDays,
  type BillingType,
  type DraftLinePayload,
  type TaxRateRef,
} from "../invoicing/draft-line";
import { formatBps } from "../money";
import { lineBaseCents } from "../metrics/mrr";
import { issuerOn, type IssuerAssignment } from "./issuer";
import { splitByMilestones, validateMilestones } from "./milestones";
import { nextBillingOn, periodAmountCents, periodsDue, type Pause } from "./schedule";

export type PaymentMethod = "transfer" | "sepa_debit" | "card" | "cash" | "other";
export type Locale = "es" | "ca" | "en";

export type PlanLine = {
  id: string;
  position: number;
  description: string;
  billingType: BillingType;
  quantity: string | number;
  unitPriceCents: number;
  discountBps: number;
  taxRateId: string;
  irpfApplies: boolean;
  startsOn: CivilDate | null;
  endsOn: CivilDate | null;
  billingDay: number | null;
  prorateFirst: boolean;
  pauses: Pause[];
};

export type PlanMilestone = {
  id: string;
  position: number;
  label: string;
  percentBps: number;
  plannedOn: CivilDate | null;
  auto: boolean;
};

export type PlanContract = {
  id: string;
  clientId: string;
  dealId: string | null;
  title: string;
  signedOn: CivilDate;
  paymentTermsDays: number | null;
  paymentMethod: PaymentMethod;
  invoiceGrouping: "client" | "contract";
  issuers: IssuerAssignment[];
  lines: PlanLine[];
  milestones: PlanMilestone[];
};

export type PlanItem = {
  id: string;
  contractLineId: string;
  source: "recurring" | "usage" | "milestone";
  periodStart: CivilDate | null;
  periodEnd: CivilDate | null;
  milestoneId: string | null;
  description: string;
  quantity: string | number;
  unitPriceCents: number;
  discountBps: number;
  amountCents: number;
  billableOn: CivilDate;
  invoiceLineId: string | null;
  waived: boolean;
};

export type PlanIssuer = {
  id: string;
  name: string;
  defaultIrpfBps: number;
  fiscalProvider: string;
  verifactuFrom: CivilDate;
  active: boolean;
};

export type PlanClient = {
  id: string;
  name: string;
  isBusiness: boolean;
  taxIdKind: "es" | "eu_vat" | "foreign";
  countryCode: string;
  language: Locale;
  paymentTermsDays: number | null;
  ownerMemberId: string | null;
  billingEmails: string[];
};

export type PlanDraft = {
  id: string;
  issuerId: string;
  clientId: string;
  groupingKey: string;
  updatedAt: string;
  irpfBps: number;
  lines: DraftLinePayload[];
};

export type PlanOverdueInvoice = {
  id: string;
  number: string;
  clientId: string;
  issuerName: string;
  issuedOn: CivilDate;
  dueOn: CivilDate;
  totalCents: number;
  outstandingCents: number;
  language: Locale;
  paymentMethod: PaymentMethod;
  iban: string | null;
};

export type BillingState = {
  orgId: string;
  today: CivilDate;
  settings: { paymentTermsDays: number; dunningDays: number[]; renewalAlertDays: number[] };
  issuers: PlanIssuer[];
  vatRates: ReadonlyMap<string, TaxRateRef>;
  clients: PlanClient[];
  contracts: PlanContract[];
  items: PlanItem[];
  openDrafts: PlanDraft[];
  overdueInvoices: PlanOverdueInvoice[];
  deals: { id: string; stageId: string; stageKind: "open" | "won" | "lost" }[];
  /** La última etapa ganada (Activo): a ella pasa un deal ganado cuando empieza su contrato. */
  activeStageId: string | null;
};

export type PlanDeps = {
  newId: () => string;
  renderReminder: (invoice: PlanOverdueInvoice) => { subject: string; body: string };
};

type NewItemPayload = {
  id: string;
  contract_line_id: string;
  source: PlanItem["source"];
  period_start: CivilDate | null;
  period_end: CivilDate | null;
  milestone_id: string | null;
  description: string;
  quantity: string;
  unit_price_cents: number;
  discount_bps: number;
  amount_cents: number;
  billable_on: CivilDate;
};

export type DraftPayload = {
  invoice_id?: string;
  expected_updated_at?: string;
  grouping_key?: string;
  header?: Record<string, string | number | null>;
  lines: DraftLinePayload[];
};

export type NotificationPayload = {
  member_id: string | null;
  kind: "renewal" | "reminder_ready" | "job_failed" | "verifactu_deadline";
  params: Record<string, string | number>;
  href: string;
  due_on: CivilDate | null;
  dedupe_key: string;
};

export type EmailPayload = {
  invoice_id: string;
  client_id: string;
  template: "payment_reminder";
  language: Locale;
  to_emails: string[];
  subject: string;
  body: string;
  attach_pdf: boolean;
  dedupe_key: string;
};

export type BillingRunPayload = {
  org_id: string;
  items: NewItemPayload[];
  drafts: DraftPayload[];
  notifications: NotificationPayload[];
  emails: EmailPayload[];
  deal_moves: { deal_id: string; stage_id: string }[];
};

export type BillingPlan = { payload: BillingRunPayload; skipped: { lineId: string; reason: string }[] };

const q = (quantity: string | number) => (typeof quantity === "number" ? String(quantity) : quantity);

/** El menor umbral que ya se ha alcanzado (p. ej. [60, 30, 7] y faltan 20 días → 30). */
function crossedThreshold(thresholds: readonly number[], daysLeft: number): number | null {
  const sorted = [...thresholds].filter((t) => t >= 0).sort((a, b) => a - b);
  return sorted.find((t) => daysLeft <= t) ?? null;
}

export function planBillingRun(state: BillingState, deps: PlanDeps): BillingPlan {
  const { today } = state;
  const skipped: BillingPlan["skipped"] = [];
  const clients = new Map(state.clients.map((c) => [c.id, c]));
  const issuers = new Map(state.issuers.map((i) => [i.id, i]));
  const lineIndex = new Map<string, { line: PlanLine; contract: PlanContract }>();
  const contracts = state.contracts.filter((c) => compareCivil(c.signedOn, today) <= 0);
  for (const contract of contracts) for (const line of contract.lines) lineIndex.set(line.id, { line, contract });

  const itemsByLine = new Map<string, PlanItem[]>();
  for (const item of state.items) {
    const list = itemsByLine.get(item.contractLineId) ?? [];
    list.push(item);
    itemsByLine.set(item.contractLineId, list);
  }

  const newItems: NewItemPayload[] = [];

  // 1. Periodos recurrentes vencidos (los pendientes sin facturar se rehacen siempre).
  for (const contract of contracts) {
    for (const line of contract.lines) {
      if ((line.billingType !== "monthly" && line.billingType !== "yearly") || !line.startsOn) continue;
      const billedStarts = new Set(
        (itemsByLine.get(line.id) ?? [])
          .filter((i) => i.source === "recurring" && i.periodStart && (i.invoiceLineId || i.waived))
          .map((i) => i.periodStart!),
      );
      const recurring = {
        billingType: line.billingType,
        startsOn: line.startsOn,
        endsOn: line.endsOn,
        billingDay: line.billingDay ?? 1,
        prorateFirst: line.prorateFirst,
      };
      for (const period of periodsDue(recurring, line.pauses, billedStarts, today)) {
        const unit = period.activeDays === period.cycleDays ? line.unitPriceCents : periodAmountCents(line.unitPriceCents, period);
        newItems.push({
          id: deps.newId(),
          contract_line_id: line.id,
          source: "recurring",
          period_start: period.start,
          period_end: period.end,
          milestone_id: null,
          description: line.description,
          quantity: q(line.quantity),
          unit_price_cents: unit,
          discount_bps: line.discountBps,
          amount_cents: lineBaseCents({ quantity: line.quantity, unitPriceCents: unit, discountBps: line.discountBps }),
          billable_on: period.billableOn,
        });
      }
    }
  }

  // 2. Hitos automáticos con fecha cumplida, en orden (uno sin facturar y sin fecha para la cola).
  for (const contract of contracts) {
    const oneOff = contract.lines.filter((l) => l.billingType === "one_off").sort((a, b) => a.position - b.position);
    const milestones = [...contract.milestones].sort((a, b) => a.position - b.position);
    if (oneOff.length === 0 || milestones.length === 0) continue;
    if (validateMilestones(milestones.map((m) => m.percentBps)) !== null) {
      skipped.push({ lineId: oneOff[0]!.id, reason: "milestones_invalid" });
      continue;
    }
    const billed = new Set(
      oneOff.flatMap((l) => (itemsByLine.get(l.id) ?? []).filter((i) => i.milestoneId).map((i) => i.milestoneId!)),
    );
    const shares = splitByMilestones(
      oneOff.map((l) => ({ id: l.id, baseCents: lineBaseCents(l) })),
      milestones.map((m) => ({ id: m.id, percentBps: m.percentBps })),
    );
    for (const milestone of milestones) {
      if (billed.has(milestone.id)) continue;
      if (!milestone.auto || !milestone.plannedOn || compareCivil(milestone.plannedOn, today) > 0) break;
      for (const line of oneOff) {
        const share = shares[milestone.id]?.[line.id] ?? 0;
        if (share <= 0) continue;
        newItems.push({
          id: deps.newId(),
          contract_line_id: line.id,
          source: "milestone",
          period_start: null,
          period_end: null,
          milestone_id: milestone.id,
          description: `${line.description} · ${milestone.label} (${formatBps(milestone.percentBps)})`,
          quantity: "1",
          unit_price_cents: share,
          discount_bps: 0,
          amount_cents: share,
          billable_on: milestone.plannedOn,
        });
      }
      billed.add(milestone.id);
    }
  }

  // 3. Lo que hay que facturar hoy: lo nuevo + usos e hitos pendientes que ya existían.
  const pendingExisting: NewItemPayload[] = state.items
    .filter(
      (i) =>
        i.source !== "recurring" &&
        !i.invoiceLineId &&
        !i.waived &&
        compareCivil(i.billableOn, today) <= 0 &&
        lineIndex.has(i.contractLineId),
    )
    .map((i) => ({
      id: i.id,
      contract_line_id: i.contractLineId,
      source: i.source,
      period_start: i.periodStart,
      period_end: i.periodEnd,
      milestone_id: i.milestoneId,
      description: i.description,
      quantity: q(i.quantity),
      unit_price_cents: i.unitPriceCents,
      discount_bps: i.discountBps,
      amount_cents: i.amountCents,
      billable_on: i.billableOn,
    }));

  type Group = { issuerId: string; clientId: string; groupingKey: string; contract: PlanContract; items: NewItemPayload[] };
  const groups = new Map<string, Group>();
  for (const item of [...newItems, ...pendingExisting]) {
    const found = lineIndex.get(item.contract_line_id);
    if (!found) continue;
    const { contract } = found;
    const issuerId = issuerOn(contract.issuers, item.period_start ?? item.billable_on);
    if (!issuerId || !issuers.get(issuerId)?.active) {
      skipped.push({ lineId: item.contract_line_id, reason: issuerId ? "issuer_inactive" : "no_issuer" });
      continue;
    }
    const groupingKey = contract.invoiceGrouping === "contract" ? `contract:${contract.id}` : "client";
    const key = `${issuerId}|${contract.clientId}|${groupingKey}`;
    const group = groups.get(key) ?? { issuerId, clientId: contract.clientId, groupingKey, contract, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }

  // Si un pendiente no entra en ningún borrador (emisor inactivo…), tampoco se crea hoy:
  // mañana se vuelve a intentar con el estado de entonces.
  const grouped = new Set([...groups.values()].flatMap((g) => g.items.map((i) => i.id)));
  const items = newItems.filter((i) => grouped.has(i.id));

  const drafts: DraftPayload[] = [];
  for (const group of groups.values()) {
    const client = clients.get(group.clientId);
    const issuer = issuers.get(group.issuerId)!;
    if (!client) continue;
    const existing = state.openDrafts.find(
      (d) => d.issuerId === group.issuerId && d.clientId === group.clientId && d.groupingKey === group.groupingKey,
    );
    const irpfBps =
      existing?.irpfBps ??
      defaultIrpfBps(issuer, { isBusiness: client.isBusiness, taxIdKind: client.taxIdKind, countryCode: client.countryCode });
    const sorted = [...group.items].sort((a, b) => {
      const la = lineIndex.get(a.contract_line_id)!;
      const lb = lineIndex.get(b.contract_line_id)!;
      return (
        la.contract.title.localeCompare(lb.contract.title) ||
        la.line.position - lb.line.position ||
        (a.period_start ?? a.billable_on).localeCompare(b.period_start ?? b.billable_on)
      );
    });
    let position = existing ? Math.max(-1, ...existing.lines.map((l) => l.position)) + 1 : 0;
    const lines: DraftLinePayload[] = existing ? existing.lines.map((l) => ({ ...l, billable_item_id: null })) : [];
    let added = 0;
    for (const item of sorted) {
      const { line } = lineIndex.get(item.contract_line_id)!;
      const taxRate = state.vatRates.get(line.taxRateId);
      if (!taxRate) {
        skipped.push({ lineId: line.id, reason: "vat_rate_missing" });
        continue;
      }
      lines.push(
        buildDraftLine(
          {
            id: deps.newId(),
            position: position++,
            description: item.description,
            quantity: item.quantity,
            unitPriceCents: item.unit_price_cents,
            discountBps: item.discount_bps,
            taxRate,
            irpfApplies: line.irpfApplies,
            billingType: line.billingType,
            periodStart: item.period_start,
            periodEnd: item.period_end,
            contractLineId: line.id,
            billableItemId: item.id,
          },
          irpfBps,
        ),
      );
      added += 1;
    }
    if (added === 0) continue;
    drafts.push(
      existing
        ? { invoice_id: existing.id, expected_updated_at: existing.updatedAt, lines }
        : {
            grouping_key: group.groupingKey,
            header: {
              issuer_id: group.issuerId,
              client_id: group.clientId,
              contract_id: group.groupingKey === "client" ? null : group.contract.id,
              language: client.language,
              irpf_bps: irpfBps,
              payment_method: group.contract.paymentMethod,
              payment_terms_days: resolvePaymentTermsDays(
                group.contract.paymentTermsDays,
                client.paymentTermsDays,
                state.settings.paymentTermsDays,
              ),
            },
            lines,
          },
    );
  }

  const notifications: NotificationPayload[] = [];

  // 4. Renovaciones anuales: aviso al socio responsable a 60, 30 y 7 días (orgs.settings).
  for (const contract of contracts) {
    const client = clients.get(contract.clientId);
    for (const line of contract.lines) {
      if (line.billingType !== "yearly" || !line.startsOn) continue;
      const recurring = { billingType: "yearly" as const, startsOn: line.startsOn, endsOn: line.endsOn, billingDay: 1, prorateFirst: false };
      const next = nextBillingOn(recurring, line.pauses, addDays(today, -1));
      if (!next || next === line.startsOn) continue;
      const daysLeft = daysBetween(today, next);
      const threshold = crossedThreshold(state.settings.renewalAlertDays, daysLeft);
      if (daysLeft <= 0 || threshold === null) continue;
      notifications.push({
        member_id: client?.ownerMemberId ?? null,
        kind: "renewal",
        params: {
          client: client?.name ?? "",
          line: line.description,
          date: next,
          days: daysLeft,
          amount_cents: lineBaseCents(line),
        },
        href: `/contracts/${contract.id}`,
        due_on: next,
        dedupe_key: `renewal:${line.id}:${next}:${threshold}`,
      });
    }
  }

  // 5. Recordatorios de cobro a 7 y 15 días de vencida: se preparan, nunca se envían solos.
  const emails: EmailPayload[] = [];
  for (const invoice of state.overdueInvoices) {
    const daysOverdue = daysBetween(invoice.dueOn, today);
    const reached = [...state.settings.dunningDays].sort((a, b) => b - a).find((d) => daysOverdue >= d);
    if (reached === undefined || invoice.outstandingCents <= 0) continue;
    const client = clients.get(invoice.clientId);
    const { subject, body } = deps.renderReminder(invoice);
    emails.push({
      invoice_id: invoice.id,
      client_id: invoice.clientId,
      template: "payment_reminder",
      language: invoice.language,
      to_emails: client?.billingEmails ?? [],
      subject,
      body,
      attach_pdf: true,
      dedupe_key: `reminder:${invoice.id}:${reached}`,
    });
    notifications.push({
      member_id: client?.ownerMemberId ?? null,
      kind: "reminder_ready",
      params: { number: invoice.number, client: client?.name ?? "", days: daysOverdue, amount_cents: invoice.outstandingCents },
      href: "/invoices/outbox",
      due_on: null,
      dedupe_key: `reminder_ready:${invoice.id}:${reached}`,
    });
  }

  // 6. Cuenta atrás de Verifactu para los emisores que siguen con el proveedor interno.
  for (const issuer of state.issuers) {
    if (!issuer.active || issuer.fiscalProvider !== "internal") continue;
    const daysLeft = daysBetween(today, issuer.verifactuFrom);
    const threshold = daysLeft <= 0 ? 0 : crossedThreshold([90, 30, 7], daysLeft);
    if (threshold === null) continue;
    notifications.push({
      member_id: null,
      kind: "verifactu_deadline",
      params: { issuer: issuer.name, date: issuer.verifactuFrom, days: Math.max(daysLeft, 0) },
      href: "/settings/issuers",
      due_on: issuer.verifactuFrom,
      dedupe_key: `verifactu:${issuer.id}:${issuer.verifactuFrom}:${threshold}`,
    });
  }

  // 7. Un deal ganado pasa a Activo cuando empieza su contrato.
  const dealMoves: BillingRunPayload["deal_moves"] = [];
  if (state.activeStageId) {
    const deals = new Map(state.deals.map((d) => [d.id, d]));
    for (const contract of contracts) {
      const deal = contract.dealId ? deals.get(contract.dealId) : undefined;
      if (!deal || deal.stageKind !== "won" || deal.stageId === state.activeStageId) continue;
      const starts = contract.lines.map((l) => l.startsOn ?? contract.signedOn).sort();
      if (starts.length > 0 && compareCivil(starts[0]!, today) <= 0) {
        dealMoves.push({ deal_id: deal.id, stage_id: state.activeStageId });
      }
    }
  }

  return {
    payload: { org_id: state.orgId, items, drafts, notifications, emails, deal_moves: dealMoves },
    skipped,
  };
}
