"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { FormField, useValidationMessage } from "@/components/settings/form-field";
import { SettingsCard } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { initialsFrom } from "@/domain/people";
import { localeNames, locales } from "@/i18n/config";
import { saveProfile } from "./actions";
import { type ProfileInput, profileSchema } from "./schema";

export function ProfileForm({ slug, defaults }: { slug: string; defaults: ProfileInput }) {
  const t = useTranslations("settings.preferences");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const message = useValidationMessage();
  const form = useForm<ProfileInput>({
    resolver: zodResolver(profileSchema),
    defaultValues: defaults,
    mode: "onTouched",
  });
  const { control, register, formState } = form;
  const { errors, isSubmitting, isDirty } = formState;
  const [fullName, initials] = useWatch({ control, name: ["full_name", "initials"] });
  const preview = initials.trim().toUpperCase() || initialsFrom(fullName);

  const submit = form.handleSubmit(async () => {
    const values = form.getValues();
    const result = await saveProfile(slug, values);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    form.reset(values);
    toast.success(t("saved"));
    // El idioma vive en una cookie: se vuelve a pintar todo con él.
    router.refresh();
  });

  return (
    <form onSubmit={submit} noValidate>
      <SettingsCard
        footer={
          <Button type="submit" disabled={isSubmitting || !isDirty}>
            {isSubmitting ? tCommon("saving") : tCommon("save")}
          </Button>
        }
      >
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
          <span
            className="flex size-14 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-lg font-bold text-white shadow-[0_10px_30px_rgb(46_128_255/0.25)]"
            aria-hidden
          >
            {preview}
          </span>
          <fieldset disabled={isSubmitting} className="grid flex-1 gap-4 sm:grid-cols-[1fr_8rem]">
            <FormField id="profile-name" label={t("name")} error={message(errors.full_name?.message)}>
              <Input id="profile-name" autoComplete="name" aria-invalid={Boolean(errors.full_name)} {...register("full_name")} />
            </FormField>
            <FormField id="profile-initials" label={t("initials")} error={message(errors.initials?.message)}>
              <Input
                id="profile-initials"
                maxLength={3}
                autoComplete="off"
                placeholder={initialsFrom(fullName)}
                className="uppercase"
                aria-invalid={Boolean(errors.initials)}
                {...register("initials")}
              />
            </FormField>
            <p className="-mt-2 text-xs text-muted-foreground sm:col-span-2">{t("initialsHint")}</p>
            <Controller
              control={control}
              name="locale"
              render={({ field }) => (
                <FormField id="profile-locale" label={t("language")} description={t("languageHint")} className="sm:col-span-2">
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="profile-locale" className="w-full sm:w-64">
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
          </fieldset>
        </div>
      </SettingsCard>
    </form>
  );
}
