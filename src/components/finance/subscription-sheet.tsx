"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { deleteSubscription, saveSubscription } from "@/app/[org]/finance/actions";
import {
  bpsToInput,
  centsToInput,
  expenseAmountsFromInput,
  PAYMENT_METHODS,
  SUBSCRIPTION_INTERVALS,
  type SubscriptionFormInput,
  subscriptionFormSchema,
  type SubscriptionFormValues,
} from "@/app/[org]/finance/schema";
import { FormSection } from "@/components/contracts/inputs";
import { InlineConfirm } from "@/components/invoices/inline-confirm";
import { FormField, ToggleField } from "@/components/settings/form-field";
import { SettingsSheet, SheetForm } from "@/components/settings/settings-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { EXPENSE_GROUPS, expenseCostCents } from "@/domain/finance";
import { divRoundHalfAwayFromZero } from "@/domain/money";
import { AllocationFields, type AllocationValue } from "./allocation-fields";
import { useFinanceFormat, useFinanceValidationMessage } from "./format";
import { MoneyInput, RateField, VendorPicker } from "./inputs";
import type { FinanceConfig, SubscriptionListItem } from "./types";

const NONE = "none";

type Props = {
  slug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscription: SubscriptionListItem | null;
  config: FinanceConfig;
  canEdit: boolean;
  today: string;
};

export function SubscriptionSheet({ open, onOpenChange, ...props }: Props) {
  const t = useTranslations("finance.subscriptionSheet");
  return (
    <SettingsSheet
      open={open}
      onOpenChange={onOpenChange}
      title={props.subscription ? (props.canEdit ? t("editTitle") : t("viewTitle")) : t("createTitle")}
      description={t("description")}
    >
      <SubscriptionForm key={props.subscription?.id ?? "new"} {...props} onDone={() => onOpenChange(false)} />
    </SettingsSheet>
  );
}

function defaults(sub: SubscriptionListItem | null, config: FinanceConfig, today: string): SubscriptionFormInput {
  if (!sub) {
    return {
      issuer_id: config.defaultIssuerId ?? "",
      vendor_id: "",
      new_vendor_name: "",
      category_id: config.categories.find((c) => !c.archived && c.isFixed && c.expenseGroup === "operating")?.id ?? "",
      member_id: "",
      description: "",
      base: "",
      vat: bpsToInput(config.defaultVatBps),
      vat_deductible: true,
      irpf: "",
      interval: "monthly",
      starts_on: today,
      ends_on: "",
      billing_day: String(Number(today.slice(8, 10))),
      payment_method: "card",
      is_active: true,
      notes: "",
      allocation: "company",
      client_id: "",
      rebill: false,
      rebill_markup: "",
    };
  }
  return {
    issuer_id: sub.issuerId,
    vendor_id: sub.vendorId ?? "",
    new_vendor_name: "",
    category_id: sub.categoryId,
    member_id: sub.memberId ?? "",
    description: sub.description,
    base: centsToInput(sub.baseCents),
    vat: bpsToInput(sub.vatBps),
    vat_deductible: sub.vatDeductible,
    irpf: sub.irpfBps ? bpsToInput(sub.irpfBps) : "",
    interval: sub.interval,
    starts_on: sub.startsOn,
    ends_on: sub.endsOn ?? "",
    billing_day: sub.billingDay ? String(sub.billingDay) : String(Number(sub.startsOn.slice(8, 10))),
    payment_method: sub.paymentMethod,
    is_active: sub.isActive,
    notes: sub.notes ?? "",
    allocation: sub.allocation,
    client_id: sub.clientId ?? "",
    rebill: sub.rebill,
    rebill_markup: sub.rebillMarkupBps ? bpsToInput(sub.rebillMarkupBps) : "",
  };
}

function SubscriptionForm({ slug, subscription, config, canEdit, today, onDone }: Omit<Props, "open" | "onOpenChange"> & { onDone: () => void }) {
  const t = useTranslations("finance.subscriptionSheet");
  const tAllocation = useTranslations("finance.allocationField");
  const tGroup = useTranslations("finance.groups");
  const tMethod = useTranslations("finance.paymentMethods");
  const tInterval = useTranslations("finance.intervals");
  const tCommon = useTranslations("common");
  const message = useFinanceValidationMessage();
  const { money } = useFinanceFormat();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, startDelete] = useTransition();
  const form = useForm<SubscriptionFormInput, unknown, SubscriptionFormValues>({
    resolver: zodResolver(subscriptionFormSchema),
    defaultValues: defaults(subscription, config, today),
    mode: "onTouched",
  });
  const { control, register, getValues, setValue, formState } = form;
  const { errors, isSubmitting } = formState;
  const [base, vat, irpf, interval, deductible, newVendorName, categoryId, allocation, clientId, rebill, rebillMarkup] = useWatch({
    control,
    name: [
      "base",
      "vat",
      "irpf",
      "interval",
      "vat_deductible",
      "new_vendor_name",
      "category_id",
      "allocation",
      "client_id",
      "rebill",
      "rebill_markup",
    ],
  });
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
  const amounts = expenseAmountsFromInput({ base: base ?? "", vat: vat ?? "", irpf: irpf ?? "" });
  const cost = amounts ? expenseCostCents({ baseCents: amounts.baseCents, vatCents: amounts.vatCents, vatDeductible: deductible }) : null;
  const monthly = cost === null ? null : interval === "yearly" ? Number(divRoundHalfAwayFromZero(BigInt(cost), BigInt(12))) : cost;
  const readOnly = !canEdit;
  const scheduleLocked = (subscription?.generatedCount ?? 0) > 0;

  const submit = form.handleSubmit(async () => {
    const result = await saveSubscription(slug, subscription?.id ?? null, getValues());
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(result.generated > 0 ? t("savedGenerated", { count: result.generated }) : subscription ? t("savedToast") : t("createdToast"));
    onDone();
  });

  const remove = () =>
    startDelete(async () => {
      if (!subscription) return;
      const result = await deleteSubscription(slug, subscription.id, subscription.generatedCount > 0);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("deletedToast", { count: result.deleted }));
      onDone();
    });

  const field = (name: keyof SubscriptionFormInput) => ({ id: `sub-${name}`, error: message(errors[name]?.message) });
  const input = (name: "description" | "starts_on" | "ends_on" | "billing_day" | "notes") => ({
    ...register(name),
    id: `sub-${name}`,
    "aria-invalid": Boolean(errors[name]),
    disabled: readOnly,
  });
  const visibleCategories = config.categories.filter((c) => !c.archived || c.id === categoryId);

  return (
    <SheetForm
      onSubmit={submit}
      footer={
        confirmDelete && subscription ? (
          <InlineConfirm
            className="w-full"
            tone="destructive"
            icon={<Trash2 className="text-destructive" />}
            confirmLabel={deleting ? t("deleting") : t("deleteConfirm")}
            onConfirm={remove}
            onCancel={() => setConfirmDelete(false)}
            pending={deleting}
          >
            <p>{subscription.generatedCount > 0 ? t("deleteWithExpenses", { count: subscription.generatedCount }) : t("deleteBody")}</p>
          </InlineConfirm>
        ) : (
          <>
            {subscription && canEdit && (
              <Button type="button" variant="ghost" className="mr-auto text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)} disabled={isSubmitting}>
                <Trash2 data-icon="inline-start" />
                {t("delete")}
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={onDone} disabled={isSubmitting}>
              {canEdit ? tCommon("cancel") : tCommon("close")}
            </Button>
            {canEdit && (
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? tCommon("saving") : subscription ? tCommon("save") : t("create")}
              </Button>
            )}
          </>
        )
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormSection>{t("sectionWhat")}</FormSection>
        <Controller
          control={control}
          name="vendor_id"
          render={({ field: vendor }) => (
            <FormField id="sub-vendor" label={t("vendor")} optional className="sm:col-span-2">
              <VendorPicker
                id="sub-vendor"
                vendors={config.vendors}
                vendorId={vendor.value}
                newVendorName={newVendorName ?? ""}
                disabled={readOnly}
                onChange={({ vendorId, newVendorName }) => {
                  vendor.onChange(vendorId);
                  setValue("new_vendor_name", newVendorName, { shouldDirty: true });
                  const picked = config.vendors.find((v) => v.id === vendorId);
                  if (picked?.defaultCategoryId) setValue("category_id", picked.defaultCategoryId, { shouldValidate: true });
                }}
              />
            </FormField>
          )}
        />
        <FormField label={t("concept")} className="sm:col-span-2" {...field("description")}>
          <Input {...input("description")} placeholder={t("conceptPlaceholder")} autoFocus={!subscription} />
        </FormField>
        <Controller
          control={control}
          name="category_id"
          render={({ field: category }) => (
            <FormField id="sub-category" label={t("category")} error={message(errors.category_id?.message)}>
              <Select value={category.value || undefined} onValueChange={category.onChange} disabled={readOnly}>
                <SelectTrigger id="sub-category" className="w-full" aria-invalid={Boolean(errors.category_id)}>
                  <SelectValue placeholder={t("categoryPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {EXPENSE_GROUPS.map((group) => {
                    const items = visibleCategories.filter((c) => c.expenseGroup === group);
                    return items.length === 0 ? null : (
                      <SelectGroup key={group}>
                        <SelectLabel>{tGroup(group)}</SelectLabel>
                        {items.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    );
                  })}
                </SelectContent>
              </Select>
            </FormField>
          )}
        />
        <Controller
          control={control}
          name="issuer_id"
          render={({ field: issuer }) => (
            <FormField id="sub-issuer" label={t("issuer")} error={message(errors.issuer_id?.message)}>
              <Select value={issuer.value || undefined} onValueChange={issuer.onChange} disabled={readOnly}>
                <SelectTrigger id="sub-issuer" className="w-full">
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
            <FormField id="sub-member" label={t("member")} optional description={t("memberHint")} className="sm:col-span-2">
              <Select value={member.value || NONE} onValueChange={(v) => member.onChange(v === NONE ? "" : v)} disabled={readOnly}>
                <SelectTrigger id="sub-member" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t("noMember")}</SelectItem>
                  {config.members.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          )}
        />

        <FormSection>{t("sectionAmounts")}</FormSection>
        <FormField label={t("base")} description={t("baseHint")} {...field("base")}>
          <MoneyInput {...register("base")} id="sub-base" aria-invalid={Boolean(errors.base)} disabled={readOnly} />
        </FormField>
        <Controller
          control={control}
          name="vat"
          render={({ field: rate }) => (
            <FormField id="sub-vat" label={t("vat")} error={message(errors.vat?.message)}>
              <RateField id="sub-vat" rates={config.vatRates} value={rate.value} onChange={rate.onChange} onBlur={rate.onBlur} onPick={rate.onChange} disabled={readOnly} />
            </FormField>
          )}
        />
        <Controller
          control={control}
          name="irpf"
          render={({ field: rate }) => (
            <FormField id="sub-irpf" label={t("irpf")} optional description={t("irpfHint")} error={message(errors.irpf?.message)}>
              <RateField id="sub-irpf" rates={config.irpfRates} value={rate.value} onChange={rate.onChange} onBlur={rate.onBlur} onPick={rate.onChange} disabled={readOnly} />
            </FormField>
          )}
        />
        <Controller
          control={control}
          name="vat_deductible"
          render={({ field: d }) => (
            <ToggleField id="sub-deductible" label={t("deductible")} checked={d.value} onCheckedChange={d.onChange} disabled={readOnly} />
          )}
        />
        <dl className="grid gap-1 rounded-xl border bg-card px-4 py-3 text-sm sm:col-span-2" aria-live="polite">
          <div className="flex justify-between gap-3">
            <dt className="font-semibold">{t("perCharge")}</dt>
            <dd className="font-bold tabular">{amounts ? money(amounts.totalCents) : "—"}</dd>
          </div>
          <div className="flex justify-between gap-3 text-muted-foreground">
            <dt>{t("breakdown", { vat: vat?.trim() ? `${vat} %` : "0 %" })}</dt>
            <dd className="tabular">
              {amounts ? `${money(amounts.baseCents)} + ${money(amounts.vatCents)}${amounts.irpfCents ? ` − ${money(amounts.irpfCents)}` : ""}` : "—"}
            </dd>
          </div>
          <div className="flex justify-between gap-3 text-muted-foreground">
            <dt>{t("monthlyCost")}</dt>
            <dd className="tabular">{monthly === null ? "—" : money(monthly)}</dd>
          </div>
        </dl>

        <FormSection>{tAllocation("section")}</FormSection>
        <AllocationFields
          idPrefix="sub"
          kind="subscription"
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
          showSubscriptionNote={scheduleLocked}
        />

        <FormSection>{t("sectionSchedule")}</FormSection>
        {scheduleLocked && (
          <p className="rounded-xl border bg-muted/40 px-3 py-2 text-xs text-muted-foreground sm:col-span-2">
            {t("scheduleLocked", { count: subscription?.generatedCount ?? 0 })}
          </p>
        )}
        <Controller
          control={control}
          name="interval"
          render={({ field: iv }) => (
            <FormField id="sub-interval" label={t("interval")}>
              <Select value={iv.value} onValueChange={(v) => iv.onChange(SUBSCRIPTION_INTERVALS.find((x) => x === v) ?? "monthly")} disabled={readOnly || scheduleLocked}>
                <SelectTrigger id="sub-interval" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUBSCRIPTION_INTERVALS.map((x) => (
                    <SelectItem key={x} value={x}>
                      {tInterval(x)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          )}
        />
        <FormField label={t("startsOn")} description={t("startsOnHint")} {...field("starts_on")}>
          <Input type="date" {...input("starts_on")} disabled={readOnly || scheduleLocked} />
        </FormField>
        {interval === "monthly" && (
          <FormField label={t("billingDay")} description={t("billingDayHint")} {...field("billing_day")}>
            <Input {...input("billing_day")} inputMode="numeric" className="w-24 tabular" disabled={readOnly || scheduleLocked} />
          </FormField>
        )}
        <FormField label={t("endsOn")} optional description={t("endsOnHint")} {...field("ends_on")}>
          <Input type="date" {...input("ends_on")} />
        </FormField>
        <Controller
          control={control}
          name="payment_method"
          render={({ field: method }) => (
            <FormField id="sub-method" label={t("method")} description={t("methodHint")}>
              <Select value={method.value} onValueChange={method.onChange} disabled={readOnly}>
                <SelectTrigger id="sub-method" className="w-full">
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
          name="is_active"
          render={({ field: active }) => (
            <ToggleField
              id="sub-active"
              label={t("active")}
              description={t("activeHint")}
              checked={active.value}
              onCheckedChange={active.onChange}
              disabled={readOnly}
              className="sm:col-span-2"
            />
          )}
        />
        <FormField label={t("notes")} optional className="sm:col-span-2" {...field("notes")}>
          <Textarea {...input("notes")} rows={2} />
        </FormField>
        <p className="text-xs text-muted-foreground sm:col-span-2">{t("generationNote")}</p>
      </div>
    </SheetForm>
  );
}
