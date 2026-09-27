"use client";

import { ArrowLeft, Building2, ExternalLink, Pencil, Server } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { ReadOnlyNotice, SettingsCard } from "@/components/settings/settings-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSiteFormat } from "./format";
import { CheckNowButton, SiteActionsMenu, useCheckNow } from "./site-actions";
import { SiteHistoryChart } from "./site-history-chart";
import { SiteSheet } from "./site-sheet";
import { StatusLine } from "./sites-table";
import { StatusDot, StatusPill } from "./status-dot";
import type { SiteDetailData, SiteExpiry } from "./types";

type Props = { slug: string; basePath: string; data: SiteDetailData; canEdit: boolean };

/** La ficha de una web: estado, cifras, 7 días de historia, caídas y últimas comprobaciones. */
export function SiteDetail({ slug, basePath, data, canEdit }: Props) {
  const t = useTranslations("sites.detail");
  const router = useRouter();
  const fmt = useSiteFormat();
  const { check, pendingId } = useCheckNow(slug);
  const [editOpen, setEditOpen] = useState(false);
  const { site, thresholds } = data;

  const expiryHint = (expiry: SiteExpiry | null, kind: "ssl" | "domain") => {
    if (!expiry) return kind === "ssl" ? t("sslUnknown") : t("domainUnknown");
    return t(expiry.expired ? "expiredOn" : "expiresOn", { date: fmt.date(expiry.expiresOn) });
  };
  const expiryValue = (expiry: SiteExpiry | null) => {
    if (!expiry) return "—";
    if (expiry.expired) return t("expired");
    return t("daysLeft", { count: expiry.daysLeft });
  };
  const tone = (expiry: SiteExpiry | null) => (expiry?.severity === "expired" ? "danger" : expiry?.severity === "warning" ? "warning" : undefined);

  return (
    <div className="mx-auto max-w-6xl">
      <Link
        href={`${basePath}/sites`}
        className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {t("back")}
      </Link>

      <header className="mb-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h2 className="min-w-0 text-3xl font-extrabold break-words heading-tight md:text-4xl">{site.name}</h2>
            <StatusPill status={site.status} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
            <a href={site.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 font-mono text-[13px] hover:text-primary">
              {site.displayUrl}
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
            {site.clientId ? (
              <Link href={`${basePath}/clients/${site.clientId}`} className="inline-flex items-center gap-1.5 hover:text-primary">
                <Building2 className="size-3.5" aria-hidden />
                {site.clientName}
              </Link>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <Building2 className="size-3.5" aria-hidden />
                {t("noClient")}
              </span>
            )}
            {site.hostedByUs && (
              <Badge variant="outline" className="gap-1 text-muted-foreground">
                <Server aria-hidden />
                {t("hostedByUs")}
              </Badge>
            )}
          </div>
          <StatusLine site={site} fmt={fmt} className="mt-2 text-sm" />
        </div>

        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <CheckNowButton variant="full" onClick={() => check(site)} pending={pendingId === site.id} />
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil data-icon="inline-start" />
              {t("edit")}
            </Button>
            <SiteActionsMenu slug={slug} site={site} onEdit={() => setEditOpen(true)} onDeleted={() => router.push(`${basePath}/sites`)} />
          </div>
        )}
      </header>
      {!canEdit && <ReadOnlyNotice className="mb-6">{t("readOnly")}</ReadOnlyNotice>}

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label={t("stats.response")}
          value={site.lastResponseMs === null || site.status === "down" ? "—" : fmt.ms(site.lastResponseMs)}
          hint={
            site.lastCheckedAt
              ? `${data.avgResponseMs24h === null ? "" : `${t("stats.avg24h", { value: fmt.ms(data.avgResponseMs24h) })} · `}${fmt.relative(site.lastCheckedAt)}`
              : t("stats.neverChecked")
          }
          tone={site.status === "slow" ? "warning" : undefined}
        />
        <Stat
          label={t("stats.uptime")}
          value={site.uptime.week === null ? "—" : fmt.uptime(site.uptime.week)}
          hint={t("stats.uptimeHint", {
            day: site.uptime.day === null ? "—" : fmt.uptime(site.uptime.day),
            month: site.uptime.month === null ? "—" : fmt.uptime(site.uptime.month),
          })}
        />
        <Stat label={t("stats.ssl")} value={expiryValue(site.ssl)} hint={expiryHint(site.ssl, "ssl")} tone={tone(site.ssl)} />
        <Stat label={t("stats.domain")} value={expiryValue(site.domain)} hint={expiryHint(site.domain, "domain")} tone={tone(site.domain)} />
      </dl>

      <div className="mt-6">
        <SiteHistoryChart buckets={data.buckets} slowMs={thresholds.slowMs} fmt={fmt} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <SettingsCard
          title={t("incidents.title")}
          description={
            data.incidents.length === 0
              ? undefined
              : t("incidents.summary", { count: data.incidents.length, blips: data.blips })
          }
          className="min-w-0 lg:col-span-3"
          bodyClassName={data.incidents.length > 0 ? "p-0" : undefined}
        >
          {data.incidents.length === 0 ? (
            <p className="text-center text-muted-foreground">
              {data.blips > 0 ? t("incidents.emptyWithBlips", { count: data.blips }) : t("incidents.empty")}
            </p>
          ) : (
            <ul className="divide-y">
              {data.incidents.map((incident) => (
                <li key={incident.startedAt} className="flex items-start gap-3 px-5 py-3">
                  <StatusDot status={incident.endedAt ? "unknown" : "down"} className="mt-1.5" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      {incident.endedAt
                        ? t("incidents.resolved", { duration: fmt.duration(incident.minutes) })
                        : t("incidents.ongoing", { duration: fmt.duration(incident.minutes) })}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {fmt.error(incident.error, incident.statusCode)} · {t("incidents.failures", { count: incident.failures })}
                    </p>
                  </div>
                  <p className="shrink-0 text-right text-xs text-muted-foreground">
                    <time dateTime={incident.startedAt}>{fmt.dateTime(incident.startedAt)}</time>
                    {incident.endedAt && (
                      <>
                        <br />
                        {t("incidents.until", { time: fmt.time(incident.endedAt) })}
                      </>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </SettingsCard>

        <div className="min-w-0 space-y-6 lg:col-span-2">
          <SettingsCard title={t("recent.title")} bodyClassName={data.recentChecks.length > 0 ? "p-0" : undefined}>
            {data.recentChecks.length === 0 ? (
              <p className="text-center text-muted-foreground">{t("recent.empty")}</p>
            ) : (
              <ul className="divide-y text-xs">
                {data.recentChecks.map((c) => (
                  <li key={c.checkedAt} className="flex items-center gap-2.5 px-5 py-2">
                    <StatusDot status={c.ok ? (c.responseMs !== null && c.responseMs >= thresholds.slowMs ? "slow" : "up") : "down"} />
                    <time dateTime={c.checkedAt} className="text-muted-foreground tabular" title={fmt.dateTime(c.checkedAt)}>
                      {fmt.time(c.checkedAt)}
                    </time>
                    <span className="min-w-0 flex-1 truncate">
                      {c.ok ? t("recent.ok", { status: c.statusCode ?? 200 }) : fmt.error(c.error, c.statusCode)}
                    </span>
                    <span className="shrink-0 text-muted-foreground tabular">{c.responseMs === null ? "—" : fmt.ms(c.responseMs)}</span>
                  </li>
                ))}
              </ul>
            )}
          </SettingsCard>

          {site.notes && (
            <SettingsCard title={t("notes")}>
              <p className="whitespace-pre-line">{site.notes}</p>
            </SettingsCard>
          )}
        </div>
      </div>

      {canEdit && <SiteSheet slug={slug} open={editOpen} onOpenChange={setEditOpen} clients={data.clients} site={site} />}
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: ReactNode; value: ReactNode; hint: ReactNode; tone?: "warning" | "danger" }) {
  return (
    <div className="min-w-0 rounded-2xl border bg-card px-4 py-3.5">
      <dt className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{label}</dt>
      <dd className={cn("mt-1 truncate text-xl font-bold heading-tight", tone === "warning" && "text-warning", tone === "danger" && "text-destructive")}>{value}</dd>
      <dd className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</dd>
    </div>
  );
}
