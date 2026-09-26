"use client";

import { Lock, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Controller, useFieldArray, useFormContext, useWatch } from "react-hook-form";
import {
  bpsToPercentInput,
  MILESTONE_PRESETS,
  type MilestoneFormInput,
  milestonesTotalBps,
  percentInputToBps,
} from "@/app/[org]/contracts/schema";
import { milestoneAmounts } from "@/app/[org]/contracts/summary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useContractFormat } from "./format";
import { PercentInput } from "./inputs";
import { useContractValidationMessage } from "./validation";

type MilestonesForm = { milestones: MilestoneFormInput[] };

const FULL = 10_000;

/**
 * Plan de hitos de lo puntual (50/50, 40/30/30…): etiqueta, porcentaje, fecha prevista y si
 * el cron lo prepara solo ese día. Enseña en vivo lo que suma y lo que factura cada hito.
 * Los ya facturados (`locked`) conservan su porcentaje y no se quitan.
 */
export function MilestoneFields({
  oneOffBases,
  locked = new Set(),
}: {
  /** Bases de las líneas puntuales, para el importe de cada hito. */
  oneOffBases: { id: string; baseCents: number }[];
  locked?: ReadonlySet<string>;
}) {
  const t = useTranslations("contracts.milestones");
  const message = useContractValidationMessage();
  const fmt = useContractFormat();
  const { control, register, formState } = useFormContext<MilestonesForm>();
  const { fields, append, remove, replace } = useFieldArray({ control, name: "milestones", keyName: "key" });
  const rows = useWatch({ control, name: "milestones" }) ?? [];
  const errors = formState.errors.milestones;
  const planError = message(errors?.root?.message ?? errors?.message);

  const total = milestonesTotalBps(rows);
  const percents = rows.map((r) => percentInputToBps(r.percent) ?? 0);
  const amounts =
    oneOffBases.length > 0 && percents.every((bps) => bps > 0)
      ? milestoneAmounts(
          oneOffBases,
          percents.map((percentBps, i) => ({ id: String(i), percentBps })),
        )
      : null;
  const hasLocked = rows.some((r) => r.id && locked.has(r.id));

  const applyPreset = (preset: keyof typeof MILESTONE_PRESETS) =>
    replace(
      MILESTONE_PRESETS[preset].map((m) => ({ id: "", label: t(`presetLabels.${m.label}`), percent: m.percent, planned_on: "", auto: false })),
    );

  return (
    <div className="space-y-2">
      <div className="hidden grid-cols-[minmax(0,1fr)_5.5rem_9rem_4.5rem_2rem] gap-2 px-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase sm:grid">
        <span>{t("label")}</span>
        <span className="text-right">{t("percent")}</span>
        <span>{t("plannedOn")}</span>
        <span>{t("auto")}</span>
        <span />
      </div>

      {fields.map((field, index) => {
        const row = rows[index];
        const isLocked = Boolean(row?.id && locked.has(row.id));
        const rowErrors = errors?.[index];
        return (
          <div key={field.key} className="rounded-xl border bg-muted/30 p-2">
            <div className="grid grid-cols-2 items-start gap-2 sm:grid-cols-[minmax(0,1fr)_5.5rem_9rem_4.5rem_2rem]">
              <div className="col-span-2 min-w-0 sm:col-span-1">
                <Input
                  aria-label={t("label")}
                  placeholder={t("labelPlaceholder")}
                  aria-invalid={Boolean(rowErrors?.label)}
                  {...register(`milestones.${index}.label`)}
                />
              </div>
              <PercentInput
                aria-label={t("percent")}
                aria-invalid={Boolean(rowErrors?.percent)}
                {...register(`milestones.${index}.percent`)}
                readOnly={isLocked}
                className={cn(isLocked && "opacity-60")}
              />
              <Input
                type="date"
                aria-label={t("plannedOn")}
                aria-invalid={Boolean(rowErrors?.planned_on)}
                {...register(`milestones.${index}.planned_on`)}
                readOnly={isLocked}
                className={cn(isLocked && "opacity-60")}
              />
              <Controller
                control={control}
                name={`milestones.${index}.auto`}
                render={({ field: auto }) => (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="flex h-8 items-center">
                        <Switch
                          aria-label={t("auto")}
                          checked={auto.value}
                          onCheckedChange={auto.onChange}
                          disabled={isLocked}
                        />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{t("autoHint")}</TooltipContent>
                  </Tooltip>
                )}
              />
              {isLocked ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="flex size-8 items-center justify-center text-muted-foreground">
                      <Lock className="size-3.5" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{t("lockedHint")}</TooltipContent>
                </Tooltip>
              ) : (
                <Button type="button" variant="ghost" size="icon-sm" aria-label={t("remove")} onClick={() => remove(index)}>
                  <Trash2 />
                </Button>
              )}
            </div>
            {(rowErrors?.label || rowErrors?.percent || rowErrors?.planned_on) && (
              <p className="mt-1.5 px-1 text-xs text-destructive">
                {message(rowErrors.label?.message ?? rowErrors.percent?.message ?? rowErrors.planned_on?.message)}
              </p>
            )}
            {amounts && (
              <p className="mt-1 px-1 text-right text-xs text-muted-foreground tabular">
                {t("amount", { amount: fmt.money(amounts[String(index)] ?? 0) })}
              </p>
            )}
          </div>
        );
      })}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          // El hito nuevo propone lo que falta para llegar al 100 %.
          onClick={() => append({ id: "", label: "", percent: total < FULL ? bpsToPercentInput(FULL - total) : "", planned_on: "", auto: false })}
        >
          <Plus data-icon="inline-start" />
          {t("add")}
        </Button>
        {!hasLocked && (
          <div className="flex items-center gap-1">
            <span className="px-1 text-xs text-muted-foreground">{t("presets")}</span>
            {(["full", "half", "thirds"] as const).map((preset) => (
              <Button key={preset} type="button" variant="ghost" size="xs" onClick={() => applyPreset(preset)}>
                {t(`preset.${preset}`)}
              </Button>
            ))}
          </div>
        )}
        <p
          className={cn(
            "ml-auto text-xs font-semibold tabular",
            rows.length > 0 && total === FULL ? "text-success" : "text-warning",
          )}
        >
          {rows.length === 0
            ? t("none")
            : total === FULL
              ? t("totalOk")
              : total < FULL
                ? t("totalMissing", { value: fmt.percent(FULL - total) })
                : t("totalOver", { value: fmt.percent(total - FULL) })}
        </p>
      </div>
      {planError && <p className="text-xs text-destructive">{planError}</p>}
    </div>
  );
}
