"use client";

import { CalendarRange } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { SettingsCard } from "@/components/settings/settings-card";
import { ToggleField } from "@/components/settings/form-field";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FISCAL_MODELS, type FiscalCalendarSettings, type FiscalIssuerKind, type FiscalModel } from "@/domain/calendar/fiscal";
import { saveFiscalCalendarSettings } from "./actions";

// Los modelos que no aplican a un tipo de emisor no se ofrecen (el calendario los ignora igual).
const NOT_FOR: Record<FiscalIssuerKind, readonly FiscalModel[]> = { company: ["130"], self_employed: ["202", "200"] };
const KINDS: FiscalIssuerKind[] = ["company", "self_employed"];

/** Qué plazos de la AEAT enseña el calendario, por tipo de emisor. */
export function FiscalCalendarForm({ slug, value, canEdit }: { slug: string; value: FiscalCalendarSettings; canEdit: boolean }) {
  const t = useTranslations("settings.taxes.fiscalCalendar");
  const tModels = useTranslations("calendar.fiscal.models");
  const [enabled, setEnabled] = useState(value.enabled);
  const [models, setModels] = useState<Record<FiscalIssuerKind, FiscalModel[]>>({
    company: [...value.models.company],
    self_employed: [...value.models.self_employed],
  });
  const [intraEu, setIntraEu] = useState(value.intraEu);
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();

  const toggle = (kind: FiscalIssuerKind, model: FiscalModel, on: boolean) => {
    setModels((current) => ({
      ...current,
      [kind]: on ? [...current[kind], model] : current[kind].filter((m) => m !== model),
    }));
    setDirty(true);
  };

  const save = () =>
    startTransition(async () => {
      const result = await saveFiscalCalendarSettings(slug, {
        enabled,
        company: models.company,
        self_employed: models.self_employed,
        intra_eu: intraEu,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setDirty(false);
      toast.success(t("saved"));
    });

  return (
    <SettingsCard
      title={
        <span className="inline-flex items-center gap-2">
          <CalendarRange className="size-4 text-primary" />
          {t("title")}
        </span>
      }
      description={t("description")}
      footer={
        canEdit ? (
          <div className="flex justify-end">
            <Button size="sm" onClick={save} disabled={pending || !dirty}>
              {pending ? t("saving") : t("save")}
            </Button>
          </div>
        ) : undefined
      }
    >
      <fieldset disabled={!canEdit} className="space-y-4">
        <ToggleField
          id="fiscal-enabled"
          label={t("enabled")}
          description={t("enabledHint")}
          checked={enabled}
          disabled={!canEdit}
          onCheckedChange={(on) => {
            setEnabled(on);
            setDirty(true);
          }}
        />
        {enabled && (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              {KINDS.map((kind) => (
                <div key={kind} className="rounded-xl border p-3">
                  <p className="mb-2 font-semibold">{t(`kinds.${kind}`)}</p>
                  <ul className="space-y-1.5">
                    {FISCAL_MODELS.filter((m) => !NOT_FOR[kind].includes(m)).map((model) => {
                      const id = `fiscal-${kind}-${model}`;
                      return (
                        <li key={model}>
                          <ToggleField
                            id={id}
                            control="checkbox"
                            className="bg-transparent p-2"
                            label={
                              <>
                                <span className="tabular">{model}</span> · {tModels(`m${model}.short`)}
                              </>
                            }
                            description={tModels(`m${model}.description`)}
                            checked={models[kind].includes(model)}
                            disabled={!canEdit}
                            onCheckedChange={(on) => toggle(kind, model, on)}
                          />
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{t("intraEu")}</p>
                <p className="text-muted-foreground">{t("intraEuHint")}</p>
              </div>
              <Select
                value={intraEu}
                disabled={!canEdit}
                onValueChange={(next) => {
                  setIntraEu(next as FiscalCalendarSettings["intraEu"]);
                  setDirty(true);
                }}
              >
                <SelectTrigger className="w-64" aria-label={t("intraEu")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["auto", "always", "never"] as const).map((option) => (
                    <SelectItem key={option} value={option}>
                      {t(`intraEuOptions.${option}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">{t("disclaimer")}</p>
          </>
        )}
      </fieldset>
    </SettingsCard>
  );
}
