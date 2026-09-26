"use client";

import { ArrowRight, ChartNoAxesCombined, Plus } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ClientSeoSummary } from "@/server/seo/queries";
import { Delta, directionOf } from "./delta";
import { formatChange, formatCount, formatPoints, formatPosition, formatPositionDelta, formatRange, siteName, toneOf } from "./format";
import { Sparkline } from "./sparkline";

/**
 * El SEO del cliente en su ficha 360: los últimos 28 días con datos de su web frente a los 28
 * anteriores y la tendencia de los clics. Sin web vinculada, invita a vincularla.
 *
 * Uso (servidor): `const seo = await getClientSeoSummary(org.id, client.id)` y
 * `<ClientSeoCard summary={seo} basePath={`/${org.slug}`} clientId={client.id} canManage={isPartner} />`.
 */
export function ClientSeoCard({
  summary,
  basePath,
  clientId,
  canManage,
  className,
}: {
  summary: ClientSeoSummary | null;
  basePath: string;
  clientId: string;
  canManage: boolean;
  className?: string;
}) {
  const t = useTranslations("seo.card");
  const format = useFormatter();

  if (!summary) {
    return (
      <section className={cn("flex items-center gap-3 rounded-2xl border border-dashed px-4 py-3 text-sm text-muted-foreground", className)}>
        <ChartNoAxesCombined aria-hidden className="size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{t("title")}</p>
          <p className="truncate text-xs">{t("empty")}</p>
        </div>
        {canManage && (
          <Link
            href={`${basePath}/seo/properties?new=1&client=${clientId}`}
            className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
          >
            <Plus aria-hidden className="size-3.5" />
            {t("link")}
          </Link>
        )}
      </section>
    );
  }

  const stats = [
    {
      key: "clicks",
      value: formatCount(format, summary.clicks, true),
      change: summary.change.clicks,
      text: summary.change.clicks === null ? null : formatChange(format, summary.change.clicks),
      tone: toneOf(summary.change.clicks, 0.01),
    },
    {
      key: "impressions",
      value: formatCount(format, summary.impressions, true),
      change: summary.change.impressions,
      text: summary.change.impressions === null ? null : formatChange(format, summary.change.impressions),
      tone: toneOf(summary.change.impressions, 0.01),
    },
    {
      key: "position",
      value: summary.position === null ? "—" : formatPosition(format, summary.position),
      change: summary.change.position,
      text: summary.change.position === null ? null : formatPositionDelta(format, summary.change.position),
      tone: toneOf(summary.change.position, 0.1),
    },
  ] as const;

  return (
    <section className={cn("rounded-2xl border bg-card text-sm", className)}>
      <header className="flex items-start justify-between gap-3 border-b px-5 py-4">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 font-bold">
            {t("title")}
            {summary.source === "demo" && (
              <Badge variant="secondary" className="font-semibold">
                {t("demo")}
              </Badge>
            )}
          </h3>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {siteName(summary.siteUrl) ?? summary.label} · {formatRange(format, summary.range)}
          </p>
        </div>
        <Link
          href={`${basePath}/seo?property=${summary.propertyId}`}
          className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-primary hover:underline"
        >
          {t("open")}
          <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      </header>
      <div className="space-y-3 p-5">
        <dl className="grid grid-cols-3 gap-3">
          {stats.map((s) => (
            <div key={s.key} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{t(s.key)}</dt>
              <dd className="mt-0.5 text-lg font-bold heading-tight">{s.value}</dd>
              {s.text && (
                <dd>
                  <Delta tone={s.tone} direction={directionOf(s.change)} className="text-xs">
                    {s.text}
                  </Delta>
                </dd>
              )}
            </div>
          ))}
        </dl>
        <Sparkline values={summary.spark} />
        <p className="text-xs text-muted-foreground">
          {summary.ctr !== null && t("ctr", { value: format.number(summary.ctr, { style: "percent", maximumFractionDigits: 1 }) })}
          {summary.change.ctr !== null && ` (${formatPoints(format, summary.change.ctr)} ${t("pp")})`}
          {summary.organicSessions !== null && ` · ${t("sessions", { value: formatCount(format, summary.organicSessions) })}`}
          {summary.otherProperties > 0 && ` · ${t("others", { count: summary.otherProperties })}`}
        </p>
      </div>
    </section>
  );
}
