import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Plus } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { FunnelBoard } from "@/components/crm/funnel-board";
import { LeadFolders } from "@/components/crm/lead-folders";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { funnelStages, leadTotals, sortLeads } from "@/domain/crm";
import { formatMoney } from "@/domain/money";
import { loadLeadBoard } from "@/server/crm/lead-board";
import { getOrgContext, hasRole } from "@/server/session";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("leads"))("title") };
}

/**
 * Leads: una carpeta por oportunidad de quien todavía no es cliente, ordenadas por lo que urge
 * (primero lo que toca contestar). Arriba, lo que podría entrar si entra todo —sin ponderar, que es
 * lo que se quiere saber aquí— y el embudo por etapas.
 */
export default async function LeadsPage({ params, searchParams }: PageProps<"/[org]/leads">) {
  const [{ org: slug }, search] = await Promise.all([params, searchParams]);
  const showAll = search.all === "1";
  const { org, member } = await getOrgContext(slug);
  const [t, board] = await Promise.all([getTranslations("leads"), loadLeadBoard(org.id, org.timezone)]);
  const basePath = `/${org.slug}`;
  const canEdit = hasRole(member.role, "partner");
  // Solo lo que de verdad es un lead: novedad en las últimas dos semanas o calificado como caliente.
  // El resto sigue en el pipeline; «ver todos» los enseña.
  const hidden = board.leads.filter((lead) => !lead.live).length;
  const leads = sortLeads(showAll ? board.leads : board.leads.filter((lead) => lead.live));
  const totals = leadTotals(leads);
  const funnel = funnelStages(
    board.stages.filter((stage) => stage.kind === "open"),
    leads.map((lead) => ({ stageId: lead.stageId, estOneOffCents: lead.estOneOffCents, estMrrCents: lead.estMrrCents, estimated: lead.estimated })),
  );
  const money = (cents: number) => formatMoney(cents, { locale: org.locale, currency: org.currency, wholeUnits: true });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={`${basePath}/pipeline`}>
                {t("board")}
                <ArrowUpRight data-icon="inline-end" />
              </Link>
            </Button>
            {canEdit && (
              <Button asChild>
                <Link href={`${basePath}/pipeline?new=1`}>
                  <Plus data-icon="inline-start" />
                  {t("new")}
                </Link>
              </Button>
            )}
          </>
        }
      />

      {/* Lo que hay en juego. Sin ponderar: «si entran todos», y aparte lo ya presupuestado. */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label={t("summary")}>
        <Metric label={t("openDeals")} value={String(totals.openDeals)} hint={totals.awaitingReply > 0 ? t("awaitingReply", { count: totals.awaitingReply }) : undefined} />
        <Metric label={t("potentialOneOff")} value={money(totals.oneOffCents)} hint={t("ifAllWin")} />
        <Metric label={t("potentialMrr")} value={`${money(totals.mrrCents)} / ${t("month")}`} hint={t("ifAllWin")} />
        <Metric label={t("quotedPotential")} value={money(totals.quotedOneOffCents)} hint={t("quotedHint", { count: totals.quotedDeals })} />
        {totals.estimatedDeals > 0 && (
          <Metric
            label={t("estimatedPotential")}
            value={`≈ ${money(totals.estimatedOneOffCents)}`}
            hint={t("estimatedTotalHint", { count: totals.estimatedDeals })}
          />
        )}
      </section>

      <div className="grid gap-5 xl:grid-cols-[1fr_22rem]">
        <section aria-label={t("listTitle")}>
          <p className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span>{showAll ? t("showingAll", { count: leads.length }) : t("showingLive", { count: leads.length })}</span>
            {hidden > 0 && (
              <Link href={showAll ? `${basePath}/leads` : `${basePath}/leads?all=1`} className="font-semibold text-primary hover:underline">
                {showAll ? t("onlyLive") : t("showOlder", { count: hidden })}
              </Link>
            )}
          </p>
          <LeadFolders leads={leads} basePath={basePath} money={money} />
        </section>
        <Card className="self-start">
          <CardHeader className="border-b">
            <CardTitle>{t("funnel.title")}</CardTitle>
            <CardDescription>{t("funnel.description")}</CardDescription>
          </CardHeader>
          <CardContent className="pt-5">
            <FunnelBoard stages={funnel} money={money} compact />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardDescription className="font-semibold">{label}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold tabular-nums">{value}</p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}
