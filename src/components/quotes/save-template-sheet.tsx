"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { listQuoteTemplateOptions, saveQuoteAsTemplate } from "@/app/[org]/quotes/actions";
import { type SaveAsTemplateInput, saveAsTemplateSchema } from "@/app/[org]/quotes/template-schema";
import { FormField, useValidationMessage } from "@/components/settings/form-field";
import { SettingsSheet, SheetForm } from "@/components/settings/settings-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CATALOG_CATEGORIES } from "@/domain/catalog";

const NONE = "__new__";

/**
 * «Guardar como plantilla»: las líneas, el texto y el plan del presupuesto abierto pasan a una
 * plantilla nueva o sustituyen una existente. Panel lateral, nunca un modal encima del editor.
 */
export function SaveTemplateSheet({
  slug,
  basePath,
  quoteId,
  defaultName,
  open,
  onClose,
}: {
  slug: string;
  basePath: string;
  quoteId: string;
  defaultName: string;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("quotes.templates");
  const tCatalog = useTranslations("catalog");
  const tCommon = useTranslations("common");
  const message = useValidationMessage();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [existing, setExisting] = useState<{ id: string; name: string }[]>([]);
  const form = useForm<SaveAsTemplateInput>({
    resolver: zodResolver(saveAsTemplateSchema),
    values: { name: defaultName, category: "other", summary: "", replace_id: "" },
    mode: "onTouched",
  });
  const { control, register, handleSubmit, formState, setValue } = form;
  const { errors } = formState;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listQuoteTemplateOptions(slug).then((result) => {
      if (!cancelled && result.ok) setExisting(result.templates);
    });
    return () => {
      cancelled = true;
    };
  }, [open, slug]);

  const submit = handleSubmit((values) => {
    startTransition(async () => {
      const result = await saveQuoteAsTemplate(slug, quoteId, values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("savedToast"), { action: { label: t("title"), onClick: () => router.push(`${basePath}/quotes/templates`) } });
      onClose();
    });
  });

  return (
    <SettingsSheet open={open} onOpenChange={(value) => !value && onClose()} title={t("saveAs.title")} description={t("saveAs.description")}>
      <SheetForm
        onSubmit={submit}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
              {tCommon("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? tCommon("saving") : t("saveAs.submit")}
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          {existing.length > 0 && (
            <Controller
              control={control}
              name="replace_id"
              render={({ field }) => (
                <FormField id="template-replace" label={t("saveAs.replace")} optional>
                  <Select
                    value={field.value || NONE}
                    onValueChange={(value) => {
                      field.onChange(value === NONE ? "" : value);
                      const chosen = existing.find((item) => item.id === value);
                      if (chosen) setValue("name", chosen.name);
                    }}
                  >
                    <SelectTrigger id="template-replace" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>{t("saveAs.keepNew")}</SelectItem>
                      {existing.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
              )}
            />
          )}
          <FormField id="template-save-name" label={t("fields.name")} error={message(errors.name?.message)}>
            <Input id="template-save-name" maxLength={120} aria-invalid={Boolean(errors.name)} {...register("name")} />
          </FormField>
          <Controller
            control={control}
            name="category"
            render={({ field }) => (
              <FormField id="template-save-category" label={t("fields.category")} error={message(errors.category?.message)}>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="template-save-category" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATALOG_CATEGORIES.map((category) => (
                      <SelectItem key={category} value={category}>
                        {tCatalog(`categories.${category}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
          />
          <FormField id="template-save-summary" label={t("fields.summary")} description={t("fields.summaryHint")} error={message(errors.summary?.message)} optional>
            <Textarea id="template-save-summary" rows={3} maxLength={1000} {...register("summary")} />
          </FormField>
          <p className="text-xs text-muted-foreground">
            <Link href={`${basePath}/quotes/templates`} className="text-primary hover:underline">
              {t("title")}
            </Link>
          </p>
        </div>
      </SheetForm>
    </SettingsSheet>
  );
}
