"use client";

import { ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveAgentSettings } from "@/app/[org]/settings/council/actions";
import { FormField } from "@/components/settings/form-field";
import { ReadOnlyNotice } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { AGENT_CONFIG, COUNCIL_MODELS, type CouncilModel, THRESHOLD_LIMITS, type Thresholds, thresholdKeys } from "@/council/agents.config";
import type { AgentStatusView } from "@/council/queries";
import type { AgentName } from "@/council/types";
import { centsToInput } from "@/domain/catalog";
import { parseMoneyInput } from "@/domain/money";
import { cn } from "@/lib/utils";
import { AGENT_ICONS, usd, usdCents } from "../meta";

export type AgentAccuracy = { hit: number; partial: number; miss: number; noData: number };

type Draft = { enabled: boolean; model: CouncilModel | "default"; budget: string; thresholds: Partial<Record<keyof Thresholds, string>> };

function draftOf(a: AgentStatusView): Draft {
  const saved = a.thresholds as Record<string, unknown>;
  return {
    enabled: a.enabled,
    model: a.modelIsDefault ? "default" : a.model,
    budget: a.budgetUsdCents === AGENT_CONFIG[a.agent].monthlyBudgetUsdCents ? "" : centsToInput(a.budgetUsdCents),
    thresholds: Object.fromEntries(thresholdKeys(a.agent).map((key) => [key, typeof saved[key] === "number" ? String(saved[key]) : ""])),
  };
}

/** Los nueve agentes: encendido, modelo, presupuesto mensual y umbrales, con lo que llevan gastado. */
export function AgentSettingsList({
  slug,
  agents,
  accuracy,
  locale,
  canEdit,
  cadence,
}: {
  slug: string;
  agents: AgentStatusView[];
  accuracy: Record<AgentName, AgentAccuracy>;
  locale: string;
  canEdit: boolean;
  cadence: Record<string, string>;
}) {
  const t = useTranslations("council.settings.agents");
  const tCommon = useTranslations("common");
  return (
    <div className="space-y-3">
      {!canEdit && <ReadOnlyNotice>{tCommon("ownerOnly")}</ReadOnlyNotice>}
      <p className="text-xs text-muted-foreground">{t("budgetNote")}</p>
      <ul className="space-y-3">
        {agents.map((a) => (
          <AgentRow key={a.agent} slug={slug} agent={a} accuracy={accuracy[a.agent]} locale={locale} canEdit={canEdit} cadence={cadence[a.agent] ?? ""} />
        ))}
      </ul>
    </div>
  );
}

function AgentRow({ slug, agent: a, accuracy, locale, canEdit, cadence }: { slug: string; agent: AgentStatusView; accuracy: AgentAccuracy; locale: string; canEdit: boolean; cadence: string }) {
  const t = useTranslations("council.settings.agents");
  const tThresholds = useTranslations("council.settings.thresholds");
  const tAgents = useTranslations("council.agents");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [draft, setDraft] = useState(() => draftOf(a));
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const Icon = AGENT_ICONS[a.agent];
  const config = AGENT_CONFIG[a.agent];
  const keys = thresholdKeys(a.agent);
  const initial = draftOf(a);
  const dirty = JSON.stringify(initial) !== JSON.stringify(draft);
  const reviews = accuracy.hit + accuracy.partial + accuracy.miss;
  const share = a.budgetUsdCents > 0 ? Math.min(1, a.spentUsdMicros / (a.budgetUsdCents * 10_000)) : 1;

  /**
   * Guarda `next` (validado aquí y otra vez en el servidor). Si falla, `revert` deshace lo que haga
   * falta; `full` es el guardado del panel (el interruptor solo guarda el encendido).
   */
  const persist = (next: Draft, { revert, full }: { revert: () => void; full: boolean }) =>
    startTransition(async () => {
      const rawBudget = next.budget.trim();
      const budget = rawBudget === "" ? null : parseMoneyInput(rawBudget);
      if (rawBudget !== "" && (budget === null || budget < 0)) {
        setError(t("errors.budget"));
        revert();
        return;
      }
      const thresholds: Partial<Record<keyof Thresholds, number>> = {};
      for (const key of keys) {
        const raw = (next.thresholds[key] ?? "").trim();
        if (raw === "") continue;
        const limits = THRESHOLD_LIMITS[key];
        const n = /^\d{1,4}$/.test(raw) ? Number(raw) : Number.NaN;
        if (!Number.isInteger(n) || n < limits.min || n > limits.max) {
          setError(`${tThresholds(`${key}.label`)} · ${t("errors.threshold", { min: limits.min, max: limits.max })}`);
          revert();
          return;
        }
        thresholds[key] = n;
      }
      setError(null);
      const result = await saveAgentSettings(slug, {
        agent: a.agent,
        enabled: next.enabled,
        model: next.model === "default" ? null : next.model,
        monthly_budget_usd_cents: budget,
        thresholds,
      });
      if (!result.ok) {
        toast.error(result.error);
        revert();
        return;
      }
      // Lo guardado, escrito como lo enseñará la pantalla al recargar.
      if (full) {
        setDraft({
          enabled: next.enabled,
          model: next.model,
          budget: budget === null || budget === config.monthlyBudgetUsdCents ? "" : centsToInput(budget),
          thresholds: Object.fromEntries(keys.map((key) => [key, thresholds[key] === undefined ? "" : String(thresholds[key])])),
        });
      }
      toast.success(t("savedToast", { agent: tAgents(`${a.agent}.name`) }));
      router.refresh();
    });

  return (
    <li className={cn("rounded-2xl border bg-card text-sm", !draft.enabled && "bg-card/50")}>
      <div className="flex flex-wrap items-center gap-3 px-5 py-4">
        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl bg-secondary", draft.enabled ? "text-primary" : "text-muted-foreground")}>
          <Icon aria-hidden className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn("font-semibold", !draft.enabled && "text-muted-foreground")}>{tAgents(`${a.agent}.name`)}</p>
          <p className="truncate text-xs text-muted-foreground">
            {cadence} · {a.model}
            {reviews > 0 && ` · ${t("accuracy", { hit: accuracy.hit, partial: accuracy.partial, miss: accuracy.miss })}`}
          </p>
        </div>
        <div className="hidden w-40 sm:block" title={t("spent", { spent: usd(a.spentUsdMicros, locale), budget: usdCents(a.budgetUsdCents, locale) })}>
          <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
            <div className={cn("h-full rounded-full", share >= 1 ? "bg-destructive" : share > 0.8 ? "bg-warning" : "bg-brand-gradient")} style={{ width: `${Math.max(2, share * 100)}%` }} />
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground tabular">{t("spent", { spent: usd(a.spentUsdMicros, locale), budget: usdCents(a.budgetUsdCents, locale) })}</p>
        </div>
        <Switch
          checked={draft.enabled}
          disabled={!canEdit || pending}
          aria-label={t("enabled", { agent: tAgents(`${a.agent}.name`) })}
          onCheckedChange={(enabled) => {
            // El interruptor guarda al momento solo el encendido; lo que se esté editando abajo sigue igual.
            setDraft((current) => ({ ...current, enabled }));
            persist({ ...initial, enabled }, { full: false, revert: () => setDraft((current) => ({ ...current, enabled: initial.enabled })) });
          }}
        />
        <Button variant="ghost" size="icon-sm" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={t("configure", { agent: tAgents(`${a.agent}.name`) })}>
          <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
        </Button>
      </div>
      {open && (
        <div className="border-t px-5 py-4">
          <p className="mb-4 text-xs text-muted-foreground">{tAgents(`${a.agent}.mission`)}</p>
          <fieldset disabled={!canEdit || pending} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FormField id={`agent-${a.agent}-model`} label={t("model")} description={t("modelHint")}>
              <Select value={draft.model} onValueChange={(model) => setDraft({ ...draft, model: model as Draft["model"] })}>
                <SelectTrigger id={`agent-${a.agent}-model`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">{t("modelDefault", { model: config.model })}</SelectItem>
                  {COUNCIL_MODELS.map((model) => (
                    <SelectItem key={model} value={model}>
                      {model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField id={`agent-${a.agent}-budget`} label={t("budget")} description={t("budgetHint", { amount: usdCents(config.monthlyBudgetUsdCents, locale) })}>
              <InputGroup>
                <InputGroupInput
                  id={`agent-${a.agent}-budget`}
                  value={draft.budget}
                  placeholder={centsToInput(config.monthlyBudgetUsdCents)}
                  onChange={(event) => setDraft({ ...draft, budget: event.target.value })}
                  inputMode="decimal"
                  className="tabular"
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupText>{t("usdMonth")}</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
            </FormField>
            {keys.map((key) => (
              <FormField
                key={key}
                id={`agent-${a.agent}-${key}`}
                label={tThresholds(`${key}.label`)}
                description={tThresholds(`${key}.hint`, { default: config.thresholds[key] ?? 0, min: THRESHOLD_LIMITS[key].min, max: THRESHOLD_LIMITS[key].max })}
              >
                <InputGroup>
                  <InputGroupInput
                    id={`agent-${a.agent}-${key}`}
                    value={draft.thresholds[key] ?? ""}
                    placeholder={String(config.thresholds[key] ?? "")}
                    onChange={(event) => setDraft({ ...draft, thresholds: { ...draft.thresholds, [key]: event.target.value } })}
                    inputMode="numeric"
                    className="tabular"
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupText>{tThresholds(`${key}.unit`)}</InputGroupText>
                  </InputGroupAddon>
                </InputGroup>
              </FormField>
            ))}
          </fieldset>
          {error && <p className="mt-3 text-xs font-semibold text-destructive">{error}</p>}
          {canEdit && (
            <div className="mt-4 flex items-center justify-end gap-2">
              {dirty && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDraft(initial);
                    setError(null);
                  }}
                  disabled={pending}
                >
                  {t("reset")}
                </Button>
              )}
              <Button size="sm" onClick={() => persist(draft, { full: true, revert: () => undefined })} disabled={!dirty || pending}>
                {pending ? tCommon("saving") : tCommon("save")}
              </Button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
