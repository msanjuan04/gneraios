"use client";

import { Archive, ArchiveRestore, Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { toast } from "sonner";
import { saveUpsellRule, setUpsellRuleArchived } from "@/app/[org]/settings/council/actions";
import { splitWords } from "@/app/[org]/settings/council/schema";
import { FormField } from "@/components/settings/form-field";
import { ReadOnlyNotice, SettingsCard } from "@/components/settings/settings-card";
import { SettingsSheet, SheetForm } from "@/components/settings/settings-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Textarea } from "@/components/ui/textarea";
import { centsToInput } from "@/domain/catalog";
import { parseMoneyInput } from "@/domain/money";
import { cn } from "@/lib/utils";
import { eur, type MoneyFormat } from "../meta";

export type UpsellRuleRow = {
  id: string;
  label: string;
  requires_any: string[];
  excludes_any: string[];
  max_services: number | null;
  min_months: number | null;
  suggestion: string;
  reference_mrr_cents: number | null;
  archived_at: string | null;
};

/** Las reglas de venta cruzada del agente de retención: son datos, las cambia un owner. */
export function UpsellRulesEditor({ slug, rules, money, canEdit }: { slug: string; rules: UpsellRuleRow[]; money: MoneyFormat; canEdit: boolean }) {
  const t = useTranslations("council.settings.rules");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [editing, setEditing] = useState<UpsellRuleRow | "new" | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [pending, startTransition] = useTransition();
  const active = rules.filter((r) => r.archived_at === null);
  const archived = rules.filter((r) => r.archived_at !== null);
  const visible = showArchived ? rules : active;

  const archive = (rule: UpsellRuleRow, value: boolean) =>
    startTransition(async () => {
      const result = await setUpsellRuleArchived(slug, rule.id, value);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(value ? t("archivedToast") : t("restoredToast"));
      router.refresh();
    });

  return (
    <SettingsCard
      title={t("title")}
      description={t("description")}
      actions={
        canEdit && (
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus data-icon="inline-start" />
            {t("add")}
          </Button>
        )
      }
      bodyClassName="p-0"
    >
      {!canEdit && <ReadOnlyNotice className="px-5 pt-4">{tCommon("ownerOnly")}</ReadOnlyNotice>}
      {visible.length === 0 ? (
        <p className="px-5 py-6 text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="divide-y">
          {visible.map((rule) => (
            <li key={rule.id} className={cn("flex flex-wrap items-start gap-3 px-5 py-3", rule.archived_at && "opacity-60")}>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {rule.label}
                  {rule.archived_at && <span className="ml-2 rounded-full bg-secondary px-2 text-[11px] font-semibold text-muted-foreground">{t("archivedBadge")}</span>}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{rule.suggestion}</p>
                <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  <span>{t("summary.requires", { words: rule.requires_any.join(", ") || "—" })}</span>
                  {rule.excludes_any.length > 0 && <span>{t("summary.excludes", { words: rule.excludes_any.join(", ") })}</span>}
                  {rule.max_services !== null && <span>{t("summary.maxServices", { count: rule.max_services })}</span>}
                  {rule.min_months !== null && <span>{t("summary.minMonths", { count: rule.min_months })}</span>}
                  <span>{rule.reference_mrr_cents === null ? t("summary.noReference") : t("summary.reference", { amount: eur(rule.reference_mrr_cents, money) })}</span>
                </p>
              </div>
              {canEdit && (
                <div className="flex shrink-0 items-center gap-1">
                  {!rule.archived_at && (
                    <Button variant="ghost" size="icon-sm" aria-label={tCommon("edit")} title={tCommon("edit")} onClick={() => setEditing(rule)} disabled={pending}>
                      <Pencil />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={rule.archived_at ? t("restore") : t("archive")}
                    title={rule.archived_at ? t("restore") : t("archive")}
                    onClick={() => archive(rule, rule.archived_at === null)}
                    disabled={pending}
                  >
                    {rule.archived_at ? <ArchiveRestore /> : <Archive />}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {archived.length > 0 && (
        <div className="border-t px-5 py-2">
          <button type="button" className="text-xs font-semibold text-muted-foreground hover:text-foreground" onClick={() => setShowArchived(!showArchived)}>
            {showArchived ? t("hideArchived") : t("showArchived", { count: archived.length })}
          </button>
        </div>
      )}
      <SettingsSheet open={editing !== null} onOpenChange={(open) => !open && setEditing(null)} title={editing === "new" ? t("addTitle") : t("editTitle")} description={t("formDescription")}>
        {editing !== null && <RuleForm slug={slug} rule={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
      </SettingsSheet>
    </SettingsCard>
  );
}

const optionalInt = (value: string, min: number, max: number): number | null | undefined => {
  const raw = value.trim();
  if (raw === "") return null;
  if (!/^\d{1,3}$/.test(raw)) return undefined;
  const n = Number(raw);
  return n >= min && n <= max ? n : undefined;
};

function RuleForm({ slug, rule, onDone }: { slug: string; rule: UpsellRuleRow | null; onDone: () => void }) {
  const t = useTranslations("council.settings.rules");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [values, setValues] = useState({
    label: rule?.label ?? "",
    requires: rule?.requires_any.join(", ") ?? "",
    excludes: rule?.excludes_any.join(", ") ?? "",
    maxServices: rule?.max_services === null || rule?.max_services === undefined ? "" : String(rule.max_services),
    minMonths: rule?.min_months === null || rule?.min_months === undefined ? "" : String(rule.min_months),
    suggestion: rule?.suggestion ?? "",
    reference: rule?.reference_mrr_cents === null || rule?.reference_mrr_cents === undefined ? "" : centsToInput(rule.reference_mrr_cents),
  });
  const [errors, setErrors] = useState<Partial<Record<keyof typeof values, string>>>({});
  const [pending, startTransition] = useTransition();
  const set = (key: keyof typeof values, value: string) => setValues((current) => ({ ...current, [key]: value }));

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next: typeof errors = {};
    const requires = splitWords(values.requires);
    const excludes = splitWords(values.excludes);
    const maxServices = optionalInt(values.maxServices, 1, 20);
    const minMonths = optionalInt(values.minMonths, 0, 120);
    const reference = values.reference.trim() === "" ? null : parseMoneyInput(values.reference);
    if (values.label.trim() === "") next.label = t("errors.label");
    if (values.suggestion.trim() === "") next.suggestion = t("errors.suggestion");
    if (requires.length === 0 || requires.some((w) => w.length < 2 || w.length > 60)) next.requires = t("errors.requiresAny");
    if (excludes.some((w) => w.length < 2 || w.length > 60)) next.excludes = t("errors.words");
    if (maxServices === undefined) next.maxServices = t("errors.maxServices");
    if (minMonths === undefined) next.minMonths = t("errors.minMonths");
    if (values.reference.trim() !== "" && (reference === null || reference < 0)) next.reference = t("errors.reference");
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    startTransition(async () => {
      const result = await saveUpsellRule(slug, rule?.id ?? null, {
        label: values.label.trim(),
        requires_any: requires,
        excludes_any: excludes,
        max_services: maxServices ?? null,
        min_months: minMonths ?? null,
        suggestion: values.suggestion.trim(),
        reference_mrr_cents: reference,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(rule ? t("savedToast") : t("createdToast"));
      router.refresh();
      onDone();
    });
  };

  return (
    <SheetForm
      onSubmit={submit}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onDone} disabled={pending}>
            {tCommon("cancel")}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? tCommon("saving") : tCommon("save")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="rule-label" label={t("fields.label")} error={errors.label} className="sm:col-span-2">
          <Input id="rule-label" value={values.label} onChange={(e) => set("label", e.target.value)} maxLength={120} aria-invalid={Boolean(errors.label)} autoFocus />
        </FormField>
        <FormField id="rule-requires" label={t("fields.requires")} description={t("fields.requiresHint")} error={errors.requires} className="sm:col-span-2">
          <Input id="rule-requires" value={values.requires} onChange={(e) => set("requires", e.target.value)} aria-invalid={Boolean(errors.requires)} />
        </FormField>
        <FormField id="rule-excludes" label={t("fields.excludes")} description={t("fields.excludesHint")} error={errors.excludes} optional className="sm:col-span-2">
          <Input id="rule-excludes" value={values.excludes} onChange={(e) => set("excludes", e.target.value)} aria-invalid={Boolean(errors.excludes)} />
        </FormField>
        <FormField id="rule-max" label={t("fields.maxServices")} description={t("fields.maxServicesHint")} error={errors.maxServices} optional>
          <Input id="rule-max" value={values.maxServices} onChange={(e) => set("maxServices", e.target.value)} inputMode="numeric" className="tabular" aria-invalid={Boolean(errors.maxServices)} />
        </FormField>
        <FormField id="rule-months" label={t("fields.minMonths")} description={t("fields.minMonthsHint")} error={errors.minMonths} optional>
          <Input id="rule-months" value={values.minMonths} onChange={(e) => set("minMonths", e.target.value)} inputMode="numeric" className="tabular" aria-invalid={Boolean(errors.minMonths)} />
        </FormField>
        <FormField id="rule-suggestion" label={t("fields.suggestion")} description={t("fields.suggestionHint")} error={errors.suggestion} className="sm:col-span-2">
          <Textarea id="rule-suggestion" value={values.suggestion} onChange={(e) => set("suggestion", e.target.value.replace(/[\n\r]/g, " "))} maxLength={300} rows={3} aria-invalid={Boolean(errors.suggestion)} />
        </FormField>
        <FormField id="rule-reference" label={t("fields.reference")} description={t("fields.referenceHint")} error={errors.reference} optional className="sm:col-span-2">
          <InputGroup>
            <InputGroupInput id="rule-reference" value={values.reference} onChange={(e) => set("reference", e.target.value)} inputMode="decimal" className="tabular" aria-invalid={Boolean(errors.reference)} />
            <InputGroupAddon align="inline-end">
              <InputGroupText>{t("fields.referenceUnit")}</InputGroupText>
            </InputGroupAddon>
          </InputGroup>
        </FormField>
      </div>
    </SheetForm>
  );
}
