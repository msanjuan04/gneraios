"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { Controller, useFormContext, useWatch } from "react-hook-form";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { slugify } from "@/domain/org";
import { initialsFrom } from "@/domain/people";
import { localeNames, locales } from "@/i18n/config";
import type { OnboardingInput } from "@/lib/validation/onboarding";
import { StepHeading, TextField, useFieldError } from "../form-fields";

export function OrgStep({ appHost }: { appHost: string }) {
  const t = useTranslations("onboarding.org");
  const tPrefs = useTranslations("settings.preferences");
  const { control, register, setValue, getFieldState } = useFormContext<OnboardingInput>();
  const name = useWatch({ control, name: "org.name" });
  const slug = useWatch({ control, name: "org.slug" });
  const fullName = useWatch({ control, name: "owner.full_name" });
  const slugError = useFieldError("org.slug");

  // El identificador y las iniciales se proponen solos hasta que el usuario los toca.
  useEffect(() => {
    if (!getFieldState("org.slug").isDirty) setValue("org.slug", slugify(name ?? ""));
  }, [name, getFieldState, setValue]);
  useEffect(() => {
    if (!getFieldState("owner.initials").isDirty) setValue("owner.initials", fullName ? initialsFrom(fullName) : "");
  }, [fullName, getFieldState, setValue]);

  return (
    <div>
      <StepHeading title={t("title")} description={t("description")} />
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField name="org.name" label={t("name")} autoFocus className="sm:col-span-2" />
        <Field data-invalid={Boolean(slugError)} className="sm:col-span-2">
          <FieldLabel htmlFor="org.slug">{t("slug")}</FieldLabel>
          <InputGroup>
            <InputGroupAddon>
              <InputGroupText>{appHost}/</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput id="org.slug" aria-invalid={Boolean(slugError)} {...register("org.slug")} />
          </InputGroup>
          {slugError ? (
            <FieldError>{slugError}</FieldError>
          ) : (
            <FieldDescription>{t("slugHint", { url: `${appHost}/${slug || "…"}` })}</FieldDescription>
          )}
        </Field>
        <TextField name="owner.full_name" label={t("yourName")} placeholder={t("yourNamePlaceholder")} autoComplete="name" />
        <TextField
          name="owner.initials"
          label={t("initials")}
          description={t("initialsHint")}
          maxLength={3}
          className="[&_input]:uppercase"
        />
        <Controller
          control={control}
          name="owner.locale"
          render={({ field }) => (
            <Field>
              <FieldLabel>{tPrefs("language")}</FieldLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {locales.map((l) => (
                    <SelectItem key={l} value={l}>
                      {localeNames[l]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        />
      </div>
    </div>
  );
}
