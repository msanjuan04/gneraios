"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { type Figures, hasOtherCosts, otherCostsCents, type ProfitabilityReport, type ProfitabilitySettings } from "@/domain/profitability";
import { cn } from "@/lib/utils";
import { useProfitabilityFormat } from "./format";

function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint: string; tone?: "destructive" | "warning" }) {
  return (
    <div className="min-w-0 rounded-2xl border bg-card px-4 py-3.5">
      <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{label}</p>
      <p
        className={cn(
          "mt-1 truncate text-2xl font-bold heading-tight",
          tone === "destructive" && "text-destructive",
          tone === "warning" && "text-warning",
        )}
      >
        {value}
      </p>
      {/* Dos líneas como mucho (el desglose del coste o lo cobrado sin factura no caben en una en siete columnas). */}
      <p title={hint} className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
        {hint}
      </p>
    </div>
  );
}

/**
 * Las siete cifras del periodo (la suma de los clientes): ingresos (base de lo emitido y cobros sin
 * factura), cobrado (con IVA, con lo pendiente debajo), coste (horas, gastos e infraestructura, con
 * el desglose debajo), margen, margen %, €/hora y horas.
 */
export function SummaryStrip({
  totals,
  costs,
  collection,
  clients,
  settings,
}: {
  totals: Figures;
  costs: ProfitabilityReport["costs"];
  collection: ProfitabilityReport["collection"];
  clients: number;
  settings: ProfitabilitySettings;
}) {
  const t = useTranslations("profitability.summary");
  const fmt = useProfitabilityFormat();
  const lowMargin = totals.flags.includes("lowMargin");
  const lowRate = totals.flags.includes("lowRate");
  return (
    <section aria-label={t("label")} className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
      <Stat
        label={t("revenue")}
        value={fmt.money(totals.revenueCents)}
        hint={collection.receiptsCents !== 0 ? t("revenueReceipts", { amount: fmt.money(collection.receiptsCents) }) : t("revenueHint")}
      />
      <Stat
        label={t("collected")}
        value={fmt.money(collection.collectedCents)}
        hint={
          collection.pendingCents > 0
            ? t("collectedPending", { amount: fmt.money(collection.pendingCents) })
            : collection.receiptsCents !== 0
              ? t("collectedReceipts", { amount: fmt.money(collection.receiptsCents) })
              : t("collectedHint")
        }
      />
      <Stat
        label={t("cost")}
        value={fmt.money(totals.costCents)}
        hint={
          hasOtherCosts(costs.other)
            ? t("costSplit", { hours: fmt.money(costs.hoursCents), amount: fmt.money(otherCostsCents(costs.other)) })
            : t("costHint")
        }
      />
      <Stat
        label={t("margin")}
        value={fmt.money(totals.marginCents)}
        hint={t("marginHint")}
        tone={totals.marginCents < 0 ? "destructive" : undefined}
      />
      <Stat
        label={t("marginShare")}
        value={totals.marginBps === null ? "—" : fmt.percent(totals.marginBps)}
        hint={t("minimum", { value: fmt.percent(settings.minMarginBps) })}
        tone={lowMargin ? (totals.marginCents < 0 ? "destructive" : "warning") : undefined}
      />
      <Stat
        label={t("rate")}
        value={totals.rateCents === null ? "—" : fmt.rate(totals.rateCents)}
        hint={t("minimum", { value: fmt.rate(settings.minHourlyRateCents) })}
        tone={lowRate ? "warning" : undefined}
      />
      <Stat label={t("hours")} value={fmt.hours(totals.minutes)} hint={t("clients", { count: clients })} />
    </section>
  );
}
