"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { QuoteState } from "./types";

/** Estado derivado (caducado sale de la validez): los colores de la marca para cada momento. */
const STATE_STYLES: Record<QuoteState, string> = {
  draft: "bg-secondary text-secondary-foreground",
  sent: "bg-primary/15 text-primary",
  expired: "bg-warning/15 text-warning",
  accepted: "bg-success/15 text-success",
  rejected: "border-border bg-transparent text-muted-foreground",
};

export function QuoteStateBadge({ state, className }: { state: QuoteState; className?: string }) {
  const t = useTranslations("quotes.state");
  return <Badge className={cn(STATE_STYLES[state], className)}>{t(state)}</Badge>;
}
