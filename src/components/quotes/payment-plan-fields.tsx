"use client";

import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Controller, type UseFieldArrayReturn, type UseFormReturn, useWatch } from "react-hook-form";
import { planTotalBps, type PlanItemInput, presetPlan, type QuoteFormInput, type QuoteFormValues } from "@/app/[org]/quotes/schema";
import { MAX_PLAN_ITEMS, PLAN_PRESETS, PLAN_WHEN, type MilestoneAmount, type PlanPreset } from "@/app/[org]/quotes/summary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useQuoteFormat, useQuoteValidationMessage } from "./format";
import type { AppLocale } from "./types";

type Props = {
  form: UseFormReturn<QuoteFormInput, unknown, QuoteFormValues>;
  fieldArray: UseFieldArrayReturn<QuoteFormInput, "plan", "key">;
  /** Idioma del presupuesto: el de las etiquetas de los planes habituales (salen en su PDF). */
  language: AppLocale;
  /** Lo que cobra cada pago con lo escrito ahora; null si el plan aún no suma el 100 %. */
  amounts: MilestoneAmount[] | null;
  disabled: boolean;
};

const PRESET_ORDER: PlanPreset[] = ["full", "half", "thirds"];

/**
 * Plan de pagos de lo puntual: planes habituales (100 %, 50/50, 40/30/30) o a medida, con lo que
 * cobra cada pago en vivo. «A la aceptación» se factura en el momento de aceptar; «en una fecha»,
 * el cron lo prepara ese día; «a la entrega», cuando un socio lo factura desde el contrato.
 */
export function PaymentPlanFields({ form, fieldArray, language, amounts, disabled }: Props) {
  const t = useTranslations("quotes.plan");
  const { money, percent } = useQuoteFormat();
  const message = useQuoteValidationMessage();
  const { control, register, formState } = form;
  const { fields, append, remove, replace } = fieldArray;
  const watched: PlanItemInput[] = useWatch({ control, name: "plan" }) ?? [];
  const total = planTotalBps(watched);
  const planErrors = formState.errors.plan;
  const planError = message(planErrors?.message ?? planErrors?.root?.message);

  return (
    <div className="space-y-3">
      {!disabled && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">{t("presets")}</span>
          {PRESET_ORDER.map((preset) => (
            <Button
              key={preset}
              type="button"
              variant="outline"
              size="xs"
              onClick={() => replace(presetPlan(preset, language))}
              title={PLAN_PRESETS[preset].map((item) => percent(item.percentBps)).join(" · ")}
            >
              {t(`preset.${preset}`)}
            </Button>
          ))}
        </div>
      )}

      {fields.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-5 text-center text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ol className="space-y-2">
          {fields.map((field, index) => {
            const errors = planErrors?.[index];
            const when = watched[index]?.when ?? field.when;
            const amount = amounts?.[index] ?? null;
            const errorText = [errors?.label, errors?.percent, errors?.planned_on]
              .map((e) => message(e?.message))
              .filter(Boolean)
              .join(" · ");
            return (
              <li key={field.key} className={cn("rounded-xl border bg-muted/20 p-3", errorText && "border-destructive/40")}>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    {...register(`plan.${index}.label`)}
                    aria-label={t("label")}
                    aria-invalid={Boolean(errors?.label)}
                    placeholder={t("labelPlaceholder")}
                    className="min-w-40 flex-1"
                  />
                  <Controller
                    control={control}
                    name={`plan.${index}.when`}
                    render={({ field: select }) => (
                      <Select
                        value={select.value}
                        onValueChange={(v) => select.onChange(PLAN_WHEN.find((w) => w === v) ?? select.value)}
                        disabled={disabled}
                      >
                        <SelectTrigger size="sm" className="w-40" aria-label={t("when")}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PLAN_WHEN.map((w) => (
                            <SelectItem key={w} value={w} disabled={w === "on_accept" && index > 0}>
                              {t(`whenOptions.${w}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  {when === "date" && (
                    <Input
                      type="date"
                      {...register(`plan.${index}.planned_on`)}
                      aria-label={t("plannedOn")}
                      aria-invalid={Boolean(errors?.planned_on)}
                      className="h-7 w-36 text-xs tabular"
                    />
                  )}
                  <InputGroup className="w-24">
                    <InputGroupInput
                      {...register(`plan.${index}.percent`)}
                      aria-label={t("percent")}
                      aria-invalid={Boolean(errors?.percent)}
                      inputMode="decimal"
                      autoComplete="off"
                      className="text-right tabular"
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupText>%</InputGroupText>
                    </InputGroupAddon>
                  </InputGroup>
                  <p className="w-36 text-right text-sm leading-tight tabular">
                    {amount ? (
                      <>
                        <span className="block font-semibold">{money(amount.baseCents)}</span>
                        <span className="block text-xs text-muted-foreground">{t("withVat", { amount: money(amount.totalCents) })}</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </p>
                  {!disabled && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label={t("remove")}
                          onClick={() => remove(index)}
                          className="hover:text-destructive"
                        >
                          <Trash2 />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t("remove")}</TooltipContent>
                    </Tooltip>
                  )}
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">{t(`whenHints.${when}`)}</p>
                {errorText && <p className="mt-1 text-xs text-destructive">{errorText}</p>}
              </li>
            );
          })}
        </ol>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {!disabled && fields.length < MAX_PLAN_ITEMS && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              append({ label: "", when: fields.length === 0 ? "on_accept" : "on_delivery", planned_on: "", percent: "" })
            }
          >
            <Plus data-icon="inline-start" />
            {t("add")}
          </Button>
        )}
        {fields.length > 0 && (
          <p className={cn("text-xs tabular", total === 10_000 ? "text-success" : "text-warning")}>
            {t("total", { total: percent(total) })}
          </p>
        )}
        {planError && <p className="text-xs text-destructive">{planError}</p>}
      </div>
    </div>
  );
}
