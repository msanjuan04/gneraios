import { CircleAlert, CircleCheck, Database, History, Settings2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/page-header";
import { BusinessCard } from "@/components/seo/business-card";
import { ClientRelationCard } from "@/components/seo/client-relation-card";
import { ConnectState } from "@/components/seo/connect-state";
import { formatDay, formatRange, siteName } from "@/components/seo/format";
import { KpiTiles } from "@/components/seo/kpi-tiles";
import { MoversCard } from "@/components/seo/movers-card";
import { OpportunitiesCard } from "@/components/seo/opportunities-card";
import { PerformanceChart } from "@/components/seo/performance-chart";
import { QueryTables } from "@/components/seo/query-tables";
import { SeoContent, SeoFrame } from "@/components/seo/seo-frame";
import { SeoToolbar } from "@/components/seo/seo-toolbar";
import { SyncButton } from "@/components/seo/sync-button";
import { Button } from "@/components/ui/button";
import { addDays } from "@/domain/dates/civil-date";
import {
  historyStart,
  parseSeoComparison,
  parseSeoPeriod,
  SEO_COMPARISONS,
  SEO_PERIODS,
  type SeoComparison,
  type SeoPeriod,
  selectPeriod,
} from "@/domain/seo";
import { nowInZone } from "@/lib/clock";
import { cn } from "@/lib/utils";
import { getClientRelation, getSeoBusiness, getSeoOverview, getSeoSetup, pickProperty } from "@/server/seo/queries";
import { getOrgContext, hasRole } from "@/server/session";

type SearchParams = Record<string, string | string[] | undefined>;
type SeoPageProps = { params: Promise<{ org: string }>; searchParams: Promise<SearchParams> };

const GOOGLE_ERRORS = ["not_configured", "owner_required", "state", "session", "denied", "google", "no_refresh_token", "scopes", "save"] as const;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("seo"))("metaTitle") };
}

function Banner({ tone, icon: Icon, children }: { tone: "info" | "warning" | "error" | "success"; icon: typeof CircleAlert; children: ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border px-4 py-3 text-sm",
        tone === "info" && "border-primary/25 bg-primary/10",
        tone === "warning" && "border-warning/30 bg-warning/10",
        tone === "error" && "border-destructive/30 bg-destructive/10",
        tone === "success" && "border-success/30 bg-success/10",
      )}
    >
      <Icon
        aria-hidden
        className={cn(
          "size-4 shrink-0",
          tone === "info" && "text-primary",
          tone === "warning" && "text-warning",
          tone === "error" && "text-destructive",
          tone === "success" && "text-success",
        )}
      />
      {children}
    </div>
  );
}

/** SEO de la org: la web propia y las de los clientes, de Search Console y GA4, atado al CRM. */
export default async function SeoPage({ params, searchParams }: SeoPageProps) {
  const [{ org: slug }, query] = await Promise.all([params, searchParams]);
  const { org, member, orgs } = await getOrgContext(slug);
  const setup = await getSeoSetup(org.id);
  const t = await getTranslations("seo");
  const format = await getFormatter();

  const basePath = `/${org.slug}`;
  const seoPath = `${basePath}/seo`;
  const propertiesHref = `${seoPath}/properties`;
  const startHref = `/api/integrations/google/start?org=${org.slug}`;
  const isOwner = hasRole(member.role, "owner");
  const isPartner = hasRole(member.role, "partner");
  const status = setup.integration?.status ?? null;
  const connected = status === "connected";
  const errorCode = GOOGLE_ERRORS.find((code) => code === first(query.google_error)) ?? null;
  const flashError = errorCode ? t(`googleErrors.${errorCode}`) : null;
  const justConnected = first(query.google) === "connected";

  const live = setup.properties.filter((p) => !p.archived);
  if (live.length === 0) {
    if (!setup.googleConfigured || !connected) {
      return (
        <ConnectState
          variant={!setup.googleConfigured ? "setup" : status === "error" ? "reconnect" : "connect"}
          isOwner={isOwner}
          startHref={startHref}
          missingEnv={setup.missingEnv}
          redirectUri={setup.redirectUri}
          demoHref={org.slug !== "demo" && orgs.some((o) => o.slug === "demo") ? "/demo/seo" : null}
          error={flashError}
        />
      );
    }
    return (
      <div className="mx-auto mt-6 w-full max-w-lg rounded-3xl border bg-card/50 px-8 py-12 text-center md:mt-12">
        <CircleCheck aria-hidden className="mx-auto size-10 text-success" />
        <h2 className="mt-4 text-2xl font-extrabold heading-tight">{t("noProperties.title")}</h2>
        <p className="mt-3 text-muted-foreground">{t("noProperties.body", { email: setup.integration?.accountEmail ?? "" })}</p>
        {isPartner && (
          <Button asChild className="mt-8">
            <Link href={`${propertiesHref}?new=1`}>{t("noProperties.cta")}</Link>
          </Button>
        )}
      </div>
    );
  }

  const property = pickProperty(setup.properties, first(query.property))!;
  const period = parseSeoPeriod(query.period);
  const comparison = parseSeoComparison(query.compare);
  const today = nowInZone(org.timezone).date;
  const selection = selectPeriod({ period, comparison, today, span: property.searchSpan ?? property.webSpan });
  const money = { locale: org.locale, currency: org.currency };

  const [overview, business, relation] = await Promise.all([
    getSeoOverview(property, selection),
    property.clientId ? Promise.resolve(null) : getSeoBusiness(org, selection.range),
    property.clientId ? getClientRelation(property, today) : Promise.resolve(null),
  ]);

  // La URL lleva el estado; los valores por defecto no se escriben.
  const href = (next: { property?: string; period?: SeoPeriod; compare?: SeoComparison }) => {
    const search = new URLSearchParams();
    const p = next.property ?? property.id;
    const pr = next.period ?? period;
    const c = next.compare ?? comparison;
    if (p !== pickProperty(setup.properties, null)?.id) search.set("property", p);
    if (pr !== "28d") search.set("period", pr);
    if (c !== "previous") search.set("compare", c);
    const qs = search.toString();
    return qs ? `${seoPath}?${qs}` : seoPath;
  };

  const rangeLabel = formatRange(format, selection.range);
  const compareLabel = formatRange(format, selection.compare);
  const caption = selection.comparable
    ? t("toolbar.caption", { range: rangeLabel, compare: compareLabel })
    : t("toolbar.captionNoCompare", { range: rangeLabel });

  // Carga histórica en curso: Search Console aún no tiene los 16 meses.
  const backfillFrom = property.gsc.syncedFrom;
  const loadingHistory = connected && property.gscSiteUrl !== null && backfillFrom !== null && backfillFrom > addDays(historyStart(today), 3);
  const firstSync = connected && property.source !== "demo" && property.searchSpan === null && property.webSpan === null;
  const missingFeatures =
    connected && setup.integration
      ? [
          property.gscSiteUrl && !setup.integration.features.searchConsole ? t("features.searchConsole") : null,
          property.ga4PropertyId && !setup.integration.features.analytics ? t("features.analytics") : null,
        ].filter((x): x is string => x !== null)
      : [];

  return (
    <SeoFrame>
      <div className="mx-auto w-full max-w-7xl">
        <PageHeader
          title={t("title")}
          description={t("description")}
          actions={
            <>
              {connected && isPartner && <SyncButton slug={org.slug} />}
              <Button asChild variant="ghost" size="sm">
                <Link href={propertiesHref}>
                  <Settings2 data-icon="inline-start" />
                  {t("manage")}
                </Link>
              </Button>
            </>
          }
        />

        <div className="space-y-6">
          <SeoToolbar
            properties={live.map((p) => ({
              id: p.id,
              label: p.label,
              clientName: p.clientName,
              site: siteName(p.gscSiteUrl),
              href: href({ property: p.id }),
              active: p.id === property.id,
            }))}
            periods={SEO_PERIODS.map((value) => ({ value, href: href({ period: value }), active: value === period }))}
            comparisons={SEO_COMPARISONS.map((value) => ({ value, href: href({ compare: value }), active: value === comparison }))}
            caption={caption}
            manageHref={propertiesHref}
          />

          {(flashError || justConnected || property.source === "demo" || status === "error" || !connected || loadingHistory || firstSync || missingFeatures.length > 0) && (
            <div className="space-y-2">
              {flashError && (
                <Banner tone="error" icon={CircleAlert}>
                  {flashError}
                </Banner>
              )}
              {justConnected && (
                <Banner tone="success" icon={CircleCheck}>
                  {t("banners.connected")}
                </Banner>
              )}
              {property.source === "demo" && (
                <Banner tone="info" icon={Database}>
                  <span className="min-w-0 flex-1">{t("banners.demo")}</span>
                </Banner>
              )}
              {status === "error" && (
                <Banner tone="error" icon={CircleAlert}>
                  <span className="min-w-0 flex-1">{t("banners.reconnect")}</span>
                  {isOwner && (
                    <Button asChild size="sm">
                      <a href={startHref}>{t("banners.reconnectCta")}</a>
                    </Button>
                  )}
                </Banner>
              )}
              {!connected && status !== "error" && property.source !== "demo" && (
                <Banner tone="warning" icon={CircleAlert}>
                  <span className="min-w-0 flex-1">{setup.googleConfigured ? t("banners.notConnected") : t("banners.notConfigured")}</span>
                  {isOwner && setup.googleConfigured && (
                    <Button asChild size="sm" variant="outline">
                      <a href={startHref}>{t("banners.connectCta")}</a>
                    </Button>
                  )}
                </Banner>
              )}
              {firstSync && (
                <Banner tone="info" icon={History}>
                  {t("banners.firstSync")}
                </Banner>
              )}
              {loadingHistory && backfillFrom && (
                <Banner tone="info" icon={History}>
                  {t("banners.loadingHistory", { date: formatDay(format, backfillFrom, true) })}
                </Banner>
              )}
              {missingFeatures.length > 0 && (
                <Banner tone="warning" icon={CircleAlert}>
                  {t("banners.missingScopes", { features: missingFeatures.join(" · ") })}
                </Banner>
              )}
            </div>
          )}

          <SeoContent className="space-y-6">
            <KpiTiles
              kpis={overview.kpis}
              organicShare={overview.organicShare}
              comparable={selection.comparable}
              hasSearch={overview.hasSearch}
              hasWeb={overview.hasWeb}
            />
            {overview.hasSearch && (
              <>
                <PerformanceChart points={overview.chart} comparable={selection.comparable} rangeLabel={rangeLabel} compareLabel={compareLabel} />
                <div className="grid gap-4 xl:grid-cols-5">
                  <QueryTables className="xl:col-span-3" queries={overview.topQueries} pages={overview.topPages} comparable={selection.comparable} />
                  <MoversCard className="xl:col-span-2" winners={overview.winners} losers={overview.losers} comparable={selection.comparable} />
                </div>
              </>
            )}
            <div className="grid gap-4 xl:grid-cols-5">
              {overview.hasSearch && <OpportunitiesCard className="xl:col-span-3" opportunities={overview.opportunities} />}
              {business && (
                <BusinessCard
                  className={overview.hasSearch ? "xl:col-span-2" : "xl:col-span-5"}
                  slug={org.slug}
                  data={business}
                  money={money}
                  canEdit={isOwner}
                />
              )}
              {relation && (
                <ClientRelationCard
                  className={overview.hasSearch ? "xl:col-span-2" : "xl:col-span-5"}
                  relation={relation}
                  basePath={basePath}
                  money={money}
                />
              )}
            </div>
          </SeoContent>
        </div>
      </div>
    </SeoFrame>
  );
}
