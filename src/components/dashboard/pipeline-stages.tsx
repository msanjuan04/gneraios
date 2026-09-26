import { ArrowUpRight, Kanban } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { stageColor } from "@/app/[org]/pipeline/funnel/colors";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { money } from "./format";
import type { DashboardView } from "./types";

/**
 * Deals abiertos por etapa (mini-embudo): la barra es el número de deals, con la rampa ordinal
 * de etapas del embudo; los importes van aparte, one-off y €/mes, sin sumarse nunca.
 */
export async function PipelineStages({ view, className }: { view: DashboardView; className?: string }) {
  const t = await getTranslations("dashboard.stages");
  const tk = await getTranslations("dashboard.kpi");
  const max = Math.max(1, ...view.stages.map((s) => s.deals));
  const fmt = view.money;
  const href = `${view.basePath}/pipeline`;
  return (
    <Card className={cn("gap-4", className)}>
      <CardHeader>
        <CardTitle className="font-semibold">
          <h3>{t("title")}</h3>
        </CardTitle>
        <CardDescription className="text-xs">{t("description")}</CardDescription>
        <CardAction>
          <Link
            href={href}
            aria-label={tk("goPipeline")}
            className="-m-1 flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <ArrowUpRight className="size-4" />
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        {view.pipeline.openDeals === 0 ? (
          <div className="flex min-h-32 flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            <Kanban aria-hidden className="size-5" />
            {t("empty")}
          </div>
        ) : (
          <ol className="-mx-2 space-y-0.5">
            {view.stages.map((stage, index) => (
              <li key={stage.stageId}>
                <Link
                  href={href}
                  className="grid grid-cols-[minmax(5.5rem,30%)_minmax(0,1fr)] items-center gap-x-3 rounded-md px-2 py-1.5 outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <span className="truncate text-sm">{stage.name}</span>
                  <span className="min-w-0">
                    <span className="flex h-5 items-center gap-2">
                      <span
                        aria-hidden
                        className="h-4 shrink-0 rounded-r-[4px]"
                        style={{
                          width: `calc((100% - 5rem) * ${stage.deals / max})`,
                          minWidth: stage.deals > 0 ? 2 : 0,
                          background: stageColor(index, view.stages.length),
                        }}
                      />
                      <span className="shrink-0 text-sm font-semibold tabular">{t("deals", { count: stage.deals })}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground tabular">
                      {stage.deals === 0
                        ? "—"
                        : t("amounts", { oneOff: money(stage.oneOffCents, fmt), mrr: money(stage.mrrCents, fmt) })}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-auto text-xs text-muted-foreground">
          {t("weighted", { oneOff: money(view.pipeline.oneOffCents, fmt), mrr: money(view.pipeline.mrrCents, fmt) })}
        </p>
      </CardContent>
    </Card>
  );
}
