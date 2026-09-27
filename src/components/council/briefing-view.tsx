"use client";

import { ArrowUpRight, ChevronDown, Lightbulb, Scale, ShieldAlert, TriangleAlert, Wallet, Zap } from "lucide-react";
import Link from "next/link";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import type { BriefingContentV2, BriefingItemContent } from "@/council/briefing";
import type { ReportView } from "@/council/queries";
import type { EvidenceItem } from "@/council/types";
import { cn } from "@/lib/utils";
import { EvidenceList } from "./evidence-list";
import { civil, eur } from "./meta";

// Versión 1 (antes del plan de acción en cuatro secciones): se sigue enseñando tal cual.
type DecisionV1 = { title: string; why: string; urgency: string; recommendationId: string | null; evidence: string[] };
type Area = { area: string; status: string; note: string; evidence: string[] };
type BriefingContentV1 = {
  week?: { from: string; to: string };
  headline?: string;
  decisions?: DecisionV1[];
  cash?: { text: string; evidence: string[] };
  areas?: Area[];
  conflicts?: string | null;
};

const LIGHT: Record<string, string> = {
  verde: "bg-success",
  ambar: "bg-warning",
  rojo: "bg-destructive",
  sin_datos: "bg-muted-foreground/40",
};

const URGENCY_TONE: Record<string, string> = {
  hoy: "border-destructive/40 bg-destructive/10 text-destructive",
  esta_semana: "border-warning/40 bg-warning/10 text-warning",
  este_mes: "text-muted-foreground",
};

function pick(evidence: readonly EvidenceItem[], refs: readonly string[] | undefined): EvidenceItem[] {
  return (refs ?? []).flatMap((ref) => evidence.filter((e) => e.ref === ref));
}

function Expandable({ label, items, basePath }: { label: string; items: EvidenceItem[]; basePath: string }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  return (
    <div className="mt-2">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
        {label}
        <ChevronDown aria-hidden className={cn("size-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="mt-2">
          <EvidenceList items={items} basePath={basePath} />
        </div>
      )}
    </div>
  );
}

function Chip({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cn("inline-flex items-center rounded-full border px-2 text-[11px] font-semibold", className)}>{children}</span>;
}

/**
 * El briefing del lunes del Chief of Staff como plan de acción: las 3 acciones críticas (antes
 * del martes), las alertas de riesgo, las oportunidades de optimización y los conflictos entre
 * agentes ya resueltos, cada punto con su impacto en € y su urgencia; debajo, la caja y el
 * semáforo por área. Los briefings de antes (versión 1) se enseñan con su formato.
 */
export function BriefingView({ report, basePath }: { report: ReportView; basePath: string }) {
  const t = useTranslations("council.briefing");
  const format = useFormatter();
  const content = report.content as Partial<BriefingContentV2> & BriefingContentV1;
  const day = (date: string) => format.dateTime(civil(date), { day: "numeric", month: "long" });
  const v2 = content.version === 2;

  return (
    <article className="space-y-6">
      <header className="rounded-3xl border bg-card px-6 py-6 sm:px-8">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {t("week", { from: day(report.periodStart), to: day(report.periodEnd) })}
        </p>
        <h2 className="mt-2 text-2xl font-extrabold heading-tight md:text-3xl">{content.headline}</h2>
        <p className="mt-3 text-xs text-muted-foreground">
          {t("generated", { date: format.dateTime(new Date(report.createdAt), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) })}
          {" · "}
          {report.policyVersion === null ? t("policyExample") : t("policyVersion", { version: report.policyVersion })}
        </p>
      </header>

      {v2 ? <ActionPlan content={content as BriefingContentV2} report={report} basePath={basePath} /> : <DecisionsV1 content={content} report={report} basePath={basePath} />}

      <div className="grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <section aria-labelledby="briefing-cash" className="rounded-2xl border bg-card px-5 py-4">
          <h3 id="briefing-cash" className="flex items-center gap-2 text-sm font-bold">
            <Wallet aria-hidden className="size-4 text-primary" />
            {t("cash")}
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">{content.cash?.text}</p>
          <Expandable label={t("seeCalc")} items={pick(report.evidence, content.cash?.evidence)} basePath={basePath} />
        </section>

        <section aria-labelledby="briefing-areas" className="rounded-2xl border bg-card">
          <h3 id="briefing-areas" className="border-b px-5 py-3 text-sm font-bold">
            {t("areas")}
          </h3>
          <ul className="grid sm:grid-cols-2">
            {(content.areas ?? []).map((a) => (
              <li key={a.area} className="border-b px-5 py-3 text-sm sm:odd:border-r">
                <div className="flex items-center gap-2">
                  <span aria-hidden className={cn("size-2.5 rounded-full", LIGHT[a.status] ?? LIGHT.sin_datos)} />
                  <span className="font-semibold">{t(`area.${a.area}`)}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{t(`light.${a.status}`)}</span>
                </div>
                <p className="mt-1 text-muted-foreground">{a.note}</p>
                <Expandable label={t("seeCalc")} items={pick(report.evidence, a.evidence)} basePath={basePath} />
              </li>
            ))}
          </ul>
        </section>
      </div>

      {!v2 && typeof content.conflicts === "string" && content.conflicts && (
        <section className="rounded-2xl border border-dashed px-5 py-4 text-sm">
          <h3 className="flex items-center gap-2 font-bold">
            <Scale aria-hidden className="size-4 text-primary" />
            {t("conflicts")}
          </h3>
          <p className="mt-1 text-muted-foreground">{content.conflicts}</p>
        </section>
      )}
    </article>
  );
}

/** Impacto, agentes de origen, recomendación y evidencia de un punto del plan. */
function ItemMeta({ item, report, basePath }: { item: BriefingItemContent; report: ReportView; basePath: string }) {
  const t = useTranslations("council.briefing");
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {item.fromAgents.length > 0 && (
        <span className="mt-2 text-xs text-muted-foreground">{t("from", { agents: item.fromAgents.map((a) => t(`agentShort.${a}`)).join(" · ") })}</span>
      )}
      <Expandable label={t("seeCalc")} items={pick(report.evidence, item.evidence)} basePath={basePath} />
      {item.recommendationId && (
        <Link href={`${basePath}/council?id=${item.recommendationId}`} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
          {t("openRecommendation")}
          <ArrowUpRight aria-hidden className="size-3.5" />
        </Link>
      )}
    </div>
  );
}

function useImpact() {
  const t = useTranslations("council.briefing");
  const locale = useLocale();
  return (cents: number | null) => (cents === null ? null : t("impact", { amount: eur(cents, { locale, currency: "EUR" }) }));
}

function ActionPlan({ content, report, basePath }: { content: BriefingContentV2; report: ReportView; basePath: string }) {
  const t = useTranslations("council.briefing");
  const tLabels = useTranslations("council");
  const impact = useImpact();
  const top = content.topActions ?? [];
  const risks = content.riskAlerts ?? [];
  const optimizations = content.optimizations ?? [];
  const conflicts = content.conflicts ?? [];

  return (
    <>
      <section aria-labelledby="briefing-top" className="rounded-2xl border bg-card">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-5 py-3">
          <h3 id="briefing-top" className="flex items-center gap-2 text-sm font-bold">
            <Zap aria-hidden className="size-4 text-primary" />
            {t("topActions")}
          </h3>
          <span className="text-xs text-muted-foreground">{t("topActionsHint")}</span>
        </div>
        {top.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">{t("noTopActions")}</p>
        ) : (
          <ol className="divide-y">
            {top.map((d, i) => (
              <li key={i} className="flex gap-4 px-5 py-4">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-xs font-bold text-white tabular">{i + 1}</span>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{t("priority", { n: i + 1 })}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{d.title}</p>
                    {impact(d.impactCents) && <Chip className="tabular">{impact(d.impactCents)}</Chip>}
                    <Chip className={URGENCY_TONE[d.urgency]}>{t("urgency", { urgency: tLabels(`urgency.${d.urgency}`) })}</Chip>
                  </div>
                  <p className="mt-1 text-muted-foreground">{d.why}</p>
                  <p className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground">
                    <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0 text-warning" />
                    <span>{t("ifNotDone", { text: d.ifNotDone })}</span>
                  </p>
                  <ItemMeta item={d} report={report} basePath={basePath} />
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="briefing-risks" className="rounded-2xl border bg-card">
          <h3 id="briefing-risks" className="flex items-center gap-2 border-b px-5 py-3 text-sm font-bold">
            <ShieldAlert aria-hidden className="size-4 text-destructive" />
            {t("riskAlerts")}
          </h3>
          {risks.length === 0 ? (
            <p className="px-5 py-5 text-sm text-muted-foreground">{t("noRiskAlerts")}</p>
          ) : (
            <ul className="divide-y">
              {risks.map((d, i) => (
                <li key={i} className="px-5 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip className="border-destructive/30 text-destructive">{t(`risk.${d.risk}`)}</Chip>
                    <p className="font-semibold">{d.title}</p>
                    {impact(d.impactCents) && <Chip className="tabular">{impact(d.impactCents)}</Chip>}
                  </div>
                  <p className="mt-1 text-muted-foreground">{d.why}</p>
                  <ItemMeta item={d} report={report} basePath={basePath} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="briefing-optimizations" className="rounded-2xl border bg-card">
          <h3 id="briefing-optimizations" className="flex items-center gap-2 border-b px-5 py-3 text-sm font-bold">
            <Lightbulb aria-hidden className="size-4 text-primary" />
            {t("optimizations")}
          </h3>
          {optimizations.length === 0 ? (
            <p className="px-5 py-5 text-sm text-muted-foreground">{t("noOptimizations")}</p>
          ) : (
            <ul className="divide-y">
              {optimizations.map((d, i) => (
                <li key={i} className="px-5 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{d.title}</p>
                    {impact(d.impactCents) && <Chip className="tabular">{impact(d.impactCents)}</Chip>}
                  </div>
                  <p className="mt-1 text-muted-foreground">{d.why}</p>
                  <ItemMeta item={d} report={report} basePath={basePath} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {conflicts.length > 0 && (
        <section aria-labelledby="briefing-conflicts" className="rounded-2xl border border-dashed bg-card/40">
          <h3 id="briefing-conflicts" className="flex items-center gap-2 border-b border-dashed px-5 py-3 text-sm font-bold">
            <Scale aria-hidden className="size-4 text-primary" />
            {t("resolvedConflicts")}
          </h3>
          <ul className="divide-y divide-dashed">
            {conflicts.map((c, i) => (
              <li key={i} className="px-5 py-3 text-sm">
                <p className="text-xs font-semibold text-muted-foreground">{c.agents.map((a) => t(`agentShort.${a}`)).join(" ↔ ")}</p>
                <p className="mt-1 text-muted-foreground">{c.tension}</p>
                <p className="mt-1 font-medium">{t("decision", { text: c.decision })}</p>
                <Expandable label={t("seeCalc")} items={pick(report.evidence, c.evidence)} basePath={basePath} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/** Las decisiones de un briefing de la versión 1. */
function DecisionsV1({ content, report, basePath }: { content: BriefingContentV1; report: ReportView; basePath: string }) {
  const t = useTranslations("council.briefing");
  const tLabels = useTranslations("council");
  const decisions = content.decisions ?? [];
  return (
    <section aria-labelledby="briefing-decisions" className="rounded-2xl border bg-card">
      <h3 id="briefing-decisions" className="border-b px-5 py-3 text-sm font-bold">
        {t("decisions", { count: decisions.length })}
      </h3>
      {decisions.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">{t("noDecisions")}</p>
      ) : (
        <ol className="divide-y">
          {decisions.map((d, i) => (
            <li key={i} className="flex gap-4 px-5 py-4">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-xs font-bold text-white tabular">{i + 1}</span>
              <div className="min-w-0 flex-1 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">{d.title}</p>
                  <span className="rounded-full border px-2 text-[11px] font-semibold text-muted-foreground">{tLabels(`urgency.${d.urgency}`)}</span>
                </div>
                <p className="mt-1 text-muted-foreground">{d.why}</p>
                <div className="flex flex-wrap items-center gap-4">
                  <Expandable label={t("seeCalc")} items={pick(report.evidence, d.evidence)} basePath={basePath} />
                  {d.recommendationId && (
                    <Link href={`${basePath}/council?id=${d.recommendationId}`} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                      {t("openRecommendation")}
                      <ArrowUpRight aria-hidden className="size-3.5" />
                    </Link>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
