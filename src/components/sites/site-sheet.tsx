"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { EMPTY_SITE_FORM, type SiteFormInput, siteFormSchema, type SiteFormValues } from "@/app/[org]/sites/schema";
import { useShell } from "@/components/app-shell/shell-context";
import { OptionSelect } from "@/components/projects/fields";
import { FormField, ToggleField } from "@/components/settings/form-field";
import { SettingsSheet, SheetForm } from "@/components/settings/settings-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { suggestClientForSite } from "@/domain/seo/site-url";
import { normalizeSiteUrl } from "@/domain/sites";
import { saveSite } from "@/server/sites/actions";
import type { SiteClientOption, SiteListItem } from "./types";

/**
 * Traduce el mensaje de un error de Zod de los formularios de Webs: primero `sites.validation.*`,
 * luego los comunes de `validation.*`.
 */
export function useSiteValidationMessage() {
  const t = useTranslations("sites.validation");
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
  clients: SiteClientOption[];
  /** La web a editar; sin ella, se da de alta una. */
  site?: SiteListItem | null;
  /** Al dar de alta desde la ficha de un cliente. */
  defaultClientId?: string | null;
  onSaved?: (id: string, created: boolean) => void;
};

/** «Nueva web» y «Editar web» en el mismo panel. */
export function SiteSheet(props: Props) {
  const t = useTranslations("sites.sheet");
  return (
    <SettingsSheet
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.site ? t("editTitle") : t("createTitle")}
      description={props.site ? undefined : t("description")}
    >
      {props.open && <SiteForm key={props.site?.id ?? "new"} {...props} />}
    </SettingsSheet>
  );
}

function toForm(site: SiteListItem): SiteFormInput {
  return {
    url: site.url,
    label: site.label ?? "",
    client_id: site.clientId ?? "",
    hosted_by_us: site.hostedByUs,
    domain_expires_on: site.domainExpiresOn ?? "",
    notes: site.notes ?? "",
    is_active: site.isActive,
  };
}

function SiteForm({ slug, onOpenChange, clients, site, defaultClientId, onSaved }: Props) {
  const t = useTranslations("sites.sheet");
  const tCommon = useTranslations("common");
  const message = useSiteValidationMessage();
  const { preview } = useShell();
  const [pending, startTransition] = useTransition();
  const initialClient = defaultClientId && clients.some((c) => c.id === defaultClientId) ? defaultClientId : "";

  const form = useForm<SiteFormInput, unknown, SiteFormValues>({
    resolver: zodResolver(siteFormSchema),
    defaultValues: site ? toForm(site) : { ...EMPTY_SITE_FORM, client_id: initialClient },
  });
  const { errors } = form.formState;
  const [url, clientId] = useWatch({ control: form.control, name: ["url", "client_id"] });
  const normalized = url.trim() ? normalizeSiteUrl(url) : null;
  const suggested = normalized && !clientId ? clients.find((c) => c.id === suggestClientForSite(normalized, clients)) : undefined;

  const submit = form.handleSubmit((values) => {
    if (preview) {
      toast.info(t("previewOnly"));
      return;
    }
    startTransition(async () => {
      const result = await saveSite(slug, site?.id ?? null, values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(site ? t("saved") : t("created"));
      onOpenChange(false);
      onSaved?.(result.id, !site);
    });
  });

  return (
    <SheetForm
      onSubmit={submit}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {tCommon("cancel")}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? tCommon("saving") : site ? t("save") : t("create")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          id="site-url"
          label={t("url")}
          error={message(errors.url?.message)}
          description={normalized && normalized !== url.trim() ? t("urlNormalized", { url: normalized }) : t("urlHint")}
          className="sm:col-span-2"
        >
          <Input
            id="site-url"
            autoFocus={!site}
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            placeholder="clinicamarblau.com"
            aria-invalid={Boolean(errors.url)}
            className="font-mono"
            {...form.register("url")}
          />
        </FormField>

        <FormField id="site-label" label={t("label")} optional error={message(errors.label?.message)} description={t("labelHint")}>
          <Input id="site-label" placeholder={t("labelPlaceholder")} {...form.register("label")} />
        </FormField>

        <FormField
          id="site-client"
          label={t("client")}
          description={
            suggested ? (
              <button type="button" className="font-semibold text-primary hover:underline" onClick={() => form.setValue("client_id", suggested.id)}>
                {t("clientSuggestion", { name: suggested.name })}
              </button>
            ) : (
              t("clientHint")
            )
          }
        >
          <Controller
            control={form.control}
            name="client_id"
            render={({ field }) => (
              <OptionSelect
                id="site-client"
                value={field.value}
                onChange={field.onChange}
                noneLabel={t("noClient")}
                options={clients.map((c) => ({ value: c.id, label: c.name }))}
              />
            )}
          />
        </FormField>

        <FormField
          id="site-domain"
          label={t("domainExpiresOn")}
          optional
          error={message(errors.domain_expires_on?.message)}
          description={t("domainHint")}
        >
          <Input id="site-domain" type="date" {...form.register("domain_expires_on")} />
        </FormField>

        <Controller
          control={form.control}
          name="hosted_by_us"
          render={({ field }) => (
            <ToggleField
              id="site-hosted"
              label={t("hostedByUs")}
              description={t("hostedByUsHint")}
              checked={field.value}
              onCheckedChange={field.onChange}
              className="self-end"
            />
          )}
        />

        {site && (
          <Controller
            control={form.control}
            name="is_active"
            render={({ field }) => (
              <ToggleField
                id="site-active"
                label={t("active")}
                description={t("activeHint")}
                checked={field.value}
                onCheckedChange={field.onChange}
                className="sm:col-span-2"
              />
            )}
          />
        )}

        <FormField id="site-notes" label={t("notes")} optional error={message(errors.notes?.message)} className="sm:col-span-2">
          <Textarea id="site-notes" rows={4} placeholder={t("notesPlaceholder")} {...form.register("notes")} />
        </FormField>
      </div>
    </SheetForm>
  );
}
