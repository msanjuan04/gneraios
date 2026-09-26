"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const TONES = {
  default: "border-primary/30 bg-primary/10",
  warning: "border-warning/30 bg-warning/10",
  destructive: "border-destructive/30 bg-destructive/10",
} as const;

/**
 * Confirmación en línea, en el sitio de la acción: nunca un modal encima de otro. El botón de
 * confirmar recibe el foco, así que Enter confirma y Escape (o Cancelar) vuelve atrás.
 */
export function InlineConfirm({
  tone = "default",
  icon,
  children,
  confirmLabel,
  onConfirm,
  onCancel,
  pending = false,
  className,
}: {
  tone?: keyof typeof TONES;
  icon?: ReactNode;
  children: ReactNode;
  confirmLabel: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
  pending?: boolean;
  className?: string;
}) {
  const t = useTranslations("common");
  return (
    <div
      role="alertdialog"
      aria-live="polite"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !pending) {
          e.stopPropagation();
          onCancel();
        }
      }}
      className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border px-4 py-3 text-sm", TONES[tone], className)}
    >
      {icon && <span className="shrink-0 [&_svg]:size-4">{icon}</span>}
      <div className="min-w-0 flex-1">{children}</div>
      <div className="flex shrink-0 items-center gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
          {t("cancel")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={tone === "destructive" ? "destructive" : "default"}
          onClick={onConfirm}
          disabled={pending}
          autoFocus
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}
