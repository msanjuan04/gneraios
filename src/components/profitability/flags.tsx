"use client";

import { Clock, Coins, type LucideIcon, TrendingDown, Unplug } from "lucide-react";
import { useTranslations } from "next-intl";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Flag, ProfitabilitySettings } from "@/domain/profitability";
import { cn } from "@/lib/utils";
import { useProfitabilityFormat } from "./format";

/*
 * Avisos de la rentabilidad como píldoras pequeñas. El color es de estado (rojo: pierde o no factura;
 * ámbar: por debajo del €/hora mínimo; azul: solo informa) y siempre va con icono y texto: nunca
 * solo el color. El detalle, en el tooltip.
 */

const STYLES: Record<Flag, string> = {
  lowMargin: "bg-destructive/15 text-destructive",
  lowRate: "bg-warning/15 text-warning",
  hoursWithoutRevenue: "bg-destructive/15 text-destructive",
  revenueWithoutHours: "bg-primary/10 text-primary",
};

const ICONS: Record<Flag, LucideIcon> = {
  lowMargin: TrendingDown,
  lowRate: Coins,
  hoursWithoutRevenue: Clock,
  revenueWithoutHours: Unplug,
};

/** Los umbrales con los que se explica cada aviso (los de la org). */
export type FlagThresholds = Pick<ProfitabilitySettings, "minMarginBps" | "minHourlyRateCents">;

export function FlagPill({ flag, thresholds, className }: { flag: Flag; thresholds: FlagThresholds; className?: string }) {
  const t = useTranslations("profitability");
  const fmt = useProfitabilityFormat();
  const Icon = ICONS[flag];
  const min = flag === "lowMargin" ? fmt.percent(thresholds.minMarginBps) : flag === "lowRate" ? fmt.rate(thresholds.minHourlyRateCents) : "";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={cn(
            "inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-1.5 text-[11px] font-semibold whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            STYLES[flag],
            className,
          )}
        >
          <Icon aria-hidden className="size-3" />
          {t(`flags.${flag}`)}
        </span>
      </TooltipTrigger>
      <TooltipContent>{t(`flagHints.${flag}`, { min })}</TooltipContent>
    </Tooltip>
  );
}

export function FlagPills({ flags, thresholds, className }: { flags: readonly Flag[]; thresholds: FlagThresholds; className?: string }) {
  if (flags.length === 0) return null;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {flags.map((flag) => (
        <FlagPill key={flag} flag={flag} thresholds={thresholds} />
      ))}
    </span>
  );
}
