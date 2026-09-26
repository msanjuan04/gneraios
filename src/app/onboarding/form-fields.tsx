"use client";

import { useTranslations } from "next-intl";
import type { ComponentProps, ReactNode } from "react";
import { type FieldPath, get, useFormContext } from "react-hook-form";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { OnboardingInput } from "@/lib/validation/onboarding";

type Name = FieldPath<OnboardingInput>;

/** Mensaje de error ya traducido de un campo (los esquemas devuelven claves de validation.*). */
export function useFieldError(name: Name): string | undefined {
  const t = useTranslations("validation");
  const { formState } = useFormContext<OnboardingInput>();
  const key = get(formState.errors, name)?.message as string | undefined;
  return key ? t(key) : undefined;
}

export function TextField({
  name,
  label,
  description,
  optional,
  type = "text",
  className,
  ...inputProps
}: {
  name: Name;
  label: ReactNode;
  description?: ReactNode;
  optional?: boolean;
} & Omit<ComponentProps<typeof Input>, "name">) {
  const t = useTranslations("common");
  const { register } = useFormContext<OnboardingInput>();
  const error = useFieldError(name);

  return (
    <Field data-invalid={Boolean(error)} className={className}>
      <FieldLabel htmlFor={name}>
        {label}
        {optional && <span className="font-normal text-muted-foreground">· {t("optional")}</span>}
      </FieldLabel>
      <Input
        id={name}
        type={type}
        aria-invalid={Boolean(error)}
        {...inputProps}
        {...register(name, type === "number" ? { valueAsNumber: true } : undefined)}
      />
      {description && !error && <FieldDescription>{description}</FieldDescription>}
      {error && <FieldError>{error}</FieldError>}
    </Field>
  );
}

export function StepHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-2xl font-extrabold heading-tight">{title}</h2>
      <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
