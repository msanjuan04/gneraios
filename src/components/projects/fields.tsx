"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const NONE = "__none__";

/**
 * Traduce el mensaje de un error de Zod de los formularios de proyectos: primero
 * `projects.validation.*`, luego los comunes de `validation.*`.
 */
export function useProjectValidationMessage() {
  const t = useTranslations("projects.validation");
  const tCommon = useTranslations("validation");
  return (message: string | undefined): string | undefined => {
    if (!message) return undefined;
    if (t.has(message)) return t(message);
    return tCommon.has(message) ? tCommon(message) : tCommon("invalid");
  };
}

export type SelectOption = { value: string; label: ReactNode; hint?: ReactNode };

/**
 * Desplegable con una opción vacía opcional ("Sin asignar", "Interno"…). El valor vacío es "":
 * así casa con los esquemas (que convierten "" en null).
 */
export function OptionSelect({
  id,
  value,
  onChange,
  options,
  noneLabel,
  disabled,
  invalid,
  className,
  size,
  ariaLabel,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  /** Sin él, no hay opción vacía. */
  noneLabel?: ReactNode;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  size?: "sm" | "default";
  ariaLabel?: string;
}) {
  return (
    <Select
      value={value === "" && noneLabel !== undefined ? NONE : value}
      onValueChange={(v) => onChange(v === NONE ? "" : v)}
      disabled={disabled}
    >
      <SelectTrigger id={id} size={size} aria-invalid={invalid} aria-label={ariaLabel} className={cn("w-full", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {noneLabel !== undefined && <SelectItem value={NONE}>{noneLabel}</SelectItem>}
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
            {o.hint && <span className="ml-1 text-muted-foreground">{o.hint}</span>}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Evento que avisa de que el temporizador ha cambiado (lo escucha la barra superior). */
export const TIMER_EVENT = "gnerai:timer-changed";

export function announceTimerChange() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(TIMER_EVENT));
}
