import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { InvoiceHistory } from "@/components/invoices/invoice-history";
import { buildHistory, HISTORY_GRANULARITIES, type HistoryGranularity } from "@/domain/invoicing/history";
import { nowInZone } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/server/action-utils";
import { loadInvoiceHistory } from "@/server/invoices/history";
import { getOutboxCount } from "@/server/invoices/queries";
import { getOrgContext, hasRole } from "@/server/session";

// Tipado a mano (y no con PageProps) para no depender de los tipos de rutas generados.
type Props = {
  params: Promise<{ org: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const param = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: `${t("invoices.history.title")} · ${t("nav.invoices")}` };
}

/**
 * Histórico: lo facturado, cobrado y pendiente por año, trimestre o mes desde la primera factura
 * (también las importadas), de toda la org o de un cliente con sus gastos.
 */
export default async function InvoiceHistoryPage(props: Props) {
  const [{ org: slug }, searchParams] = await Promise.all([props.params, props.searchParams]);
  const { org, member } = await getOrgContext(slug);
  const today = nowInZone(org.timezone).date;
  const isPartner = hasRole(member.role, "partner");
  const supabase = await createClient();

  const clientParam = param(searchParams.client);
  const [clients, outboxCount] = await Promise.all([
    supabase.from("clients").select("id, display_name, archived_at").eq("org_id", org.id).order("display_name"),
    getOutboxCount(supabase, org.id),
  ]);
  if (clients.error) throw clients.error;
  const client =
    clientParam && idSchema.safeParse(clientParam).success ? (clients.data.find((c) => c.id === clientParam) ?? null) : null;

  const source = await loadInvoiceHistory(org.id, client?.id ?? null);
  // Los gastos son de Finanzas: solo los ven los socios.
  const expenses = isPartner ? source.expenses : null;

  // Sin elegir: por años si el histórico tiene más de dos, por meses si es reciente.
  const first = [
    ...source.invoices.map((i) => i.issuedOn),
    ...source.payments.map((p) => p.paidOn),
    ...source.receipts.map((r) => r.receivedOn),
  ].sort()[0];
  const chosen = HISTORY_GRANULARITIES.find((g) => g === param(searchParams.g));
  const granularity: HistoryGranularity =
    chosen ?? (first && Number(today.slice(0, 4)) - Number(first.slice(0, 4)) >= 2 ? "year" : "month");
  const history = buildHistory({
    invoices: source.invoices,
    payments: source.payments,
    receipts: source.receipts,
    expenses: expenses ?? [],
    granularity,
    until: today,
  });

  return (
    <InvoiceHistory
      basePath={`/${org.slug}`}
      outboxCount={outboxCount}
      granularity={granularity}
      rows={history.rows}
      totals={history.totals}
      client={client ? { id: client.id, name: client.display_name } : null}
      clients={clients.data.map((c) => ({ id: c.id, name: c.display_name, archived: c.archived_at !== null }))}
      showCosts={expenses !== null}
    />
  );
}
