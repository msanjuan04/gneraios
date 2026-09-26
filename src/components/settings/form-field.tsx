"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/**
 * Traduce el mensaje de un error de Zod. Los esquemas devuelven claves de
 * `validation.*`; lo que no sea una clave conocida se muestra como genérico.
 */
export function useValidationMessage() {
  const t = useTranslations("validation");
  return (message: string | undefined): string | undefined => {
    if (!message) return undefined;
    return t.has(message) ? t(message) : t("invalid");
  };
}

/** Campo con etiqueta, marca de opcional, ayuda y error ya traducido. */
export function FormField({
  id,
  label,
  optional,
  description,
  error,
  disabled,
  className,
  children,
}: {
  id?: string;
  label: ReactNode;
  optional?: boolean;
  description?: ReactNode;
  error?: string;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const t = useTranslations("common");
  return (
    <Field data-invalid={Boolean(error)} data-disabled={disabled} className={className}>
      <FieldLabel htmlFor={id}>
        {label}
        {optional && <span className="font-normal text-muted-foreground">· {t("optional")}</span>}
      </FieldLabel>
      {children}
      {error ? <FieldError>{error}</FieldError> : description ? <FieldDescription>{description}</FieldDescription> : null}
    </Field>
  );
}

/** Opción sí/no con título y explicación; toda la fila es clicable. */
export function ToggleField({
  id,
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
  control = "switch",
  className,
}: {
  id: string;
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  control?: "switch" | "checkbox";
  className?: string;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex items-start gap-3 rounded-xl border bg-muted/40 p-3",
        disabled ? "cursor-not-allowed" : "cursor-pointer",
        className,
      )}
    >
      {control === "switch" ? (
        <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} className="mt-0.5" />
      ) : (
        <Checkbox
          id={id}
          checked={checked}
          onCheckedChange={(value) => onCheckedChange(value === true)}
          disabled={disabled}
          className="mt-0.5"
        />
      )}
      <span className={cn("min-w-0", disabled && "opacity-70")}>
        <span className="block text-sm font-semibold">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>}
      </span>
    </label>
  );
}
