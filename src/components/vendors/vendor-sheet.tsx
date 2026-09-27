"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { saveVendorProfile } from "@/app/[org]/finance/vendors/actions";
import { emptyVendorForm, type VendorFormInput, vendorFormSchema, type VendorFormValues } from "@/app/[org]/finance/vendors/schema";
import { FormSection } from "@/components/contracts/inputs";
import { FormField } from "@/components/settings/form-field";
import { SettingsSheet, SheetForm } from "@/components/settings/settings-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { VENDOR_KINDS } from "@/domain/vendors";
import { cn } from "@/lib/utils";
import type { VendorCategoryOption, VendorProfile } from "./types";
import { VENDOR_KIND_ICONS } from "./vendor-kind";

const NONE = "none";

/**
 * Traduce el mensaje de un error de Zod del formulario de proveedores: primero
 * `vendors.validation.*`, luego los comunes de `validation.*`.
 */
export function useVendorValidationMessage() {
  const t = useTranslations("vendors.validation");
  const tCommon = useTranslations("validation");
  return (message: string | undefined): string | undefined => {
    if (!message) return undefined;
    if (t.has(message)) return t(message);
    return tCommon.has(message) ? tCommon(message) : tCommon("invalid");
  };
}

type Props = {
  slug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** El proveedor a editar; sin él, se da de alta uno. */
  vendor?: VendorProfile | null;
  categories: VendorCategoryOption[];
  /** Tras guardar (el panel ya se ha cerrado). */
  onSaved?: (id: string, created: boolean, name: string) => void;
};

/** «Nuevo proveedor» y «Editar proveedor» en el mismo panel, con todos sus datos. */
export function VendorSheet(props: Props) {
  const t = useTranslations("vendors.sheet");
  return (
    <SettingsSheet
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.vendor ? t("editTitle") : t("createTitle")}
      description={t("description")}
    >
      {props.open && <VendorForm key={props.vendor?.id ?? "new"} {...props} />}
    </SettingsSheet>
  );
}

function toForm(vendor: VendorProfile): VendorFormInput {
  return {
    name: vendor.name,
    kind: vendor.kind,
    tax_id: vendor.taxId ?? "",
    country_code: vendor.countryCode,
    contact_name: vendor.contactName ?? "",
    email: vendor.email ?? "",
    phone: vendor.phone ?? "",
    iban: vendor.iban ?? "",
    website: vendor.website ?? "",
    default_category_id: vendor.defaultCategoryId ?? "",
    notes: vendor.notes ?? "",
  };
}

function VendorForm({ slug, onOpenChange, vendor, categories, onSaved }: Props) {
  const t = useTranslations("vendors.sheet");
  const tKind = useTranslations("vendors.kinds");
  const tCommon = useTranslations("common");
  const message = useVendorValidationMessage();
  const form = useForm<VendorFormInput, unknown, VendorFormValues>({
    resolver: zodResolver(vendorFormSchema),
    defaultValues: vendor ? toForm(vendor) : emptyVendorForm(),
    mode: "onTouched",
  });
  const { control, register, formState } = form;
  const { errors, isSubmitting } = formState;

  const submit = form.handleSubmit(async (values) => {
    const result = await saveVendorProfile(slug, vendor?.id ?? null, values);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    if (vendor) toast.success(t("savedToast"));
    onOpenChange(false);
    onSaved?.(result.id, !vendor, values.name);
  });

  type Field = Exclude<keyof VendorFormInput, "kind" | "default_category_id">;
  const field = (name: Field) => ({ id: `vendor-${name}`, error: message(errors[name]?.message) });
  const input = (name: Field) => ({ ...register(name), id: `vendor-${name}`, "aria-invalid": Boolean(errors[name]) });

  return (
    <SheetForm
      onSubmit={submit}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            {tCommon("cancel")}
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? tCommon("saving") : vendor ? t("save") : t("create")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormSection>{t("sectionWho")}</FormSection>
        <Controller
          control={control}
          name="kind"
          render={({ field: kind }) => (
            <div className="sm:col-span-2">
              <div role="radiogroup" aria-label={t("kind")} className="grid grid-cols-2 gap-1 rounded-xl border bg-muted/40 p-1">
                {VENDOR_KINDS.map((k) => {
                  const Icon = VENDOR_KIND_ICONS[k];
                  const checked = kind.value === k;
                  return (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={checked}
                      onClick={() => kind.onChange(k)}
                      className={cn(
                        "flex min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                        checked ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
                      )}
                    >
                      <Icon aria-hidden className={cn("size-4 shrink-0", checked && "text-primary")} />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold">{tKind(k)}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">{t(`kindHints.${k}`)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        />
        <FormField label={t("name")} className="sm:col-span-2" {...field("name")}>
          <Input {...input("name")} autoFocus={!vendor} placeholder={t("namePlaceholder")} autoComplete="off" />
        </FormField>
        <FormField label={t("taxId")} optional description={t("taxIdHint")} {...field("tax_id")}>
          <Input {...input("tax_id")} className="font-mono uppercase" autoComplete="off" spellCheck={false} />
        </FormField>
        <FormField label={t("country")} description={t("countryHint")} {...field("country_code")}>
          <Input {...input("country_code")} maxLength={2} className="w-20 font-mono uppercase" autoComplete="off" spellCheck={false} />
        </FormField>

        <FormSection>{t("sectionContact")}</FormSection>
        <FormField label={t("contactName")} optional className="sm:col-span-2" {...field("contact_name")}>
          <Input {...input("contact_name")} autoComplete="off" />
        </FormField>
        <FormField label={t("email")} optional {...field("email")}>
          <Input {...input("email")} type="email" inputMode="email" autoComplete="off" spellCheck={false} />
        </FormField>
        <FormField label={t("phone")} optional {...field("phone")}>
          <Input {...input("phone")} type="tel" inputMode="tel" autoComplete="off" />
        </FormField>
        <FormField label={t("website")} optional className="sm:col-span-2" {...field("website")}>
          <Input {...input("website")} inputMode="url" autoComplete="off" spellCheck={false} placeholder="estudi.cat" className="font-mono" />
        </FormField>

        <FormSection>{t("sectionPayment")}</FormSection>
        <FormField label={t("iban")} optional description={t("ibanHint")} className="sm:col-span-2" {...field("iban")}>
          <Input {...input("iban")} className="font-mono uppercase" autoComplete="off" spellCheck={false} placeholder="ES00 0000 0000 0000 0000 0000" />
        </FormField>
        <Controller
          control={control}
          name="default_category_id"
          render={({ field: category }) => (
            <FormField id="vendor-category" label={t("category")} optional description={t("categoryHint")} className="sm:col-span-2">
              <Select value={category.value || NONE} onValueChange={(v) => category.onChange(v === NONE ? "" : v)}>
                <SelectTrigger id="vendor-category" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t("noCategory")}</SelectItem>
                  {categories
                    .filter((c) => !c.archived || c.id === category.value)
                    .map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </FormField>
          )}
        />
        <FormField label={t("notes")} optional className="sm:col-span-2" {...field("notes")}>
          <Textarea {...input("notes")} rows={3} placeholder={t("notesPlaceholder")} />
        </FormField>
      </div>
    </SheetForm>
  );
}
