"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { GitBranchPlus, Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import { FormProvider, useForm } from "react-hook-form";
import { toast } from "sonner";
import { createLineVersion, saveContractLine } from "@/app/[org]/contracts/actions";
import {
  type BillingType,
  lineFormDefaults,
  type LineSheetInput,
  lineSheetSchema,
  lineVersionSheetSchema,
  newLineDefaults,
} from "@/app/[org]/contracts/schema";
import { FormField } from "@/components/settings/form-field";
import { SheetForm } from "@/components/settings/settings-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useContractFormat } from "./format";
import { ContractSheet } from "./inputs";
import { LineFields } from "./line-fields";
import type { ContractFormOptions, ContractLineView } from "./types";
import { useContractValidationMessage } from "./validation";

export type LineSheetMode = "create" | "edit" | "version";

type Props = {
  slug: string;
  contractId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: LineSheetMode;
  /** La línea que se edita o de la que sale la versión (null al crear). */
  line: ContractLineView | null;
  /** Tipo de la línea nueva. */
  createType: BillingType;
  options: ContractFormOptions;
  today: string;
  /** Pasar de editar a «Nueva versión desde…» sin cerrar el panel. */
  onModeChange: (mode: LineSheetMode) => void;
};

/** ¿Se puede sacar una versión nueva de la línea? Solo si ya tiene facturación y no es puntual. */
export function canCreateVersion(line: ContractLineView): boolean {
  return line.billingType !== "one_off" && line.billedItemsCount > 0 && line.status !== "ended";
}

/** Panel de una línea: alta, edición (con las condiciones congeladas si ya factura) o versión nueva. */
export function LineSheet({ open, onOpenChange, mode, line, ...props }: Props) {
  const t = useTranslations("contracts.lineSheet");
  const title = mode === "create" ? t("createTitle") : mode === "version" ? t("versionTitle") : t("editTitle");
  const description =
    mode === "version" ? t("versionDescription") : mode === "edit" && line ? line.description : t("createDescription");
  return (
    <ContractSheet open={open} onOpenChange={onOpenChange} title={title} description={description} wide>
      {(mode === "create" || line) && (
        <LineForm key={`${mode}:${line?.id ?? "new"}`} mode={mode} line={line} onDone={() => onOpenChange(false)} {...props} />
      )}
    </ContractSheet>
  );
}

function LineForm({
  slug,
  contractId,
  mode,
  line,
  createType,
  options,
  today,
  onModeChange,
  onDone,
}: Omit<Props, "open" | "onOpenChange"> & { onDone: () => void }) {
  const t = useTranslations("contracts.lineSheet");
  const tCommon = useTranslations("common");
  const message = useContractValidationMessage();
  const fmt = useContractFormat();
  const frozen = mode === "edit" && line !== null && line.billedItemsCount > 0;
  // Si la línea usa un IVA ya archivado, se sigue ofreciendo para que el selector no salga vacío.
  const vatRates =
    line && !options.vatRates.some((r) => r.id === line.taxRateId)
      ? [...options.vatRates, { id: line.taxRateId, name: line.taxRateName, rateBps: 0, isDefault: false }]
      : options.vatRates;

  // Los dos esquemas tienen la misma forma; la versión exige además la fecha.
  const schema = mode === "version" ? lineVersionSheetSchema : lineSheetSchema;
  const form = useForm<LineSheetInput>({
    resolver: zodResolver(schema as typeof lineSheetSchema),
    defaultValues: {
      from: mode === "version" && line ? line.defaultVersionFrom : "",
      lines: [
        line
          ? lineFormDefaults(line, options.billingDay)
          : newLineDefaults(createType, { vatRateId: options.defaultVatRateId, billingDay: options.billingDay, today }),
      ],
    },
    mode: "onTouched",
  });
  const { register, getValues, formState } = form;
  const { errors, isSubmitting } = formState;

  const submit = form.handleSubmit(async () => {
    const values = getValues();
    const input = values.lines[0]!;
    const result =
      mode === "version" && line
        ? await createLineVersion(slug, line.id, { from: values.from, line: input })
        : await saveContractLine(slug, contractId, mode === "edit" && line ? line.id : null, input);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(mode === "version" ? t("versionToast", { date: fmt.date(values.from) }) : mode === "edit" ? t("savedToast") : t("createdToast"));
    onDone();
  });

  return (
    <FormProvider {...form}>
      <SheetForm
        onSubmit={submit}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={onDone} disabled={isSubmitting}>
              {tCommon("cancel")}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? tCommon("saving") : mode === "version" ? t("createVersion") : mode === "edit" ? tCommon("save") : t("create")}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          {frozen && line && (
            <div className="rounded-xl border border-primary/25 bg-primary/5 p-3 text-sm">
              <p className="flex items-center gap-2 font-semibold">
                <Lock className="size-4 text-primary" />
                {t("frozenTitle")}
              </p>
              <p className="mt-1 text-muted-foreground">
                {line.billedUntil ? t("frozenBodyUntil", { date: fmt.date(line.billedUntil) }) : t("frozenBody")}
              </p>
              {canCreateVersion(line) && (
                <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => onModeChange("version")}>
                  <GitBranchPlus data-icon="inline-start" />
                  {t("newVersion")}
                </Button>
              )}
            </div>
          )}

          {mode === "version" && line && (
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                id="version-from"
                label={t("from")}
                error={message(errors.from?.message)}
                description={t("fromHint", {
                  until: line.billedUntil ? fmt.date(line.billedUntil) : t("nothingBilled"),
                })}
              >
                <Input id="version-from" type="date" min={line.defaultVersionFrom} autoFocus {...register("from")} />
              </FormField>
              <div className="self-end rounded-xl border bg-muted/40 p-3 text-xs text-muted-foreground">
                <p className="font-semibold text-foreground">{t("currentTerms")}</p>
                <p className="mt-1 tabular">
                  {fmt.quantity(line.quantity)} × {fmt.money(line.unitPriceCents)}
                  {line.discountBps > 0 && ` · −${fmt.percent(line.discountBps)}`} · {line.taxRateName}
                </p>
                <p className="mt-0.5 tabular">{t("currentBase", { amount: fmt.perCycle(line.baseCents, line.billingType) })}</p>
              </div>
            </div>
          )}

          <LineFields
            index={0}
            vatRates={vatRates}
            today={today}
            lockEconomics={frozen}
            lockType={mode !== "create" && (line?.billedItemsCount ?? 0) > 0}
            versionMode={mode === "version"}
            autoFocus={mode === "create"}
          />

          {mode === "version" && <p className="text-xs text-muted-foreground">{t("versionKeeps")}</p>}

          {mode === "edit" && line && line.pauses.length > 0 && (
            <section className="border-t pt-4">
              <h3 className="mb-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{t("pauses")}</h3>
              <ul className="space-y-1 text-sm">
                {line.pauses.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-baseline gap-x-2 tabular">
                    <span>{p.endsOn ? fmt.period(p.startsOn, p.endsOn) : t("pauseOpen", { date: fmt.date(p.startsOn) })}</span>
                    {p.reason && <span className="text-xs text-muted-foreground">{p.reason}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </SheetForm>
    </FormProvider>
  );
}
