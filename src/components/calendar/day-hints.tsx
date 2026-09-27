"use client";

import { TriangleAlert } from "lucide-react";
import type { DayHint } from "@/domain/calendar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useCalendarText } from "./use-calendar-text";

/** Aviso de carga de un día (muchos cobros, plazos o reuniones que se pisan), con su explicación. */
export function DayHintsBadge({ hints, className }: { hints: DayHint[]; className?: string }) {
  const text = useCalendarText();
  if (hints.length === 0) return null;
  const label = hints.map(text.hint).join(" · ");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          role="img"
          aria-label={label}
          className={cn("inline-flex shrink-0 items-center rounded-full text-warning outline-none focus-visible:ring-2 focus-visible:ring-ring/60", className)}
        >
          <TriangleAlert aria-hidden className="size-3.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Los mismos avisos, en texto (panel del día). */
export function DayHintsList({ hints }: { hints: DayHint[] }) {
  const text = useCalendarText();
  if (hints.length === 0) return null;
  return (
    <ul className="space-y-1 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
      {hints.map((hint) => (
        <li key={hint.kind} className="flex items-center gap-1.5">
          <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
          {text.hint(hint)}
        </li>
      ))}
    </ul>
  );
}
