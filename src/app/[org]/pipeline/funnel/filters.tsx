"use client";

import { useTranslations } from "next-intl";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FunnelPreset } from "@/domain/pipeline";
import { cn } from "@/lib/utils";
import { FunnelLink, useFunnelNavigation } from "./frame";

export type PresetOption = { preset: FunnelPreset; href: string };

type FunnelFiltersProps = {
  /** URL de la página sin filtro ("Todo"). */
  basePath: string;
  presets: PresetOption[];
  active: FunnelPreset | null;
  from: string | null;
  to: string | null;
  /** Hoy en la zona de la org (YYYY-MM-DD). */
  today: string;
  /** El periodo en palabras; vacío para "Todo". */
  caption: string | null;
};

/** Una sola fila encima de todo lo que filtra: presets primero y, después, un rango a medida. */
export function FunnelFilters({ basePath, presets, active, from, to, today, caption }: FunnelFiltersProps) {
  const t = useTranslations("funnel.filters");
  const { navigate } = useFunnelNavigation();

  function applyCustomRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const params = new URLSearchParams();
    for (const name of ["from", "to"]) {
      const value = data.get(name);
      if (typeof value === "string" && value !== "") params.set(name, value);
    }
    const query = params.toString();
    navigate(query ? `${basePath}?${query}` : basePath);
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
      <nav aria-label={t("label")} className="flex w-fit flex-wrap gap-1 rounded-2xl border bg-card/60 p-1 sm:rounded-full">
        {presets.map(({ preset, href }) => {
          const isActive = preset === active;
          return (
            <FunnelLink
              key={preset}
              href={href}
              aria-current={isActive ? "true" : undefined}
              className={cn(
                "rounded-full px-3.5 py-1 text-sm font-semibold whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                isActive ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`presets.${preset}`)}
            </FunnelLink>
          );
        })}
      </nav>

      {/* La key rehace los campos cuando cambia el periodo desde la URL. */}
      <form
        key={`${from ?? ""}_${to ?? ""}`}
        onSubmit={applyCustomRange}
        aria-label={t("custom")}
        className="flex flex-wrap items-center gap-2"
      >
        <label htmlFor="funnel-from" className="sr-only">
          {t("from")}
        </label>
        <Input
          id="funnel-from"
          name="from"
          type="date"
          defaultValue={from ?? ""}
          max={today}
          className="w-[9.5rem] tabular"
        />
        <span aria-hidden className="text-muted-foreground">
          –
        </span>
        <label htmlFor="funnel-to" className="sr-only">
          {t("to")}
        </label>
        <Input id="funnel-to" name="to" type="date" defaultValue={to ?? ""} className="w-[9.5rem] tabular" />
        <Button type="submit" variant="secondary" size="sm">
          {t("apply")}
        </Button>
      </form>

      {caption && <p className="text-sm text-muted-foreground lg:ml-auto">{caption}</p>}
    </div>
  );
}
