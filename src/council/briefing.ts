// El briefing del lunes tal como se guarda (reports.content) y se enseña: la salida ya comprobada
// del Chief of Staff (src/council/guardrails) con las evidencias por referencia. Versión 2: las
// cuatro secciones del plan de acción (acciones críticas, alertas de riesgo, oportunidades de
// optimización y conflictos resueltos), cada punto con su impacto en € y su urgencia. Los
// briefings guardados antes (versión 1: «decisiones» y un conflicto en texto) se siguen leyendo.

import type { CheckedBriefing, CheckedBriefingItem } from "./guardrails";

export const BRIEFING_CONTENT_VERSION = 2;

export type BriefingItemContent = {
  title: string;
  why: string;
  impactCents: number | null;
  recommendationId: string | null;
  fromAgents: string[];
  evidence: string[];
};

export type BriefingContentV2 = {
  version: 2;
  week: { from: string; to: string };
  headline: string;
  topActions: (BriefingItemContent & { urgency: string; ifNotDone: string })[];
  riskAlerts: (BriefingItemContent & { risk: string })[];
  optimizations: BriefingItemContent[];
  conflicts: { agents: string[]; tension: string; decision: string; evidence: string[] }[];
  cash: { text: string; evidence: string[] };
  areas: { area: string; status: string; note: string; evidence: string[] }[];
  policy: { version: number | null; is_example: boolean };
};

const refs = (items: readonly { ref: string }[]) => items.map((e) => e.ref);

/**
 * Lo que se guarda del briefing. Un punto que se basa en una recomendación abierta y no trae su
 * propia métrica de impacto hereda el impacto de esa recomendación (que ya salió de una métrica).
 */
export function briefingContent(
  b: CheckedBriefing,
  opts: { week: { from: string; to: string }; openImpact: ReadonlyMap<string, number | null>; policy: { version: number | null; is_example: boolean } },
): BriefingContentV2 {
  const item = (d: CheckedBriefingItem): BriefingItemContent => ({
    title: d.title,
    why: d.why,
    impactCents: d.impactCents ?? (d.recommendationId ? (opts.openImpact.get(d.recommendationId) ?? null) : null),
    recommendationId: d.recommendationId,
    fromAgents: d.fromAgents,
    evidence: refs(d.evidence),
  });
  return {
    version: BRIEFING_CONTENT_VERSION,
    week: opts.week,
    headline: b.headline,
    topActions: b.topActions.map((d) => ({ ...item(d), urgency: d.urgency, ifNotDone: d.ifNotDone })),
    riskAlerts: b.riskAlerts.map((d) => ({ ...item(d), risk: d.risk })),
    optimizations: b.optimizations.map(item),
    conflicts: b.conflicts.map((c) => ({ agents: c.agents, tension: c.tension, decision: c.decision, evidence: refs(c.evidence) })),
    cash: { text: b.cash.text, evidence: refs(b.cash.evidence) },
    areas: b.areas.map((a) => ({ ...a, evidence: refs(a.evidence) })),
    policy: opts.policy,
  };
}
