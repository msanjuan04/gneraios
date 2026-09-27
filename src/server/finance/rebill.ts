import "server-only";
import { randomUUID } from "node:crypto";
import { readOrgSettings } from "@/app/[org]/settings/schema";
import type { ClientRebillData, RebillClientGroup, RebillItem } from "@/components/finance/types";
import type { CivilDate } from "@/domain/dates/civil-date";
import {
  groupRebillsByClient,
  planRebillLines,
  rebillAmountCents,
  type RebillExpense,
  rebillTotals,
  sortRebills,
} from "@/domain/finance/rebill";
import type { DraftLinePayload, TaxRateRef } from "@/domain/invoicing/draft-line";
import type { Locale } from "@/i18n/config";
import type { Json, Tables } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { BillingRuleError, type Db, DbError, fetchAll, must } from "@/server/billing/context";
import { loadDraftEditor } from "@/server/invoices/detail";
import { rebillLineDescriber } from "./rebill-copy";

// Repercutir gastos a los clientes (src/domain/finance/rebill.ts): lo que falta repercutir, por
// cliente, y «Añadir a factura», que lo pone en un borrador del cliente con una línea por gasto.
//
// «Añadir a factura» usa el borrador ordinario abierto más reciente del cliente (reenviando todas
// sus líneas, como el cron) o, si no tiene, uno nuevo con los valores de una factura manual nueva
// (emisor, IVA, IRPF e idioma: loadDraftEditor). La base de datos (rebill_expenses) guarda el
// borrador con save_invoice_draft y enlaza cada gasto con su línea en la misma transacción, y solo
// si todos siguen pendientes: repetirlo nunca repercute dos veces lo mismo.

/** Si el borrador cambia entre la lectura y la escritura (o otro socio se adelanta), se vuelve a intentar. */
const MAX_ATTEMPTS = 3;

export type PendingRebill = RebillExpense & { clientName: string; fromSubscription: boolean };

const PENDING_COLUMNS = "id, client_id, client_name, description, vendor_name, issued_on, period_start, base_cents, rebill_markup_bps, source";

/** Lo que falta repercutir (marcado «Repercutir» y sin línea de factura), de un cliente o de todos. */
export async function loadPendingRebills(
  db: Db,
  orgId: string,
  filter: { clientId?: string; expenseIds?: readonly string[] | null } = {},
): Promise<PendingRebill[]> {
  const rows = await fetchAll((from, to) => {
    let query = db.from("expenses_overview").select(PENDING_COLUMNS).eq("org_id", orgId).eq("rebill_state", "pending");
    if (filter.clientId) query = query.eq("client_id", filter.clientId);
    if (filter.expenseIds) query = query.in("id", [...filter.expenseIds]);
    return query.order("issued_on").order("id").range(from, to);
  }, "finance.rebill.pending");
  return rows.flatMap((r) =>
    r.id && r.client_id && r.issued_on
      ? [
          {
            id: r.id,
            clientId: r.client_id,
            clientName: r.client_name ?? "",
            description: r.description ?? "",
            vendorName: r.vendor_name ?? null,
            issuedOn: r.issued_on,
            periodStart: r.period_start ?? null,
            baseCents: r.base_cents ?? 0,
            markupBps: r.rebill_markup_bps ?? 0,
            fromSubscription: r.source === "subscription",
          },
        ]
      : [],
  );
}

function toItem(e: PendingRebill): RebillItem {
  return {
    id: e.id,
    description: e.description,
    vendorName: e.vendorName,
    issuedOn: e.issuedOn,
    periodStart: e.periodStart,
    baseCents: e.baseCents,
    markupBps: e.markupBps,
    amountCents: rebillAmountCents(e.baseCents, e.markupBps),
    fromSubscription: e.fromSubscription,
  };
}

/** Los pendientes por cliente (de más a menos importe), para «Por repercutir» en Gastos. */
export async function listRebillGroups(db: Db, orgId: string): Promise<RebillClientGroup[]> {
  const pending = await loadPendingRebills(db, orgId);
  const byId = new Map(pending.map((p) => [p.id, p]));
  return groupRebillsByClient(pending).map((group) => {
    const items = group.expenses.map((e) => byId.get(e.id)!);
    return {
      clientId: group.clientId,
      clientName: items[0]?.clientName ?? "",
      count: group.count,
      baseCents: group.baseCents,
      markupCents: group.markupCents,
      amountCents: group.amountCents,
      items: items.map(toItem),
    };
  });
}

/** Cuántos gastos faltan por repercutir y cuánto se facturaría (sin IVA): el dashboard y el filtro de Gastos. */
export async function countPendingRebills(db: Db, orgId: string): Promise<{ count: number; amountCents: number }> {
  const rows = await fetchAll(
    (from, to) =>
      db
        .from("expenses_overview")
        .select("id, base_cents, rebill_markup_bps")
        .eq("org_id", orgId)
        .eq("rebill_state", "pending")
        .order("id")
        .range(from, to),
    "finance.rebill.count",
  );
  const totals = rebillTotals(rows.map((r) => ({ baseCents: r.base_cents ?? 0, markupBps: r.rebill_markup_bps ?? 0 })));
  return { count: totals.count, amountCents: totals.amountCents };
}

/**
 * La tarjeta «Por repercutir» de la ficha del cliente: sus gastos pendientes con lo que se le
 * facturará y lo que ya está en un borrador suyo (el importe de sus líneas, por si se retocaron).
 */
export async function getClientRebills(orgId: string, clientId: string): Promise<ClientRebillData> {
  const supabase = await createClient();
  const [pending, drafted] = await Promise.all([
    loadPendingRebills(supabase, orgId, { clientId }),
    supabase
      .from("expenses_overview")
      .select("rebill_invoice_line_id, rebill_invoice_id")
      .eq("org_id", orgId)
      .eq("client_id", clientId)
      .eq("rebill_state", "drafted"),
  ]);
  const draftedRows = must(drafted, "finance.rebill.drafted");
  const lineIds = draftedRows.flatMap((r) => (r.rebill_invoice_line_id ? [r.rebill_invoice_line_id] : []));
  const lines = lineIds.length
    ? must(await supabase.from("invoice_lines").select("id, base_cents").in("id", lineIds), "finance.rebill.draftedLines")
    : [];
  const sorted = sortRebills(pending);
  return {
    pending: sorted.map(toItem),
    totals: rebillTotals(sorted),
    drafted: {
      count: draftedRows.length,
      amountCents: lines.reduce((sum, l) => sum + l.base_cents, 0),
      invoiceId: draftedRows.find((r) => r.rebill_invoice_id)?.rebill_invoice_id ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// «Añadir a factura»
// ---------------------------------------------------------------------------

type OpenDraft = {
  id: string;
  updatedAt: string;
  irpfBps: number;
  language: Locale;
  lines: DraftLinePayload[];
};

/** El borrador ordinario abierto más reciente del cliente, con sus líneas tal como están guardadas. */
async function latestOpenDraft(db: Db, orgId: string, clientId: string): Promise<OpenDraft | null> {
  const draft = must(
    await db
      .from("invoices")
      .select("id, updated_at, irpf_bps, language, invoice_lines(*)")
      .eq("org_id", orgId)
      .eq("client_id", clientId)
      .eq("lifecycle", "draft")
      .eq("kind", "ordinary")
      .order("created_at", { ascending: false })
      .order("id")
      .limit(1),
    "finance.rebill.draft",
  )[0];
  if (!draft) return null;
  return {
    id: draft.id,
    updatedAt: draft.updated_at,
    irpfBps: draft.irpf_bps,
    language: draft.language,
    // Las mismas líneas, sin tocar nada (como las reenvía el cron al añadir a un borrador).
    lines: [...draft.invoice_lines]
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
          billable_item_id: null,
        }),
      ),
  };
}

type RebillTarget = {
  payload: { draft: Record<string, Json>; links: { expense_id: string; line_id: string }[] };
  appended: boolean;
};

async function buildTarget(
  db: Db,
  org: Pick<Tables<"orgs">, "id" | "settings">,
  clientId: string,
  pending: readonly RebillExpense[],
  today: CivilDate,
): Promise<RebillTarget> {
  const [draft, editor] = await Promise.all([
    latestOpenDraft(db, org.id, clientId),
    // Los valores de una factura manual nueva para este cliente (emisor, IVA, IRPF, idioma).
    loadDraftEditor(org, null, { today, orgPaymentTermsDays: readOrgSettings(org.settings).payment_terms_days, clientId }),
  ]);
  const client = editor.clients.find((c) => c.id === clientId);
  // Un cliente archivado ya no se elige en una factura nueva: tampoco aquí.
  if (!client) throw new BillingRuleError("finance.rebill.errors.clientUnavailable");
  const defaults = editor.defaults;
  const vat = editor.vatRates.find((r) => r.id === defaults.lines[0]?.tax_rate_id);
  if (!vat) throw new BillingRuleError("billing.errors.vatRateRequired");
  const taxRate: TaxRateRef = { id: vat.id, rateBps: vat.rateBps, regime: vat.regime, legalNote: vat.legalNote };

  const language = draft?.language ?? defaults.language;
  const irpfBps = draft?.irpfBps ?? Number(defaults.irpf_bps);
  const lines = planRebillLines(pending, {
    startPosition: draft ? Math.max(-1, ...draft.lines.map((l) => l.position)) + 1 : 0,
    taxRate,
    invoiceIrpfBps: irpfBps,
    // Como una línea manual nueva: sujeta al IRPF de la factura (0 % en la SL).
    irpfApplies: true,
    describe: rebillLineDescriber(language),
    newId: randomUUID,
  });
  const links = lines.map((l) => ({ expense_id: l.expenseId, line_id: l.line.id }));
  const newLines = lines.map((l) => l.line);

  if (draft) {
    return {
      appended: true,
      payload: {
        draft: {
          invoice_id: draft.id,
          expected_updated_at: draft.updatedAt,
          lines: [...draft.lines, ...newLines] as unknown as Json,
        },
        links,
      },
    };
  }
  if (!defaults.issuer_id) throw new BillingRuleError("billing.errors.noIssuer");
  return {
    appended: false,
    payload: {
      draft: {
        header: {
          issuer_id: defaults.issuer_id,
          client_id: clientId,
          language,
          irpf_bps: irpfBps,
          payment_method: defaults.payment_method,
        },
        lines: newLines as unknown as Json,
      },
      links,
    },
  };
}

export type RebillResult = { invoiceId: string; count: number; appended: boolean };

/**
 * «Añadir a factura»: los gastos pendientes del cliente (o solo los de `expenseIds` que sigan
 * pendientes) a su borrador abierto más reciente o a uno nuevo. Lanza BillingRuleError si no queda
 * nada por repercutir y DbError si la base de datos lo rechaza.
 */
export async function rebillClientExpenses(
  db: Db,
  org: Pick<Tables<"orgs">, "id" | "settings">,
  clientId: string,
  opts: { expenseIds?: readonly string[] | null; today: CivilDate },
): Promise<RebillResult> {
  for (let attempt = 1; ; attempt += 1) {
    const pending = await loadPendingRebills(db, org.id, { clientId, expenseIds: opts.expenseIds });
    if (pending.length === 0) throw new BillingRuleError("finance.rebill.errors.nothingPending");
    const target = await buildTarget(db, org, clientId, pending, opts.today);
    const { data, error } = await db.rpc("rebill_expenses", { p: target.payload as unknown as Json });
    if (error) {
      // Otro socio (o el cron) ha tocado el borrador o se ha adelantado con algún gasto: se relee.
      if ((error.hint === "draft_changed" || error.hint === "rebill_taken") && attempt < MAX_ATTEMPTS) continue;
      throw new DbError(error, "finance.rebill.apply");
    }
    return { invoiceId: data, count: pending.length, appended: target.appended };
  }
}
