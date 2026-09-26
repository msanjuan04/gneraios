import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Tone } from "./format";

const TONE_CLASS: Record<Tone, string> = {
  good: "text-success",
  bad: "text-destructive",
  neutral: "text-muted-foreground",
};

/**
 * Variación con icono y signo: el color dice si es buena o mala, nunca él solo (el signo y la
 * flecha también lo dicen). `direction` es hacia dónde se mueve la cifra, no si es buena.
 */
export function Delta({
  tone,
  direction,
  children,
  label,
  className,
}: {
  tone: Tone;
  direction: "up" | "down" | "flat";
  children: ReactNode;
  /** Texto para lectores de pantalla ("sube un 12 % frente al periodo anterior"). */
  label?: string;
  className?: string;
}) {
  // Una variación que es ruido (neutra) no lleva flecha: se lee como "igual".
  const shown = tone === "neutral" ? "flat" : direction;
  const Icon = shown === "up" ? ArrowUpRight : shown === "down" ? ArrowDownRight : Minus;
  return (
    <span className={cn("inline-flex items-center gap-0.5 font-semibold whitespace-nowrap tabular", TONE_CLASS[tone], className)}>
      <Icon aria-hidden className="size-3.5 shrink-0" />
      <span aria-hidden={label ? true : undefined}>{children}</span>
      {label && <span className="sr-only">{label}</span>}
    </span>
  );
}

export const directionOf = (value: number | null): "up" | "down" | "flat" =>
  value === null || value === 0 ? "flat" : value > 0 ? "up" : "down";
