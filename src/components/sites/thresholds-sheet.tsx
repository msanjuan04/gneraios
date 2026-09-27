"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { type SiteThresholdsInput, siteThresholdsSchema } from "@/app/[org]/sites/schema";
import { SITE_THRESHOLD_LIMITS } from "@/app/[org]/settings/schema";
import { useShell } from "@/components/app-shell/shell-context";
import { FormField } from "@/components/settings/form-field";
import { SettingsSheet, SheetForm } from "@/components/settings/settings-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SiteThresholds } from "@/domain/sites";
import { saveSiteThresholds } from "@/server/sites/actions";
import { useSiteValidationMessage } from "./site-sheet";

type Props = { slug: string; open: boolean; onOpenChange: (open: boolean) => void; thresholds: SiteThresholds };

/** Umbrales de la org (orgs.settings.sites): cuándo avisar del SSL y del dominio, cuándo va lenta y cuántos fallos son una caída. */
export function ThresholdsSheet(props: Props) {
  const t = useTranslations("sites.thresholds");
  return (
    <SettingsSheet open={props.open} onOpenChange={props.onOpenChange} title={t("title")} description={t("description")}>
      {props.open && <ThresholdsForm {...props} />}
    </SettingsSheet>
  );
}

const FIELDS = [
  { name: "ssl_warn_days", unit: "days" },
  { name: "domain_warn_days", unit: "days" },
  { name: "slow_ms", unit: "ms" },
  { name: "down_after_failures", unit: "checks" },
] as const;

function ThresholdsForm({ slug, onOpenChange, thresholds }: Props) {
  const t = useTranslations("sites.thresholds");
  const tCommon = useTranslations("common");
  const message = useSiteValidationMessage();
  const { preview } = useShell();
  const [pending, startTransition] = useTransition();
  const form = useForm<SiteThresholdsInput>({
    resolver: zodResolver(siteThresholdsSchema),
    defaultValues: {
      ssl_warn_days: thresholds.sslWarnDays,
      domain_warn_days: thresholds.domainWarnDays,
      slow_ms: thresholds.slowMs,
      down_after_failures: thresholds.downAfterFailures,
    },
  });
  const { errors } = form.formState;

  const submit = form.handleSubmit((values) => {
    if (preview) {
      toast.info(t("previewOnly"));
      return;
    }
    startTransition(async () => {
      const result = await saveSiteThresholds(slug, values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("saved"));
      onOpenChange(false);
    });
  });

  return (
    <SheetForm
      onSubmit={submit}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {tCommon("cancel")}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? tCommon("saving") : tCommon("save")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map(({ name, unit }) => {
          const limits = SITE_THRESHOLD_LIMITS[name];
          return (
            <FormField
              key={name}
              id={`threshold-${name}`}
              label={t(`${name}.label`)}
              description={t(`${name}.hint`, { min: limits.min, max: limits.max })}
              error={errors[name] ? `${message(errors[name]?.message)} (${limits.min}–${limits.max})` : undefined}
            >
              <div className="relative">
                <Input
                  id={`threshold-${name}`}
                  type="number"
                  inputMode="numeric"
                  min={limits.min}
                  max={limits.max}
                  step={name === "slow_ms" ? 100 : 1}
                  className="pr-16 text-right tabular"
                  aria-invalid={Boolean(errors[name])}
                  {...form.register(name, { valueAsNumber: true })}
                />
                <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">{t(`units.${unit}`)}</span>
              </div>
            </FormField>
          );
        })}
      </div>
    </SheetForm>
  );
}
