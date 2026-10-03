import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { InvoicesList } from "@/components/invoices/invoices-list";
import { UpcomingChargesCard } from "@/components/invoices/upcoming-charges-card";
import { nowInZone } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/server/action-utils";
import { getUpcomingCharges } from "@/server/billing/forecast";
import { getInvoicesSummary, getLastBillingRun, getOutboxCount, listInvoices } from "@/server/invoices/queries";
import { getOrgContext, hasRole } from "@/server/session";
import { readListFilter } from "./schema";

/** Filas que se pintan por pestaña; si hay más, se pide afinar la búsqueda. */
const LIST_LIMIT = 200;

const param = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("nav"))("invoices") };
}

export default async function InvoicesPage(props: PageProps<"/[org]/invoices">) {
  const [{ org: slug }, searchParams] = await Promise.all([props.params, props.searchParams]);
  const { org, member } = await getOrgContext(slug);

  const clientParam = param(searchParams.client);
  const clientId = clientParam && idSchema.safeParse(clientParam).success ? clientParam : null;
  // «Nueva factura» desde ⌘K (el patrón ?new=1 del resto de listados) va a su página.
  if (param(searchParams.new) === "1") redirect(`/${org.slug}/invoices/new${clientId ? `?client=${clientId}` : ""}`);

  const filter = readListFilter(param(searchParams.status));
  const q = (param(searchParams.q) ?? "").trim().slice(0, 100);
  const supabase = await createClient();

  const today = nowInZone(org.timezone).date;
  const [list, summary, lastRun, outboxCount, clientRow, charges] = await Promise.all([
    listInvoices(supabase, org.id, { filter, q, clientId, limit: LIST_LIMIT }),
    getInvoicesSummary(supabase, org.id),
    getLastBillingRun(supabase, org.id, org.timezone),
    getOutboxCount(supabase, org.id),
    clientId ? supabase.from("clients").select("id, display_name").eq("org_id", org.id).eq("id", clientId).maybeSingle() : null,
    // Lo que va a entrar, haya factura o no: el calendario real del cron para los próximos 12 meses.
    getUpcomingCharges(supabase, org.id, today, 12),
  ]);
  if (clientRow?.error) throw clientRow.error;

  return (
    <InvoicesList
      basePath={`/${org.slug}`}
      slug={org.slug}
      filter={filter}
      q={q}
      client={clientRow?.data ? { id: clientRow.data.id, name: clientRow.data.display_name } : null}
      rows={list.rows}
      truncated={list.truncated}
      summary={summary}
      lastRun={lastRun}
      canEdit={hasRole(member.role, "partner")}
      today={today}
      timeZone={org.timezone}
      outboxCount={outboxCount}
      upcoming={<UpcomingChargesCard charges={clientId ? charges.filter((charge) => charge.clientId === clientId) : charges} basePath={`/${org.slug}`} today={today} />}
    />
  );
}
