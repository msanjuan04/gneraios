"use client";

import { FlaskConical, History } from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { saveFinancialPolicy } from "@/app/[org]/settings/council/actions";
import { FormField, ToggleField } from "@/components/settings/form-field";
import { ReadOnlyNotice, SettingsCard } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { type PolicyField, POLICY_FIELD_KIND, type PolicyFormErrors, changedFields, formToPolicy, policyToForm } from "@/council/policy/form";
import { EXAMPLE_POLICY, type FinancialPolicy } from "@/council/policy/schema";
import type { PolicyVersionView } from "@/council/queries";
import { parsePercentInput } from "@/domain/catalog";
import { cn } from "@/lib/utils";

const GROUPS: { key: string; fields: PolicyField[]; toggle?: boolean }[] = [
  { key: "reserves", fields: ["cushion_months", "corporate_tax_provision"] },
  { key: "distribution", fields: ["reinvestment", "partners"] },
  { key: "raise", fields: ["raise_consecutive_months", "raise_min_mrr", "raise_min_margin"], toggle: true },
  { key: "hire", fields: ["hire_min_capacity", "hire_weeks", "hire_min_pipeline"] },
  { key: "projects", fields: ["min_project_margin", "target_hourly_rate"] },
  { key: "silence", fields: ["impact_threshold", "high_impact_threshold"] },
];

/** Unidad que se enseña al lado de cada campo (clave de council.policy.units). */
const UNITS: Record<PolicyField, string> = {
  cushion_months: "months",
  corporate_tax_provision: "percent",
  reinvestment: "percent",
  partners: "percent",
  raise_consecutive_months: "months",
  raise_min_mrr: "eurMonth",
  raise_min_margin: "percent",
  hire_min_capacity: "percent",
  hire_weeks: "weeks",
  hire_min_pipeline: "eurMonth",
  min_project_margin: "percent",
  target_hourly_rate: "eurHour",
  impact_threshold: "eur",
  high_impact_threshold: "eur",
};

/**
 * La política financiera de la org (CONSEJO.md §4). Mientras no se guarde ninguna versión, el
 * consejo trabaja con los valores de ejemplo, y aquí se ve bien claro que lo son.
 */
export function PolicyForm({
  slug,
  policy,
  version,
  isExample,
  invalid,
  versions,
  canEdit,
}: {
  slug: string;
  policy: FinancialPolicy;
  version: number | null;
  isExample: boolean;
  /** La última versión guardada no se puede leer (se enseña la de ejemplo). */
  invalid: boolean;
  versions: PolicyVersionView[];
  canEdit: boolean;
}) {
  const t = useTranslations("council.policy");
  const tRoot = useTranslations();
  const tCommon = useTranslations("common");
  const format = useFormatter();
  const router = useRouter();
  const initial = useMemo(() => policyToForm(policy), [policy]);
  const example = useMemo(() => policyToForm(EXAMPLE_POLICY), []);
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<PolicyFormErrors>({});
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const changed = changedFields(initial, values);
  const canSave = canEdit && (changed.length > 0 || isExample);
  const nextVersion = (versions[0]?.version ?? 0) + 1;

  const reinvestment = parsePercentInput(values.reinvestment);
  const partners = parsePercentInput(values.partners);
  const distributionSum = reinvestment !== null && partners !== null ? reinvestment + partners : null;

  const set = (field: keyof typeof values, value: string | boolean) => {
    setValues((current) => ({ ...current, [field]: value }));
    if (field in errors) setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const save = () =>
    startTransition(async () => {
      const result = formToPolicy(values);
      if (!result.ok) {
        setErrors(result.errors);
        toast.error(t("errors.fix"));
        return;
      }
      const saved = await saveFinancialPolicy(slug, { policy: result.policy, note: note.trim() || undefined });
      if (!saved.ok) {
        toast.error(saved.error);
        return;
      }
      setNote("");
      toast.success(t("savedToast", { version: saved.version }));
      router.refresh();
    });

  const field = (name: PolicyField) => {
    const error = errors[name];
    const differsFromExample = values[name] !== example[name];
    return (
      <FormField
        key={name}
        id={`policy-${name}`}
        label={
          <>
            {t(`fields.${name}.label`)}
            {isExample && !differsFromExample && <ExampleMark label={t("exampleMark")} />}
          </>
        }
        description={t(`fields.${name}.hint`)}
        error={error ? tRoot(error) : undefined}
      >
        <InputGroup>
          <InputGroupInput
            id={`policy-${name}`}
            value={values[name]}
            onChange={(event) => set(name, event.target.value)}
            inputMode={POLICY_FIELD_KIND[name] === "integer" ? "numeric" : "decimal"}
            aria-invalid={Boolean(error)}
            className="tabular"
          />
          <InputGroupAddon align="inline-end">
            <InputGroupText>{t(`units.${UNITS[name]}`)}</InputGroupText>
          </InputGroupAddon>
        </InputGroup>
      </FormField>
    );
  };

  return (
    <div className="space-y-4">
      {isExample && (
        <div className="flex gap-3 rounded-2xl border border-warning/40 bg-warning/5 px-5 py-4 text-sm">
          <FlaskConical aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
          <div className="min-w-0">
            <p className="font-semibold">{invalid ? t("invalidTitle") : t("exampleTitle")}</p>
            <p className="mt-1 text-muted-foreground">{invalid ? t("invalidBody") : t("exampleBody")}</p>
          </div>
        </div>
      )}
      {!canEdit && <ReadOnlyNotice>{tCommon("ownerOnly")}</ReadOnlyNotice>}
      <fieldset disabled={!canEdit || pending} className="space-y-4">
        {GROUPS.map((group) => (
          <SettingsCard key={group.key} title={t(`groups.${group.key}.title`)} description={t(`groups.${group.key}.description`)}>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{group.fields.map(field)}</div>
            {group.key === "distribution" && (
              <p className={cn("mt-3 text-xs tabular", distributionSum === 10_000 ? "text-muted-foreground" : "font-semibold text-destructive")}>
                {distributionSum === null ? t("distributionPending") : t("distributionSum", { sum: format.number(distributionSum / 10_000, { style: "percent", maximumFractionDigits: 2 }) })}
              </p>
            )}
            {group.toggle && (
              <ToggleField
                id="policy-raise_require_cushion"
                label={
                  <>
                    {t("fields.raise_require_cushion.label")}
                    {isExample && values.raise_require_cushion === example.raise_require_cushion && <ExampleMark label={t("exampleMark")} />}
                  </>
                }
                description={t("fields.raise_require_cushion.hint")}
                checked={values.raise_require_cushion}
                onCheckedChange={(checked) => set("raise_require_cushion", checked)}
                disabled={!canEdit || pending}
                className="mt-4"
              />
            )}
          </SettingsCard>
        ))}

        {canEdit && (
          <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-2xl border bg-card/95 px-5 py-3 shadow-lg backdrop-blur">
            <p className="min-w-40 flex-1 text-xs text-muted-foreground">
              {changed.length > 0 ? t("changedCount", { count: changed.length }) : isExample ? t("adoptHint") : t("unchanged")}
            </p>
            <Input
              value={note}
              onChange={(event) => setNote(event.target.value.replace(/[\n\r]/g, " "))}
              maxLength={300}
              placeholder={t("notePlaceholder")}
              aria-label={t("note")}
              className="h-8 min-w-48 flex-1"
            />
            {changed.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setValues(initial);
                  setErrors({});
                }}
              >
                {t("reset")}
              </Button>
            )}
            <Button type="button" size="sm" onClick={save} disabled={!canSave || pending}>
              {pending ? tCommon("saving") : isExample && changed.length === 0 ? t("adopt") : t("saveVersion", { version: nextVersion })}
            </Button>
          </div>
        )}
      </fieldset>

      <SettingsCard title={t("history.title")} description={t("history.description")}>
        {versions.length === 0 ? (
          <p className="text-muted-foreground">{t("history.empty")}</p>
        ) : (
          <ol className="space-y-2">
            {versions.map((v) => (
              <li key={v.version} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className={cn("inline-flex items-center gap-1 font-semibold tabular", v.version === version && "text-primary")}>
                  <History aria-hidden className="size-3.5" />v{v.version}
                </span>
                <span className="text-xs text-muted-foreground">
                  {format.dateTime(new Date(v.createdAt), { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  {v.createdBy && ` · ${v.createdBy}`}
                </span>
                {v.version === version && <span className="rounded-full bg-primary/10 px-2 text-[11px] font-semibold text-primary">{t("history.current")}</span>}
                {v.note && <span className="w-full text-xs text-muted-foreground sm:w-auto">«{v.note}»</span>}
              </li>
            ))}
          </ol>
        )}
      </SettingsCard>
    </div>
  );
}

function ExampleMark({ label }: { label: string }) {
  return <span className="ml-1 rounded-full border border-warning/40 px-1.5 text-[10px] font-semibold tracking-wide text-warning uppercase">{label}</span>;
}
