"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { cancelLine, pauseLine, registerLineUsage } from "@/app/[org]/contracts/actions";
import {
  type CancelFormInput,
  cancelFormSchema,
  isCivilDate,
  parseQuantity,
  type PauseFormInput,
  pauseFormSchema,
  type UsageFormInput,
  usageFormSchema,
} from "@/app/[org]/contracts/schema";
import { lineBase } from "@/app/[org]/contracts/summary";
import { FormField } from "@/components/settings/form-field";
import { SheetForm } from "@/components/settings/settings-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useContractFormat } from "./format";
import { ContractSheet } from "./inputs";
import type { ContractLineView } from "./types";
import { useContractValidationMessage } from "./validation";

export type LineActionKind = "pause" | "cancel" | "usage";

type Props = {
  slug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: LineActionKind;
  line: ContractLineView | null;
  today: string;
  /** Sin firma no se registran usos (no se facturarían). */
  signed: boolean;
};

/** Pausar, dar de baja o registrar un uso: un panel pequeño con lo justo para cada cosa. */
export function LineActionSheet({ open, onOpenChange, kind, line, ...props }: Props) {
  const t = useTranslations("contracts.lineActions");
  return (
    <ContractSheet open={open} onOpenChange={onOpenChange} title={t(`${kind}.title`)} description={line?.description}>
      {line && kind === "pause" && <PauseForm line={line} onDone={() => onOpenChange(false)} {...props} />}
      {line && kind === "cancel" && <CancelForm line={line} onDone={() => onOpenChange(false)} {...props} />}
      {line && kind === "usage" && <UsageForm line={line} onDone={() => onOpenChange(false)} {...props} />}
    </ContractSheet>
  );
}

type FormProps = Omit<Props, "open" | "onOpenChange" | "kind" | "line"> & { line: ContractLineView; onDone: () => void };

function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warning" }) {
  return (
    <p
      className={
        tone === "warning"
          ? "flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3 text-xs"
          : "rounded-xl border bg-muted/40 p-3 text-xs text-muted-foreground"
      }
    >
      {tone === "warning" && <TriangleAlert className="mt-px size-3.5 shrink-0 text-warning" />}
      <span>{children}</span>
    </p>
  );
}

function Footer({ onDone, pending, disabled = false, label }: { onDone: () => void; pending: boolean; disabled?: boolean; label: string }) {
  const tCommon = useTranslations("common");
  return (
    <>
      <Button type="button" variant="ghost" onClick={onDone} disabled={pending}>
        {tCommon("cancel")}
      </Button>
      <Button type="submit" disabled={pending || disabled}>
        {pending ? tCommon("saving") : label}
      </Button>
    </>
  );
}

function PauseForm({ slug, line, today, onDone }: FormProps) {
  const t = useTranslations("contracts.lineActions.pause");
  const message = useContractValidationMessage();
  const fmt = useContractFormat();
  const form = useForm<PauseFormInput>({
    resolver: zodResolver(pauseFormSchema),
    defaultValues: { starts_on: today, ends_on: "", reason: "" },
    mode: "onTouched",
  });
  const { register, control, getValues, formState } = form;
  const { errors, isSubmitting } = formState;
  const startsOn = useWatch({ control, name: "starts_on" });
  const alreadyBilled = line.billedUntil !== null && isCivilDate(startsOn) && startsOn <= line.billedUntil;

  const submit = form.handleSubmit(async () => {
    const values = getValues();
    const result = await pauseLine(slug, line.id, values);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(values.ends_on ? t("toastUntil", { date: fmt.date(values.ends_on) }) : t("toast"));
    onDone();
  });

  return (
    <SheetForm onSubmit={submit} footer={<Footer onDone={onDone} pending={isSubmitting} label={t("submit")} />}>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="pause-start" label={t("startsOn")} error={message(errors.starts_on?.message)}>
          <Input id="pause-start" type="date" autoFocus {...register("starts_on")} />
        </FormField>
        <FormField id="pause-end" label={t("endsOn")} optional error={message(errors.ends_on?.message)} description={t("endsOnHint")}>
          <Input id="pause-end" type="date" {...register("ends_on")} />
        </FormField>
        <FormField id="pause-reason" label={t("reason")} optional className="sm:col-span-2">
          <Input id="pause-reason" placeholder={t("reasonPlaceholder")} {...register("reason")} />
        </FormField>
        <div className="space-y-2 sm:col-span-2">
          <Notice>{t("explain")}</Notice>
          {alreadyBilled && line.billedUntil && <Notice tone="warning">{t("billedWarning", { date: fmt.date(line.billedUntil) })}</Notice>}
        </div>
      </div>
    </SheetForm>
  );
}

function CancelForm({ slug, line, onDone }: FormProps) {
  const t = useTranslations("contracts.lineActions.cancel");
  const message = useContractValidationMessage();
  const fmt = useContractFormat();
  const recommended = line.recommendedEndOn;
  const form = useForm<CancelFormInput>({
    resolver: zodResolver(cancelFormSchema),
    defaultValues: { ends_on: (line.cancelledOn ? line.endsOn : null) ?? recommended ?? "", reason: line.cancelReason ?? "" },
    mode: "onTouched",
  });
  const { register, control, getValues, setValue, formState } = form;
  const { errors, isSubmitting } = formState;
  const endsOn = useWatch({ control, name: "ends_on" });
  const beforeBilled = line.billedUntil !== null && isCivilDate(endsOn) && endsOn < line.billedUntil;

  const submit = form.handleSubmit(async () => {
    const values = getValues();
    const result = await cancelLine(slug, line.id, values);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(t("toast", { date: fmt.date(values.ends_on) }));
    onDone();
  });

  return (
    <SheetForm onSubmit={submit} footer={<Footer onDone={onDone} pending={isSubmitting} label={t("submit")} />}>
      <div className="grid gap-4">
        <FormField
          id="cancel-end"
          label={t("endsOn")}
          error={message(errors.ends_on?.message)}
          description={
            recommended && endsOn !== recommended ? (
              <button
                type="button"
                className="font-semibold text-primary hover:underline"
                onClick={() => setValue("ends_on", recommended, { shouldValidate: true })}
              >
                {t("useRecommended", { date: fmt.date(recommended) })}
              </button>
            ) : recommended ? (
              t("isRecommended")
            ) : undefined
          }
        >
          <Input id="cancel-end" type="date" min={line.startsOn ?? undefined} className="sm:w-48" autoFocus {...register("ends_on")} />
        </FormField>
        <FormField id="cancel-reason" label={t("reason")} optional>
          <Textarea id="cancel-reason" rows={3} placeholder={t("reasonPlaceholder")} {...register("reason")} />
        </FormField>
        <Notice>{t("explain")}</Notice>
        {beforeBilled && line.billedUntil && <Notice tone="warning">{t("billedWarning", { date: fmt.date(line.billedUntil) })}</Notice>}
      </div>
    </SheetForm>
  );
}

function UsageForm({ slug, line, today, signed, onDone }: FormProps) {
  const t = useTranslations("contracts.lineActions.usage");
  const message = useContractValidationMessage();
  const fmt = useContractFormat();
  const form = useForm<UsageFormInput>({
    resolver: zodResolver(usageFormSchema),
    defaultValues: { quantity: "1", billable_on: today, description: "" },
    mode: "onTouched",
  });
  const { register, control, getValues, formState } = form;
  const { errors, isSubmitting } = formState;
  const quantity = useWatch({ control, name: "quantity" });
  const parsed = parseQuantity(quantity);
  const amount = parsed === null ? null : lineBase({ quantity: parsed, unitPriceCents: line.unitPriceCents, discountBps: line.discountBps });

  const submit = form.handleSubmit(async () => {
    const result = await registerLineUsage(slug, line.id, getValues());
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(t("toast", { amount: fmt.money(amount ?? 0) }));
    onDone();
  });

  return (
    <SheetForm onSubmit={submit} footer={<Footer onDone={onDone} pending={isSubmitting} disabled={!signed} label={t("submit")} />}>
      <div className="grid gap-4 sm:grid-cols-2">
        {!signed && (
          <div className="sm:col-span-2">
            <Notice tone="warning">{t("unsigned")}</Notice>
          </div>
        )}
        <FormField id="usage-quantity" label={t("quantity")} error={message(errors.quantity?.message)}>
          <Input id="usage-quantity" inputMode="decimal" className="text-right tabular" autoFocus {...register("quantity")} />
        </FormField>
        <FormField id="usage-date" label={t("date")} error={message(errors.billable_on?.message)}>
          <Input
            id="usage-date"
            type="date"
            max={today}
            min={line.startsOn ?? undefined}
            {...register("billable_on")}
          />
        </FormField>
        <FormField id="usage-description" label={t("description")} optional className="sm:col-span-2" description={t("descriptionHint")}>
          <Input id="usage-description" placeholder={line.description} {...register("description")} />
        </FormField>
        <div className="rounded-xl border bg-muted/40 p-3 sm:col-span-2">
          <p className="text-xs text-muted-foreground tabular">
            {t("unitPrice", { price: fmt.money(line.unitPriceCents) })}
            {line.discountBps > 0 && ` · −${fmt.percent(line.discountBps)}`}
          </p>
          <p className="mt-1 text-sm">
            {amount === null ? (
              <span className="text-muted-foreground">{t("amountPending")}</span>
            ) : (
              t.rich("amount", {
                amount: fmt.money(amount),
                strong: (chunks) => <span className="font-bold tabular">{chunks}</span>,
              })
            )}
          </p>
        </div>
      </div>
    </SheetForm>
  );
}
