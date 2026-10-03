"use client";

import { Flame, Snowflake, Thermometer } from "lucide-react";
import { useTranslations } from "next-intl";
import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { setDealTemperature } from "@/app/[org]/pipeline/actions";
import { type LeadTemperature, LEAD_TEMPERATURES } from "@/domain/crm";
import { cn } from "@/lib/utils";

/** El color y el icono de cada calificación, los mismos en la carpeta y en la ficha. */
export const TEMPERATURE_STYLE: Record<LeadTemperature, { className: string; Icon: typeof Flame }> = {
  hot: { className: "border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400", Icon: Flame },
  warm: { className: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400", Icon: Thermometer },
  cold: { className: "border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400", Icon: Snowflake },
};

/**
 * Calificar el lead: caliente, templado o frío. Volver a pulsar la que ya está la quita (vuelve a
 * «sin calificar»). Se ve al momento y, si el servidor dice que no, se deshace.
 */
export function LeadTemperaturePicker({
  slug,
  dealId,
  value,
  size = "default",
}: {
  slug: string;
  dealId: string;
  value: LeadTemperature | null;
  size?: "default" | "sm";
}) {
  const t = useTranslations("leads.temperature");
  const [pending, start] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(value);

  const choose = (next: LeadTemperature | null) => {
    start(async () => {
      setOptimistic(next);
      const result = await setDealTemperature(slug, dealId, next);
      if (!result.ok) toast.error(result.error);
    });
  };

  return (
    <div className="flex gap-1" role="group" aria-label={t("label")}>
      {LEAD_TEMPERATURES.map((temperature) => {
        const { className, Icon } = TEMPERATURE_STYLE[temperature];
        const active = optimistic === temperature;
        return (
          <button
            key={temperature}
            type="button"
            disabled={pending}
            onClick={() => choose(active ? null : temperature)}
            aria-pressed={active}
            title={t(temperature)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors",
              size === "sm" && "px-2 py-0.5",
              active ? className : "border-transparent bg-muted/60 text-muted-foreground hover:bg-muted",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {t(temperature)}
          </button>
        );
      })}
    </div>
  );
}

/** Solo la etiqueta, sin poder cambiarla (listas y resúmenes). */
export function LeadTemperatureBadge({ value, label }: { value: LeadTemperature; label: string }) {
  const { className, Icon } = TEMPERATURE_STYLE[value];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold", className)}>
      <Icon className="size-3" aria-hidden />
      {label}
    </span>
  );
}
