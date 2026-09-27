import { CircleAlert, FileText, Landmark } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AgentStrip } from "@/components/council/agent-strip";
import { cadenceOf } from "@/components/council/cadence";
import { CouncilIntro } from "@/components/council/connect-state";
import { FeedTabs } from "@/components/council/feed-tabs";
import { RecommendationCard } from "@/components/council/recommendation-card";
import { TasksPanel } from "@/components/council/tasks-panel";
import { Button } from "@/components/ui/button";
import { AGENTS } from "@/council/agents";
import { councilConfigured, feedCounts, getAgentStatuses, listOpenTasks, listRecommendations, recommendationTab } from "@/council/queries";
import { nowInZone } from "@/lib/clock";
import { getOrgContext, hasRole } from "@/server/session";
import { readFeedTab } from "./schema";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("council.meta"))("feed") };
}

/** El feed del consejo: lo que los agentes proponen, con su evidencia, y lo que decidís. */
export default async function CouncilPage({ params, searchParams }: PageProps<"/[org]/council">) {
  const [{ org: slug }, query] = await Promise.all([params, searchParams]);
  const { org, member } = await getOrgContext(slug);
  const t = await getTranslations("council");
  const tCadence = await getTranslations("council.cadence");
  const today = nowInZone(org.timezone).date;
  const basePath = `/${org.slug}`;
  const configured = councilConfigured();
  const canDecide = hasRole(member.role, "partner");
  const highlight = typeof query.id === "string" ? query.id : null;
  const tab = query.tab === undefined && highlight ? ((await recommendationTab(org.id, highlight, today)) ?? "new") : readFeedTab(query.tab);

  const [agents, recs, counts, tasks] = await Promise.all([
    getAgentStatuses(org.id),
    listRecommendations(org.id, tab, today),
    feedCounts(org.id, today),
    listOpenTasks(org.id),
  ]);
  const quiet = counts.new + counts.postponed + counts.accepted === 0 && (tab !== "history" || recs.length === 0);
  const neverSpoke = quiet && agents.every((a) => a.lastFinishedAt === null);

  if (!configured && neverSpoke) return <CouncilIntro variant="connect" isOwner={hasRole(member.role, "owner")} />;

  const money = { locale: org.locale, currency: org.currency };
  const cadence = Object.fromEntries(agents.map((a) => {
    const c = cadenceOf(AGENTS[a.agent]);
    return [a.agent, tCadence(c.key, c.values)];
  }));

  return (
    <div className="space-y-6">
      {!configured && (
        <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
          <CircleAlert aria-hidden className="size-4 shrink-0 text-warning" />
          <span className="min-w-0 flex-1">{t("banners.noApiKey")}</span>
          <Button asChild size="sm" variant="outline">
            <Link href={`${basePath}/settings/council`}>{t("banners.howToConnect")}</Link>
          </Button>
        </div>
      )}

      <AgentStrip agents={agents} slug={org.slug} canRun={canDecide} configured={configured} cadence={cadence} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          <FeedTabs basePath={basePath} active={tab} counts={counts} />
          {recs.length === 0 ? (
            neverSpoke && tab === "new" ? (
              <CouncilIntro variant="empty" isOwner={hasRole(member.role, "owner")} />
            ) : (
              <div className="rounded-2xl border border-dashed px-6 py-12 text-center">
                <p className="font-semibold">{t(`empty.${tab}.title`)}</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t(`empty.${tab}.body`)}</p>
              </div>
            )
          ) : (
            <ul className="space-y-3">
              {recs.map((rec) => (
                <li key={rec.id}>
                  <RecommendationCard rec={rec} slug={org.slug} basePath={basePath} money={money} canDecide={canDecide} today={today} highlight={rec.id === highlight} />
                </li>
              ))}
            </ul>
          )}
        </div>

        <aside className="space-y-4">
          <TasksPanel tasks={tasks} slug={org.slug} basePath={basePath} canEdit={canDecide} today={today} />
          <nav aria-label={t("reports.label")} className="grid gap-2">
            <Link href={`${basePath}/council/briefing`} className="flex items-center gap-3 rounded-2xl border bg-card px-4 py-3 text-sm transition-colors hover:bg-muted/50">
              <FileText aria-hidden className="size-4 text-primary" />
              <span className="min-w-0">
                <span className="block font-semibold">{t("reports.briefing")}</span>
                <span className="block text-xs text-muted-foreground">{t("reports.briefingHint")}</span>
              </span>
            </Link>
            <Link href={`${basePath}/council/close`} className="flex items-center gap-3 rounded-2xl border bg-card px-4 py-3 text-sm transition-colors hover:bg-muted/50">
              <Landmark aria-hidden className="size-4 text-primary" />
              <span className="min-w-0">
                <span className="block font-semibold">{t("reports.close")}</span>
                <span className="block text-xs text-muted-foreground">{t("reports.closeHint")}</span>
              </span>
            </Link>
          </nav>
        </aside>
      </div>
    </div>
  );
}
