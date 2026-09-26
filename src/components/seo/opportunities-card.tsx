"use client";

import { Sparkles } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { type Opportunity, OPPORTUNITY_RULES } from "@/domain/seo";
import { cn } from "@/lib/utils";
import { SEO_ACCENT, SEO_TRACK } from "./chart-colors";
import { formatCount, formatPercent, formatPosition } from "./format";

/**
 * Quick wins: consultas que ya se ven (muchas impresiones) desde la parte baja de la primera página
 * o la segunda. La barra es la estimación de clics al mes que faltan para el CTR del top 3: una sola
 * serie en el azul de marca, con la cifra en la punta y el detalle en el tooltip de cada fila.
 */
export function OpportunitiesCard({ opportunities, className }: { opportunities: Opportunity[]; className?: string }) {
  const t = useTranslations("seo.opportunities");
  const format = useFormatter();
  const max = Math.max(1, ...opportunities.map((o) => o.potentialPerMonth));

  return (
    <Card className={cn("gap-3", className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-semibold">
          <Sparkles aria-hidden className="size-4 text-primary" />
          <h2>{t("title")}</h2>
        </CardTitle>
        <CardDescription className="text-xs">
          {t("description", { min: OPPORTUNITY_RULES.minPosition, max: OPPORTUNITY_RULES.maxPosition, target: OPPORTUNITY_RULES.targetPosition })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {opportunities.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul aria-label={t("title")} className="-mx-2 space-y-0.5">
            {opportunities.map((o) => (
              <Tooltip key={o.key}>
                <TooltipTrigger asChild>
                  <li
                    tabIndex={0}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 rounded-md px-2 py-1.5 outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{o.key}</p>
                      <p className="truncate text-xs text-muted-foreground tabular">
                        {t("meta", {
                          position: formatPosition(format, o.position ?? 0),
                          impressions: formatCount(format, o.impressions),
                          ctr: formatPercent(format, o.ctr, 1),
                        })}
                      </p>
                    </div>
                    <div className="flex min-w-24 items-center gap-2">
                      <div className="hidden h-2 flex-1 overflow-hidden rounded-full sm:block" style={{ background: SEO_TRACK }}>
                        <div className="h-full rounded-full" style={{ width: `${(o.potentialPerMonth / max) * 100}%`, background: SEO_ACCENT }} />
                      </div>
                      <span className="text-sm font-semibold whitespace-nowrap tabular">
                        {t("potential", { value: formatCount(format, o.potentialPerMonth) })}
                      </span>
                    </div>
                  </li>
                </TooltipTrigger>
                <TooltipContent side="top" align="start" className="flex-col items-start gap-0.5">
                  <span className="text-sm font-semibold tabular">{t("potentialLong", { value: formatCount(format, o.potentialPerMonth) })}</span>
                  <span className="opacity-70">{o.key}</span>
                  <span className="tabular">
                    {t("tooltipNow", { clicks: formatCount(format, o.clicks), impressions: formatCount(format, o.impressions) })}
                  </span>
                </TooltipContent>
              </Tooltip>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted-foreground">{t("footnote")}</p>
      </CardContent>
    </Card>
  );
}
