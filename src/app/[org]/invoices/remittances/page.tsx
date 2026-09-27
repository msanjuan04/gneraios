import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { RemittancesPage } from "@/components/collections/remittances-page";
import { suggestCollectionDate } from "@/domain/collections";
import { nowInZone } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { loadCreditors } from "@/server/collections/creditors";
import { listRemittances } from "@/server/collections/queries";
import { getOutboxCount } from "@/server/invoices/queries";
import { getOrgContext, hasRole } from "@/server/session";

// Tipado a mano (y no con PageProps) para no depender de los tipos de rutas generados.
type Props = { params: Promise<{ org: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: `${t("collections.title")} · ${t("nav.invoices")}` };
}

/** Remesas SEPA: preparar una nueva, el listado con su estado y los datos de acreedor de cada emisor. */
export default async function RemittancesRoute({ params }: Props) {
  const { org: slug } = await params;
  const { org, member } = await getOrgContext(slug);
  const supabase = await createClient();
  const today = nowInZone(org.timezone).date;
  const [remittances, creditors, outboxCount] = await Promise.all([
    listRemittances(supabase, org.id),
    loadCreditors(supabase, org.id),
    getOutboxCount(supabase, org.id),
  ]);

  return (
    <RemittancesPage
      slug={org.slug}
      basePath={`/${org.slug}`}
      outboxCount={outboxCount}
      remittances={remittances}
      creditors={creditors}
      canEdit={hasRole(member.role, "partner")}
      canEditCreditors={hasRole(member.role, "owner")}
      today={today}
      defaultCollectionOn={suggestCollectionDate(today)}
    />
  );
}
