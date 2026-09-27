"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Controller, FormProvider, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { CatalogSheet, Segmented } from "@/components/catalog/catalog-sheet";
import { useCatalogValidationMessage } from "@/components/catalog/format";
import { CatalogLinePreview } from "@/components/catalog/line-preview";
import { FormField, ToggleField } from "@/components/settings/form-field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  type BillingInterval,
  billingInterval,
  billingTypeOf,
  buildTranslations,
  CATALOG_CATEGORIES,
  CATALOG_LOCALES,
  type CatalogCategory,
  type CatalogItem,
  type CatalogLine,
  type CatalogLocale,
  type CatalogVatRate,
  lineDescription,
  localizedTexts,
  normalizeCatalogText,
  parseQuantityInput,
  PRICING_KINDS,
  pricingKind,
  resolveVatRateId,
  type TranslatedLocale,
} from "@/domain/catalog";
import { parseMoneyInput } from "@/domain/money";
import { saveCatalogItem } from "@/server/catalog/actions";
import { type CatalogItemFormInput, catalogItemFormSchema, type CatalogItemFormValues, itemFormDefaults } from "./schema";
import { TranslationFields } from "./translation-fields";

export type ItemSheetState = { item: CatalogItem | null; category?: CatalogCategory } | null;

/** Alta o edición de un servicio en el panel lateral, con la vista previa de su línea. */
export function ItemSheet({
  slug,
  state,
  onClose,
  vatRates,
  defaultVatRateId,
}: {
  slug: string;
  state: ItemSheetState;
  onClose: () => void;
  vatRates: CatalogVatRate[];
  defaultVatRateId: string | null;
}) {
  const t = useTranslations("catalog.item");
  const editing = state?.item ?? null;
  return (
    <CatalogSheet
      open={state !== null}
      onOpenChange={(open) => !open && onClose()}
      title={editing ? t("editTitle") : t("createTitle")}
      description={t("description")}
    >
      {state && (
        <ItemForm
          key={editing?.id ?? "new"}
          slug={slug}
          item={editing}
          category={state.category}
          vatRates={vatRates}
          defaultVatRateId={defaultVatRateId}
          onDone={onClose}
        />
      )}
    </CatalogSheet>
  );
}

/** La línea que saldría con lo escrito ahora, en un idioma (sin nombre, ninguna). */
function previewLines(values: CatalogItemFormInput, locale: CatalogLocale): CatalogLine[] {
  const name = normalizeCatalogText(values.name ?? "");
  if (!name) return [];
  const texts = {
    name,
    description: normalizeCatalogText(values.description ?? "") || null,
    translations: buildTranslations(values.translations ?? {}),
  };
  const price = parseMoneyInput(values.unit_price ?? "");
  return [
    {
      itemId: "preview",
      description: lineDescription(localizedTexts(texts, locale)),
      billingType: values.billing_type,
      quantity: parseQuantityInput(values.default_quantity ?? "") ?? "1",
      unitPriceCents: price !== null && price >= 0 ? price : 0,
      discountBps: 0,
      taxRateId: values.tax_rate_id,
      irpfApplies: values.irpf_applies,
    },
  ];
}

function ItemForm({
  slug,
  item,
  category,
  vatRates,
  defaultVatRateId,
  onDone,
}: {
  slug: string;
  item: CatalogItem | null;
  category?: CatalogCategory;
  vatRates: CatalogVatRate[];
  defaultVatRateId: string | null;
  onDone: () => void;
}) {
  const t = useTranslations("catalog.item");
  const tCatalog = useTranslations("catalog");
  const tCommon = useTranslations("common");
  const message = useCatalogValidationMessage();
  const form = useForm<CatalogItemFormInput, unknown, CatalogItemFormValues>({
    resolver: zodResolver(catalogItemFormSchema),
    // Un servicio con el IVA archivado propone el vigente (el que llevarán sus líneas).
    defaultValues: itemFormDefaults(item ? { ...item, taxRateId: resolveVatRateId(item.taxRateId, vatRates) } : null, {
      vatRateId: defaultVatRateId,
      category,
    }),
    mode: "onTouched",
  });
  const { control, register, setValue, getValues, formState } = form;
  const { errors, isSubmitting } = formState;
  const values = useWatch({ control }) as CatalogItemFormInput;
  const billingType = values.billing_type;
  const kind = pricingKind(billingType);
  const [interval, setRecurringInterval] = useState<BillingInterval>(billingInterval(billingType) ?? "monthly");
  const [translationLocale, setTranslationLocale] = useState<TranslatedLocale>("ca");
  const [previewLocale, setPreviewLocale] = useState<CatalogLocale>("es");
  const activeRates = vatRates.filter((rate) => !rate.archived);
  // El IVA que tenía, si se archivó: el formulario ya propone el vigente.
  const replacedRate = item ? vatRates.find((rate) => rate.id === item.taxRateId && rate.archived) : undefined;

  const submit = form.handleSubmit(async () => {
    const result = await saveCatalogItem(slug, item?.id ?? null, getValues());
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(item ? tCatalog("toasts.saved") : tCatalog("toasts.created", { name: normalizeCatalogText(getValues("name")) }));
    onDone();
  });

  const translated = {
    ca: Boolean(values.translations?.ca?.name?.trim() || values.translations?.ca?.description?.trim()),
    en: Boolean(values.translations?.en?.name?.trim() || values.translations?.en?.description?.trim()),
  };

  return (
    <FormProvider {...form}>
      <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
          <section className="grid gap-4 sm:grid-cols-3">
            <FormField id="item-name" label={t("name")} error={message(errors.name?.message)} className="sm:col-span-2">
              <Input id="item-name" autoFocus={!item} placeholder={t("namePlaceholder")} aria-invalid={Boolean(errors.name)} {...register("name")} />
            </FormField>
            <Controller
              control={control}
              name="category"
              render={({ field }) => (
                <FormField id="item-category" label={t("category")}>
                  <Select value={field.value} onValueChange={(v) => field.onChange(CATALOG_CATEGORIES.find((c) => c === v) ?? field.value)}>
                    <SelectTrigger id="item-category" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATALOG_CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {tCatalog(`categories.${c}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
              )}
            />
            <FormField
              id="item-description"
              label={t("descriptionLabel")}
              optional
              description={t("descriptionHint")}
              error={message(errors.description?.message)}
              className="sm:col-span-3"
            >
              <Textarea
                id="item-description"
                rows={2}
                placeholder={t("descriptionPlaceholder")}
                aria-invalid={Boolean(errors.description)}
                {...register("description")}
              />
            </FormField>
          </section>

          <section className="space-y-4 border-t pt-5">
            <h3 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{t("sections.price")}</h3>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Segmented
                label={t("kind")}
                value={kind}
                onChange={(next) => setValue("billing_type", billingTypeOf(next, interval), { shouldDirty: true })}
                options={PRICING_KINDS.map((k) => ({ value: k, label: tCatalog(`pricingKinds.${k}`) }))}
              />
              {kind === "recurring" && (
                <Segmented
                  label={t("interval")}
                  value={interval}
                  size="sm"
                  onChange={(next) => {
                    setRecurringInterval(next);
                    setValue("billing_type", next, { shouldDirty: true });
                  }}
                  options={(["monthly", "yearly"] as const).map((i) => ({ value: i, label: tCatalog(`intervals.${i}`) }))}
                />
              )}
              <p className="text-xs text-muted-foreground">{t(`kindHints.${kind}`)}</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <FormField
                id="item-price"
                label={t("unitPrice")}
                description={t(`unitPriceHints.${billingType}`)}
                error={message(errors.unit_price?.message)}
              >
                <InputGroup>
                  <InputGroupInput
                    id="item-price"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0,00"
                    className="text-right tabular"
                    aria-invalid={Boolean(errors.unit_price)}
                    {...register("unit_price")}
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupText>€</InputGroupText>
                  </InputGroupAddon>
                </InputGroup>
              </FormField>
              {kind !== "recurring" && (
                <FormField id="item-unit" label={t("unitLabel")} optional description={t("unitLabelHint")} error={message(errors.unit_label?.message)}>
                  <Input id="item-unit" placeholder={t("unitLabelPlaceholder")} aria-invalid={Boolean(errors.unit_label)} {...register("unit_label")} />
                </FormField>
              )}
              <FormField
                id="item-quantity"
                label={t("quantity")}
                description={t("quantityHint")}
                error={message(errors.default_quantity?.message)}
              >
                <Input
                  id="item-quantity"
                  inputMode="decimal"
                  autoComplete="off"
                  className="text-right tabular"
                  aria-invalid={Boolean(errors.default_quantity)}
                  {...register("default_quantity")}
                />
              </FormField>
              <Controller
                control={control}
                name="tax_rate_id"
                render={({ field }) => (
                  <FormField
                    id="item-vat"
                    label={t("vat")}
                    description={replacedRate ? t("vatReplaced", { name: replacedRate.name }) : undefined}
                    error={message(errors.tax_rate_id?.message)}
                  >
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="item-vat" className="w-full" aria-invalid={Boolean(errors.tax_rate_id)}>
                        <SelectValue placeholder={t("vatPlaceholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        {activeRates.map((rate) => (
                          <SelectItem key={rate.id} value={rate.id}>
                            {rate.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                )}
              />
              <Controller
                control={control}
                name="irpf_applies"
                render={({ field }) => (
                  <ToggleField
                    id="item-irpf"
                    control="checkbox"
                    label={t("irpf")}
                    description={t("irpfHint")}
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    className="sm:col-span-2"
                  />
                )}
              />
            </div>
          </section>

          <section className="space-y-3 border-t pt-5">
            <h3 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{t("sections.translations")}</h3>
            <TranslationFields
              locale={translationLocale}
              onLocaleChange={(next) => {
                setTranslationLocale(next);
                setPreviewLocale(next);
              }}
              fallback={{ name: values.name ?? "", description: values.description ?? "" }}
              translated={translated}
            />
          </section>

          <section className="space-y-3 border-t pt-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{t("sections.preview")}</h3>
                <p className="mt-1 text-xs text-muted-foreground">{t("previewHint")}</p>
              </div>
              <Segmented
                label={t("previewLanguage")}
                size="sm"
                value={previewLocale}
                onChange={setPreviewLocale}
                options={CATALOG_LOCALES.map((l) => ({ value: l, label: l.toUpperCase() }))}
              />
            </div>
            <CatalogLinePreview lines={previewLines(values, previewLocale)} vatRates={vatRates} locale={previewLocale} empty={t("previewEmpty")} />
          </section>
        </div>
        <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
          <Button type="button" variant="ghost" onClick={onDone} disabled={isSubmitting}>
            {tCommon("cancel")}
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? tCommon("saving") : item ? tCommon("save") : t("create")}
          </Button>
        </div>
      </form>
    </FormProvider>
  );
}
