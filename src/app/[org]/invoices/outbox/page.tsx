import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { readOrgSettings } from "@/app/[org]/settings/schema";
import { OutboxList } from "@/components/invoices/outbox-list";
import { nowInZone } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { getOutboxCount, listOutbox } from "@/server/invoices/queries";
import { getOrgContext, hasRole } from "@/server/session";

// Tipado a mano (y no con PageProps) para no depender de los tipos de rutas generados.
type Props = {
  params: Promise<{ org: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: `${t("invoices.outbox.title")} · ${t("nav.invoices")}` };
}

/** «Por enviar»: recordatorios de cobro por aprobar y, en otra pestaña, lo ya enviado. */
export default async function OutboxPage(props: Props) {
  const [{ org: slug }, searchParams] = await Promise.all([props.params, props.searchParams]);
  const { org, member } = await getOrgContext(slug);
  const tab = searchParams.tab === "sent" ? "sent" : "pending";
  const supabase = await createClient();
  const today = nowInZone(org.timezone).date;

  const [items, pendingCount] = await Promise.all([listOutbox(supabase, org.id, tab, today), getOutboxCount(supabase, org.id)]);
  // Los umbrales de los recordatorios viven en orgs.settings: "7 y 15".
  const format = await getFormatter();
  const dunningDays = format.list(
    readOrgSettings(org.settings).dunning_days.map(String),
    { type: "conjunction" },
  );

  return (
    <OutboxList
      basePath={`/${org.slug}`}
      slug={org.slug}
      tab={tab}
      items={items}
      pendingCount={pendingCount}
      dunningDays={dunningDays}
      timeZone={org.timezone}
      canEdit={hasRole(member.role, "partner")}
    />
  );
}
