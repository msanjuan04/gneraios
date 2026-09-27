"use client";

import { useTranslations } from "next-intl";
import type { SiteStatus } from "@/domain/sites";
import { cn } from "@/lib/utils";

const DOT: Record<SiteStatus, string> = {
  up: "bg-success",
  slow: "bg-warning",
  down: "bg-destructive",
  unknown: "bg-muted-foreground/50",
  paused: "border border-muted-foreground/60 bg-transparent",
};

/** El punto de color del estado. Nunca va solo: lleva su etiqueta (visible o para lectores de pantalla). */
export function StatusDot({ status, size = "sm", className }: { status: SiteStatus; size?: "sm" | "lg"; className?: string }) {
  const t = useTranslations("sites.status");
  return (
    <span className={cn("relative inline-flex shrink-0", size === "lg" ? "size-3" : "size-2", className)} title={t(status)}>
      {status === "down" && <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-destructive/60" />}
      <span aria-hidden className={cn("relative inline-flex size-full rounded-full", DOT[status])} />
      <span className="sr-only">{t(status)}</span>
    </span>
  );
}

const PILL: Record<SiteStatus, string> = {
  up: "border-success/30 bg-success/10 text-success",
  slow: "border-warning/30 bg-warning/10 text-warning",
  down: "border-destructive/30 bg-destructive/10 text-destructive",
  unknown: "border-border text-muted-foreground",
  paused: "border-border text-muted-foreground",
};

/** El estado con su nombre, en píldora (cabecera de la ficha). */
export function StatusPill({ status, className }: { status: SiteStatus; className?: string }) {
  const t = useTranslations("sites.status");
  return (
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold", PILL[status], className)}>
      <StatusDot status={status} className="[&_.sr-only]:hidden" />
      {t(status)}
    </span>
  );
}
