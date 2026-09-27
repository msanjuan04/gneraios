import { Lock } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { InfrastructureView } from "@/components/finance/infrastructure/infrastructure-view";
import { nowInZone } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { loadInfrastructure } from "@/server/finance/infrastructure";
import { getOrgContext, hasRole } from "@/server/session";

export async function generateMetadata(): Promise<Metadata> {
  const [t, tFinance] = await Promise.all([getTranslations("infrastructure"), getTranslations("finance")]);
  return { title: `${t("tab")} · ${tFinance("title")}` };
}

/**
 * Infraestructura: lo que cuestan los servidores, las bases de datos, los dominios y el software de
 * las webs, cuándo se renuevan y cuánto cuesta cada web alojada (y a cada cliente). Solo para socios,
 * como la rentabilidad: es lo que cuesta de verdad cada cliente.
 */
export default async function InfrastructurePage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const { org, member } = await getOrgContext(slug);
  if (!hasRole(member.role, "partner")) return <PartnersOnly />;

  const today = nowInZone(org.timezone).date;
  const supabase = await createClient();
  const data = await loadInfrastructure(supabase, org, today);

  return (
    <InfrastructureView
      data={{
        slug: org.slug,
        basePath: `/${org.slug}`,
        today,
        spentFrom: data.spentFrom,
        report: data.report,
        settings: data.settings,
        canConfigure: hasRole(member.role, "owner"),
      }}
    />
  );
}

async function PartnersOnly() {
  const t = await getTranslations("infrastructure.partnersOnly");
  return (
    <div className="rounded-3xl border bg-card/50 px-8 py-14 text-center">
      <Lock aria-hidden className="mx-auto size-5 text-muted-foreground" />
      <h3 className="mt-4 text-lg font-bold">{t("title")}</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t("body")}</p>
    </div>
  );
}
