"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { FormField, useValidationMessage } from "@/components/settings/form-field";
import { ReadOnlyNotice, SettingsCard } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveGeneralSettings } from "./actions";
import { type GeneralSettingsInput, generalSettingsSchema } from "./schema";

export function GeneralSettingsForm({
  slug,
  defaults,
  canEdit,
}: {
  slug: string;
  defaults: GeneralSettingsInput;
  canEdit: boolean;
}) {
  const t = useTranslations("settings.general");
  const tCommon = useTranslations("common");
  const message = useValidationMessage();
  const form = useForm<GeneralSettingsInput>({
    resolver: zodResolver(generalSettingsSchema),
    defaultValues: defaults,
    mode: "onTouched",
  });
  const { register, formState } = form;
  const { errors, isSubmitting, isDirty } = formState;

  const submit = form.handleSubmit(async () => {
    const values = form.getValues();
    const result = await saveGeneralSettings(slug, values);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    form.reset(values);
    toast.success(t("saved"));
  });

  return (
    <form onSubmit={submit} noValidate>
      {!canEdit && <ReadOnlyNotice className="mb-4">{tCommon("ownerOnly")}</ReadOnlyNotice>}
      <fieldset disabled={!canEdit || isSubmitting} className="space-y-6">
        <SettingsCard title={t("title")} description={t("description")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="org-name" label={t("name")} error={message(errors.name?.message)}>
              <Input id="org-name" autoComplete="organization" aria-invalid={Boolean(errors.name)} {...register("name")} />
            </FormField>
            <FormField id="org-slug" label={t("slug")} description={t("slugLocked")}>
              <Input id="org-slug" value={slug} readOnly disabled className="font-mono" />
            </FormField>
          </div>
        </SettingsCard>

        <SettingsCard title={t("rulesTitle")} description={t("rulesDescription")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              id="payment-terms"
              label={t("paymentTerms")}
              description={t("paymentTermsHint")}
              error={message(errors.payment_terms_days?.message)}
            >
              <Input
                id="payment-terms"
                type="number"
                inputMode="numeric"
                min={0}
                max={365}
                className="tabular"
                aria-invalid={Boolean(errors.payment_terms_days)}
                {...register("payment_terms_days", { valueAsNumber: true })}
              />
            </FormField>
            <FormField
              id="billing-day"
              label={t("billingDay")}
              description={t("billingDayHint")}
              error={message(errors.billing_day?.message)}
            >
              <Input
                id="billing-day"
                type="number"
                inputMode="numeric"
                min={1}
                max={31}
                className="tabular"
                aria-invalid={Boolean(errors.billing_day)}
                {...register("billing_day", { valueAsNumber: true })}
              />
            </FormField>
            <FormField
              id="dunning-days"
              label={t("dunningDays")}
              description={t("daysListHint")}
              error={message(errors.dunning_days?.message)}
            >
              <Input
                id="dunning-days"
                inputMode="numeric"
                placeholder="7, 15"
                className="tabular"
                aria-invalid={Boolean(errors.dunning_days)}
                {...register("dunning_days")}
              />
            </FormField>
            <FormField
              id="renewal-days"
              label={t("renewalDays")}
              description={t("renewalDaysHint")}
              error={message(errors.renewal_alert_days?.message)}
            >
              <Input
                id="renewal-days"
                inputMode="numeric"
                placeholder="60, 30, 7"
                className="tabular"
                aria-invalid={Boolean(errors.renewal_alert_days)}
                {...register("renewal_alert_days")}
              />
            </FormField>
            <FormField
              id="quote-validity"
              label={t("quoteValidity")}
              description={t("quoteValidityHint")}
              error={message(errors.quote_validity_days?.message)}
            >
              <Input
                id="quote-validity"
                type="number"
                inputMode="numeric"
                min={1}
                max={365}
                className="tabular"
                aria-invalid={Boolean(errors.quote_validity_days)}
                {...register("quote_validity_days", { valueAsNumber: true })}
              />
            </FormField>
            <FormField
              id="concentration-alert"
              label={t("concentrationAlert")}
              description={t("concentrationAlertHint")}
              error={message(errors.concentration_alert_percent?.message)}
            >
              <Input
                id="concentration-alert"
                type="number"
                inputMode="numeric"
                min={1}
                max={100}
                className="tabular"
                aria-invalid={Boolean(errors.concentration_alert_percent)}
                {...register("concentration_alert_percent", { valueAsNumber: true })}
              />
            </FormField>
            <FormField
              id="target-hourly-rate"
              label={t("targetHourlyRate")}
              description={t("targetHourlyRateHint")}
              error={message(errors.target_hourly_rate_euros?.message)}
            >
              <Input
                id="target-hourly-rate"
                type="number"
                inputMode="numeric"
                min={1}
                max={1000}
                className="tabular"
                aria-invalid={Boolean(errors.target_hourly_rate_euros)}
                {...register("target_hourly_rate_euros", { valueAsNumber: true })}
              />
            </FormField>
          </div>
        </SettingsCard>
      </fieldset>

      {canEdit && (
        <div className="mt-6 flex justify-end">
          <Button type="submit" disabled={isSubmitting || !isDirty}>
            {isSubmitting ? tCommon("saving") : tCommon("save")}
          </Button>
        </div>
      )}
    </form>
  );
}
