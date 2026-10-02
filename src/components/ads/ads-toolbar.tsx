"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { addAdsAccount } from "@/app/[org]/ads/actions";
import { type AddAdsAccountInput, addAdsAccountSchema } from "@/app/[org]/ads/schema";
import { FormField, useValidationMessage } from "@/components/settings/form-field";
import { SettingsSheet, SheetForm } from "@/components/settings/settings-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ADS_PROVIDERS, type AdsProvider, PROVIDER_LABEL } from "@/domain/ads/types";

export type OwnerOption = { id: string; name: string };

const AGENCY = "agency";

/** Arriba a la derecha: de quién son las cuentas que se ven (la agencia o un cliente) y «Añadir cuenta». */
export function AdsToolbar({
  slug,
  basePath,
  owner,
  clients,
  canEdit,
  presetProvider,
}: {
  slug: string;
  basePath: string;
  /** "agency" o el id del cliente. */
  owner: string;
  clients: OwnerOption[];
  canEdit: boolean;
  /** Abre el panel ya con esta plataforma elegida (viene de un «Añadir X» de una sección). */
  presetProvider: AdsProvider | null;
}) {
  const t = useTranslations("ads");
  const router = useRouter();
  const [open, setOpen] = useState(presetProvider !== null);
  const adsPath = `${basePath}/ads`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={owner} onValueChange={(value) => router.push(`${adsPath}?owner=${encodeURIComponent(value)}`)}>
        <SelectTrigger aria-label={t("owner.label")} className="min-w-52">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AGENCY}>{t("owner.agency")}</SelectItem>
          {clients.map((client) => (
            <SelectItem key={client.id} value={client.id}>
              {client.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {canEdit && (
        <Button onClick={() => setOpen(true)}>
          <Plus data-icon="inline-start" />
          {t("add")}
        </Button>
      )}
      {canEdit && (
        <AddAccountSheet
          slug={slug}
          adsPath={adsPath}
          owner={owner}
          clients={clients}
          presetProvider={presetProvider}
          open={open}
          onClose={() => {
            setOpen(false);
            if (presetProvider) router.replace(`${adsPath}?owner=${encodeURIComponent(owner)}`, { scroll: false });
          }}
        />
      )}
    </div>
  );
}

function AddAccountSheet({
  slug,
  adsPath,
  owner,
  clients,
  presetProvider,
  open,
  onClose,
}: {
  slug: string;
  adsPath: string;
  owner: string;
  clients: OwnerOption[];
  presetProvider: AdsProvider | null;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("ads.sheet");
  const tAds = useTranslations("ads");
  const tCommon = useTranslations("common");
  const message = useValidationMessage();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useForm<AddAdsAccountInput>({
    resolver: zodResolver(addAdsAccountSchema),
    values: {
      provider: presetProvider ?? "meta",
      label: "",
      owner_client_id: owner === AGENCY ? "" : owner,
      external_account_id: "",
      credential: "",
      developer_token: "",
      login_customer_id: "",
    },
    mode: "onTouched",
  });
  const { control, register, handleSubmit, formState } = form;
  const { errors } = formState;
  const provider = useWatch({ control, name: "provider" });

  const submit = handleSubmit((values) => {
    startTransition(async () => {
      const result = await addAdsAccount(slug, values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.needsGoogle ? t("createdGoogle") : t("created"));
      onClose();
      router.replace(`${adsPath}?owner=${encodeURIComponent(result.owner)}`);
      router.refresh();
    });
  });

  return (
    <SettingsSheet open={open} onOpenChange={(value) => !value && onClose()} title={t("title")} description={t("description")}>
      <SheetForm
        onSubmit={submit}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
              {tCommon("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? t("verifying") : t("submit")}
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <Controller
            control={control}
            name="provider"
            render={({ field }) => (
              <FormField id="ads-provider" label={t("provider")} error={message(errors.provider?.message)}>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="ads-provider" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ADS_PROVIDERS.map((item) => (
                      <SelectItem key={item} value={item}>
                        {PROVIDER_LABEL[item]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
          />
          <Controller
            control={control}
            name="owner_client_id"
            render={({ field }) => (
              <FormField id="ads-owner" label={t("owner")} error={message(errors.owner_client_id?.message)}>
                <Select value={field.value || AGENCY} onValueChange={(value) => field.onChange(value === AGENCY ? "" : value)}>
                  <SelectTrigger id="ads-owner" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={AGENCY}>{tAds("owner.agency")}</SelectItem>
                    {clients.map((client) => (
                      <SelectItem key={client.id} value={client.id}>
                        {client.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
          />
          <FormField id="ads-label" label={t("label")} error={message(errors.label?.message)}>
            <Input id="ads-label" maxLength={80} placeholder={t("labelPlaceholder")} aria-invalid={Boolean(errors.label)} {...register("label")} />
          </FormField>
          <FormField id="ads-external" label={t(`external.${provider}`)} optional={provider === "openai"} error={message(errors.external_account_id?.message)}>
            <Input id="ads-external" maxLength={120} autoComplete="off" aria-invalid={Boolean(errors.external_account_id)} {...register("external_account_id")} />
          </FormField>
          {provider === "google" ? (
            <>
              <FormField id="ads-developer-token" label={t("developerToken")} error={message(errors.developer_token?.message)}>
                <Input id="ads-developer-token" type="password" maxLength={200} autoComplete="off" aria-invalid={Boolean(errors.developer_token)} {...register("developer_token")} />
              </FormField>
              <FormField id="ads-login-customer" label={t("loginCustomerId")} optional error={message(errors.login_customer_id?.message)}>
                <Input id="ads-login-customer" maxLength={20} autoComplete="off" inputMode="numeric" {...register("login_customer_id")} />
              </FormField>
              <p className="text-xs text-muted-foreground">{t("googleHint")}</p>
            </>
          ) : (
            <FormField id="ads-credential" label={t(`credential.${provider}`)} error={message(errors.credential?.message)}>
              <Input id="ads-credential" type="password" maxLength={4000} autoComplete="off" aria-invalid={Boolean(errors.credential)} {...register("credential")} />
            </FormField>
          )}
        </div>
      </SheetForm>
    </SettingsSheet>
  );
}
