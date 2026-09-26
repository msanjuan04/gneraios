"use client";

import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Controller, useFieldArray, useFormContext } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { OnboardingInput } from "@/lib/validation/onboarding";
import { StepHeading, TextField } from "../form-fields";

const ROLES = ["owner", "partner", "viewer"] as const;

export function TeamStep() {
  const t = useTranslations("onboarding.team");
  const tRoles = useTranslations("roles");
  const tHints = useTranslations("roleHints");
  const tCommon = useTranslations("common");
  const { control } = useFormContext<OnboardingInput>();
  const { fields, append, remove } = useFieldArray({ control, name: "invitations" });

  return (
    <div>
      <StepHeading title={t("title")} description={t("description")} />
      <div className="space-y-3">
        {fields.length === 0 && (
          <p className="rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">{t("empty")}</p>
        )}
        {fields.map((field, index) => (
          <div
            key={field.id}
            className="grid items-start gap-3 rounded-2xl border bg-card/70 p-4 backdrop-blur sm:grid-cols-[1.4fr_1fr_11rem_auto]"
          >
            <TextField name={`invitations.${index}.email`} label={t("email")} type="email" placeholder="nombre@gnerai.com" />
            <TextField name={`invitations.${index}.full_name`} label={t("name")} optional />
            <Controller
              control={control}
              name={`invitations.${index}.role`}
              render={({ field: roleField }) => (
                <Field>
                  <FieldLabel>{t("role")}</FieldLabel>
                  <Select value={roleField.value} onValueChange={roleField.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map((r) => (
                        <SelectItem key={r} value={r}>
                          <span>{tRoles(r)}</span>
                          <span className="text-xs text-muted-foreground">{tHints(r)}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="sm:mt-7"
              onClick={() => remove(index)}
              aria-label={tCommon("remove")}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" onClick={() => append({ email: "", full_name: "", role: "owner" })}>
          <Plus data-icon="inline-start" />
          {t("add")}
        </Button>
      </div>
    </div>
  );
}
