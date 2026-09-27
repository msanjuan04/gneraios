"use client";

import { Languages } from "lucide-react";
import { useTranslations } from "next-intl";
import { useFormContext, useFormState } from "react-hook-form";
import { useCatalogValidationMessage } from "@/components/catalog/format";
import { Segmented } from "@/components/catalog/catalog-sheet";
import { FormField } from "@/components/settings/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TRANSLATED_LOCALES, type TranslatedLocale } from "@/domain/catalog";
import { localeNames } from "@/i18n/config";
import { cn } from "@/lib/utils";
import type { TranslationsFormInput } from "./schema";

type WithTranslations = { translations: TranslationsFormInput };

/**
 * Nombre y descripción en catalán e inglés. Lo que se deja vacío sale en castellano (el
 * marcador lo enseña), así que traducir es opcional y se puede hacer por partes.
 */
export function TranslationFields({
  locale,
  onLocaleChange,
  fallback,
  translated,
}: {
  locale: TranslatedLocale;
  onLocaleChange: (locale: TranslatedLocale) => void;
  /** El castellano, que sale donde no hay traducción. */
  fallback: { name: string; description: string };
  /** Idiomas con algo escrito (para marcarlos en las pestañas). */
  translated: Record<TranslatedLocale, boolean>;
}) {
  const t = useTranslations("catalog.translations");
  const tLanguage = useTranslations("catalog.languages");
  const message = useCatalogValidationMessage();
  const { register, control } = useFormContext<WithTranslations>();
  const { errors } = useFormState({ control, name: "translations" });
  const current = errors.translations?.[locale];
  const language = tLanguage(locale);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          label={t("label")}
          value={locale}
          onChange={onLocaleChange}
          options={TRANSLATED_LOCALES.map((l) => ({
            value: l,
            label: (
              <span className="inline-flex items-center gap-1.5">
                {localeNames[l]}
                {/* Traducido (azul), sin traducir (gris) o con un error que no se ve desde la otra pestaña (rojo). */}
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    errors.translations?.[l] ? "bg-destructive" : translated[l] ? "bg-primary" : "bg-muted-foreground/30",
                  )}
                  aria-hidden
                />
              </span>
            ),
          }))}
        />
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Languages className="size-3.5" />
          {t("hint")}
        </p>
      </div>
      {/* Una sola pareja de campos a la vista; la clave los rehace al cambiar de idioma. */}
      <div key={locale} className="grid gap-3">
        <FormField id={`translation-${locale}-name`} label={t("name", { language })} optional error={message(current?.name?.message)}>
          <Input
            id={`translation-${locale}-name`}
            lang={locale}
            placeholder={fallback.name}
            aria-invalid={Boolean(current?.name)}
            {...register(`translations.${locale}.name`)}
          />
        </FormField>
        <FormField
          id={`translation-${locale}-description`}
          label={t("description", { language })}
          optional
          error={message(current?.description?.message)}
        >
          <Textarea
            id={`translation-${locale}-description`}
            lang={locale}
            rows={2}
            placeholder={fallback.description}
            aria-invalid={Boolean(current?.description)}
            {...register(`translations.${locale}.description`)}
          />
        </FormField>
      </div>
    </div>
  );
}
