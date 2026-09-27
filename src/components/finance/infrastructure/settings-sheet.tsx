"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { saveRenewalSettings } from "@/app/[org]/finance/infrastructure/actions";
import { centsToAmountInput, type RenewalSettingsFormInput, renewalSettingsFormSchema } from "@/app/[org]/finance/infrastructure/schema";
import { FINANCE_SETTINGS_LIMITS } from "@/app/[org]/settings/schema";
import { useShell } from "@/components/app-shell/shell-context";
import { MoneyInput } from "@/components/contracts/inputs";
import { FormField } from "@/components/settings/form-field";
import { SettingsSheet, SheetForm } from "@/components/settings/settings-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RenewalSettings } from "@/domain/finance/renewals";

/** Traduce un error de Zod del formulario: `infrastructure.validation.*` o genérico. */
function useInfrastructureValidationMessage() {
  const t = useTranslations("infrastructure.validation");
  const tCommon = useTranslations("validation");
  return (message: string | undefined): string | undefined => {
    if (!message) return undefined;
    return t.has(message) ? t(message) : tCommon("invalid");
  };
}

type Props = { slug: string; settings: RenewalSettings; open: boolean; onOpenChange: (open: boolean) => void };

/**
 * Avisos de renovación (orgs.settings.finance), en un panel lateral: cuántos días antes se avisa a
 * los socios y desde qué importe avisan las mensuales. Solo lo abre un owner.
 */
export function RenewalSettingsSheet(props: Props) {
  const t = useTranslations("infrastructure.settings");
  return (
    <SettingsSheet open={props.open} onOpenChange={props.onOpenChange} title={t("title")} description={t("description")}>
      {props.open && <SettingsForm {...props} />}
    </SettingsSheet>
  );
}

function SettingsForm({ slug, settings, onOpenChange }: Props) {
  const t = useTranslations("infrastructure.settings");
  const tCommon = useTranslations("common");
  const message = useInfrastructureValidationMessage();
  const { preview } = useShell();
  const days = FINANCE_SETTINGS_LIMITS.renewal_warning_days;
  const form = useForm<RenewalSettingsFormInput>({
    resolver: zodResolver(renewalSettingsFormSchema),
    defaultValues: {
      renewal_warning_days: settings.warningDays,
      monthly_renewal_min: centsToAmountInput(settings.monthlyMinCents),
    },
    mode: "onTouched",
  });
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    if (preview) {
      toast.info(t("previewOnly"));
      return;
    }
    const result = await saveRenewalSettings(slug, values);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(t("saved"));
    onOpenChange(false);
  });

  return (
    <SheetForm
      onSubmit={submit}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            {tCommon("cancel")}
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? tCommon("saving") : tCommon("save")}
          </Button>
        </>
      }
    >
      <div className="grid gap-5">
        <FormField
          id="renewal-warning-days"
          label={t("warningDays")}
          description={t("warningDaysHint")}
          error={message(errors.renewal_warning_days?.message)}
        >
          {/* max-w: el campo de Field ocupa todo el ancho (*:w-full). */}
          <div className="relative max-w-40">
            <Input
              id="renewal-warning-days"
              type="number"
              inputMode="numeric"
              min={days.min}
              max={days.max}
              step={1}
              className="pr-14 text-right tabular"
              aria-invalid={Boolean(errors.renewal_warning_days)}
              {...form.register("renewal_warning_days", { valueAsNumber: true })}
            />
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">{t("days")}</span>
          </div>
        </FormField>
        <FormField
          id="renewal-monthly-min"
          label={t("monthlyMin")}
          description={t("monthlyMinHint")}
          error={message(errors.monthly_renewal_min?.message)}
        >
          <div className="max-w-40">
            <MoneyInput id="renewal-monthly-min" aria-invalid={Boolean(errors.monthly_renewal_min)} {...form.register("monthly_renewal_min")} />
          </div>
        </FormField>
      </div>
    </SheetForm>
  );
}
