import "server-only";
import { cache } from "react";
import { CONTRACT_STATUSES, type ContractStatus } from "@/app/[org]/contracts/schema";
import {
  contractSummary,
  currentPause,
  defaultVersionFrom,
  lineBase,
  lineNextBillingOn,
  milestoneAmounts,
  recommendedEndOn,
  type SummaryLine,
  upcomingPause,
} from "@/app/[org]/contracts/summary";
import { readOrgSettings } from "@/app/[org]/settings/schema";
import type {
  BillableItemView,
  BillableState,
  ClientContractItem,
  ContractDetailData,
  ContractFormOptions,
  ContractInvoiceView,
  ContractLineView,
  ContractListItem,
  IssuerAssignmentView,
  MilestoneView,
  PauseView,
} from "@/components/contracts/types";
import { compareCivil } from "@/domain/dates/civil-date";
import { nowInZone } from "@/lib/clock";
import type { Tables } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/server/action-utils";
import { fetchAll } from "@/server/billing/context";

/**
 * Lecturas de contratos. Todo pasa por RLS (cualquier miembro lee) y las cifras se derivan
 * en TS con la única definición de cada una (src/domain, `contracts/summary.ts`).
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;
type OrgRef = Pick<Tables<"orgs">, "id" | "settings">;

const issuerLabel = (i: { legal_name: string; trade_name: string | null }) => i.trade_name || i.legal_name;
const unique = <T>(values: T[]) => [...new Set(values)];

function chunks<T>(values: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

function groupBy<T, K>(rows: readonly T[], key: (row: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = map.get(k);
    if (list) list.push(row);
    else map.set(k, [row]);
  }
  return map;
}

/** Hoy en la zona horaria de la org. */
export function orgToday(timeZone: string): string {
  return nowInZone(timeZone).date;
}

/** Clientes, emisores e IVA para los paneles de alta y edición, con los valores por defecto de la org. */
export const getContractFormOptions = cache(async (org: OrgRef): Promise<ContractFormOptions> => {
  const supabase = await createClient();
  const [clients, issuers, rates] = await Promise.all([
    supabase.from("clients").select("id, display_name").eq("org_id", org.id).is("archived_at", null).order("display_name"),
    supabase
      .from("issuers")
      .select("id, legal_name, trade_name, kind, is_primary, active_from")
      .eq("org_id", org.id)
      .is("archived_at", null)
      .order("is_primary", { ascending: false })
      .order("legal_name"),
    supabase
      .from("tax_rates")
      .select("id, name, rate_bps, is_default")
      .eq("org_id", org.id)
      .eq("kind", "vat")
      .is("archived_at", null)
      .order("position")
      .order("name"),
  ]);
  for (const r of [clients, issuers, rates]) if (r.error) throw r.error;

  const settings = readOrgSettings(org.settings);
  const issuerOptions = (issuers.data ?? []).map((i) => ({
    id: i.id,
    name: issuerLabel(i),
    isPrimary: i.is_primary,
    pendingConstitution: i.kind === "company" && i.active_from === null,
  }));
  const vatRates = (rates.data ?? []).map((r) => ({ id: r.id, name: r.name, rateBps: r.rate_bps, isDefault: r.is_default }));
  return {
    clients: (clients.data ?? []).map((c) => ({ id: c.id, name: c.display_name })),
    issuers: issuerOptions,
    vatRates,
    defaultIssuerId: (issuerOptions.find((i) => i.isPrimary) ?? issuerOptions[0])?.id ?? null,
    defaultVatRateId: (vatRates.find((r) => r.isDefault) ?? vatRates[0])?.id ?? null,
    billingDay: settings.billing_day,
    paymentTermsDays: settings.payment_terms_days,
  };
});

type LineRow = Pick<
  Tables<"contract_lines">,
  | "id"
  | "contract_id"
  | "billing_type"
  | "quantity"
  | "unit_price_cents"
  | "discount_bps"
  | "starts_on"
  | "ends_on"
  | "billing_day"
  | "prorate_first"
>;
type PauseRow = Pick<Tables<"contract_line_pauses">, "id" | "line_id" | "starts_on" | "ends_on" | "reason">;

const LINE_COLUMNS = "id, contract_id, billing_type, quantity, unit_price_cents, discount_bps, starts_on, ends_on, billing_day, prorate_first";

function toSummaryLine(line: Omit<LineRow, "id" | "contract_id">, pauses: readonly PauseRow[]): SummaryLine {
  return {
    billingType: line.billing_type,
    quantity: line.quantity,
    unitPriceCents: line.unit_price_cents,
    discountBps: line.discount_bps,
    startsOn: line.starts_on,
    endsOn: line.ends_on,
    billingDay: line.billing_day,
    prorateFirst: line.prorate_first,
    pauses: pauses.map((p) => ({ startsOn: p.starts_on, endsOn: p.ends_on })),
  };
}

/** Líneas con sus pausas, por contrato: de toda la org o solo de unos contratos. */
async function loadSummaryLines(supabase: Supabase, orgId: string, contractIds?: string[]): Promise<Map<string, SummaryLine[]>> {
  if (contractIds && contractIds.length === 0) return new Map();
  const lines = await fetchAll<LineRow>((from, to) => {
    const query = supabase.from("contract_lines").select(LINE_COLUMNS).eq("org_id", orgId);
    return (contractIds ? query.in("contract_id", contractIds) : query).order("id").range(from, to);
  }, "contracts.lines");
  const pauses =
    lines.length === 0
      ? []
      : contractIds
        ? (
            await Promise.all(
              chunks(
                lines.map((l) => l.id),
                100,
              ).map((ids) =>
                fetchAll<PauseRow>(
                  (from, to) =>
                    supabase
                      .from("contract_line_pauses")
                      .select("id, line_id, starts_on, ends_on, reason")
                      .in("line_id", ids)
                      .order("id")
                      .range(from, to),
                  "contracts.pauses",
                ),
              ),
            )
          ).flat()
        : await fetchAll<PauseRow>(
            (from, to) =>
              supabase
                .from("contract_line_pauses")
                .select("id, line_id, starts_on, ends_on, reason")
                .eq("org_id", orgId)
                .order("id")
                .range(from, to),
            "contracts.pauses",
          );
  const pausesByLine = groupBy(pauses, (p) => p.line_id);
  const byContract = new Map<string, SummaryLine[]>();
  for (const line of lines) {
    const list = byContract.get(line.contract_id) ?? [];
    list.push(toSummaryLine(line, pausesByLine.get(line.id) ?? []));
    byContract.set(line.contract_id, list);
  }
  return byContract;
}

const STATUS_RANK = new Map<ContractStatus, number>(CONTRACT_STATUSES.map((s, i) => [s, i]));

/** Listado: estado, cifras y emisor vigente de cada contrato de la org (también los archivados). */
export async function getContractsList(orgId: string, today: string): Promise<ContractListItem[]> {
  const supabase = await createClient();
  const [overview, issuers, linesByContract] = await Promise.all([
    fetchAll(
      (from, to) =>
        supabase
          .from("contracts_overview")
          .select("id, title, client_id, client_name, status, signed_on, issuer_id, lines_count, archived_at")
          .eq("org_id", orgId)
          .order("id")
          .range(from, to),
      "contracts.list",
    ),
    supabase.from("issuers").select("id, legal_name, trade_name").eq("org_id", orgId),
    loadSummaryLines(supabase, orgId),
  ]);
  if (issuers.error) throw issuers.error;
  const issuerNames = new Map((issuers.data ?? []).map((i) => [i.id, issuerLabel(i)]));

  return overview
    .flatMap((row): ContractListItem[] => {
      if (!row.id || !row.title || !row.client_id) return [];
      const summary = contractSummary(linesByContract.get(row.id) ?? [], today);
      return [
        {
          id: row.id,
          title: row.title,
          clientId: row.client_id,
          clientName: row.client_name ?? "",
          status: row.status ?? "draft",
          signedOn: row.signed_on,
          archived: row.archived_at !== null,
          linesCount: row.lines_count ?? 0,
          mrrCents: summary.mrrCents,
          upcomingMrr: summary.upcomingMrr,
          oneOffCents: summary.oneOffCents,
          nextBillingOn: row.signed_on ? summary.nextBillingOn : null,
          issuerName: row.issuer_id ? (issuerNames.get(row.issuer_id) ?? null) : null,
        },
      ];
    })
    .sort(
      (a, b) =>
        (STATUS_RANK.get(a.status) ?? 99) - (STATUS_RANK.get(b.status) ?? 99) ||
        a.clientName.localeCompare(b.clientName, "es", { sensitivity: "base" }) ||
        a.title.localeCompare(b.title, "es", { sensitivity: "base" }),
    );
}

/**
 * Contratos de un cliente para su ficha 360 (sin los archivados), con su MRR, lo puntual y
 * la próxima facturación de hoy en la zona de la org.
 */
export async function getClientContracts(orgId: string, clientId: string): Promise<ClientContractItem[]> {
  if (!idSchema.safeParse(clientId).success) return [];
  const supabase = await createClient();
  const [org, overview] = await Promise.all([
    supabase.from("orgs").select("timezone").eq("id", orgId).single(),
    supabase
      .from("contracts_overview")
      .select("id, title, status, signed_on, created_at")
      .eq("org_id", orgId)
      .eq("client_id", clientId)
      .is("archived_at", null),
  ]);
  if (org.error) throw org.error;
  if (overview.error) throw overview.error;

  const today = orgToday(org.data.timezone);
  // Primero los vivos; dentro de cada estado, el más reciente arriba.
  const rows = (overview.data ?? [])
    .flatMap((r) => (r.id && r.title ? [{ ...r, id: r.id, title: r.title, status: r.status ?? "draft" }] : []))
    .sort(
      (a, b) =>
        (STATUS_RANK.get(a.status) ?? 99) - (STATUS_RANK.get(b.status) ?? 99) ||
        (b.created_at ?? "").localeCompare(a.created_at ?? ""),
    );
  const linesByContract = await loadSummaryLines(
    supabase,
    orgId,
    rows.map((r) => r.id),
  );
  return rows.map((row) => {
    const summary = contractSummary(linesByContract.get(row.id) ?? [], today);
    return {
      id: row.id,
      title: row.title,
      status: row.status,
      signedOn: row.signed_on,
      mrrCents: summary.mrrCents,
      upcomingMrr: summary.upcomingMrr,
      oneOffCents: summary.oneOffCents,
      nextBillingOn: row.signed_on ? summary.nextBillingOn : null,
    };
  });
}

/** Fila del contrato (vista con su estado y su emisor de hoy). Una vez por petición: metadatos y página. */
export const getContractRow = cache(async (orgId: string, contractId: string) => {
  if (!idSchema.safeParse(contractId).success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contracts_overview")
    .select(
      "id, title, client_id, client_name, signed_on, payment_terms_days, payment_method, invoice_grouping, notes, archived_at, issuer_id, status",
    )
    .eq("org_id", orgId)
    .eq("id", contractId)
    .maybeSingle();
  if (error) throw error;
  return data?.id && data.title && data.client_id ? { ...data, id: data.id, title: data.title, client_id: data.client_id } : null;
});

function milestoneState(items: readonly { state: BillableState }[]): BillableState | null {
  if (items.length === 0) return null;
  for (const state of ["invoiced", "drafted", "pending"] as const) {
    if (items.some((i) => i.state === state)) return state;
  }
  return "waived";
}

/** Todo lo de la ficha de un contrato, o null si no existe (o la RLS no deja verlo). */
export async function getContractDetail(
  org: OrgRef,
  contractId: string,
  today: string,
): Promise<Omit<ContractDetailData, "slug" | "basePath" | "canEdit"> | null> {
  const contract = await getContractRow(org.id, contractId);
  if (!contract) return null;
  const supabase = await createClient();

  const [linesRes, issuerRowsRes, milestonesRes, itemRows, orgIssuersRes, ratesRes, clientRes, options] = await Promise.all([
    supabase
      .from("contract_lines_overview")
      .select(
        "id, position, description, billing_type, quantity, unit_price_cents, discount_bps, tax_rate_id, irpf_applies, starts_on, ends_on, billing_day, prorate_first, cancelled_on, cancel_reason, replaces_line_id, created_at, status, billed_until, billed_items_count",
      )
      .eq("org_id", org.id)
      .eq("contract_id", contract.id),
    supabase
      .from("contract_issuers")
      .select("id, issuer_id, valid_from")
      .eq("org_id", org.id)
      .eq("contract_id", contract.id)
      .order("valid_from"),
    supabase
      .from("contract_milestones")
      .select("id, position, label, percent_bps, planned_on, auto")
      .eq("org_id", org.id)
      .eq("contract_id", contract.id)
      .order("position"),
    fetchAll(
      (from, to) =>
        supabase
          .from("billable_items_overview")
          .select(
            "id, contract_line_id, source, description, period_start, period_end, billable_on, quantity, amount_cents, state, invoice_id, invoice_number, waived_at, waive_reason, milestone_id",
          )
          .eq("org_id", org.id)
          .eq("contract_id", contract.id)
          .order("billable_on", { ascending: false })
          .order("id")
          .range(from, to),
      "contract.items",
    ),
    supabase.from("issuers").select("id, legal_name, trade_name").eq("org_id", org.id),
    supabase.from("tax_rates").select("id, name").eq("org_id", org.id),
    supabase.from("clients").select("payment_terms_days").eq("org_id", org.id).eq("id", contract.client_id).maybeSingle(),
    getContractFormOptions(org),
  ]);
  for (const r of [linesRes, issuerRowsRes, milestonesRes, orgIssuersRes, ratesRes, clientRes]) if (r.error) throw r.error;

  const lineRows = (linesRes.data ?? [])
    .flatMap((l) =>
      l.id && l.billing_type && l.description !== null && l.tax_rate_id
        ? [{ ...l, id: l.id, billing_type: l.billing_type, description: l.description, tax_rate_id: l.tax_rate_id }]
        : [],
    )
    // Por posición; las versiones de una misma línea, por fecha de inicio.
    .sort(
      (a, b) =>
        (a.position ?? 0) - (b.position ?? 0) ||
        (a.starts_on ?? "").localeCompare(b.starts_on ?? "") ||
        (a.created_at ?? "").localeCompare(b.created_at ?? ""),
    );
  const lineIds = lineRows.map((l) => l.id);

  // Pausas de sus líneas y facturas en las que aparece alguna (las rectificativas copian la línea).
  const [pauses, invoiceLineRows] = await Promise.all([
    lineIds.length === 0
      ? Promise.resolve([] as PauseRow[])
      : fetchAll<PauseRow>(
          (from, to) =>
            supabase
              .from("contract_line_pauses")
              .select("id, line_id, starts_on, ends_on, reason")
              .in("line_id", lineIds)
              .order("starts_on")
              .order("id")
              .range(from, to),
          "contract.pauses",
        ),
    lineIds.length === 0
      ? Promise.resolve([] as { invoice_id: string }[])
      : fetchAll<{ invoice_id: string }>(
          (from, to) =>
            supabase.from("invoice_lines").select("invoice_id").in("contract_line_id", lineIds).order("id").range(from, to),
          "contract.invoiceLines",
        ),
  ]);
  const invoiceIds = unique(invoiceLineRows.map((r) => r.invoice_id));
  const invoiceRows = (
    await Promise.all(
      chunks(invoiceIds, 100).map(async (ids) => {
        const { data, error } = await supabase
          .from("invoices_overview")
          .select("id, number, kind, issued_on, created_at, total_cents, status")
          .in("id", ids);
        if (error) throw error;
        return data ?? [];
      }),
    )
  ).flat();

  const rateNames = new Map((ratesRes.data ?? []).map((r) => [r.id, r.name]));
  const issuerNames = new Map((orgIssuersRes.data ?? []).map((i) => [i.id, issuerLabel(i)]));
  const pausesByLine = groupBy(pauses, (p) => p.line_id);
  const replacedBy = new Map(lineRows.flatMap((l) => (l.replaces_line_id ? [[l.replaces_line_id, l.id] as const] : [])));

  const summaryLines: SummaryLine[] = [];
  const lines: ContractLineView[] = lineRows.map((row) => {
    const linePauses = pausesByLine.get(row.id) ?? [];
    const summaryLine = toSummaryLine(
      {
        billing_type: row.billing_type,
        quantity: row.quantity ?? 1,
        unit_price_cents: row.unit_price_cents ?? 0,
        discount_bps: row.discount_bps ?? 0,
        starts_on: row.starts_on,
        ends_on: row.ends_on,
        billing_day: row.billing_day,
        prorate_first: row.prorate_first ?? true,
      },
      linePauses,
    );
    summaryLines.push(summaryLine);
    const pauseViews: PauseView[] = linePauses.map((p) => ({ id: p.id, startsOn: p.starts_on, endsOn: p.ends_on, reason: p.reason }));
    const status = row.status ?? "active";
    return {
      id: row.id,
      position: row.position ?? 0,
      description: row.description,
      billingType: row.billing_type,
      quantity: Number(row.quantity ?? 1),
      unitPriceCents: row.unit_price_cents ?? 0,
      discountBps: row.discount_bps ?? 0,
      taxRateId: row.tax_rate_id,
      taxRateName: rateNames.get(row.tax_rate_id) ?? "—",
      irpfApplies: row.irpf_applies ?? true,
      startsOn: row.starts_on,
      endsOn: row.ends_on,
      billingDay: row.billing_day,
      prorateFirst: row.prorate_first ?? true,
      cancelledOn: row.cancelled_on,
      cancelReason: row.cancel_reason,
      replacesLineId: row.replaces_line_id,
      replacedByLineId: replacedBy.get(row.id) ?? null,
      status,
      billedUntil: row.billed_until,
      billedItemsCount: row.billed_items_count ?? 0,
      baseCents: lineBase(summaryLine),
      // Sin firma no se factura nada: no hay próxima facturación que enseñar.
      nextBillingOn: status === "ended" || !contract.signed_on ? null : lineNextBillingOn(summaryLine, today),
      pauses: pauseViews,
      currentPause: currentPause(pauseViews, today),
      upcomingPause: upcomingPause(pauseViews, today),
      recommendedEndOn: recommendedEndOn({ ...summaryLine, billedUntil: row.billed_until }, today),
      defaultVersionFrom: defaultVersionFrom({ startsOn: row.starts_on, billedUntil: row.billed_until }, today),
    };
  });

  const milestoneOfItem = new Map<string, string>();
  const items: BillableItemView[] = itemRows.flatMap((i) => {
    if (!i.id || !i.contract_line_id || !i.source || !i.state || !i.billable_on) return [];
    if (i.milestone_id) milestoneOfItem.set(i.id, i.milestone_id);
    return [
      {
        id: i.id,
        contractLineId: i.contract_line_id,
        source: i.source,
        description: i.description ?? "",
        periodStart: i.period_start,
        periodEnd: i.period_end,
        billableOn: i.billable_on,
        quantity: Number(i.quantity ?? 1),
        amountCents: i.amount_cents ?? 0,
        state: i.state,
        invoiceId: i.invoice_id,
        invoiceNumber: i.invoice_number,
        waivedAt: i.waived_at,
        waiveReason: i.waive_reason,
      },
    ];
  });

  // Hitos: su importe sale del reparto de las líneas puntuales; su estado, de sus pendientes.
  const milestoneRows = milestonesRes.data ?? [];
  const oneOffLines = lines.filter((l) => l.billingType === "one_off").map((l) => ({ id: l.id, baseCents: l.baseCents }));
  const amounts =
    oneOffLines.length > 0 ? milestoneAmounts(oneOffLines, milestoneRows.map((m) => ({ id: m.id, percentBps: m.percent_bps }))) : null;
  const itemsByMilestone = groupBy(
    items.filter((i) => milestoneOfItem.has(i.id)),
    (i) => milestoneOfItem.get(i.id),
  );
  const milestones: MilestoneView[] = milestoneRows.map((m) => {
    const mItems = itemsByMilestone.get(m.id) ?? [];
    const withInvoice = mItems.find((i) => i.invoiceId);
    return {
      id: m.id,
      position: m.position,
      label: m.label,
      percentBps: m.percent_bps,
      plannedOn: m.planned_on,
      auto: m.auto,
      amountCents: amounts?.[m.id] ?? null,
      state: milestoneState(mItems),
      invoiceId: withInvoice?.invoiceId ?? null,
      invoiceNumber: withInvoice?.invoiceNumber ?? null,
    };
  });
  const nextMilestone = milestones.find((m) => m.state === null) ?? null;

  const summary = contractSummary(summaryLines, today);
  const sum = (state: BillableState) => items.filter((i) => i.state === state).reduce((acc, i) => acc + i.amountCents, 0);
  const draftedCents = sum("drafted");

  const invoices: ContractInvoiceView[] = invoiceRows
    .flatMap((i) =>
      i.id && i.kind && i.status
        ? [
            {
              id: i.id,
              number: i.number,
              kind: i.kind,
              issuedOn: i.issued_on,
              createdAt: i.created_at ?? "",
              totalCents: i.total_cents ?? 0,
              status: i.status,
            },
          ]
        : [],
    )
    // Los borradores primero; después, de la más reciente a la más antigua.
    .sort(
      (a, b) =>
        Number(a.issuedOn !== null) - Number(b.issuedOn !== null) ||
        (b.issuedOn ?? "").localeCompare(a.issuedOn ?? "") ||
        b.createdAt.localeCompare(a.createdAt),
    );

  // Emisor por fecha: el vigente es el de mayor valid_from que no supere hoy (o el primero).
  const issuerRows = issuerRowsRes.data ?? [];
  const currentIndex = issuerRows.reduce((current, row, index) => (compareCivil(row.valid_from, today) <= 0 ? index : current), 0);
  const issuerHistory: IssuerAssignmentView[] = issuerRows.map((row, index) => ({
    id: row.id,
    issuerId: row.issuer_id,
    issuerName: issuerNames.get(row.issuer_id) ?? "—",
    validFrom: row.valid_from,
    current: index === currentIndex,
    scheduled: compareCivil(row.valid_from, today) > 0,
  }));
  const currentIssuerId = contract.issuer_id ?? issuerRows[currentIndex]?.issuer_id ?? null;

  const clientDays = clientRes.data?.payment_terms_days ?? null;
  const paymentTerms =
    contract.payment_terms_days !== null
      ? { days: contract.payment_terms_days, source: "contract" as const, clientDays }
      : clientDays !== null
        ? { days: clientDays, source: "client" as const, clientDays }
        : { days: options.paymentTermsDays, source: "org" as const, clientDays };

  return {
    today,
    contract: {
      id: contract.id,
      title: contract.title,
      clientId: contract.client_id,
      clientName: contract.client_name ?? "",
      signedOn: contract.signed_on,
      paymentTermsDays: contract.payment_terms_days,
      paymentMethod: contract.payment_method ?? "transfer",
      invoiceGrouping: contract.invoice_grouping ?? "client",
      notes: contract.notes,
      archived: contract.archived_at !== null,
      status: contract.status ?? "draft",
    },
    paymentTerms,
    issuer: currentIssuerId ? { id: currentIssuerId, name: issuerNames.get(currentIssuerId) ?? "—" } : null,
    issuerHistory,
    lines,
    milestones,
    nextMilestoneId: nextMilestone?.id ?? null,
    items,
    invoices,
    kpis: {
      mrrCents: summary.mrrCents,
      upcomingMrr: summary.upcomingMrr,
      oneOffCents: summary.oneOffCents,
      oneOffPendingCents:
        milestones.length === 0
          ? summary.oneOffCents
          : milestones.filter((m) => m.state === null).reduce((acc, m) => acc + (m.amountCents ?? 0), 0),
      billedCents: sum("invoiced"),
      pendingCents: sum("pending") + draftedCents,
      draftedCents,
      issuedInvoices: invoices.filter((i) => i.kind === "ordinary" && i.status !== "draft" && i.status !== "issuing").length,
    },
    options,
  };
}
