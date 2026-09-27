"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Repeat, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { deleteExpense, saveExpense } from "@/app/[org]/finance/actions";
import {
  bpsToInput,
  centsToInput,
  expenseAmountsFromInput,
  type ExpenseFormInput,
  expenseFormSchema,
  type ExpenseFormValues,
  PAYMENT_METHODS,
  percentToBps,
} from "@/app/[org]/finance/schema";
import { FormSection } from "@/components/contracts/inputs";
import { InlineConfirm } from "@/components/invoices/inline-confirm";
import { FormField, ToggleField } from "@/components/settings/form-field";
import { SettingsSheet, SheetForm } from "@/components/settings/settings-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { EXPENSE_GROUPS } from "@/domain/finance";
import { cn } from "@/lib/utils";
import { type AllocationLock, AllocationFields, type AllocationValue } from "./allocation-fields";
import { AttachmentField } from "./attachment-field";
import { useFinanceFormat, useFinanceValidationMessage } from "./format";
import { MoneyInput, RateField, VendorPicker } from "./inputs";
import type { CategoryOption, CostAllocation, ExpenseListItem, FinanceConfig } from "./types";

const NONE = "none";

/**
 * Valores con los que empieza un gasto nuevo abierto desde otra pantalla: la ficha de un
 * proveedor (`{ vendorId }`) o la de un cliente (`{ allocation: "client", clientId }`). Con un
 * gasto que ya existe no se usa.
 */
export type ExpenseSheetInitial = { vendorId?: string; allocation?: CostAllocation; clientId?: string };

type Props = {
  slug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Sin gasto, el panel crea uno nuevo. */
  expense: ExpenseListItem | null;
  config: FinanceConfig;
  canEdit: boolean;
  today: string;
  /** Solo al crear: proveedor y a quién sirve ya elegidos. */
  initial?: ExpenseSheetInitial;
  /**
   * Tras crear un gasto: su id (el panel sigue abierto para adjuntar el justificante). Sin él,
   * el panel se cierra al crear.
   */
  onCreated?: (id: string) => void;
};

/** Panel lateral de un gasto. El formulario se monta al abrir, siempre limpio. */
export function ExpenseSheet({ open, onOpenChange, ...props }: Props) {
  const t = useTranslations("finance.expenseSheet");
  return (
    <SettingsSheet
      open={open}
      onOpenChange={onOpenChange}
      title={props.expense ? (props.canEdit ? t("editTitle") : t("viewTitle")) : t("createTitle")}
      description={t("description")}
    >
      <ExpenseForm key={props.expense?.id ?? "new"} {...props} onDone={() => onOpenChange(false)} />
    </SettingsSheet>
  );
}

function defaults(expense: ExpenseListItem | null, config: FinanceConfig, today: string, initial?: ExpenseSheetInitial): ExpenseFormInput {
  if (!expense) {
    const vendor = initial?.vendorId ? config.vendors.find((v) => v.id === initial.vendorId) : undefined;
    const allocation = initial?.allocation ?? (initial?.clientId ? "client" : "company");
    return {
      issuer_id: config.defaultIssuerId ?? "",
      vendor_id: vendor?.id ?? "",
      new_vendor_name: "",
      // La categoría habitual del proveedor, como al elegirlo en el panel.
      category_id: vendor?.defaultCategoryId ?? "",
      description: "",
      vendor_invoice_number: "",
      issued_on: today,
      due_on: "",
      base: "",
      vat: bpsToInput(config.defaultVatBps),
      vat_deductible: true,
      irpf: "",
      paid: false,
      paid_on: today,
      payment_method: "transfer",
      member_id: "",
      notes: "",
      allocation,
      client_id: allocation === "client" ? (initial?.clientId ?? "") : "",
      rebill: false,
      rebill_markup: "",
    };
  }
  return {
    issuer_id: expense.issuerId,
    vendor_id: expense.vendorId ?? "",
    new_vendor_name: "",
    category_id: expense.categoryId,
    description: expense.description,
    vendor_invoice_number: expense.vendorInvoiceNumber ?? "",
    issued_on: expense.issuedOn,
    due_on: expense.dueOn ?? "",
    base: centsToInput(expense.baseCents),
    vat: bpsToInput(expense.vatBps),
    vat_deductible: expense.vatDeductible,
    irpf: expense.irpfBps ? bpsToInput(expense.irpfBps) : "",
    paid: expense.paidOn !== null,
    paid_on: expense.paidOn ?? today,
    payment_method: expense.paymentMethod ?? "transfer",
    member_id: expense.memberId ?? "",
    notes: expense.notes ?? "",
    allocation: expense.allocation,
    client_id: expense.clientId ?? "",
    rebill: expense.rebill,
    rebill_markup: expense.rebillMarkupBps ? bpsToInput(expense.rebillMarkupBps) : "",
  };
}

/** Ya repercutido (en un borrador o en una factura emitida): a quién sirve no se cambia. */
function rebillLock(expense: ExpenseListItem | null, slug: string): AllocationLock | null {
  if (!expense || (expense.rebillState !== "drafted" && expense.rebillState !== "invoiced")) return null;
  return {
    state: expense.rebillState,
    href: expense.rebillInvoiceId ? `/${slug}/invoices/${expense.rebillInvoiceId}` : null,
    number: expense.rebillInvoiceNumber,
  };
}

/** Categorías activas agrupadas por su grupo (más la del gasto, aunque esté archivada). */
function groupedCategories(categories: CategoryOption[], currentId: string) {
  const visible = categories.filter((c) => !c.archived || c.id === currentId);
  return EXPENSE_GROUPS.map((group) => ({ group, items: visible.filter((c) => c.expenseGroup === group) })).filter((g) => g.items.length > 0);
}

function ExpenseForm({
  slug,
  expense,
  config,
  canEdit,
  today,
  initial,
  onCreated,
  onDone,
}: Omit<Props, "open" | "onOpenChange"> & { onDone: () => void }) {
  const t = useTranslations("finance.expenseSheet");
  const tAllocation = useTranslations("finance.allocationField");
  const tGroup = useTranslations("finance.groups");
  const tMethod = useTranslations("finance.paymentMethods");
  const tCommon = useTranslations("common");
  const message = useFinanceValidationMessage();
  const { money, percent, dateMedium } = useFinanceFormat();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, startDelete] = useTransition();
  const form = useForm<ExpenseFormInput, unknown, ExpenseFormValues>({
    resolver: zodResolver(expenseFormSchema),
    defaultValues: defaults(expense, config, today, initial),
    mode: "onTouched",
  });
  const { control, register, getValues, setValue, formState } = form;
  const { errors, isSubmitting, dirtyFields } = formState;
  const [base, vat, irpf, paid, vatDeductible, newVendorName, allocation, clientId, rebill, rebillMarkup] = useWatch({
    control,
    name: ["base", "vat", "irpf", "paid", "vat_deductible", "new_vendor_name", "allocation", "client_id", "rebill", "rebill_markup"],
  });
  const amounts = expenseAmountsFromInput({ base: base ?? "", vat: vat ?? "", irpf: irpf ?? "" });
  const readOnly = !canEdit;
  const generated = expense?.source === "subscription";
  const lock = rebillLock(expense, slug);

  const assignment: AllocationValue = {
    allocation: allocation ?? "company",
    clientId: clientId ?? "",
    rebill: rebill ?? false,
    markup: rebillMarkup ?? "",
  };
  const changeAssignment = (patch: Partial<AllocationValue>) => {
    const opts = { shouldDirty: true, shouldValidate: true } as const;
    if (patch.allocation !== undefined) setValue("allocation", patch.allocation, opts);
    if (patch.clientId !== undefined) setValue("client_id", patch.clientId, opts);
    if (patch.rebill !== undefined) setValue("rebill", patch.rebill, opts);
    if (patch.markup !== undefined) setValue("rebill_markup", patch.markup, opts);
  };

  const submit = form.handleSubmit(async () => {
    const result = await saveExpense(slug, expense?.id ?? null, getValues());
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    if (expense) {
      toast.success(t("savedToast"));
      onDone();
    } else if (onCreated) {
      toast.success(t("createdToast"));
      onCreated(result.id);
    } else {
      toast.success(t("createdShortToast"));
      onDone();
    }
  });

  const remove = () =>
    startDelete(async () => {
      if (!expense) return;
      const result = await deleteExpense(slug, expense.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("deletedToast"));
      onDone();
    });

  type TextField = "description" | "vendor_invoice_number" | "notes";
  const field = (name: keyof ExpenseFormInput) => ({ id: `expense-${name}`, error: message(errors[name]?.message) });
  const input = (name: TextField | "issued_on" | "due_on" | "paid_on") => ({
    ...register(name),
    id: `expense-${name}`,
    "aria-invalid": Boolean(errors[name]),
    disabled: readOnly,
  });

  return (
    <SheetForm
      onSubmit={submit}
      footer={
        confirmDelete && expense ? (
          <InlineConfirm
            className="w-full"
            icon={<Trash2 className="text-destructive" />}
            confirmLabel={deleting ? t("deleting") : t("deleteConfirm")}
            onConfirm={remove}
            onCancel={() => setConfirmDelete(false)}
            pending={deleting}
            tone="destructive"
          >
            <p>{t("deleteBody")}</p>
          </InlineConfirm>
        ) : (
          <>
            {expense && canEdit && (
              <Button
                type="button"
                variant="ghost"
                className="mr-auto text-destructive hover:text-destructive"
                onClick={() => setConfirmDelete(true)}
                disabled={isSubmitting || expense.locked || lock !== null}
                title={lock ? t("rebilledDeleteHint") : expense.locked ? t("lockedHint") : undefined}
              >
                <Trash2 data-icon="inline-start" />
                {t("delete")}
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={onDone} disabled={isSubmitting}>
              {canEdit ? tCommon("cancel") : tCommon("close")}
            </Button>
            {canEdit && (
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? tCommon("saving") : expense ? tCommon("save") : t("create")}
              </Button>
            )}
          </>
        )
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {generated && expense && (
          <p className="flex items-start gap-2 rounded-xl border bg-muted/40 px-3 py-2 text-xs text-muted-foreground sm:col-span-2">
            <Repeat aria-hidden className="mt-px size-3.5 shrink-0" />
            <span>
              {t("generatedNote", { date: dateMedium(expense.periodStart ?? expense.issuedOn) })}
              {expense.locked && ` ${t("lockedHint")}`}
            </span>
          </p>
        )}

        <FormSection>{t("sectionInvoice")}</FormSection>
        <Controller
          control={control}
          name="vendor_id"
          render={({ field: vendor }) => (
            <FormField id="expense-vendor" label={t("vendor")} optional className="sm:col-span-2">
              <VendorPicker
                id="expense-vendor"
                vendors={config.vendors}
                vendorId={vendor.value}
                newVendorName={newVendorName ?? ""}
                disabled={readOnly}
                onChange={({ vendorId, newVendorName }) => {
                  vendor.onChange(vendorId);
                  setValue("new_vendor_name", newVendorName, { shouldDirty: true });
                  // La categoría habitual del proveedor, si aún no se ha elegido otra.
                  const picked = config.vendors.find((v) => v.id === vendorId);
                  if (picked?.defaultCategoryId && (!getValues("category_id") || !dirtyFields.category_id)) {
                    setValue("category_id", picked.defaultCategoryId, { shouldValidate: true });
                  }
                }}
              />
            </FormField>
          )}
        />
        <FormField label={t("concept")} className="sm:col-span-2" {...field("description")}>
          <Input {...input("description")} placeholder={t("conceptPlaceholder")} autoFocus={!expense} />
        </FormField>
        <FormField label={t("invoiceNumber")} optional {...field("vendor_invoice_number")}>
          <Input {...input("vendor_invoice_number")} className="font-mono" autoComplete="off" />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label={t("issuedOn")} {...field("issued_on")}>
            <Input type="date" {...input("issued_on")} />
          </FormField>
          <FormField label={t("dueOn")} optional {...field("due_on")}>
            <Input type="date" {...input("due_on")} />
          </FormField>
        </div>

        <FormSection>{t("sectionAmounts")}</FormSection>
        <FormField label={t("base")} description={t("baseHint")} {...field("base")}>
          <MoneyInput {...register("base")} id="expense-base" aria-invalid={Boolean(errors.base)} disabled={readOnly} />
        </FormField>
        <Controller
          control={control}
          name="vat"
          render={({ field: rate }) => (
            <FormField id="expense-vat" label={t("vat")} error={message(errors.vat?.message)}>
              <RateField
                id="expense-vat"
                rates={config.vatRates}
                value={rate.value}
                onChange={rate.onChange}
                onBlur={rate.onBlur}
                onPick={(value) => rate.onChange(value)}
                aria-invalid={Boolean(errors.vat)}
                disabled={readOnly}
              />
            </FormField>
          )}
        />
        <Controller
          control={control}
          name="irpf"
          render={({ field: rate }) => (
            <FormField id="expense-irpf" label={t("irpf")} optional description={t("irpfHint")} error={message(errors.irpf?.message)}>
              <RateField
                id="expense-irpf"
                rates={config.irpfRates}
                value={rate.value}
                onChange={rate.onChange}
                onBlur={rate.onBlur}
                onPick={(value) => rate.onChange(value)}
                aria-invalid={Boolean(errors.irpf)}
                disabled={readOnly}
              />
            </FormField>
          )}
        />
        <Controller
          control={control}
          name="vat_deductible"
          render={({ field: deductible }) => (
            <ToggleField
              id="expense-deductible"
              label={t("deductible")}
              description={t("deductibleHint")}
              checked={deductible.value}
              onCheckedChange={deductible.onChange}
              disabled={readOnly}
            />
          )}
        />

        <dl className="grid gap-1 rounded-xl border bg-card px-4 py-3 text-sm sm:col-span-2" aria-live="polite">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t("baseLabel")}</dt>
            <dd className="tabular">{amounts ? money(amounts.baseCents) : "—"}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">
              {t("vatLabel", { rate: amounts ? percent(percentToBps(vat ?? "")) : "—" })}
              {!vatDeductible && <span className="ml-1 text-xs text-warning">{t("notDeductible")}</span>}
            </dt>
            <dd className="tabular">{amounts ? money(amounts.vatCents) : "—"}</dd>
          </div>
          {amounts && amounts.irpfCents !== 0 && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{t("irpfLabel")}</dt>
              <dd className="tabular">−{money(amounts.irpfCents)}</dd>
            </div>
          )}
          <div className="mt-1 flex justify-between gap-3 border-t pt-2">
            <dt className="font-semibold">{t("totalLabel")}</dt>
            <dd className="text-base font-bold tabular">{amounts ? money(amounts.totalCents) : "—"}</dd>
          </div>
          {amounts && amounts.irpfCents !== 0 && <p className="text-xs text-muted-foreground">{t("irpfNote", { amount: money(amounts.irpfCents) })}</p>}
        </dl>

        <FormSection>{t("sectionClassification")}</FormSection>
        <Controller
          control={control}
          name="category_id"
          render={({ field: category }) => (
            <FormField id="expense-category" label={t("category")} error={message(errors.category_id?.message)}>
              <Select value={category.value || undefined} onValueChange={category.onChange} disabled={readOnly}>
                <SelectTrigger id="expense-category" className="w-full" aria-invalid={Boolean(errors.category_id)}>
                  <SelectValue placeholder={t("categoryPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {groupedCategories(config.categories, category.value).map(({ group, items }) => (
                    <SelectGroup key={group}>
                      <SelectLabel>{tGroup(group)}</SelectLabel>
                      {items.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          )}
        />
        <Controller
          control={control}
          name="issuer_id"
          render={({ field: issuer }) => (
            <FormField id="expense-issuer" label={t("issuer")} description={t("issuerHint")} error={message(errors.issuer_id?.message)}>
              <Select value={issuer.value || undefined} onValueChange={issuer.onChange} disabled={readOnly}>
                <SelectTrigger id="expense-issuer" className="w-full" aria-invalid={Boolean(errors.issuer_id)}>
                  <SelectValue placeholder={t("issuerPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {config.issuers
                    .filter((i) => !i.archived || i.id === issuer.value)
                    .map((i) => (
                      <SelectItem key={i.id} value={i.id}>
                        {i.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </FormField>
          )}
        />
        <Controller
          control={control}
          name="member_id"
          render={({ field: member }) => (
            <FormField id="expense-member" label={t("member")} optional description={t("memberHint")} className="sm:col-span-2">
              <Select value={member.value || NONE} onValueChange={(v) => member.onChange(v === NONE ? "" : v)} disabled={readOnly}>
                <SelectTrigger id="expense-member" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t("noMember")}</SelectItem>
                  {config.members.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      <span className="inline-flex size-5 items-center justify-center rounded-full bg-brand-gradient text-[9px] font-bold text-white">
                        {m.initials}
                      </span>
                      {m.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          )}
        />

        <FormSection>{tAllocation("section")}</FormSection>
        <AllocationFields
          idPrefix="expense"
          kind="expense"
          value={assignment}
          onChange={changeAssignment}
          errors={{
            clientId: message(errors.client_id?.message),
            rebill: message(errors.rebill?.message),
            markup: message(errors.rebill_markup?.message),
          }}
          clients={config.clients}
          baseCents={amounts?.baseCents ?? null}
          disabled={readOnly}
          lock={lock}
        />

        <FormSection>{t("sectionPayment")}</FormSection>
        <Controller
          control={control}
          name="paid"
          render={({ field: isPaid }) => (
            <ToggleField
              id="expense-paid"
              label={t("paid")}
              description={t("paidHint")}
              checked={isPaid.value}
              onCheckedChange={isPaid.onChange}
              disabled={readOnly}
              className="sm:col-span-2"
            />
          )}
        />
        <div className={cn("grid gap-3 sm:col-span-2 sm:grid-cols-2", !paid && "opacity-60")}>
          <FormField label={t("paidOn")} {...field("paid_on")}>
            <Input type="date" {...input("paid_on")} disabled={readOnly || !paid} />
          </FormField>
          <Controller
            control={control}
            name="payment_method"
            render={({ field: method }) => (
              <FormField id="expense-method" label={t("method")}>
                <Select value={method.value || "transfer"} onValueChange={method.onChange} disabled={readOnly}>
                  <SelectTrigger id="expense-method" className="w-full">
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
        </div>

        <FormField label={t("notes")} optional className="sm:col-span-2" {...field("notes")}>
          <Textarea {...register("notes")} id="expense-notes" rows={3} disabled={readOnly} />
        </FormField>

        {expense && (
          <div className="sm:col-span-2">
            <AttachmentField expenseId={expense.id} hasAttachment={expense.hasAttachment} canEdit={canEdit} />
          </div>
        )}
        {!expense && <p className="text-xs text-muted-foreground sm:col-span-2">{t("attachAfter")}</p>}
      </div>
    </SheetForm>
  );
}
