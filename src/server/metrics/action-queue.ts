import "server-only";
import { addDays, type CivilDate } from "@/domain/dates/civil-date";
import { nowInZone } from "@/lib/clock";
import type { Db } from "@/server/billing/context";
import { loadBankingQueueCount } from "@/server/banking/exports";
import { loadClientsHealth } from "@/server/clients/health";
import { countPendingRebills } from "@/server/finance/rebill";
import { countClientsBelowThresholds } from "@/server/profitability/queue";

// La cola de trabajo del dashboard: lo que espera a que un socio haga algo. Solo cuenta (con la
// sesión del usuario, así que la RLS aplica) y enlaza a la pantalla donde se hace; no guarda nada.

export type ActionQueueKey =
  | "drafts"
  | "reminders"
  | "expiringQuotes"
  | "waitingQuotes"
  | "staleDeals"
  | "overdueExpenses"
  | "dueExpenses"
  | "rebills"
  | "clientsAtRisk"
  | "bankPending"
  | "recommendations"
  | "profitability";

export type ActionQueueItem = {
  key: ActionQueueKey;
  count: number;
  /** Importe que hay detrás (céntimos), si lo hay. */
  amountCents: number | null;
  href: string;
  tone: "default" | "warning" | "danger";
};


/** Días sin respuesta a partir de los que un presupuesto enviado pide un seguimiento. */
const QUOTE_FOLLOW_UP_DAYS = 7;
/** Horizonte de "caduca pronto" y de "gasto por pagar pronto". */
const SOON_DAYS = 7;

const sum = (rows: Array<Record<string, unknown>> | null, key: string) =>
  (rows ?? []).reduce((total, row) => total + (typeof row[key] === "number" ? (row[key] as number) : 0), 0);

export async function loadActionQueue(
  db: Db,
  org: { id: string; slug: string; timezone: string; settings: unknown },
): Promise<ActionQueueItem[]> {
  const today: CivilDate = nowInZone(org.timezone).date;
  const soon = addDays(today, SOON_DAYS);
  const followUpBefore = addDays(today, -QUOTE_FOLLOW_UP_DAYS);
  const base = `/${org.slug}`;

  const [drafts, reminders, quotes, deals, expenses, recommendations, health, bank, belowThresholds, rebills] = await Promise.all([
    db.from("invoices_overview").select("total_cents").eq("org_id", org.id).in("status", ["draft", "issuing"]),
    db.from("outbound_emails").select("id", { count: "exact", head: true }).eq("org_id", org.id).eq("status", "pending_approval"),
    db
      .from("quotes_overview")
      .select("issued_on, valid_until, one_off_cents, monthly_cents, yearly_cents")
      .eq("org_id", org.id)
      .eq("status", "sent"),
    db
      .from("deals_board")
      .select("id", { count: "exact", head: true })
      .eq("org_id", org.id)
      .eq("stage_kind", "open")
      .lt("next_action_on", today),
    db.from("expenses_overview").select("status, payable_on, total_cents").eq("org_id", org.id).in("status", ["pending", "overdue"]),
    db.from("recommendations").select("id", { count: "exact", head: true }).eq("org_id", org.id).eq("status", "nueva"),
    loadClientsHealth(db, org),
    // Si el módulo de banco aún no tiene datos (o falla), la fila simplemente no sale.
    loadBankingQueueCount(db, org.id).catch(() => 0),
    // Rentabilidad de los últimos 3 meses: solo si quien mira ve los costes por hora (socios).
    countClientsBelowThresholds(db, org, today).catch(() => 0),
    // Gastos de clientes marcados «Repercutir» que aún no están en ninguna factura.
    countPendingRebills(db, org.id).catch(() => ({ count: 0, amountCents: 0 })),
  ]);
  const atRisk = [...health.values()].filter((h) => h.level !== "good");

  const sentQuotes = quotes.data ?? [];
  const quoteValue = (q: (typeof sentQuotes)[number]) => (q.one_off_cents ?? 0) + (q.monthly_cents ?? 0) * 12 + (q.yearly_cents ?? 0);
  const expiring = sentQuotes.filter((q) => q.valid_until !== null && q.valid_until >= today && q.valid_until <= soon);
  const waiting = sentQuotes.filter((q) => !expiring.includes(q) && q.issued_on !== null && q.issued_on <= followUpBefore);
  const openExpenses = expenses.data ?? [];
  const overdueExpenses = openExpenses.filter((e) => e.status === "overdue");
  const dueExpenses = openExpenses.filter((e) => e.status === "pending" && e.payable_on !== null && e.payable_on <= soon);

  const items: ActionQueueItem[] = [
    { key: "drafts", count: drafts.data?.length ?? 0, amountCents: sum(drafts.data, "total_cents"), href: `${base}/invoices?status=draft`, tone: "default" },
    { key: "reminders", count: reminders.count ?? 0, amountCents: null, href: `${base}/invoices/outbox`, tone: "warning" },
    {
      key: "expiringQuotes",
      count: expiring.length,
      amountCents: expiring.reduce((t, q) => t + quoteValue(q), 0),
      href: `${base}/quotes`,
      tone: "warning",
    },
    {
      key: "waitingQuotes",
      count: waiting.length,
      amountCents: waiting.reduce((t, q) => t + quoteValue(q), 0),
      href: `${base}/quotes`,
      tone: "default",
    },
    { key: "staleDeals", count: deals.count ?? 0, amountCents: null, href: `${base}/pipeline`, tone: "warning" },
    {
      key: "overdueExpenses",
      count: overdueExpenses.length,
      amountCents: sum(overdueExpenses, "total_cents"),
      href: `${base}/finance/expenses?status=overdue`,
      tone: "danger",
    },
    {
      key: "dueExpenses",
      count: dueExpenses.length,
      amountCents: sum(dueExpenses, "total_cents"),
      href: `${base}/finance/expenses?status=pending`,
      tone: "default",
    },
    {
      key: "rebills",
      count: rebills.count,
      amountCents: rebills.amountCents,
      href: `${base}/finance/expenses?rebill=pending`,
      tone: "default",
    },
    {
      key: "clientsAtRisk",
      count: atRisk.length,
      amountCents: null,
      href: `${base}/clients?health=attention`,
      tone: atRisk.some((h) => h.level === "danger") ? "danger" : "warning",
    },
    { key: "bankPending", count: bank, amountCents: null, href: `${base}/finance/bank`, tone: "default" },
    {
      key: "profitability",
      count: belowThresholds,
      amountCents: null,
      href: `${base}/finance/profitability?period=last3m`,
      tone: "warning",
    },
    // Sin la tabla (o sin permiso) el conteo sale null y la fila no aparece.
    { key: "recommendations", count: recommendations.count ?? 0, amountCents: null, href: `${base}/council`, tone: "default" },
  ];

  return items.filter((item) => item.count > 0);
}
