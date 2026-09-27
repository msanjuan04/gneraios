"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CivilDate } from "@/domain/dates/civil-date";
import {
  CALENDAR_PERIOD_KINDS,
  customPeriod,
  isPeriodInProgress,
  PERIOD_KINDS,
  type Period,
  periodAnchor,
  periodOfKind,
  periodQuery,
  shiftPeriod,
} from "@/domain/profitability";
import { cn } from "@/lib/utils";
import { usePeriodLabel, useProfitabilityFormat } from "./format";

type Props = {
  period: Period;
  today: CivilDate;
  /** La ruta de la página, sin query. */
  pathname: string;
  /** Navega dentro de la transición de la página (se atenúa mientras llega la nueva). */
  navigate: (href: string) => void;
};

/**
 * Periodo en una sola fila, encima de todo lo que filtra: el tipo (3 o 12 meses, mes, trimestre,
 * año o a medida), ← → para moverse entre meses, trimestres o años, y las dos fechas del rango.
 */
export function PeriodSelector({ period, today, pathname, navigate }: Props) {
  const t = useTranslations("profitability.period");
  const label = usePeriodLabel();
  const { range } = useProfitabilityFormat();
  const anchor = periodAnchor(period, today);
  const href = (target: Period) => `${pathname}${periodQuery(target)}`;
  const calendar = (CALENDAR_PERIOD_KINDS as readonly string[]).includes(period.kind);
  const previous = calendar ? shiftPeriod(period, -1, today) : null;
  const next = calendar ? shiftPeriod(period, 1, today) : null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
      <nav aria-label={t("label")} className="flex w-fit flex-wrap gap-1 rounded-2xl border bg-card/60 p-1 sm:rounded-full">
        {PERIOD_KINDS.map((kind) => {
          const target = periodOfKind(kind, anchor, today, period);
          const active = kind === period.kind;
          return (
            <Link
              key={kind}
              href={href(target)}
              scroll={false}
              aria-current={active ? "true" : undefined}
              onClick={(event) => {
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                if (!active) navigate(href(target));
              }}
              className={cn(
                "rounded-full px-3 py-1 text-sm font-semibold whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                active ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`kinds.${kind}`)}
            </Link>
          );
        })}
      </nav>

      {calendar && (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("previous")}
            disabled={!previous}
            onClick={() => previous && navigate(href(previous))}
          >
            <ChevronLeft />
          </Button>
          <span className="min-w-28 text-center text-sm font-semibold" aria-live="polite">
            {label(period)}
          </span>
          <Button variant="ghost" size="icon-sm" aria-label={t("next")} disabled={!next} onClick={() => next && navigate(href(next))}>
            <ChevronRight />
          </Button>
        </div>
      )}

      {period.kind === "custom" && (
        // La key rehace los campos cuando cambia el periodo desde la URL.
        <CustomRange key={`${period.from}_${period.to}`} period={period} today={today} onApply={(target) => navigate(href(target))} />
      )}

      <p className="text-sm text-muted-foreground lg:ml-auto">
        {range(period.from, period.to)}
        {isPeriodInProgress(period, today) && <span> · {t("inProgress")}</span>}
      </p>
    </div>
  );
}

function CustomRange({ period, today, onApply }: { period: Period; today: CivilDate; onApply: (period: Period) => void }) {
  const t = useTranslations("profitability.period");
  const [invalid, setInvalid] = useState(false);

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const target = customPeriod(String(data.get("from") ?? ""), String(data.get("to") ?? ""), today);
    setInvalid(target === null);
    if (target) onApply(target);
  }

  return (
    <form onSubmit={apply} aria-label={t("kinds.custom")} className="flex flex-wrap items-center gap-2">
      <label htmlFor="profitability-from" className="sr-only">
        {t("from")}
      </label>
      <Input
        id="profitability-from"
        name="from"
        type="date"
        defaultValue={period.from}
        max={today}
        aria-invalid={invalid || undefined}
        className="w-[9.5rem] tabular"
      />
      <span aria-hidden className="text-muted-foreground">
        –
      </span>
      <label htmlFor="profitability-to" className="sr-only">
        {t("to")}
      </label>
      <Input id="profitability-to" name="to" type="date" defaultValue={period.to} aria-invalid={invalid || undefined} className="w-[9.5rem] tabular" />
      <Button type="submit" variant="secondary" size="sm">
        {t("apply")}
      </Button>
      {invalid && (
        <p role="alert" className="w-full text-xs text-destructive">
          {t("invalid")}
        </p>
      )}
    </form>
  );
}
