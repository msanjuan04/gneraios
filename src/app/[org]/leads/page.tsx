import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Plus } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { FunnelStagesCard } from "@/components/crm/funnel-stages";
import { LeadFolders } from "@/components/crm/lead-folders";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { funnelStages, leadTotals, sortLeads } from "@/domain/crm";
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
export default async function LeadsPage({ params }: PageProps<"/[org]/leads">) {
  const { org: slug } = await params;
  const { org, member } = await getOrgContext(slug);
  const [t, format, board] = await Promise.all([getTranslations("leads"), getFormatter(), loadLeadBoard(org.id, org.timezone)]);
  const basePath = `/${org.slug}`;
  const canEdit = hasRole(member.role, "partner");
  const leads = sortLeads(board.leads);
  const totals = leadTotals(leads);
  const funnel = funnelStages(
    board.stages.filter((stage) => stage.kind === "open"),
    leads.map((lead) => ({ stageId: lead.stageId, estOneOffCents: lead.estOneOffCents, estMrrCents: lead.estMrrCents })),
  );
  const money = (cents: number) => format.number(cents / 100, { style: "currency", currency: org.currency, maximumFractionDigits: 0 });

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
          <LeadFolders leads={leads} basePath={basePath} money={money} />
        </section>
        <FunnelStagesCard stages={funnel} money={money} />
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
