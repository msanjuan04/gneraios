"use client";

import { CalendarClock, Clock } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import type { HTMLAttributes, KeyboardEvent, Ref } from "react";
import { formatMoney } from "@/domain/money";
import { cn } from "@/lib/utils";
import type { BoardDeal } from "./board-types";

type Props = {
  deal: BoardDeal;
  dragging?: boolean;
  overlay?: boolean;
  ref?: Ref<HTMLDivElement>;
  onOpen?: () => void;
  onMove?: (direction: -1 | 1) => void;
} & HTMLAttributes<HTMLDivElement>;

/** Tarjeta del Kanban: importe (puntual + €/mes, nunca sumados), días en etapa y próxima acción. */
export function DealCard({ deal, dragging, overlay, ref, onOpen, onMove, className, onKeyDown: dragKeyDown, ...rest }: Props) {
  const t = useTranslations("pipeline");
  const tCrm = useTranslations("crm");
  const format = useFormatter();

  // Enter abre y ⇧←/⇧→ mueven de etapa; el resto (Espacio para arrastrar) va a dnd-kit.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      onOpen?.();
    } else if (e.shiftKey && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
      e.preventDefault();
      onMove?.(e.key === "ArrowRight" ? 1 : -1);
    } else {
      dragKeyDown?.(e);
    }
  }

  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      aria-label={t("card.open", { title: deal.title })}
      title={t("card.moveHint")}
      onClick={onOpen}
      className={cn(
        "group cursor-pointer rounded-xl border bg-card p-3 text-left shadow-sm outline-none transition",
        "hover:border-primary/40 focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/40",
        dragging && "opacity-40",
        overlay && "rotate-1 border-primary/60 shadow-2xl",
        className,
      )}
      {...rest}
      onKeyDown={onKeyDown}
    >
      <p className="line-clamp-2 text-sm font-semibold leading-snug">{deal.title}</p>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">{deal.clientName}</p>

      {(deal.estOneOffCents > 0 || deal.estMrrCents > 0) && (
        <div className="mt-2.5 flex flex-wrap gap-1.5 text-xs font-semibold tabular">
          {deal.estOneOffCents > 0 && (
            <span className="rounded-md bg-secondary px-1.5 py-0.5">{formatMoney(deal.estOneOffCents, { wholeUnits: true })}</span>
          )}
          {deal.estMrrCents > 0 && (
            <span className="rounded-md bg-primary/12 px-1.5 py-0.5 text-primary">
              {tCrm("amount.perMonth", { amount: formatMoney(deal.estMrrCents, { wholeUnits: true }) })}
            </span>
          )}
        </div>
      )}

      {deal.nextAction && (
        <p
          className={cn(
            "mt-2.5 flex items-start gap-1.5 text-xs",
            deal.nextActionOverdue ? "font-semibold text-destructive" : "text-muted-foreground",
          )}
        >
          <CalendarClock className="mt-px size-3.5 shrink-0" />
          <span className="line-clamp-2">
            {deal.nextActionOn && (
              <span className="tabular">
                {format.dateTime(new Date(`${deal.nextActionOn}T12:00:00Z`), { day: "numeric", month: "short" })} ·{" "}
              </span>
            )}
            {deal.nextAction}
          </span>
        </p>
      )}

      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1 tabular">
          <Clock className="size-3.5" />
          {tCrm("daysInStage", { count: deal.daysInStage })}
          <span className="text-muted-foreground/60">· {Math.round(deal.probabilityBps / 100)} %</span>
        </span>
        {deal.ownerInitials && (
          <span className="flex size-6 items-center justify-center rounded-full bg-brand-gradient text-[10px] font-bold text-white">
            {deal.ownerInitials}
          </span>
        )}
      </div>
    </div>
  );
}
