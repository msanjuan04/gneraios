"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ListOrdered } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { FormField, useValidationMessage } from "@/components/settings/form-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatInvoiceNumber } from "@/domain/invoicing/number-format";
import { setSeriesLastNumber } from "./actions";
import { type SeriesNumberInput, seriesNumberSchema } from "./schema";

export type SeriesNumbering = {
  id: string;
  code: string;
  name: string;
  format: string;
  resetYearly: boolean;
  lastNumber: number;
};

/** "Ajustar numeración": para continuar la numeración que se llevaba en otra herramienta. */
export function SeriesNumberButton({ slug, series, year }: { slug: string; series: SeriesNumbering; year: number }) {
  const t = useTranslations("settings.issuers");
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="ghost" size="xs" onClick={() => setOpen(true)}>
        <ListOrdered data-icon="inline-start" />
        {t("setLastNumber")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="font-bold">{t("adjustTitle", { code: series.code })}</DialogTitle>
            <DialogDescription>{t("adjustDescription")}</DialogDescription>
          </DialogHeader>
          <SeriesNumberForm slug={slug} series={series} year={year} onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function SeriesNumberForm({
  slug,
  series,
  year,
  onDone,
}: {
  slug: string;
  series: SeriesNumbering;
  year: number;
  onDone: () => void;
}) {
  const t = useTranslations("settings.issuers");
  const tCommon = useTranslations("common");
  const message = useValidationMessage();
  const form = useForm<SeriesNumberInput>({
    resolver: zodResolver(seriesNumberSchema),
    defaultValues: { series_id: series.id, last_number: series.lastNumber },
    mode: "onChange",
  });
  const { errors, isSubmitting } = form.formState;
  const last = useWatch({ control: form.control, name: "last_number" });
  const preview =
    Number.isSafeInteger(last) && last >= 0 && last <= 999_999 ? formatInvoiceNumber(series.format, year, last + 1) : null;

  const submit = form.handleSubmit(async () => {
    const result = await setSeriesLastNumber(slug, form.getValues());
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(t("adjustedToast", { code: series.code }));
    onDone();
  });

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <FormField
        id="series-last-number"
        label={series.resetYearly ? t("lastNumberYear", { year }) : t("lastNumberAll")}
        error={message(errors.last_number?.message)}
        description={preview ? t("nextPreview", { number: preview }) : undefined}
      >
        <Input
          id="series-last-number"
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          autoFocus
          className="tabular"
          aria-invalid={Boolean(errors.last_number)}
          {...form.register("last_number", { valueAsNumber: true })}
        />
      </FormField>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone} disabled={isSubmitting}>
          {tCommon("cancel")}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? tCommon("saving") : tCommon("save")}
        </Button>
      </DialogFooter>
    </form>
  );
}
