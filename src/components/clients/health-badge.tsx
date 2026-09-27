"use client";

import { useFormatter, useTranslations } from "next-intl";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ClientHealth, HealthSignal } from "@/domain/clients/health";
import { formatMoney } from "@/domain/money";
import { cn } from "@/lib/utils";

const DOT: Record<ClientHealth["level"], string> = {
  good: "bg-success",
  warning: "bg-warning shadow-[0_0_6px_var(--warning)]",
  danger: "bg-destructive shadow-[0_0_6px_var(--destructive)]",
};

/** El texto de una señal, con sus cifras formateadas. */
export function useHealthText() {
  const t = useTranslations("clients.health");
  const format = useFormatter();
  return (signal: HealthSignal) => {
    const v = signal.values;
    const money = (key: string) => (typeof v[key] === "number" ? formatMoney(v[key] as number) : "");
    const date = typeof v.date === "string" ? format.dateTime(new Date(`${v.date}T12:00:00Z`), { day: "numeric", month: "short", timeZone: "UTC" }) : "";
    return t(`signals.${signal.key}`, {
      ...v,
      amount: money("amount_cents"),
      now: money("now_cents"),
      before: money("before_cents"),
      date,
      percent: typeof v.percent === "number" ? Math.abs(v.percent) : 0,
    });
  };
}

/** Punto de color con las razones al pasar por encima (o al enfocarlo con el teclado). */
export function HealthBadge({ health, className }: { health: ClientHealth; className?: string }) {
  const t = useTranslations("clients.health");
  const text = useHealthText();
  if (health.level === "good") return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          aria-label={`${t(`levels.${health.level}`)}: ${health.signals.map(text).join(" ")}`}
          className={cn("inline-block size-2 shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring", DOT[health.level], className)}
        />
      </TooltipTrigger>
      <TooltipContent className="max-w-72">
        <div className="flex flex-col gap-1 text-left">
          <p className="font-semibold">{t(`levels.${health.level}`)}</p>
          <ul className="space-y-0.5">
            {health.signals.map((signal) => (
              <li key={signal.key}>· {text(signal)}</li>
            ))}
          </ul>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

/** Bloque para la ficha del cliente: las señales una a una. */
export function HealthPanel({ health }: { health: ClientHealth }) {
  const t = useTranslations("clients.health");
  const text = useHealthText();
  if (health.level === "good") return null;
  return (
    <div
      role="status"
      className={cn(
        "rounded-2xl border px-4 py-3 text-sm",
        health.level === "danger" ? "border-destructive/30 bg-destructive/5" : "border-warning/30 bg-warning/5",
      )}
    >
      <p className="flex items-center gap-2 font-semibold">
        <span aria-hidden className={cn("size-2 rounded-full", DOT[health.level])} />
        {t(`panelTitle.${health.level}`)}
      </p>
      <ul className="mt-1.5 space-y-1 text-muted-foreground">
        {health.signals.map((signal) => (
          <li key={signal.key} className={cn(signal.level === "danger" && "text-foreground")}>
            {text(signal)}
          </li>
        ))}
      </ul>
    </div>
  );
}
