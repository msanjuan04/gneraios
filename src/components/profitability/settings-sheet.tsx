"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import {
  bpsToInput,
  hourlyToInput,
  type ProfitabilitySettingsFormInput,
  profitabilitySettingsFormSchema,
} from "@/app/[org]/finance/profitability/schema";
import { MoneyInput, PercentInput } from "@/components/contracts/inputs";
import { FormField } from "@/components/settings/form-field";
import { SettingsSheet, SheetForm } from "@/components/settings/settings-sheet";
import { Button } from "@/components/ui/button";
import type { ProfitabilitySettings } from "@/domain/profitability";
import { saveProfitabilitySettings } from "@/server/profitability/actions";

/** Traduce un error de Zod de los formularios de la rentabilidad: `profitability.validation.*` o genérico. */
export function useProfitabilityValidationMessage() {
  const t = useTranslations("profitability.validation");
  const tCommon = useTranslations("validation");
  return (message: string | undefined): string | undefined => {
    if (!message) return undefined;
    return t.has(message) ? t(message) : tCommon("invalid");
  };
}

/**
 * Umbrales de la rentabilidad (orgs.settings.profitability), en un panel lateral: el coste por hora
 * por defecto y a partir de qué margen y €/hora avisar. Solo lo abre un owner.
 */
export function ProfitabilitySettingsSheet({
  slug,
  settings,
  open,
  onOpenChange,
}: {
  slug: string;
  settings: ProfitabilitySettings;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("profitability.settings");
  return (
    <SettingsSheet open={open} onOpenChange={onOpenChange} title={t("title")} description={t("description")}>
      {open && <SettingsForm slug={slug} settings={settings} onDone={() => onOpenChange(false)} />}
    </SettingsSheet>
  );
}

function SettingsForm({ slug, settings, onDone }: { slug: string; settings: ProfitabilitySettings; onDone: () => void }) {
  const t = useTranslations("profitability.settings");
  const tCommon = useTranslations("common");
  const message = useProfitabilityValidationMessage();
  const form = useForm<ProfitabilitySettingsFormInput>({
    resolver: zodResolver(profitabilitySettingsFormSchema),
    defaultValues: {
      default_hourly_cost: hourlyToInput(settings.defaultHourlyCostCents),
      min_margin_percent: bpsToInput(settings.minMarginBps),
      min_hourly_rate: hourlyToInput(settings.minHourlyRateCents),
    },
    mode: "onTouched",
  });
  const { register, formState } = form;
  const { errors, isSubmitting } = formState;

  const submit = form.handleSubmit(async (values) => {
    const result = await saveProfitabilitySettings(slug, values);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(t("saved"));
    onDone();
  });

  return (
    <SheetForm
      onSubmit={submit}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onDone} disabled={isSubmitting}>
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
          id="profitability-default-cost"
          label={t("defaultCost")}
          description={t("defaultCostHint")}
          error={message(errors.default_hourly_cost?.message)}
        >
          <div className="w-40">
            <MoneyInput id="profitability-default-cost" {...register("default_hourly_cost")} aria-invalid={Boolean(errors.default_hourly_cost)} />
          </div>
        </FormField>
        <FormField
          id="profitability-min-margin"
          label={t("minMargin")}
          description={t("minMarginHint")}
          error={message(errors.min_margin_percent?.message)}
        >
          <div className="w-40">
            <PercentInput id="profitability-min-margin" {...register("min_margin_percent")} aria-invalid={Boolean(errors.min_margin_percent)} />
          </div>
        </FormField>
        <FormField id="profitability-min-rate" label={t("minRate")} description={t("minRateHint")} error={message(errors.min_hourly_rate?.message)}>
          <div className="w-40">
            <MoneyInput id="profitability-min-rate" {...register("min_hourly_rate")} aria-invalid={Boolean(errors.min_hourly_rate)} />
          </div>
        </FormField>
      </div>
    </SheetForm>
  );
}
