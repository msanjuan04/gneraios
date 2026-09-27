"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Controller, FormProvider, useFieldArray, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { createContract } from "@/app/[org]/contracts/actions";
import {
  BILLING_TYPES,
  type BillingType,
  type ContractFormInput,
  contractFormSchema,
  type ContractFormValues,
  INVOICE_GROUPINGS,
  type LineFormInput,
  newLineDefaults,
  PAYMENT_METHODS,
} from "@/app/[org]/contracts/schema";
import { potentialMrrCents } from "@/app/[org]/contracts/summary";
import { CatalogPicker } from "@/components/catalog/catalog-picker";
import { ClientPicker } from "@/components/crm/client-picker";
import { FormField } from "@/components/settings/form-field";
import { SheetForm } from "@/components/settings/settings-sheet";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useContractFormat } from "./format";
import { ContractSheet, FormSection, SuffixInput } from "./inputs";
import { LineFields, previewLineBase } from "./line-fields";
import { MilestoneFields } from "./milestone-fields";
import type { ContractFormOptions } from "./types";
import { useContractValidationMessage } from "./validation";

type Props = {
  slug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: ContractFormOptions;
  /** Cliente ya elegido (desde su ficha: `?new=1&client=…`). */
  defaultClientId?: string;
  today: string;
  onCreated?: (id: string) => void;
};

/** «Nuevo contrato»: cliente, emisor, condiciones de cobro, líneas y, si hay algo puntual, sus hitos. */
export function ContractCreateSheet({ open, onOpenChange, ...props }: Props) {
  const t = useTranslations("contracts.form");
  return (
    <ContractSheet open={open} onOpenChange={onOpenChange} title={t("createTitle")} description={t("description")} wide>
      <CreateForm {...props} onDone={() => onOpenChange(false)} />
    </ContractSheet>
  );
}

function CreateForm({
  slug,
  options,
  defaultClientId,
  today,
  onCreated,
  onDone,
}: Omit<Props, "open" | "onOpenChange"> & { onDone: () => void }) {
  const t = useTranslations("contracts.form");
  const tType = useTranslations("billing.billingType");
  const tMethod = useTranslations("billing.paymentMethod");
  const tGrouping = useTranslations("billing.invoiceGrouping");
  const tMilestones = useTranslations("contracts.milestones");
  const tCommon = useTranslations("common");
  const message = useContractValidationMessage();
  const fmt = useContractFormat();

  const lineDefaults = (type: BillingType) =>
    newLineDefaults(type, { vatRateId: options.defaultVatRateId, billingDay: options.billingDay, today });
  const form = useForm<ContractFormInput, unknown, ContractFormValues>({
    resolver: zodResolver(contractFormSchema),
    defaultValues: {
      client_id: options.clients.some((c) => c.id === defaultClientId) ? (defaultClientId ?? "") : "",
      new_client_name: "",
      title: "",
      issuer_id: options.defaultIssuerId ?? "",
      signed_on: "",
      payment_terms_days: "",
      payment_method: "transfer",
      invoice_grouping: "client",
      lines: [lineDefaults("monthly")],
      milestones: [{ id: "", label: tMilestones("presetLabels.signature"), percent: "100", planned_on: "", auto: false }],
    },
    mode: "onTouched",
  });
  const { control, register, formState, getValues, setValue } = form;
  const { errors, isSubmitting } = formState;
  const { fields, append, remove, replace } = useFieldArray({ control, name: "lines", keyName: "key" });
  const pickedClientId = useWatch({ control, name: "client_id" });
  // Con useWatch: el selector se repinta con el cliente nuevo que se acaba de escribir.
  const newClientName = useWatch({ control, name: "new_client_name" }) ?? "";
  // Las descripciones del catálogo salen en el idioma de los documentos del cliente.
  const catalogLocale = options.clients.find((c) => c.id === pickedClientId)?.language ?? "es";
  /** Líneas del catálogo: sustituyen a la línea vacía de un contrato nuevo. */
  const onPickCatalog = (picked: LineFormInput[]) => {
    if (picked.length === 0) return;
    const current = getValues("lines");
    const onlyEmpty = current.length === 1 && current[0]!.description.trim() === "" && String(current[0]!.unit_price ?? "").trim() === "";
    if (onlyEmpty) replace(picked);
    else append(picked);
  };
  const lines = useWatch({ control, name: "lines" }) ?? [];
  const issuerId = useWatch({ control, name: "issuer_id" });
  const grouping = useWatch({ control, name: "invoice_grouping" });
  const issuer = options.issuers.find((i) => i.id === issuerId);

  // Vista previa: el MRR cuando todo esté activo y lo puntual, nunca sumados.
  const priced = lines.map((l) => ({ line: l, base: previewLineBase(l) }));
  const mrr = potentialMrrCents(
    priced.flatMap(({ line, base }) =>
      base === null ? [] : [{ billingType: line.billing_type, quantity: 1, unitPriceCents: base, discountBps: 0 }],
    ),
  );
  const oneOffBases = priced.flatMap(({ line, base }, index) =>
    line.billing_type === "one_off" && base !== null ? [{ id: String(index), baseCents: base }] : [],
  );
  const oneOff = oneOffBases.reduce((sum, l) => sum + l.baseCents, 0);
  const hasOneOff = lines.some((l) => l.billing_type === "one_off");
  const linesError = message(errors.lines?.root?.message ?? errors.lines?.message);

  const submit = form.handleSubmit(async () => {
    const result = await createContract(slug, getValues());
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(t("createdToast"));
    onDone();
    onCreated?.(result.id);
  });

  return (
    <FormProvider {...form}>
      <SheetForm
        onSubmit={submit}
        footer={
          <>
            <p className="mr-auto flex flex-wrap gap-x-3 text-xs text-muted-foreground tabular">
              <span>
                {t("previewMrr")} <span className="font-semibold text-foreground">{fmt.perCycle(mrr, "monthly")}</span>
              </span>
              <span>
                {t("previewOneOff")} <span className="font-semibold text-foreground">{fmt.money(oneOff)}</span>
              </span>
            </p>
            <Button type="button" variant="ghost" onClick={onDone} disabled={isSubmitting}>
              {tCommon("cancel")}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? tCommon("saving") : t("create")}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormSection>{t("sectionContract")}</FormSection>
          <FormField label={t("client")} error={message(errors.client_id?.message)} className="sm:col-span-2">
            <Controller
              control={control}
              name="client_id"
              render={({ field }) => (
                <ClientPicker
                  clients={options.clients}
                  clientId={field.value}
                  newClientName={newClientName}
                  invalid={Boolean(errors.client_id)}
                  onChange={({ clientId, newClientName }) => {
                    setValue("new_client_name", newClientName);
                    field.onChange(clientId);
                  }}
                />
              )}
            />
          </FormField>
          <FormField id="contract-title" label={t("title")} error={message(errors.title?.message)} className="sm:col-span-2">
            <Input
              id="contract-title"
              placeholder={t("titlePlaceholder")}
              autoFocus
              aria-invalid={Boolean(errors.title)}
              {...register("title")}
            />
          </FormField>
          <Controller
            control={control}
            name="issuer_id"
            render={({ field }) => (
              <FormField
                id="contract-issuer"
                label={t("issuer")}
                error={message(errors.issuer_id?.message)}
                description={issuer?.pendingConstitution ? t("issuerPending") : t("issuerHint")}
              >
                <Select value={field.value || undefined} onValueChange={field.onChange}>
                  <SelectTrigger id="contract-issuer" className="w-full" aria-invalid={Boolean(errors.issuer_id)}>
                    <SelectValue placeholder={t("issuerPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {options.issuers.map((i) => (
                      <SelectItem key={i.id} value={i.id}>
                        {i.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
          />
          <FormField
            id="contract-signed"
            label={t("signedOn")}
            optional
            error={message(errors.signed_on?.message)}
            description={t("signedOnHint")}
          >
            <Input id="contract-signed" type="date" max={today} aria-invalid={Boolean(errors.signed_on)} {...register("signed_on")} />
          </FormField>

          <FormSection>{t("sectionTerms")}</FormSection>
          <FormField
            id="contract-terms"
            label={t("paymentTerms")}
            optional
            error={message(errors.payment_terms_days?.message)}
            description={t("paymentTermsHint")}
          >
            <SuffixInput
              id="contract-terms"
              inputMode="numeric"
              suffix={t("days")}
              className="pr-12"
              placeholder={String(options.paymentTermsDays)}
              aria-invalid={Boolean(errors.payment_terms_days)}
              {...register("payment_terms_days")}
            />
          </FormField>
          <Controller
            control={control}
            name="payment_method"
            render={({ field }) => (
              <FormField id="contract-method" label={t("paymentMethod")}>
                <Select value={field.value} onValueChange={(v) => field.onChange(PAYMENT_METHODS.find((m) => m === v) ?? "transfer")}>
                  <SelectTrigger id="contract-method" className="w-full">
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
              <FormField id="contract-grouping" label={t("grouping")} description={t(`groupingHint.${grouping}`)} className="sm:col-span-2">
                <Select value={field.value} onValueChange={(v) => field.onChange(INVOICE_GROUPINGS.find((g) => g === v) ?? "client")}>
                  <SelectTrigger id="contract-grouping" className="w-full">
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

          <FormSection
            action={
              <div className="flex items-center gap-2">
              <CatalogPicker
                slug={slug}
                locale={catalogLocale}
                target="contract"
                today={today}
                billingDay={options.billingDay}
                onPick={onPickCatalog}
                variant="outline"
                size="sm"
                align="end"
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" size="sm">
                    <Plus data-icon="inline-start" />
                    {t("addLine")}
                    <ChevronDown data-icon="inline-end" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  {BILLING_TYPES.map((type) => (
                    <DropdownMenuItem key={type} onSelect={() => append(lineDefaults(type))}>
                      {tType(type)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              </div>
            }
          >
            {t("sectionLines")}
          </FormSection>
          {fields.map((field, index) => (
            <div key={field.key} className="rounded-2xl border bg-card p-3 sm:col-span-2">
              <LineFields
                index={index}
                vatRates={options.vatRates}
                today={today}
                onRemove={fields.length > 1 ? () => remove(index) : undefined}
              />
            </div>
          ))}
          {linesError && <p className="text-xs text-destructive sm:col-span-2">{linesError}</p>}

          {hasOneOff && (
            <>
              <FormSection>{t("sectionMilestones")}</FormSection>
              <div className="sm:col-span-2">
                <p className="mb-3 text-xs text-muted-foreground">{t("milestonesHint")}</p>
                <MilestoneFields oneOffBases={oneOffBases} />
              </div>
            </>
          )}
        </div>
      </SheetForm>
    </FormProvider>
  );
}
