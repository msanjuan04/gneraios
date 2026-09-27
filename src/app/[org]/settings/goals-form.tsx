"use client";

import { Target } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FormField } from "@/components/settings/form-field";
import { SettingsCard } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type GoalsInput, saveGoals } from "./actions";

/** Objetivos de MRR y de facturación del año: el dashboard enseña cómo se va. */
export function GoalsForm({ slug, defaults, canEdit }: { slug: string; defaults: GoalsInput; canEdit: boolean }) {
  const t = useTranslations("settings.goals");
  const [values, setValues] = useState(defaults);
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();

  const set = <K extends keyof GoalsInput>(key: K, value: GoalsInput[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setDirty(true);
  };

  const save = () =>
    startTransition(async () => {
      const result = await saveGoals(slug, values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setDirty(false);
      toast.success(t("saved"));
    });

  const digits = (value: string) => value.replace(/\D/g, "").slice(0, 9);

  return (
    <SettingsCard
      title={
        <span className="inline-flex items-center gap-2">
          <Target className="size-4 text-primary" />
          {t("title")}
        </span>
      }
      description={t("description")}
      footer={
        canEdit ? (
          <Button size="sm" onClick={save} disabled={pending || !dirty}>
            {pending ? t("saving") : t("save")}
          </Button>
        ) : undefined
      }
    >
      <fieldset disabled={!canEdit} className="grid gap-4 md:grid-cols-2">
        <FormField id="goal-mrr" label={t("mrr")} optional description={t("mrrHint")}>
          <Input
            id="goal-mrr"
            inputMode="numeric"
            placeholder="5000"
            className="tabular"
            value={values.mrr_euros}
            onChange={(e) => set("mrr_euros", digits(e.target.value))}
          />
        </FormField>
        <FormField id="goal-mrr-by" label={t("mrrBy")} optional description={t("mrrByHint")}>
          <Input id="goal-mrr-by" type="date" value={values.mrr_by} onChange={(e) => set("mrr_by", e.target.value)} />
        </FormField>
        <FormField id="goal-revenue" label={t("revenue", { year: values.revenue_year })} optional description={t("revenueHint")}>
          <Input
            id="goal-revenue"
            inputMode="numeric"
            placeholder="60000"
            className="tabular"
            value={values.revenue_euros}
            onChange={(e) => set("revenue_euros", digits(e.target.value))}
          />
        </FormField>
        <FormField id="goal-year" label={t("year")}>
          <Input
            id="goal-year"
            type="number"
            min={2000}
            max={2100}
            className="tabular"
            value={values.revenue_year}
            onChange={(e) => set("revenue_year", Number(e.target.value) || defaults.revenue_year)}
          />
        </FormField>
      </fieldset>
    </SettingsCard>
  );
}
