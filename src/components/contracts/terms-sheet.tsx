"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { changeContractIssuer, removeContractIssuer, updateContractTerms } from "@/app/[org]/contracts/actions";
import {
  INVOICE_GROUPINGS,
  type IssuerChangeInput,
  issuerChangeSchema,
  PAYMENT_METHODS,
  type TermsFormInput,
  termsFormSchema,
} from "@/app/[org]/contracts/schema";
import { FormField } from "@/components/settings/form-field";
import { SheetForm } from "@/components/settings/settings-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useContractFormat } from "./format";
import { ContractSheet, FormSection, SuffixInput } from "./inputs";
import type { ContractDetailData } from "./types";
import { useContractValidationMessage } from "./validation";

type SheetProps = {
  data: ContractDetailData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Condiciones del contrato: título, plazo y forma de pago, cómo se agrupan sus facturas y notas. */
export function TermsSheet({ data, open, onOpenChange }: SheetProps) {
  const t = useTranslations("contracts.terms");
  return (
    <ContractSheet open={open} onOpenChange={onOpenChange} title={t("title")} description={t("description")}>
      <TermsForm data={data} onDone={() => onOpenChange(false)} />
    </ContractSheet>
  );
}

function TermsForm({ data, onDone }: { data: ContractDetailData; onDone: () => void }) {
  const t = useTranslations("contracts.terms");
  const tForm = useTranslations("contracts.form");
  const tMethod = useTranslations("billing.paymentMethod");
  const tGrouping = useTranslations("billing.invoiceGrouping");
  const tCommon = useTranslations("common");
  const message = useContractValidationMessage();
  const { contract, paymentTerms } = data;
  const form = useForm<TermsFormInput>({
    resolver: zodResolver(termsFormSchema),
    defaultValues: {
      title: contract.title,
      signed_on: contract.signedOn ?? "",
      payment_terms_days: contract.paymentTermsDays === null ? "" : String(contract.paymentTermsDays),
      payment_method: contract.paymentMethod,
      invoice_grouping: contract.invoiceGrouping,
      notes: contract.notes ?? "",
    },
    mode: "onTouched",
  });
  const { control, register, getValues, formState } = form;
  const { errors, isSubmitting } = formState;
  const grouping = useWatch({ control, name: "invoice_grouping" });
  // Vacío: el plazo del cliente o, si no tiene, el de la org.
  const fallbackDays = paymentTerms.clientDays ?? data.options.paymentTermsDays;

  const submit = form.handleSubmit(async () => {
    const result = await updateContractTerms(data.slug, contract.id, getValues());
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(t("savedToast"));
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
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="terms-title" label={tForm("title")} error={message(errors.title?.message)} className="sm:col-span-2">
          <Input id="terms-title" autoFocus {...register("title")} />
        </FormField>
        {contract.signedOn && (
          <FormField
            id="terms-signed"
            label={tForm("signedOn")}
            optional
            error={message(errors.signed_on?.message)}
            description={t("signedOnHint")}
            className="sm:col-span-2"
          >
            <Input id="terms-signed" type="date" max={data.today} className="sm:w-48" {...register("signed_on")} />
          </FormField>
        )}
        <FormSection>{tForm("sectionTerms")}</FormSection>
        <FormField
          id="terms-days"
          label={tForm("paymentTerms")}
          optional
          error={message(errors.payment_terms_days?.message)}
          description={
            paymentTerms.clientDays !== null
              ? t("paymentTermsClient", { days: paymentTerms.clientDays })
              : t("paymentTermsOrg", { days: data.options.paymentTermsDays })
          }
        >
          <SuffixInput
            id="terms-days"
            inputMode="numeric"
            suffix={tForm("days")}
            className="pr-12"
            placeholder={String(fallbackDays)}
            {...register("payment_terms_days")}
          />
        </FormField>
        <Controller
          control={control}
          name="payment_method"
          render={({ field }) => (
            <FormField id="terms-method" label={tForm("paymentMethod")}>
              <Select value={field.value} onValueChange={(v) => field.onChange(PAYMENT_METHODS.find((m) => m === v) ?? "transfer")}>
                <SelectTrigger id="terms-method" className="w-full">
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
        <Controller
          control={control}
          name="invoice_grouping"
          render={({ field }) => (
            <FormField id="terms-grouping" label={tForm("grouping")} description={tForm(`groupingHint.${grouping}`)} className="sm:col-span-2">
              <Select value={field.value} onValueChange={(v) => field.onChange(INVOICE_GROUPINGS.find((g) => g === v) ?? "client")}>
                <SelectTrigger id="terms-grouping" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INVOICE_GROUPINGS.map((g) => (
                    <SelectItem key={g} value={g}>
                      {tGrouping(g)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          )}
        />
        <FormField id="terms-notes" label={t("notes")} optional className="sm:col-span-2">
          <Textarea id="terms-notes" rows={3} placeholder={t("notesPlaceholder")} {...register("notes")} />
        </FormField>
      </div>
    </SheetForm>
  );
}

/**
 * «Cambiar emisor desde…»: qué emisor factura el contrato a partir de una fecha, con el
 * historial. Cada periodo lo factura el emisor vigente en su fecha de inicio.
 */
export function IssuerSheet({ data, open, onOpenChange }: SheetProps) {
  const t = useTranslations("contracts.issuer");
  return (
    <ContractSheet open={open} onOpenChange={onOpenChange} title={t("title")} description={t("description")}>
      <IssuerForm data={data} onDone={() => onOpenChange(false)} />
    </ContractSheet>
  );
}

function IssuerForm({ data, onDone }: { data: ContractDetailData; onDone: () => void }) {
  const t = useTranslations("contracts.issuer");
  const tCommon = useTranslations("common");
  const message = useContractValidationMessage();
  const fmt = useContractFormat();
  const [removing, startRemoving] = useTransition();
  const [removingId, setRemovingId] = useState<string | null>(null);
  const options = data.options.issuers.filter((i) => i.id !== data.issuer?.id);
  const form = useForm<IssuerChangeInput>({
    resolver: zodResolver(issuerChangeSchema),
    defaultValues: { issuer_id: options[0]?.id ?? "", valid_from: data.today },
    mode: "onTouched",
  });
  const { control, register, getValues, formState } = form;
  const { errors, isSubmitting } = formState;
  const issuerId = useWatch({ control, name: "issuer_id" });
  const selected = data.options.issuers.find((i) => i.id === issuerId);

  const submit = form.handleSubmit(async () => {
    const values = getValues();
    const result = await changeContractIssuer(data.slug, data.contract.id, values);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(t("savedToast", { name: selected?.name ?? "", date: fmt.date(values.valid_from) }));
    onDone();
  });

  const remove = (assignmentId: string) => {
    setRemovingId(assignmentId);
    startRemoving(async () => {
      const result = await removeContractIssuer(data.slug, data.contract.id, assignmentId);
      setRemovingId(null);
      if (!result.ok) toast.error(result.error);
      else toast.success(t("removedToast"));
    });
  };

  return (
    <SheetForm
      onSubmit={submit}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onDone} disabled={isSubmitting}>
            {tCommon("cancel")}
          </Button>
          <Button type="submit" disabled={isSubmitting || options.length === 0}>
            {isSubmitting ? tCommon("saving") : t("submit")}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <section>
          <h3 className="mb-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{t("history")}</h3>
          <ul className="divide-y rounded-xl border">
            {data.issuerHistory.map((row, index) => (
              <li key={row.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="w-28 shrink-0 text-xs text-muted-foreground tabular">
                  {index === 0 ? t("fromStart") : t("from", { date: fmt.date(row.validFrom) })}
                </span>
                <span className="min-w-0 flex-1 truncate font-semibold">{row.issuerName}</span>
                {row.current && <Badge className="bg-success/15 text-success">{t("current")}</Badge>}
                {row.scheduled && <Badge className="bg-primary/15 text-primary">{t("scheduled")}</Badge>}
                {row.scheduled && index > 0 && data.canEdit && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={t("remove")}
                        disabled={removing && removingId === row.id}
                        onClick={() => remove(row.id)}
                      >
                        <Trash2 />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("remove")}</TooltipContent>
                  </Tooltip>
                )}
              </li>
            ))}
          </ul>
        </section>

        {options.length === 0 ? (
          <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">{t("noOthers")}</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Controller
              control={control}
              name="issuer_id"
              render={({ field }) => (
                <FormField
                  id="issuer-change"
                  label={t("issuer")}
                  error={message(errors.issuer_id?.message)}
                  description={selected?.pendingConstitution ? t("pendingConstitution") : undefined}
                >
                  <Select value={field.value || undefined} onValueChange={field.onChange}>
                    <SelectTrigger id="issuer-change" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {options.map((i) => (
                        <SelectItem key={i.id} value={i.id}>
                          {i.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
              )}
            />
            <FormField id="issuer-from" label={t("validFrom")} error={message(errors.valid_from?.message)}>
              <Input id="issuer-from" type="date" {...register("valid_from")} />
            </FormField>
            <p className="rounded-xl border bg-muted/40 p-3 text-xs text-muted-foreground sm:col-span-2">{t("explain")}</p>
          </div>
        )}
      </div>
    </SheetForm>
  );
}
