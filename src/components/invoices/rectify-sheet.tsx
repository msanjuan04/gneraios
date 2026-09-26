"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Ban, Scale } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { rectifyInvoice } from "@/app/[org]/invoices/actions";
import { type RectifyFormInput, rectifyFormSchema } from "@/app/[org]/invoices/schema";
import { FormField } from "@/components/settings/form-field";
import { SettingsSheet, SheetForm } from "@/components/settings/settings-sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useInvoiceValidationMessage } from "./format";

/**
 * Rectificar una factura emitida: una factura nueva en la serie rectificativa del emisor.
 * Anular copia todas las líneas en negativo; por diferencias empieza vacía. Al crearla se abre
 * su borrador para revisarla y emitirla.
 */
export function RectifySheet({
  slug,
  basePath,
  invoiceId,
  number,
  /** Ya tiene rectificativas emitidas: la siguiente solo puede ir por diferencias. */
  alreadyRectified,
  open,
  onOpenChange,
}: {
  slug: string;
  basePath: string;
  invoiceId: string;
  number: string;
  alreadyRectified: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("invoices.rectify");
  return (
    <SettingsSheet open={open} onOpenChange={onOpenChange} title={t("title", { number })} description={t("description")}>
      <RectifyForm
        slug={slug}
        basePath={basePath}
        invoiceId={invoiceId}
        alreadyRectified={alreadyRectified}
        onDone={() => onOpenChange(false)}
      />
    </SettingsSheet>
  );
}

function RectifyForm({
  slug,
  basePath,
  invoiceId,
  alreadyRectified,
  onDone,
}: {
  slug: string;
  basePath: string;
  invoiceId: string;
  alreadyRectified: boolean;
  onDone: () => void;
}) {
  const t = useTranslations("invoices.rectify");
  const tCommon = useTranslations("common");
  const message = useInvoiceValidationMessage();
  const router = useRouter();
  const form = useForm<RectifyFormInput>({
    resolver: zodResolver(rectifyFormSchema),
    defaultValues: { mode: alreadyRectified ? "partial" : "full", reason: "" },
    mode: "onTouched",
  });
  const { control, register, getValues, formState } = form;
  const { errors, isSubmitting } = formState;

  const submit = form.handleSubmit(async () => {
    const result = await rectifyInvoice(slug, invoiceId, getValues());
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(t("createdToast"));
    onDone();
    router.push(`${basePath}/invoices/${result.id}`);
  });

  const options = [
    { mode: "full" as const, icon: Ban, disabled: alreadyRectified },
    { mode: "partial" as const, icon: Scale, disabled: false },
  ];

  return (
    <SheetForm
      onSubmit={submit}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onDone} disabled={isSubmitting}>
            {tCommon("cancel")}
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? t("submitting") : t("submit")}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Controller
          control={control}
          name="mode"
          render={({ field }) => (
            <div role="radiogroup" aria-label={t("modeLabel")} className="grid gap-2">
              {options.map(({ mode, icon: Icon, disabled }) => {
                const checked = field.value === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    disabled={disabled}
                    onClick={() => field.onChange(mode)}
                    className={cn(
                      "flex items-start gap-3 rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                      checked ? "border-primary bg-primary/10" : "bg-muted/30 hover:bg-muted/60",
                    )}
                  >
                    <Icon className={cn("mt-0.5 size-4 shrink-0", checked ? "text-primary" : "text-muted-foreground")} />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{t(`${mode}.title`)}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {disabled ? t("fullDisabled") : t(`${mode}.hint`)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        />
        <FormField id="rectify-reason" label={t("reason")} description={t("reasonHint")} error={message(errors.reason?.message)}>
          <Textarea
            id="rectify-reason"
            {...register("reason")}
            rows={3}
            placeholder={t("reasonPlaceholder")}
            aria-invalid={Boolean(errors.reason)}
            autoFocus
          />
        </FormField>
      </div>
    </SheetForm>
  );
}
