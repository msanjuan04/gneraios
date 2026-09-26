"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import type { MonthMovements } from "@/domain/metrics";
import { cn } from "@/lib/utils";
import { MovementsBridge } from "./movements-bridge";
import { RevenueChart } from "./revenue-chart";
import type { HistoryPoint, MoneyFormat } from "./types";

const RANGES = [12, 24] as const;
type Range = (typeof RANGES)[number];

/**
 * La historia del negocio: ingresos y MRR mes a mes y el puente de MRR de la misma ventana.
 * El rango (12 o 24 meses) está encima de las dos gráficas y manda en las dos.
 */
export function HistorySection({
  history,
  movements,
  money,
}: {
  history: readonly HistoryPoint[];
  movements: readonly MonthMovements[];
  money: MoneyFormat;
}) {
  const t = useTranslations("dashboard.history");
  const [range, setRange] = useState<Range>(12);
  return (
    <section aria-labelledby="dashboard-history" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="dashboard-history" className="text-lg font-bold heading-tight">
            {t("title")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <div role="group" aria-label={t("range")} className="flex rounded-full border bg-muted/40 p-0.5 text-xs font-semibold">
          {RANGES.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={range === value}
              onClick={() => setRange(value)}
              className={cn(
                "rounded-full px-3 py-1 text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
                range === value && "bg-background text-foreground shadow-sm ring-1 ring-foreground/10",
              )}
            >
              {t("months", { count: value })}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-12">
        <RevenueChart data={history.slice(-range)} money={money} className="xl:col-span-8" />
        <MovementsBridge movements={movements.slice(-range)} money={money} className="xl:col-span-4" />
      </div>
    </section>
  );
}
