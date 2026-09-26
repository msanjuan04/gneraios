"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { FormField, ToggleField, useValidationMessage } from "@/components/settings/form-field";
import { SettingsSheet, SheetForm } from "@/components/settings/settings-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatBps } from "@/domain/money";
import { saveIssuer } from "./actions";
import { IRPF_OPTIONS, type IssuerFormInput, issuerFormSchema, type IssuerFormValues } from "./schema";

export type MemberOption = { id: string; name: string; active: boolean };

type IssuerSheetProps = {
  slug: string;
  /** Sin id, el panel crea un emisor nuevo. */
  issuerId?: string;
  defaults: IssuerFormInput;
  members: MemberOption[];
  /** El emisor principal no se desmarca: se cambia marcando otro. */
  primaryLocked?: boolean;
};

/** Botón "Añadir emisor" o "Editar" con su panel lateral. */
export function IssuerSheetButton(props: IssuerSheetProps) {
  const t = useTranslations("settings.issuers");
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const editing = Boolean(props.issuerId);

  return (
    <>
      {editing ? (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Pencil data-icon="inline-start" />
          {tCommon("edit")}
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <Plus data-icon="inline-start" />
          {t("add")}
        </Button>
      )}
      <SettingsSheet
        open={open}
        onOpenChange={setOpen}
        title={editing ? t("edit") : t("addTitle")}
        description={t("formDescription")}
      >
        <IssuerForm {...props} onDone={() => setOpen(false)} />
      </SettingsSheet>
    </>
  );
}

function IssuerForm({ slug, issuerId, defaults, members, primaryLocked, onDone }: IssuerSheetProps & { onDone: () => void }) {
  const t = useTranslations("settings.issuers");
  const tKind = useTranslations("issuerKind");
  const tTeam = useTranslations("settings.team");
  const tCommon = useTranslations("common");
  const message = useValidationMessage();
  const form = useForm<IssuerFormInput, unknown, IssuerFormValues>({
    resolver: zodResolver(issuerFormSchema),
    defaultValues: defaults,
    mode: "onTouched",
  });
  const { control, register, setValue, formState } = form;
  const { errors, isSubmitting } = formState;
  const kind = useWatch({ control, name: "kind" });
  const pendingConstitution = useWatch({ control, name: "pending_constitution" });
  const isCompany = kind === "company";

  const submit = form.handleSubmit(async () => {
    const result = await saveIssuer(slug, issuerId ?? null, form.getValues());
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(issuerId ? t("savedToast") : t("createdToast"));
    onDone();
  });

  const text = (name: Exclude<keyof IssuerFormInput, "kind" | "default_irpf_bps" | "is_primary" | "pending_constitution">) => ({
    id: `issuer-${name}`,
    error: message(errors[name]?.message),
  });

  // Si el valor guardado no es uno de los habituales, se ofrece también.
  const irpfOptions = IRPF_OPTIONS.some((o) => o.bps === defaults.default_irpf_bps)
    ? IRPF_OPTIONS.map((o) => ({ bps: o.bps, label: t(o.labelKey) }))
    : [
        ...IRPF_OPTIONS.map((o) => ({ bps: o.bps, label: t(o.labelKey) })),
        { bps: defaults.default_irpf_bps, label: formatBps(defaults.default_irpf_bps) },
      ];

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
        <Controller
          control={control}
          name="kind"
          render={({ field }) => (
            <FormField id="issuer-kind" label={t("kind")} className="sm:col-span-2">
              <Select
                value={field.value}
                onValueChange={(value) => {
                  const next = value === "company" ? "company" : "self_employed";
                  field.onChange(next);
                  if (next === "company") setValue("member_id", "");
                  else setValue("pending_constitution", false);
                }}
              >
                <SelectTrigger id="issuer-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="self_employed">{tKind("self_employed")}</SelectItem>
                  <SelectItem value="company">{tKind("company")}</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
          )}
        />

        {isCompany && (
          <Controller
            control={control}
            name="pending_constitution"
            render={({ field }) => (
              <ToggleField
                id="issuer-pending"
                label={t("pendingToggle")}
                description={t("pendingToggleHint")}
                checked={field.value}
                onCheckedChange={(checked) => {
                  field.onChange(checked);
                  if (checked) setValue("active_from", "", { shouldValidate: true });
                }}
                className="sm:col-span-2"
              />
            )}
          />
        )}

        <FormField label={t("legalName")} className="sm:col-span-2" {...text("legal_name")}>
          <Input {...register("legal_name")} id="issuer-legal_name" aria-invalid={Boolean(errors.legal_name)} autoFocus />
        </FormField>
        <FormField label={t("tradeName")} optional {...text("trade_name")}>
          <Input {...register("trade_name")} id="issuer-trade_name" aria-invalid={Boolean(errors.trade_name)} />
        </FormField>
        <FormField label={t("taxId")} optional {...text("tax_id")}>
          <Input
            {...register("tax_id")}
            id="issuer-tax_id"
            className="uppercase"
            autoComplete="off"
            aria-invalid={Boolean(errors.tax_id)}
          />
        </FormField>

        {!(isCompany && pendingConstitution) && (
          <FormField label={t("activeFrom")} optional={!isCompany} {...text("active_from")}>
            <Input {...register("active_from")} id="issuer-active_from" type="date" aria-invalid={Boolean(errors.active_from)} />
          </FormField>
        )}

        {!isCompany && (
          <Controller
            control={control}
            name="default_irpf_bps"
            render={({ field }) => (
              <FormField id="issuer-irpf" label={t("irpf")}>
                <Select value={String(field.value)} onValueChange={(value) => field.onChange(Number(value))}>
                  <SelectTrigger id="issuer-irpf" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {irpfOptions.map((o) => (
                      <SelectItem key={o.bps} value={String(o.bps)}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
          />
        )}

        {!isCompany && (
          <Controller
            control={control}
            name="member_id"
            render={({ field }) => (
              <FormField id="issuer-member" label={t("linkedMember")} description={t("linkedMemberHint")}>
                <Select value={field.value || "none"} onValueChange={(value) => field.onChange(value === "none" ? "" : value)}>
                  <SelectTrigger id="issuer-member" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("noMember")}</SelectItem>
                    {members.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                        {!m.active && <span className="text-xs text-muted-foreground">· {tTeam("inactive")}</span>}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
          />
        )}

        <FormField label={t("address")} optional className="sm:col-span-2" {...text("address_line")}>
          <Input {...register("address_line")} id="issuer-address_line" aria-invalid={Boolean(errors.address_line)} />
        </FormField>
        <FormField label={t("postalCode")} optional {...text("postal_code")}>
          <Input
            {...register("postal_code")}
            id="issuer-postal_code"
            inputMode="numeric"
            aria-invalid={Boolean(errors.postal_code)}
          />
        </FormField>
        <FormField label={t("city")} optional {...text("city")}>
          <Input {...register("city")} id="issuer-city" aria-invalid={Boolean(errors.city)} />
        </FormField>
        <FormField label={t("province")} optional {...text("province")}>
          <Input {...register("province")} id="issuer-province" aria-invalid={Boolean(errors.province)} />
        </FormField>
        <FormField label={t("email")} optional {...text("email")}>
          <Input {...register("email")} id="issuer-email" type="email" aria-invalid={Boolean(errors.email)} />
        </FormField>
        <FormField label={t("iban")} optional className="sm:col-span-2" {...text("iban")}>
          <Input
            {...register("iban")}
            id="issuer-iban"
            className="font-mono uppercase"
            autoComplete="off"
            aria-invalid={Boolean(errors.iban)}
          />
        </FormField>

        {isCompany && (
          <FormField
            label={t("registryInfo")}
            optional
            description={t("registryInfoHint")}
            className="sm:col-span-2"
            {...text("registry_info")}
          >
            <Textarea {...register("registry_info")} id="issuer-registry_info" rows={2} aria-invalid={Boolean(errors.registry_info)} />
          </FormField>
        )}

        <Controller
          control={control}
          name="is_primary"
          render={({ field }) => (
            <ToggleField
              id="issuer-primary"
              label={t("primaryToggle")}
              description={primaryLocked ? t("primaryLocked") : t("primaryHint")}
              checked={field.value}
              onCheckedChange={field.onChange}
              disabled={primaryLocked}
              className="sm:col-span-2"
            />
          )}
        />
      </div>
    </SheetForm>
  );
}
