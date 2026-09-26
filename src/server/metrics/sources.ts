// Sin "server-only": las fotos mensuales las calcula también el seed de la demo
// (scripts/seed-demo.ts). Solo se importa desde código de servidor.
//
// Lecturas que alimentan las métricas. Funcionan con el cliente de un miembro (RLS) y con el
// de servidor (service_role), porque todas filtran por la org de forma explícita.

import type { CivilDate } from "@/domain/dates/civil-date";
import type { ClientStatus, MetricsLine, Month, PipelineDeal, ReceivableRow, RevenueRow } from "@/domain/metrics";
import { nowInZone } from "@/lib/clock";
import type { Json } from "@/lib/supabase/database.types";
import { type Db, fetchAll } from "@/server/billing/context";

/** Una línea de contrato con lo que las métricas y las listas del dashboard necesitan. */
export type MetricsContractLine = MetricsLine & {
  id: string;
  contractId: string;
  description: string;
};

/** Día civil (en la zona de la org) de un instante. */
function localDate(instant: string, timeZone: string): CivilDate {
  return nowInZone(timeZone, new Date(instant)).date;
}

/** Líneas de los contratos firmados de la org (también los archivados: cuentan hasta que se archivaron). */
export async function loadMetricsLines(db: Db, orgId: string, timeZone: string): Promise<MetricsContractLine[]> {
  const contracts = await fetchAll(
    (from, to) =>
      db
        .from("contracts")
        .select(
          "id, client_id, signed_on, archived_at, contract_lines(id, description, billing_type, quantity, unit_price_cents, discount_bps, starts_on, ends_on, contract_line_pauses(starts_on, ends_on))",
        )
        .eq("org_id", orgId)
        .not("signed_on", "is", null)
        .order("id")
        .range(from, to),
    "metrics.lines",
  );
  return contracts.flatMap((contract) =>
    contract.contract_lines.map(
      (line): MetricsContractLine => ({
        id: line.id,
        contractId: contract.id,
        clientId: contract.client_id,
        signedOn: contract.signed_on!,
        archivedOn: contract.archived_at ? localDate(contract.archived_at, timeZone) : null,
        description: line.description,
        billingType: line.billing_type,
        quantity: String(line.quantity),
        unitPriceCents: line.unit_price_cents,
        discountBps: line.discount_bps,
        startsOn: line.starts_on,
        endsOn: line.ends_on,
        pauses: line.contract_line_pauses.map((p) => ({ startsOn: p.starts_on, endsOn: p.ends_on })),
      }),
    ),
  );
}

/** Ingresos agregados por mes y tipo de facturación (vista revenue_by_month), de `from` a `to`. */
export async function loadRevenueRows(db: Db, orgId: string, from: Month, to: Month): Promise<RevenueRow[]> {
  const rows = await fetchAll(
    (a, b) =>
      db
        .from("revenue_by_month")
        .select("month, billing_type, base_cents")
        .eq("org_id", orgId)
        .gte("month", from)
        .lte("month", to)
        .order("month")
        .order("billing_type")
        .range(a, b),
    "metrics.revenue",
  );
  return rows.flatMap((r) =>
    r.month && r.billing_type ? [{ month: r.month, billingType: r.billing_type, baseCents: r.base_cents ?? 0 }] : [],
  );
}

/** Facturación neta de cada cliente entre `from` y `to` (vista revenue_by_client_month). */
export async function loadClientBilling(db: Db, orgId: string, from: Month, to: Month): Promise<{ clientId: string; cents: number }[]> {
  const rows = await fetchAll(
    (a, b) =>
      db
        .from("revenue_by_client_month")
        .select("client_id, base_cents")
        .eq("org_id", orgId)
        .gte("month", from)
        .lte("month", to)
        .order("client_id")
        .order("month")
        .range(a, b),
    "metrics.clientBilling",
  );
  return rows.flatMap((r) => (r.client_id ? [{ clientId: r.client_id, cents: r.base_cents ?? 0 }] : []));
}

/** Facturas emitidas no cobradas en la fecha `on`, con lo que les quedaba por cobrar. */
export async function loadOpenInvoicesOn(db: Db, orgId: string, on: CivilDate): Promise<(ReceivableRow & { id: string })[]> {
  const rows = await fetchAll(
    (a, b) => db.rpc("open_invoices_on", { p_org: orgId, p_on: on }).order("invoice_id").range(a, b),
    "metrics.invoicesOn",
  );
  return rows.map((r) => ({ id: r.invoice_id, kind: "ordinary" as const, status: r.status, outstandingCents: r.outstanding_cents }));
}

/** Estado en la fecha `on` de los clientes que han tenido líneas (los demás son leads). */
export async function loadClientStatusesOn(
  db: Db,
  orgId: string,
  on: CivilDate,
): Promise<{ clientId: string; status: ClientStatus }[]> {
  const rows = await fetchAll(
    (a, b) => db.rpc("client_statuses_on", { p_org: orgId, p_on: on }).order("client_id").range(a, b),
    "metrics.clientsOn",
  );
  return rows.map((r) => ({ clientId: r.client_id, status: r.status }));
}

/** Deals abiertos al final del día `on`, con su etapa y probabilidad de entonces. */
export async function loadOpenDealsOn(db: Db, orgId: string, on: CivilDate): Promise<(PipelineDeal & { stageId: string })[]> {
  const rows = await fetchAll(
    (a, b) => db.rpc("open_deals_on", { p_org: orgId, p_on: on }).order("deal_id").range(a, b),
    "metrics.dealsOn",
  );
  return rows.map((r) => ({
    stageId: r.stage_id,
    stageKind: r.stage_kind,
    estOneOffCents: r.est_one_off_cents,
    estMrrCents: r.est_mrr_cents,
    probabilityBps: r.probability_bps,
  }));
}

export type MetricsSettings = {
  /** Ventana de renovaciones próximas: la mayor de las alertas de renovación (60 por defecto). */
  renewalWindowDays: number;
  /** Aviso de concentración: parte del cliente más grande en los últimos 12 meses (25 % por defecto). */
  concentrationAlertBps: number;
};

const DEFAULT_RENEWAL_DAYS = [60, 30, 7];
const DEFAULT_CONCENTRATION_BPS = 2500;

/** Umbrales de las métricas en orgs.settings (nada de esto vive en el código). */
export function metricsSettings(settings: Json | null | undefined): MetricsSettings {
  const s = (settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {}) as Record<string, unknown>;
  const alerts = Array.isArray(s.renewal_alert_days) ? s.renewal_alert_days.filter((d): d is number => Number.isInteger(d) && d > 0) : [];
  const concentration = s.concentration_alert_bps;
  return {
    renewalWindowDays: Math.max(...(alerts.length > 0 ? alerts : DEFAULT_RENEWAL_DAYS)),
    concentrationAlertBps:
      typeof concentration === "number" && Number.isInteger(concentration) && concentration > 0 && concentration <= 10_000
        ? concentration
        : DEFAULT_CONCENTRATION_BPS,
  };
}
