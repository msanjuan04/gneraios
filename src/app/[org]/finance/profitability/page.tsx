import { Lock } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ProfitabilityView } from "@/components/profitability/profitability-view";
import { readPeriod } from "@/domain/profitability";
import { nowInZone } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/server/action-utils";
import { loadProfitability } from "@/server/profitability/load";
import { getOrgContext, hasRole } from "@/server/session";

export async function generateMetadata(): Promise<Metadata> {
  const [t, tFinance] = await Promise.all([getTranslations("profitability"), getTranslations("finance")]);
  return { title: `${t("tab")} · ${tFinance("title")}` };
}

/**
 * Rentabilidad: qué deja cada cliente y cada proyecto en un periodo (lo facturado frente a las horas
 * por su coste). Solo para socios: el coste por hora de cada persona es un dato sensible (RLS).
 */
export default async function ProfitabilityPage(props: {
  params: Promise<{ org: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ org: slug }, searchParams] = await Promise.all([props.params, props.searchParams]);
  const { org, member } = await getOrgContext(slug);
  if (!hasRole(member.role, "partner")) return <PartnersOnly />;

  const today = nowInZone(org.timezone).date;
  const period = readPeriod(searchParams, today);
  const supabase = await createClient();
  const data = await loadProfitability(supabase, org, period);
  const client = idSchema.safeParse(searchParams.client);

  return (
    <ProfitabilityView
      data={{
        slug: org.slug,
        basePath: `/${org.slug}`,
        today,
        period: data.period,
        report: data.report,
        settings: data.settings,
        costsConfigured: data.costsConfigured,
        canEdit: hasRole(member.role, "owner"),
        focusClientId: client.success ? client.data : null,
      }}
    />
  );
}

async function PartnersOnly() {
  const t = await getTranslations("profitability.partnersOnly");
  return (
    <div className="rounded-3xl border bg-card/50 px-8 py-14 text-center">
      <Lock aria-hidden className="mx-auto size-5 text-muted-foreground" />
      <h3 className="mt-4 text-lg font-bold">{t("title")}</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t("body")}</p>
    </div>
  );
}
