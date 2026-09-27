// Del JSON de un escenario a lo que necesita el runner: los datos (el escenario de referencia con
// sus cambios), el almacén en memoria con la política, los ajustes y las recomendaciones previas.

import type { FixtureDeal, FixtureFinance } from "../data/fixture";
import type { Scenario, ScenarioClient, ScenarioProject } from "../data/scenario";
import type { CouncilActivity } from "../data/types";
import { EXAMPLE_POLICY, type FinancialPolicy, financialPolicySchema } from "../policy/schema";
import { localNow } from "../schedule";
import type { MemoryCouncilStore } from "../store/memory";
import type { AgentSettingsRecord } from "../store/types";
import { agencyScenario, financeFixture, memoryStore, ORG_ID, projectsFixture } from "../testing";
import type { EvalScenario } from "./types";

/** Sábado 26/09/2026 a las 10:00 en Madrid (el "hoy" de testing.ts). */
export const DEFAULT_NOW = "2026-09-26T08:00:00Z";
const DAY_MS = 86_400_000;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge<T>(base: T, patch: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch)) {
    out[key] = isObject(value) && isObject(out[key]) ? deepMerge(out[key], value) : value;
  }
  return out as T;
}

/** La política del escenario: null si es la de ejemplo (no hay ninguna guardada). */
export function scenarioPolicy(s: EvalScenario): FinancialPolicy | null {
  if (s.policy === "example") return null;
  return financialPolicySchema.parse(deepMerge(EXAMPLE_POLICY, s.policy));
}

/** Los datos del negocio: la agencia de testing.ts con los cambios del escenario. */
export function scenarioData(s: EvalScenario, now: Date): Scenario {
  const base = agencyScenario();
  const d = s.data;
  const removedDeals = new Set(d.removeDeals);
  const removedClients = new Set(d.removeClients);
  const clients: ScenarioClient[] = [
    ...base.clients.filter((c) => !removedClients.has(c.id)).map((c) => (d.unpaid && c.id in d.unpaid ? { ...c, unpaid: d.unpaid[c.id] } : c)),
    ...(d.clients as ScenarioClient[]),
  ];
  const deals: FixtureDeal[] = [...(base.deals ?? []).filter((deal) => !removedDeals.has(deal.id) && !removedClients.has(deal.clientId)), ...(d.deals as FixtureDeal[])];
  const finance = d.finance === undefined ? null : d.finance === "default" ? financeFixture() : financeFixture(d.finance as Partial<FixtureFinance>);
  const projects = d.projects === undefined ? base.projects : d.projects === "default" ? projectsFixture() : (d.projects as ScenarioProject[]);
  return {
    ...base,
    today: localNow(now, "Europe/Madrid").date,
    clients,
    deals,
    history: (base.history ?? []).filter((h) => !removedDeals.has(h.dealId)),
    activities: [...(base.activities ?? []).filter((a) => !(a.dealId && removedDeals.has(a.dealId)) && !removedClients.has(a.clientId)), ...(d.activities as CouncilActivity[])],
    finance,
    seo: (d.seo as Scenario["seo"]) ?? base.seo ?? null,
    projects,
  };
}

/** El almacén con la política, los ajustes y las recomendaciones que ya había. Devuelve los ids de estas. */
export async function scenarioStore(s: EvalScenario, now: Date): Promise<{ store: MemoryCouncilStore; existingIds: string[] }> {
  const policy = scenarioPolicy(s);
  const settings: AgentSettingsRecord[] = s.settings.map((x) => ({ agent: x.agent, enabled: x.enabled, model: x.model, monthlyBudgetUsdCents: x.monthlyBudgetUsdCents, thresholds: x.thresholds }));
  const store = memoryStore({ policy: policy ?? undefined, settings, now: () => now });
  const existingIds: string[] = [];
  for (const e of s.existing) {
    const [id] = await store.insertRecommendations(ORG_ID, [
      {
        agent: e.agent,
        runId: null,
        kind: e.kind,
        title: e.title,
        summary: e.summary || e.title,
        reasoning: "",
        evidence: [],
        proposedActions: [],
        missingData: [],
        impactCents: e.impactCents,
        confidence: e.confidence,
        urgency: e.urgency,
        risks: null,
        requiresProfessionalReview: false,
        challenge: null,
        policyVersion: policy ? 1 : null,
        subject: e.subject,
        dedupeKey: `${e.agent}:${e.subject}`,
      },
    ]);
    if (!id) throw new Error(`Escenario ${s.id}: la recomendación previa «${e.title}» choca con otra abierta`);
    const rec = store.recommendations.find((r) => r.id === id)!;
    const when = new Date(now.getTime() - e.daysAgo * DAY_MS).toISOString();
    rec.createdAt = when;
    if (e.status !== "nueva") {
      store.decide(id, e.status, e.decisionNote);
      rec.decidedAt = when;
      if (e.status === "pospuesta") rec.postponedUntil = new Date(now.getTime() + 7 * DAY_MS).toISOString().slice(0, 10);
    }
    existingIds.push(id);
  }
  return { store, existingIds };
}
