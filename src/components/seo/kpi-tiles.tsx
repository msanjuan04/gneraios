import { getFormatter, getTranslations } from "next-intl/server";
import type { Kpi, SeoOverview } from "@/server/seo/queries";
import { Delta, directionOf } from "./delta";
import {
  formatChange,
  formatCount,
  formatPercent,
  formatPoints,
  formatPosition,
  formatPositionDelta,
  type Formatter,
  toneOf,
} from "./format";
import { Sparkline } from "./sparkline";

type Metric = keyof SeoOverview["kpis"];

// Umbral por debajo del cual una variación no se colorea (es ruido): 1 %, 0,05 pp de CTR, 0,1 posiciones.
const NOISE: Record<Metric, number> = { clicks: 0.01, impressions: 0.01, ctr: 0.0005, position: 0.1, sessions: 0.01, conversions: 0.01 };

function value(format: Formatter, metric: Metric, v: number): string {
  switch (metric) {
    case "ctr":
      return formatPercent(format, v, 2);
    case "position":
      return formatPosition(format, v);
    default:
      return formatCount(format, v, true);
  }
}

function change(format: Formatter, metric: Metric, v: number): string {
  if (metric === "ctr") return formatPoints(format, v);
  if (metric === "position") return formatPositionDelta(format, v);
  return formatChange(format, v);
}

/**
 * Las seis cifras del periodo, cada una con su variación y su tendencia. Clics, impresiones, CTR y
 * posición salen de Search Console; sesiones y conversiones, de GA4 (solo búsqueda orgánica).
 */
export async function KpiTiles({
  kpis,
  organicShare,
  comparable,
  hasSearch,
  hasWeb,
}: Pick<SeoOverview, "kpis" | "organicShare" | "hasSearch" | "hasWeb"> & { comparable: boolean }) {
  const t = await getTranslations("seo.kpi");
  const format = await getFormatter();
  const metrics: Metric[] = ["clicks", "impressions", "ctr", "position", "sessions", "conversions"];

  const hint = (metric: Metric, kpi: Kpi) => {
    const fromGa4 = metric === "sessions" || metric === "conversions";
    if ((fromGa4 && !hasWeb) || (!fromGa4 && !hasSearch)) return t(fromGa4 ? "noGa4" : "noGsc");
    const before = comparable && kpi.previous !== null ? value(format, metric, kpi.previous) : null;
    if (metric === "sessions" && organicShare !== null) {
      const share = formatPercent(format, organicShare, 0);
      return before ? t("organicShareWithPrevious", { share, value: before }) : t("organicShare", { share });
    }
    return before ? t("previous", { value: before }) : t("noCompare");
  };

  return (
    <section aria-label={t("label")} className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 2xl:grid-cols-6">
      {metrics.map((metric) => {
        const kpi = kpis[metric];
        // La posición ya llega como posiciones ganadas: más siempre es mejor.
        const tone = toneOf(kpi.change, NOISE[metric]);
        const shown = kpi.value !== null && comparable && kpi.change !== null;
        return (
          <div key={metric} className="flex min-w-0 flex-col gap-1 rounded-2xl border bg-card px-4 pt-3.5 pb-3">
            <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{t(metric)}</p>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              {/* Cifra suelta y grande: dígitos proporcionales, no tabulares. */}
              <p className="text-2xl font-extrabold heading-tight">{kpi.value === null ? "—" : value(format, metric, kpi.value)}</p>
              {shown && (
                <Delta
                  tone={tone}
                  direction={directionOf(kpi.change)}
                  className="text-xs"
                  label={t(`changeLabel.${metric === "ctr" ? "points" : metric === "position" ? "positions" : "relative"}`, {
                    value: change(format, metric, kpi.change!),
                  })}
                >
                  {change(format, metric, kpi.change!)}
                  {metric === "ctr" && <span className="ml-0.5 font-medium opacity-80">{t("pp")}</span>}
                </Delta>
              )}
            </div>
            <p className="truncate text-xs text-muted-foreground" title={metric === "position" ? t("positionHint") : undefined}>
              {hint(metric, kpi)}
            </p>
            <Sparkline values={kpi.spark} invert={metric === "position"} className="mt-1.5" />
          </div>
        );
      })}
    </section>
  );
}
