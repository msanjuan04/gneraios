"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { saveClient } from "@/app/[org]/clients/actions";
import {
  type ClientFormInput,
  clientFormSchema,
  type ClientFormValues,
  TAX_ID_KINDS,
  type TaxIdKind,
} from "@/app/[org]/clients/schema";
import { FormField, ToggleField } from "@/components/settings/form-field";
import { SettingsSheet, SheetForm } from "@/components/settings/settings-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { localeNames, locales } from "@/i18n/config";
import type { MemberOption } from "./types";
import { useClientValidationMessage } from "./validation";

const NO_OWNER = "none";

const TAX_ID_PLACEHOLDER: Record<TaxIdKind, string> = { es: "B12345674", eu_vat: "FR12345678901", foreign: "" };

type ClientSheetProps = {
  slug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Sin id, el panel crea un cliente nuevo. */
  clientId?: string;
  defaults: ClientFormInput;
  members: MemberOption[];
  /** Plazo de pago por defecto de la org, para explicar qué pasa si se deja vacío. */
  defaultPaymentTerms: number;
  /** Tras guardar, con el id del cliente (p. ej. para abrir su ficha). */
  onSaved?: (id: string) => void;
};

/** Panel lateral con la ficha del cliente. El formulario se monta al abrir, siempre limpio. */
export function ClientSheet({ open, onOpenChange, ...props }: ClientSheetProps) {
  const t = useTranslations("clients.form");
  return (
    <SettingsSheet
      open={open}
      onOpenChange={onOpenChange}
      title={props.clientId ? t("editTitle") : t("createTitle")}
      description={t("description")}
    >
      <ClientForm {...props} onDone={() => onOpenChange(false)} />
    </SettingsSheet>
  );
}

function Section({ children }: { children: ReactNode }) {
  return (
    <p className="pt-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase first:pt-0 sm:col-span-2">
      {children}
    </p>
  );
}

function ClientForm({
  slug,
  clientId,
  defaults,
  members,
  defaultPaymentTerms,
  onSaved,
  onDone,
}: Omit<ClientSheetProps, "open" | "onOpenChange"> & { onDone: () => void }) {
  const t = useTranslations("clients.form");
  const tKind = useTranslations("crm.taxIdKind");
  const tCommon = useTranslations("common");
  const message = useClientValidationMessage();
  const form = useForm<ClientFormInput, unknown, ClientFormValues>({
    resolver: zodResolver(clientFormSchema),
    defaultValues: defaults,
    mode: "onTouched",
  });
  const { control, register, getValues, trigger, formState } = form;
  const { errors, isSubmitting } = formState;
  const taxIdKind = useWatch({ control, name: "tax_id_kind" });

  const submit = form.handleSubmit(async () => {
    const result = await saveClient(slug, clientId ?? null, getValues());
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(clientId ? t("savedToast") : t("createdToast"));
    onDone();
    onSaved?.(result.id);
  });

  type TextField = Exclude<keyof ClientFormInput, "tax_id_kind" | "is_business" | "preferred_language" | "owner_member_id">;
  const field = (name: TextField) => ({ id: `client-${name}`, error: message(errors[name]?.message) });
  const input = (name: TextField) => ({ ...register(name), id: `client-${name}`, "aria-invalid": Boolean(errors[name]) });

  return (
    <SheetForm
      onSubmit={submit}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onDone} disabled={isSubmitting}>
            {tCommon("cancel")}
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? tCommon("saving") : clientId ? tCommon("save") : t("create")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Section>{t("sectionGeneral")}</Section>
        <FormField label={t("displayName")} description={t("displayNameHint")} className="sm:col-span-2" {...field("display_name")}>
          <Input {...input("display_name")} autoComplete="organization" autoFocus />
        </FormField>
        <FormField label={t("sector")} optional {...field("sector")}>
          <Input {...input("sector")} placeholder={t("sectorPlaceholder")} />
        </FormField>
        <FormField label={t("website")} optional {...field("website")}>
          <Input {...input("website")} inputMode="url" autoComplete="url" placeholder="gnerai.com" />
        </FormField>
        <Controller
          control={control}
          name="owner_member_id"
          render={({ field: owner }) => (
            <FormField id="client-owner" label={t("owner")} description={t("ownerHint")}>
              <Select value={owner.value || NO_OWNER} onValueChange={(v) => owner.onChange(v === NO_OWNER ? "" : v)}>
                <SelectTrigger id="client-owner" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_OWNER}>{t("noOwner")}</SelectItem>
                  {members.map((m) => (
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
        <Controller
          control={control}
          name="preferred_language"
          render={({ field: language }) => (
            <FormField id="client-language" label={t("language")} description={t("languageHint")}>
              <Select
                value={language.value}
                onValueChange={(v) => language.onChange(locales.find((l) => l === v) ?? "es")}
              >
                <SelectTrigger id="client-language" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {locales.map((l) => (
                    <SelectItem key={l} value={l}>
                      {localeNames[l]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          )}
        />

        <Section>{t("sectionFiscal")}</Section>
        <FormField label={t("legalName")} optional description={t("legalNameHint")} className="sm:col-span-2" {...field("legal_name")}>
          <Input {...input("legal_name")} />
        </FormField>
        <Controller
          control={control}
          name="tax_id_kind"
          render={({ field: kind }) => (
            <FormField id="client-tax-kind" label={t("taxIdKind")}>
              <Select
                value={kind.value}
                onValueChange={(v) => {
                  kind.onChange(TAX_ID_KINDS.find((k) => k === v) ?? "es");
                  // El mismo NIF puede ser válido o no según el tipo.
                  if (getValues("tax_id").trim() !== "") void trigger("tax_id");
                }}
              >
                <SelectTrigger id="client-tax-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TAX_ID_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {tKind(k)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          )}
        />
        <FormField label={t("taxId")} optional description={t(`taxIdHint.${taxIdKind}`)} {...field("tax_id")}>
          <Input
            {...input("tax_id")}
            className="font-mono uppercase"
            autoComplete="off"
            spellCheck={false}
            placeholder={TAX_ID_PLACEHOLDER[taxIdKind]}
          />
        </FormField>
        <Controller
          control={control}
          name="is_business"
          render={({ field: business }) => (
            <ToggleField
              id="client-business"
              label={t("isBusiness")}
              description={t("isBusinessHint")}
              checked={business.value}
              onCheckedChange={business.onChange}
              className="sm:col-span-2"
            />
          )}
        />
        <FormField label={t("address")} optional className="sm:col-span-2" {...field("address_line")}>
          <Input {...input("address_line")} autoComplete="street-address" />
        </FormField>
        <FormField label={t("postalCode")} optional {...field("postal_code")}>
          <Input {...input("postal_code")} inputMode="numeric" autoComplete="postal-code" />
        </FormField>
        <FormField label={t("city")} optional {...field("city")}>
          <Input {...input("city")} autoComplete="address-level2" />
        </FormField>
        <FormField label={t("province")} optional {...field("province")}>
          <Input {...input("province")} autoComplete="address-level1" />
        </FormField>
        <FormField label={t("country")} description={t("countryHint")} {...field("country_code")}>
          <Input {...input("country_code")} maxLength={2} className="w-20 font-mono uppercase" autoComplete="country" />
        </FormField>

        <Section>{t("sectionTerms")}</Section>
        <FormField
          label={t("paymentTerms")}
          optional
          description={t("paymentTermsHint", { days: defaultPaymentTerms })}
          {...field("payment_terms_days")}
        >
          <Input
            {...input("payment_terms_days")}
            inputMode="numeric"
            className="w-28 tabular"
            placeholder={String(defaultPaymentTerms)}
          />
        </FormField>
        <FormField label={t("notes")} optional className="sm:col-span-2" {...field("notes")}>
          <Textarea {...input("notes")} rows={3} placeholder={t("notesPlaceholder")} />
        </FormField>
      </div>
    </SheetForm>
  );
}
