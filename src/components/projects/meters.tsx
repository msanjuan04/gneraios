"use client";

import { useTranslations } from "next-intl";
import type { Burn, Progress } from "@/domain/projects";
import { cn } from "@/lib/utils";
import { useProjectFormat } from "./format";

/** Barra fina de 0 a 1 (lo que pase de 1 se pinta lleno). */
export function Bar({ ratio, tone = "bg-primary", className }: { ratio: number; tone?: string; className?: string }) {
  const width = `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`;
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div className={cn("h-full rounded-full transition-[width]", tone)} style={{ width }} />
    </div>
  );
}

/** Avance: tareas hechas entre tareas. Sin tareas, un guion. */
export function ProgressMeter({ progress, className }: { progress: Progress; className?: string }) {
  const t = useTranslations("projects.meters");
  const fmt = useProjectFormat();
  if (progress.ratio === null) return <span className={cn("text-xs text-muted-foreground", className)}>{t("noTasks")}</span>;
  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)} title={t("progressTitle", { done: progress.done, total: progress.total })}>
      <Bar ratio={progress.ratio} tone={progress.ratio >= 1 ? "bg-success" : "bg-primary"} className="min-w-10 flex-1" />
      <span className="w-9 shrink-0 text-right text-xs text-muted-foreground tabular">{fmt.percent(progress.ratio)}</span>
    </div>
  );
}

const BURN_TONES = { none: "bg-primary", ok: "bg-primary", warning: "bg-warning", over: "bg-destructive" } as const;

/** Horas registradas frente al presupuesto: azul, ámbar desde el 80 % y rojo al pasarse. */
export function BurnMeter({
  loggedMinutes,
  budgetMinutes,
  burn,
  className,
}: {
  loggedMinutes: number;
  budgetMinutes: number | null;
  burn: Burn;
  className?: string;
}) {
  const t = useTranslations("projects.meters");
  const fmt = useProjectFormat();
  return (
    <div className={cn("min-w-0", className)}>
      <p className="flex items-baseline justify-end gap-1 text-xs tabular">
        <span className={cn("font-semibold", burn.state === "over" && "text-destructive")}>{fmt.hours(loggedMinutes)}</span>
        {budgetMinutes !== null && <span className="text-muted-foreground">{t("of", { budget: fmt.hours(budgetMinutes) })}</span>}
      </p>
      {burn.ratio !== null && <Bar ratio={burn.ratio} tone={BURN_TONES[burn.state]} className="mt-1" />}
    </div>
  );
}
