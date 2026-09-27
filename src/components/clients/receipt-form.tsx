"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveClientReceipt } from "@/app/[org]/clients/receipt-actions";
import { type ClientReceiptInput, clientReceiptSchema, type PaymentMethod } from "@/app/[org]/clients/schema";
import { centsToInput, PAYMENT_METHODS } from "@/app/[org]/invoices/schema";
import { useInvoiceFormat } from "@/components/invoices/format";
import { FormField } from "@/components/settings/form-field";
import { SheetForm } from "@/components/settings/settings-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { parseMoneyInput } from "@/domain/money";
import { useClientValidationMessage } from "./validation";

const NO_PROJECT = "none";

export type ReceiptFormInitial = {
  id: string;
  on: string;
  amountCents: number;
  method: PaymentMethod;
  concept: string | null;
  reference: string | null;
  projectId: string | null;
  notes: string | null;
};

/**
 * Un cobro sin factura: lo que pagó el cliente, el día en que entró el dinero, un concepto y, si
 * es de un proyecto suyo, cuál. Crea uno nuevo o corrige `initial`.
 */
export function ReceiptForm({
  slug,
  clientId,
  projects,
  today,
  initial,
  defaultProjectId,
  onDone,
}: {
  slug: string;
  clientId: string;
  projects: { id: string; name: string }[];
  today: string;
  initial?: ReceiptFormInitial;
  /** Abierto desde un proyecto: ya viene elegido. */
  defaultProjectId?: string;
  onDone: () => void;
}) {
  const t = useTranslations("clients.collections.form");
  const tMethod = useTranslations("billing.paymentMethod");
  const tCommon = useTranslations("common");
  const { money } = useInvoiceFormat();
  const message = useClientValidationMessage();
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState<ClientReceiptInput>(() => ({
    amount: initial ? centsToInput(initial.amountCents) : "",
    received_on: initial?.on ?? today,
    method: initial?.method ?? "transfer",
    concept: initial?.concept ?? "",
    reference: initial?.reference ?? "",
    project_id: initial ? (initial.projectId ?? "") : projects.some((p) => p.id === defaultProjectId) ? defaultProjectId! : "",
    notes: initial?.notes ?? "",
  }));
  const [errors, setErrors] = useState<Partial<Record<keyof ClientReceiptInput, string>>>({});

  const set = <K extends keyof ClientReceiptInput>(key: K, value: ClientReceiptInput[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };
  const cents = parseMoneyInput(values.amount);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = clientReceiptSchema(today).safeParse(values);
    if (!parsed.success) {
      const next: Partial<Record<keyof ClientReceiptInput, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof ClientReceiptInput;
        if (!next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    startTransition(async () => {
      const result = await saveClientReceipt(slug, clientId, values, initial?.id ?? null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(initial ? t("updatedToast") : t("savedToast", { amount: money(parseMoneyInput(values.amount) ?? 0) }));
      onDone();
    });
  };

  return (
    <SheetForm
      onSubmit={submit}
      footer={
        <>
          <Button type="button" variant="ghost" size="sm" onClick={onDone} disabled={pending}>
            {tCommon("cancel")}
          </Button>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? tCommon("saving") : initial ? tCommon("save") : t("save")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          id="receipt-amount"
          label={t("amount")}
          error={message(errors.amount)}
          description={cents !== null && cents < 0 ? <span className="text-warning">{t("refund")}</span> : t("amountHint")}
        >
          <InputGroup>
            <InputGroupInput
              id="receipt-amount"
              value={values.amount}
              onChange={(e) => set("amount", e.target.value)}
              inputMode="decimal"
              autoComplete="off"
              autoFocus
              placeholder="0,00"
              aria-invalid={Boolean(errors.amount)}
              className="text-right tabular"
            />
            <InputGroupAddon align="inline-end">
              <InputGroupText>€</InputGroupText>
            </InputGroupAddon>
          </InputGroup>
        </FormField>
        <FormField id="receipt-date" label={t("receivedOn")} error={message(errors.received_on)} description={t("receivedOnHint")}>
          <Input
            id="receipt-date"
            type="date"
            max={today}
            value={values.received_on}
            onChange={(e) => set("received_on", e.target.value)}
            aria-invalid={Boolean(errors.received_on)}
            className="tabular"
          />
        </FormField>
        <FormField id="receipt-concept" label={t("concept")} error={message(errors.concept)} className="sm:col-span-2">
          <Input
            id="receipt-concept"
            value={values.concept}
            onChange={(e) => set("concept", e.target.value)}
            placeholder={t("conceptPlaceholder")}
            maxLength={300}
            aria-invalid={Boolean(errors.concept)}
          />
        </FormField>
        <FormField id="receipt-method" label={t("method")}>
          <Select value={values.method} onValueChange={(v) => set("method", PAYMENT_METHODS.find((m) => m === v) ?? "transfer")}>
            <SelectTrigger id="receipt-method" className="w-full">
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
        {projects.length > 0 ? (
          <FormField id="receipt-project" label={t("project")} optional>
            <Select value={values.project_id || NO_PROJECT} onValueChange={(v) => set("project_id", v === NO_PROJECT ? "" : v)}>
              <SelectTrigger id="receipt-project" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PROJECT}>{t("noProject")}</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        ) : (
          <div className="hidden sm:block" />
        )}
        <FormField id="receipt-reference" label={t("reference")} optional error={message(errors.reference)} className="sm:col-span-2">
          <Input
            id="receipt-reference"
            value={values.reference}
            onChange={(e) => set("reference", e.target.value)}
            placeholder={t("referencePlaceholder")}
            maxLength={200}
            autoComplete="off"
          />
        </FormField>
        <FormField id="receipt-notes" label={t("notes")} optional error={message(errors.notes)} className="sm:col-span-2">
          <Textarea id="receipt-notes" rows={3} value={values.notes} onChange={(e) => set("notes", e.target.value)} maxLength={2000} />
        </FormField>
      </div>
      <p className="mt-5 text-xs text-muted-foreground">{t("footnote")}</p>
    </SheetForm>
  );
}
