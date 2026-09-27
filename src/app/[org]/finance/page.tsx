import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { FinanceOverview } from "@/components/finance/overview";
import { nowInZone } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { getFinanceConfig } from "@/server/finance/queries";
import { getFinanceSnapshot } from "@/server/finance/snapshot";
import { getOrgContext } from "@/server/session";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("nav"))("finance") };
}

/** Resumen de Finanzas: la misma foto que leerá el agente CFO (getFinanceSnapshot), con la sesión del usuario. */
export default async function FinancePage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const { org } = await getOrgContext(slug);
  const supabase = await createClient();
  const today = nowInZone(org.timezone).date;
  const [snapshot, config] = await Promise.all([getFinanceSnapshot(supabase, org.id, today), getFinanceConfig(org.id)]);
  return (
    <FinanceOverview
      snapshot={snapshot}
      basePath={`/${org.slug}`}
      money={{ locale: org.locale, currency: org.currency }}
      issuerNames={Object.fromEntries(config.issuers.map((i) => [i.id, i.name]))}
    />
  );
}
