"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowDown, ArrowUp, CircleAlert, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { FormProvider, useFieldArray, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { CatalogSheet, Segmented } from "@/components/catalog/catalog-sheet";
import { useCatalogFormat, useCatalogValidationMessage } from "@/components/catalog/format";
import { CatalogLinePreview } from "@/components/catalog/line-preview";
import { FormField } from "@/components/settings/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  bundleLines,
  buildTranslations,
  CATALOG_BILLING_TYPES,
  CATALOG_CATEGORIES,
  CATALOG_LIMITS,
  CATALOG_LOCALES,
  type CatalogBundle,
  type CatalogItem,
  type CatalogLocale,
  catalogTotals,
  type CatalogVatRate,
  normalizeCatalogText,
  parseDiscountInput,
  parseQuantityInput,
  quantityToInput,
  type TranslatedLocale,
} from "@/domain/catalog";
import { cn } from "@/lib/utils";
import { saveCatalogBundle } from "@/server/catalog/actions";
import { bundleFormDefaults, type CatalogBundleFormInput, catalogBundleFormSchema, type CatalogBundleFormValues } from "./schema";
import { TranslationFields } from "./translation-fields";

export type BundleSheetState = { bundle: CatalogBundle | null } | null;

/** Alta o edición de un pack: sus servicios, su descuento y la vista previa de sus líneas. */
export function BundleSheet({
  slug,
  state,
  onClose,
  items,
  vatRates,
}: {
  slug: string;
  state: BundleSheetState;
  onClose: () => void;
  /** Todo el catálogo (los archivados, para enseñar los que ya estaban en el pack). */
  items: CatalogItem[];
  vatRates: CatalogVatRate[];
}) {
  const t = useTranslations("catalog.bundle");
  const editing = state?.bundle ?? null;
  return (
    <CatalogSheet
      open={state !== null}
      onOpenChange={(open) => !open && onClose()}
      title={editing ? t("editTitle") : t("createTitle")}
      description={t("description")}
    >
      {state && <BundleForm key={editing?.id ?? "new"} slug={slug} bundle={editing} items={items} vatRates={vatRates} onDone={onClose} />}
    </CatalogSheet>
  );
}

/** El pack tal y como está escrito ahora (lo que no se entiende, sin descuento o con la cantidad del servicio). */
function draftBundle(values: CatalogBundleFormInput): CatalogBundle {
  return {
    id: "preview",
    name: normalizeCatalogText(values.name ?? ""),
    description: normalizeCatalogText(values.description ?? "") || null,
    translations: buildTranslations(values.translations ?? {}),
    discountBps: parseDiscountInput(values.discount ?? "") ?? 0,
    isActive: true,
    position: 0,
    items: (values.items ?? []).map((entry) => ({ itemId: entry.item_id, quantity: parseQuantityInput(entry.quantity ?? "") })),
  };
}

function BundleForm({
  slug,
  bundle,
  items,
  vatRates,
  onDone,
}: {
  slug: string;
  bundle: CatalogBundle | null;
  items: CatalogItem[];
  vatRates: CatalogVatRate[];
  onDone: () => void;
}) {
  const t = useTranslations("catalog.bundle");
  const tCatalog = useTranslations("catalog");
  const tType = useTranslations("billing.billingType");
  const tCommon = useTranslations("common");
  const message = useCatalogValidationMessage();
  const fmt = useCatalogFormat();
  const form = useForm<CatalogBundleFormInput, unknown, CatalogBundleFormValues>({
    resolver: zodResolver(catalogBundleFormSchema),
    defaultValues: bundleFormDefaults(bundle),
    mode: "onTouched",
  });
  const { control, register, getValues, formState } = form;
  const { errors, isSubmitting } = formState;
  const entries = useFieldArray({ control, name: "items", keyName: "key" });
  const values = useWatch({ control }) as CatalogBundleFormInput;
  const [translationLocale, setTranslationLocale] = useState<TranslatedLocale>("ca");
  const [previewLocale, setPreviewLocale] = useState<CatalogLocale>("es");
  const [adding, setAdding] = useState(false);

  const byId = new Map(items.map((item) => [item.id, item]));
  const chosen = new Set((values.items ?? []).map((entry) => entry.item_id));
  const candidates = items.filter((item) => item.isActive && !chosen.has(item.id));
  const draft = draftBundle(values);
  const preview = bundleLines(draft, items, previewLocale, { vatRates });
  const totals = catalogTotals(bundleLines(draft, items, "es", { vatRates }).lines, vatRates);
  const itemsError = message(errors.items?.message ?? errors.items?.root?.message);

  const submit = form.handleSubmit(async () => {
    const result = await saveCatalogBundle(slug, bundle?.id ?? null, getValues());
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(bundle ? tCatalog("toasts.bundleSaved") : tCatalog("toasts.bundleCreated", { name: normalizeCatalogText(getValues("name")) }));
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
            <FormField id="bundle-name" label={t("name")} error={message(errors.name?.message)} className="sm:col-span-2">
              <Input id="bundle-name" autoFocus={!bundle} placeholder={t("namePlaceholder")} aria-invalid={Boolean(errors.name)} {...register("name")} />
            </FormField>
            <FormField id="bundle-discount" label={t("discount")} description={t("discountHint")} error={message(errors.discount?.message)}>
              <InputGroup>
                <InputGroupInput
                  id="bundle-discount"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0"
                  className="text-right tabular"
                  aria-invalid={Boolean(errors.discount)}
                  {...register("discount")}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupText>%</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
            </FormField>
            <FormField
              id="bundle-description"
              label={t("descriptionLabel")}
              optional
              description={t("descriptionHint")}
              error={message(errors.description?.message)}
              className="sm:col-span-3"
            >
              <Textarea id="bundle-description" rows={2} placeholder={t("descriptionPlaceholder")} {...register("description")} />
            </FormField>
          </section>

          <section className="space-y-3 border-t pt-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{t("items")}</h3>
              <Popover open={adding} onOpenChange={setAdding}>
                <PopoverTrigger asChild>
                  <Button type="button" variant="outline" size="sm" disabled={entries.fields.length >= CATALOG_LIMITS.bundleItems}>
                    <Plus data-icon="inline-start" />
                    {t("addItem")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-0" align="end">
                  <Command className="glass">
                    <CommandInput placeholder={t("searchItems")} />
                    <CommandList>
                      <CommandEmpty>{t("noItems")}</CommandEmpty>
                      {CATALOG_CATEGORIES.map((category) => {
                        const ofCategory = candidates.filter((item) => item.category === category);
                        if (ofCategory.length === 0) return null;
                        return (
                          <CommandGroup key={category} heading={tCatalog(`categories.${category}`)}>
                            {ofCategory.map((item) => (
                              <CommandItem
                                key={item.id}
                                value={`${item.name} ${item.id}`}
                                onSelect={() => {
                                  entries.append({ item_id: item.id, quantity: "" });
                                  setAdding(false);
                                }}
                              >
                                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                                <span className="shrink-0 text-xs text-muted-foreground tabular">
                                  {fmt.price(item.unitPriceCents, item.billingType, item.unitLabel)}
                                </span>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        );
                      })}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {entries.fields.length === 0 ? (
              <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{t("emptyItems")}</p>
            ) : (
              <ol className="divide-y rounded-xl border">
                {entries.fields.map((field, index) => {
                  const item = byId.get(field.item_id);
                  const error = errors.items?.[index]?.quantity;
                  return (
                    <li key={field.key} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
                      <span className="w-4 shrink-0 text-xs text-muted-foreground tabular">{index + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className={cn("block truncate font-medium", !item?.isActive && "text-muted-foreground line-through")}>
                          {item?.name ?? t("missingItem")}
                        </span>
                        <span className="block text-xs text-muted-foreground tabular">
                          {item ? `${tType(item.billingType)} · ${fmt.price(item.unitPriceCents, item.billingType, item.unitLabel)}` : null}
                        </span>
                      </span>
                      {item && !item.isActive && (
                        <Badge variant="outline" className="text-warning">
                          <CircleAlert data-icon="inline-start" />
                          {t("archivedItem")}
                        </Badge>
                      )}
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">{t("quantity")}</span>
                        <Input
                          aria-label={t("quantity")}
                          aria-invalid={Boolean(error)}
                          title={message(error?.message)}
                          inputMode="decimal"
                          autoComplete="off"
                          placeholder={item ? quantityToInput(item.defaultQuantity) : "1"}
                          className="h-7 w-16 text-right text-xs tabular"
                          {...register(`items.${index}.quantity`)}
                        />
                      </div>
                      <div className="flex items-center gap-0.5">
                        <IconAction label={t("moveUp")} disabled={index === 0} onClick={() => entries.move(index, index - 1)}>
                          <ArrowUp />
                        </IconAction>
                        <IconAction label={t("moveDown")} disabled={index === entries.fields.length - 1} onClick={() => entries.move(index, index + 1)}>
                          <ArrowDown />
                        </IconAction>
                        <IconAction label={t("remove")} onClick={() => entries.remove(index)} destructive>
                          <Trash2 />
                        </IconAction>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
            {itemsError && <p className="text-xs text-destructive">{itemsError}</p>}

            {Object.keys(totals).length > 0 && (
              <dl className="flex flex-wrap gap-x-6 gap-y-2 rounded-xl border bg-muted/30 px-3 py-2.5 text-sm">
                {CATALOG_BILLING_TYPES.flatMap((type) => {
                  const sum = totals[type];
                  if (!sum) return [];
                  return [
                    <div key={type}>
                      <dt className="text-xs text-muted-foreground">{tType(type)}</dt>
                      <dd className="font-semibold tabular">
                        {fmt.perCycle(sum.baseCents, type)}
                        {sum.discountCents > 0 && (
                          <span className="ml-1.5 text-xs font-normal text-success">
                            {t("savings", { amount: fmt.perCycle(sum.discountCents, type) })}
                          </span>
                        )}
                      </dd>
                    </div>,
                  ];
                })}
                <p className="basis-full text-xs text-muted-foreground">{t("totalsHint")}</p>
              </dl>
            )}
          </section>

          <section className="space-y-3 border-t pt-5">
            <h3 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{tCatalog("item.sections.translations")}</h3>
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
                <h3 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{tCatalog("item.sections.preview")}</h3>
                <p className="mt-1 text-xs text-muted-foreground">{t("previewHint")}</p>
              </div>
              <Segmented
                label={tCatalog("item.previewLanguage")}
                size="sm"
                value={previewLocale}
                onChange={setPreviewLocale}
                options={CATALOG_LOCALES.map((l) => ({ value: l, label: l.toUpperCase() }))}
              />
            </div>
            <CatalogLinePreview lines={preview.lines} vatRates={vatRates} locale={previewLocale} totals empty={t("previewEmpty")} />
            {preview.skipped.length > 0 && (
              <p className="flex items-center gap-1.5 text-xs text-warning">
                <CircleAlert className="size-3.5" />
                {tCatalog("bundles.skipped", { count: preview.skipped.length })}
              </p>
            )}
          </section>
        </div>
        <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
          <Button type="button" variant="ghost" onClick={onDone} disabled={isSubmitting}>
            {tCommon("cancel")}
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? tCommon("saving") : bundle ? tCommon("save") : t("create")}
          </Button>
        </div>
      </form>
    </FormProvider>
  );
}

function IconAction({
  label,
  onClick,
  disabled = false,
  destructive = false,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className={destructive ? "hover:text-destructive" : undefined}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
