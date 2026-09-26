"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Banknote, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { addPayment, deletePayment } from "@/app/[org]/invoices/actions";
import { centsToInput, PAYMENT_METHODS, type PaymentFormInput, paymentFormSchema } from "@/app/[org]/invoices/schema";
import { FormField } from "@/components/settings/form-field";
import { SettingsCard } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { parseMoneyInput } from "@/domain/money";
import { cn } from "@/lib/utils";
import { useInvoiceFormat, useInvoiceValidationMessage } from "./format";
import { InlineConfirm } from "./inline-confirm";
import type { PaymentItem, PaymentMethod } from "./types";

type Props = {
  slug: string;
  invoiceId: string;
  payments: PaymentItem[];
  /** Neto a cobrar (total + rectificativas), cobrado y pendiente, con IVA. */
  netTotalCents: number;
  paidCents: number;
  outstandingCents: number;
  defaultMethod: PaymentMethod;
  today: string;
  canEdit: boolean;
  /** El formulario de cobro abierto (también desde la cabecera de la factura). */
  formOpen: boolean;
  onFormOpenChange: (open: boolean) => void;
};

/** Cobros de una factura emitida: la única fuente de «cobrada», de la fecha y del método. */
export function PaymentsCard({
  slug,
  invoiceId,
  payments,
  netTotalCents,
  paidCents,
  outstandingCents,
  defaultMethod,
  today,
  canEdit,
  formOpen,
  onFormOpenChange,
}: Props) {
  const t = useTranslations("invoices.payments");
  const tMethod = useTranslations("billing.paymentMethod");
  const { money, date } = useInvoiceFormat();
  const [deleting, setDeleting] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const confirmDelete = (payment: PaymentItem) =>
    startTransition(async () => {
      const result = await deletePayment(slug, invoiceId, payment.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("deletedToast", { amount: money(payment.amountCents) }));
      setDeleting(null);
    });

  return (
    <SettingsCard
      title={t("title")}
      description={t("summary", { paid: money(paidCents), total: money(netTotalCents), outstanding: money(outstandingCents) })}
      actions={
        canEdit && !formOpen ? (
          <Button variant="outline" size="sm" onClick={() => onFormOpenChange(true)}>
            <Plus data-icon="inline-start" />
            {t("add")}
          </Button>
        ) : undefined
      }
      bodyClassName={payments.length > 0 || formOpen ? "p-0" : undefined}
    >
      {formOpen && canEdit && (
        <PaymentForm
          slug={slug}
          invoiceId={invoiceId}
          outstandingCents={outstandingCents}
          defaultMethod={defaultMethod}
          today={today}
          onDone={() => onFormOpenChange(false)}
        />
      )}
      {payments.length === 0 ? (
        !formOpen && (
          <div className="text-center">
            <Banknote className="mx-auto size-5 text-muted-foreground" />
            <p className="mt-2 text-muted-foreground">{t("empty")}</p>
          </div>
        )
      ) : (
        <ul className="divide-y">
          {payments.map((payment) => (
            <li key={payment.id} className="group px-5 py-2.5">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold tabular">
                    <span className={cn(payment.amountCents < 0 && "text-destructive")}>{money(payment.amountCents)}</span>
                    {payment.amountCents < 0 && <span className="ml-2 text-xs font-normal text-muted-foreground">{t("refund")}</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    <span className="tabular">{date(payment.paidOn)}</span> · {tMethod(payment.method)}
                    {payment.reference && <> · {payment.reference}</>}
                  </p>
                </div>
                {canEdit && deleting !== payment.id && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={t("delete")}
                        onClick={() => setDeleting(payment.id)}
                        className="opacity-100 transition-opacity hover:text-destructive md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100"
                      >
                        <Trash2 />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("delete")}</TooltipContent>
                  </Tooltip>
                )}
              </div>
              {deleting === payment.id && (
                <InlineConfirm
                  tone="destructive"
                  className="mt-2"
                  confirmLabel={t("deleteConfirmAction")}
                  onConfirm={() => confirmDelete(payment)}
                  onCancel={() => setDeleting(null)}
                  pending={pending}
                >
                  {t("deleteConfirm", { amount: money(payment.amountCents) })}
                </InlineConfirm>
              )}
            </li>
          ))}
        </ul>
      )}
    </SettingsCard>
  );
}

function PaymentForm({
  slug,
  invoiceId,
  outstandingCents,
  defaultMethod,
  today,
  onDone,
}: {
  slug: string;
  invoiceId: string;
  outstandingCents: number;
  defaultMethod: PaymentMethod;
  today: string;
  onDone: () => void;
}) {
  const t = useTranslations("invoices.payments");
  const tMethod = useTranslations("billing.paymentMethod");
  const tCommon = useTranslations("common");
  const { money } = useInvoiceFormat();
  const message = useInvoiceValidationMessage();
  const schema = useMemo(() => paymentFormSchema(today), [today]);
  const form = useForm<PaymentFormInput>({
    resolver: zodResolver(schema),
    defaultValues: {
      amount: outstandingCents > 0 ? centsToInput(outstandingCents) : "",
      paid_on: today,
      method: defaultMethod,
      reference: "",
    },
    mode: "onTouched",
  });
  const { control, register, getValues, formState } = form;
  const { errors, isSubmitting } = formState;
  const amount = parseMoneyInput(useWatch({ control, name: "amount" }) ?? "");
  const overpaid = amount !== null && amount > 0 && amount > outstandingCents;

  const submit = form.handleSubmit(async () => {
    const result = await addPayment(slug, invoiceId, getValues());
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(t("savedToast"));
    onDone();
  });

  return (
    <form onSubmit={submit} noValidate className="border-b bg-muted/20 px-5 py-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField
          id="payment-amount"
          label={t("amount")}
          description={overpaid ? <span className="text-warning">{t("overpaid", { amount: money(outstandingCents) })}</span> : t("amountHint")}
          error={message(errors.amount?.message)}
        >
          <InputGroup>
            <InputGroupInput
              id="payment-amount"
              {...register("amount")}
              inputMode="decimal"
              autoComplete="off"
              autoFocus
              aria-invalid={Boolean(errors.amount)}
              className="text-right tabular"
            />
            <InputGroupAddon align="inline-end">
              <InputGroupText>€</InputGroupText>
            </InputGroupAddon>
          </InputGroup>
        </FormField>
        <FormField id="payment-date" label={t("paidOn")} error={message(errors.paid_on?.message)}>
          <Input id="payment-date" type="date" max={today} {...register("paid_on")} aria-invalid={Boolean(errors.paid_on)} className="tabular" />
        </FormField>
        <Controller
          control={control}
          name="method"
          render={({ field }) => (
            <FormField id="payment-method" label={t("method")}>
              <Select value={field.value} onValueChange={(v) => field.onChange(PAYMENT_METHODS.find((m) => m === v) ?? "transfer")}>
                <SelectTrigger id="payment-method" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {tMethod(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          )}
        />
        <FormField id="payment-reference" label={t("reference")} optional error={message(errors.reference?.message)}>
          <Input id="payment-reference" {...register("reference")} placeholder={t("referencePlaceholder")} autoComplete="off" />
        </FormField>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone} disabled={isSubmitting}>
          {tCommon("cancel")}
        </Button>
        <Button type="submit" size="sm" disabled={isSubmitting}>
          {isSubmitting ? tCommon("saving") : t("save")}
        </Button>
      </div>
    </form>
  );
}
