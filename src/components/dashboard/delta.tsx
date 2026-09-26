import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Variación frente a un periodo con nombre. El color es dirección × si subir es bueno, y
 * siempre va con flecha y texto: nunca solo color.
 */
export function Delta({
  direction,
  goodWhenUp = true,
  children,
  className,
}: {
  direction: "up" | "down" | "flat";
  goodWhenUp?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const good = direction === "flat" ? null : (direction === "up") === goodWhenUp;
  const Icon = direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : ArrowRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-semibold tabular",
        good === true && "text-success",
        good === false && "text-destructive",
        good === null && "text-muted-foreground",
        className,
      )}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      <span>{children}</span>
    </span>
  );
}

export function directionOf(delta: number): "up" | "down" | "flat" {
  return delta > 0 ? "up" : delta < 0 ? "down" : "flat";
}
