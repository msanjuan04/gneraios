import { BellOff, BrainCircuit, Calculator, FileSearch, KeyRound, Landmark, Lock, Scale } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { AGENTS } from "@/council/agents";
import { AGENT_NAMES } from "@/council/types";
import { AGENT_ICONS } from "./meta";
import { cadenceOf } from "./cadence";

const PRINCIPLES = [
  { key: "neverCalculates", icon: Calculator },
  { key: "evidence", icon: FileSearch },
  { key: "readOnly", icon: Lock },
  { key: "policy", icon: Landmark },
  { key: "professional", icon: Scale },
  { key: "silence", icon: BellOff },
] as const;

/**
 * Lo que se ve sin clave de la API (o antes de la primera recomendación): qué hace el consejo, sus
 * principios, sus nueve agentes y cómo conectarlo.
 */
export async function CouncilIntro({ variant, isOwner }: { variant: "connect" | "empty"; isOwner: boolean }) {
  const t = await getTranslations("council.intro");
  const tAgents = await getTranslations("council.agents");
  const tCadence = await getTranslations("council.cadence");

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div className="relative overflow-hidden rounded-3xl border bg-card/50 px-6 py-10 text-center sm:px-10">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-24 mx-auto h-48 max-w-lg rounded-full bg-brand-gradient opacity-20 blur-3xl" />
        <div className="relative mx-auto flex size-14 items-center justify-center rounded-2xl bg-brand-gradient text-white shadow-[0_10px_40px_rgb(46_128_255/0.35)]">
          <BrainCircuit className="size-6" />
        </div>
        <h2 className="relative mt-6 text-2xl font-extrabold heading-tight md:text-3xl">{t(`${variant}.title`)}</h2>
        <p className="relative mx-auto mt-3 max-w-2xl text-muted-foreground">{t(`${variant}.body`)}</p>

        <ul className="relative mx-auto mt-8 grid max-w-4xl gap-3 text-left sm:grid-cols-2 lg:grid-cols-3">
          {PRINCIPLES.map(({ key, icon: Icon }) => (
            <li key={key} className="flex gap-3 rounded-2xl border bg-background/60 p-4">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Icon aria-hidden className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{t(`principles.${key}.title`)}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{t(`principles.${key}.body`)}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      {variant === "connect" && (
        <section aria-labelledby="council-connect-steps" className="rounded-3xl border bg-card px-6 py-6 sm:px-8">
          <h3 id="council-connect-steps" className="flex items-center gap-2 text-base font-bold">
            <KeyRound aria-hidden className="size-4 text-primary" />
            {t("connect.stepsTitle")}
          </h3>
          <ol className="mt-4 space-y-3 text-sm">
            {(["key", "env", "cron", "policy"] as const).map((step, index) => (
              <li key={step} className="flex gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold tabular">{index + 1}</span>
                <span className="min-w-0 pt-0.5">
                  <span className="font-semibold">{t(`connect.steps.${step}.title`)}</span>
                  <span className="mt-0.5 block text-muted-foreground">{t(`connect.steps.${step}.body`)}</span>
                  {step === "env" && <code className="mt-2 block rounded-lg bg-muted px-3 py-2 font-mono text-xs select-all">ANTHROPIC_API_KEY=sk-ant-…</code>}
                  {step === "cron" && <code className="mt-2 block rounded-lg bg-muted px-3 py-2 font-mono text-xs break-all select-all">POST /api/cron/council · Authorization: Bearer $CRON_SECRET · 0 * * * *</code>}
                </span>
              </li>
            ))}
          </ol>
          {!isOwner && <p className="mt-4 text-xs text-muted-foreground">{t("connect.ownerOnly")}</p>}
        </section>
      )}

      <section aria-labelledby="council-agents" className="rounded-3xl border bg-card px-6 py-6 sm:px-8">
        <h3 id="council-agents" className="text-base font-bold">
          {t("agentsTitle")}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">{t("agentsBody")}</p>
        <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {AGENT_NAMES.map((name) => {
            const Icon = AGENT_ICONS[name];
            return (
              <li key={name} className="rounded-2xl border bg-background/60 p-4">
                <div className="flex items-center gap-2">
                  <span className="flex size-7 items-center justify-center rounded-lg bg-secondary text-primary">
                    <Icon aria-hidden className="size-4" />
                  </span>
                  <span className="text-sm font-semibold">{tAgents(`${name}.name`)}</span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{tAgents(`${name}.mission`)}</p>
                <p className="mt-2 text-[11px] font-medium text-muted-foreground/80">{tCadence(cadenceOf(AGENTS[name]).key, cadenceOf(AGENTS[name]).values)}</p>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
