"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { type GoogleOptions, loadGoogleOptions, saveSeoProperty } from "@/app/[org]/seo/actions";
import { type PropertyFormInput, propertyFormSchema, type PropertyFormValues } from "@/app/[org]/seo/schema";
import { FormField, ToggleField } from "@/components/settings/form-field";
import { SettingsSheet, SheetForm } from "@/components/settings/settings-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { siteName } from "./format";

export type ClientOption = { id: string; name: string };

const MANUAL = "__manual__";
const NONE = "__none__";

type PropertySheetProps = {
  slug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Sin id, el panel crea una propiedad nueva. */
  propertyId?: string;
  defaults: PropertyFormInput;
  clients: ClientOption[];
  /** Si Google está conectado, se ofrecen sus webs y propiedades para elegir. */
  googleConnected: boolean;
};

function useSeoValidationMessage() {
  const t = useTranslations("seo.validation");
  const tCommon = useTranslations("validation");
  return (message: string | undefined): string | undefined => {
    if (!message) return undefined;
    if (t.has(message)) return t(message);
    return tCommon.has(message) ? tCommon(message) : tCommon("invalid");
  };
}

/** Panel lateral para dar de alta o editar una web: de la org o de un cliente, con Search Console y GA4. */
export function PropertySheet({ open, onOpenChange, ...props }: PropertySheetProps) {
  const t = useTranslations("seo.form");
  return (
    <SettingsSheet open={open} onOpenChange={onOpenChange} title={props.propertyId ? t("editTitle") : t("createTitle")} description={t("description")}>
      <PropertyForm {...props} onDone={() => onOpenChange(false)} />
    </SettingsSheet>
  );
}

function PropertyForm({ slug, propertyId, defaults, clients, googleConnected, onDone }: Omit<PropertySheetProps, "open" | "onOpenChange"> & { onDone: () => void }) {
  const t = useTranslations("seo.form");
  const tCommon = useTranslations("common");
  const message = useSeoValidationMessage();
  const form = useForm<PropertyFormInput, unknown, PropertyFormValues>({
    resolver: zodResolver(propertyFormSchema),
    defaultValues: defaults,
    mode: "onTouched",
  });
  const { control, register, getValues, setValue, formState } = form;
  const { errors, isSubmitting } = formState;
  const owner = useWatch({ control, name: "owner" });
  const gsc = useWatch({ control, name: "gsc_site_url" });
  const ga4 = useWatch({ control, name: "ga4_property_id" });

  const [options, setOptions] = useState<GoogleOptions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [manual, setManual] = useState({ gsc: !googleConnected, ga4: !googleConnected });

  useEffect(() => {
    if (!googleConnected) return;
    let cancelled = false;
    loadGoogleOptions(slug).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setLoadError(result.error);
        setManual({ gsc: true, ga4: true });
        return;
      }
      setOptions(result);
      // Lo guardado que ya no está en la cuenta (o se escribió a mano) se sigue editando a mano.
      setManual({
        gsc: Boolean(defaults.gsc_site_url) && !result.sites.some((s) => s.siteUrl === defaults.gsc_site_url),
        ga4: Boolean(defaults.ga4_property_id) && !result.properties.some((p) => p.propertyId === defaults.ga4_property_id),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [googleConnected, slug, defaults.gsc_site_url, defaults.ga4_property_id]);

  const loading = googleConnected && options === null && loadError === null;

  const submit = form.handleSubmit(async () => {
    const result = await saveSeoProperty(slug, propertyId ?? null, getValues());
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(propertyId ? t("savedToast") : googleConnected ? t("createdSyncToast") : t("createdToast"));
    onDone();
  });

  const suggestLabel = (label: string) => {
    if (!getValues("label").trim()) setValue("label", label, { shouldValidate: true });
  };

  return (
    <SheetForm
      onSubmit={submit}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onDone} disabled={isSubmitting}>
            {tCommon("cancel")}
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? tCommon("saving") : propertyId ? tCommon("save") : t("create")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {loadError && <p className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs">{loadError}</p>}

        <Controller
          control={control}
          name="owner"
          render={({ field }) => (
            <FormField id="seo-owner" label={t("owner")}>
              <div role="radiogroup" aria-labelledby="seo-owner" className="grid grid-cols-2 gap-2">
                {(["own", "client"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={field.value === value}
                    onClick={() => field.onChange(value)}
                    className={cn(
                      "rounded-xl border px-3 py-2.5 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                      field.value === value ? "border-primary bg-primary/10" : "hover:bg-muted",
                    )}
                  >
                    <span className="block text-sm font-semibold">{t(`owners.${value}`)}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{t(`owners.${value}Hint`)}</span>
                  </button>
                ))}
              </div>
            </FormField>
          )}
        />

        {owner === "client" && (
          <Controller
            control={control}
            name="client_id"
            render={({ field }) => (
              <FormField id="seo-client" label={t("client")} error={message(errors.client_id?.message)}>
                <Select
                  value={field.value || undefined}
                  onValueChange={(value) => {
                    field.onChange(value);
                    const name = clients.find((c) => c.id === value)?.name;
                    if (name) suggestLabel(name);
                  }}
                >
                  <SelectTrigger id="seo-client" className="w-full" aria-invalid={Boolean(errors.client_id)}>
                    <SelectValue placeholder={t("clientPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {clients.length === 0 && (
                      <SelectItem value={NONE} disabled>
                        {t("noClients")}
                      </SelectItem>
                    )}
                    {clients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
          />
        )}

        <FormField id="seo-gsc" label={t("gsc")} description={t("gscHint")} error={message(errors.gsc_site_url?.message)}>
          {loading ? (
            <p className="flex h-8 items-center gap-2 text-sm text-muted-foreground">
              <Loader2 aria-hidden className="size-4 animate-spin" />
              {t("loadingGoogle")}
            </p>
          ) : manual.gsc || !options ? (
            <div className="flex gap-2">
              <Input
                {...register("gsc_site_url")}
                id="seo-gsc"
                placeholder="sc-domain:ejemplo.com"
                aria-invalid={Boolean(errors.gsc_site_url)}
                onBlur={(event) => {
                  register("gsc_site_url").onBlur(event);
                  if (event.target.value) suggestLabel(siteName(event.target.value.trim()) ?? "");
                }}
              />
              {options && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setManual((m) => ({ ...m, gsc: false }))}>
                  {t("pick")}
                </Button>
              )}
            </div>
          ) : (
            <Select
              value={gsc || NONE}
              onValueChange={(value) => {
                if (value === MANUAL) return setManual((m) => ({ ...m, gsc: true }));
                const site = value === NONE ? "" : value;
                setValue("gsc_site_url", site, { shouldValidate: true, shouldTouch: true });
                if (site) suggestLabel(siteName(site) ?? "");
              }}
            >
              <SelectTrigger id="seo-gsc" className="w-full" aria-invalid={Boolean(errors.gsc_site_url)}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("noGsc")}</SelectItem>
                {options.sites.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>{t("gscAccount")}</SelectLabel>
                    {options.sites.map((s) => (
                      <SelectItem key={s.siteUrl} value={s.siteUrl}>
                        {siteName(s.siteUrl)}
                        {s.siteUrl.startsWith("sc-domain:") && <span className="text-muted-foreground"> · {t("domainProperty")}</span>}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                <SelectItem value={MANUAL}>{t("manual")}</SelectItem>
              </SelectContent>
            </Select>
          )}
        </FormField>

        <FormField id="seo-ga4" label={t("ga4")} optional description={t("ga4Hint")} error={message(errors.ga4_property_id?.message)}>
          {loading ? (
            <p className="flex h-8 items-center gap-2 text-sm text-muted-foreground">
              <Loader2 aria-hidden className="size-4 animate-spin" />
              {t("loadingGoogle")}
            </p>
          ) : manual.ga4 || !options ? (
            <div className="flex gap-2">
              <Input {...register("ga4_property_id")} id="seo-ga4" inputMode="numeric" placeholder="123456789" aria-invalid={Boolean(errors.ga4_property_id)} />
              {options && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setManual((m) => ({ ...m, ga4: false }))}>
                  {t("pick")}
                </Button>
              )}
            </div>
          ) : (
            <Select
              value={ga4 || NONE}
              onValueChange={(value) => {
                if (value === MANUAL) return setManual((m) => ({ ...m, ga4: true }));
                setValue("ga4_property_id", value === NONE ? "" : value, { shouldValidate: true, shouldTouch: true });
              }}
            >
              <SelectTrigger id="seo-ga4" className="w-full" aria-invalid={Boolean(errors.ga4_property_id)}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("noGa4")}</SelectItem>
                {options.properties.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>{t("ga4Account")}</SelectLabel>
                    {options.properties.map((p) => (
                      <SelectItem key={p.propertyId} value={p.propertyId}>
                        {p.displayName}
                        <span className="text-muted-foreground"> · {p.account || p.propertyId}</span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                <SelectItem value={MANUAL}>{t("manual")}</SelectItem>
              </SelectContent>
            </Select>
          )}
        </FormField>

        <FormField id="seo-label" label={t("label")} description={t("labelHint")} error={message(errors.label?.message)}>
          <Input {...register("label")} id="seo-label" aria-invalid={Boolean(errors.label)} />
        </FormField>

        <Controller
          control={control}
          name="is_primary"
          render={({ field }) => (
            <ToggleField
              id="seo-primary"
              label={t("primary")}
              description={owner === "client" ? t("primaryClientHint") : t("primaryOwnHint")}
              checked={field.value}
              onCheckedChange={field.onChange}
            />
          )}
        />
      </div>
    </SheetForm>
  );
}
