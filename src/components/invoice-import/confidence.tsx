"use client";

import { useTranslations } from "next-intl";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Confidence } from "@/domain/invoice-import/types";
import { cn } from "@/lib/utils";

const TONES: Record<Confidence, string> = {
  high: "bg-success",
  medium: "bg-warning",
  low: "bg-destructive",
};

/**
 * Lo seguro que es un dato leído del PDF: verde (impreso con su etiqueta y cuadra), ámbar (sin
 * etiqueta clara o deducido) o rojo (una suposición). Sin dato leído, nada. Se oculta en cuanto el
 * socio cambia el campo.
 */
export function ConfidenceDot({ value, className }: { value: Confidence | null | undefined; className?: string }) {
  const t = useTranslations("invoiceImport.confidence");
  if (!value) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={t(value)}
          className={cn("inline-block size-2 shrink-0 rounded-full align-middle", TONES[value], className)}
        />
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{t(`${value}Hint`)}</TooltipContent>
    </Tooltip>
  );
}
