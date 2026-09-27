import "server-only";

// Lecturas de las pantallas del consejo con la sesión del usuario: todo pasa por RLS (las
// recomendaciones, los informes y las tareas los ve cualquier miembro; las ejecuciones, un owner).

import { AGENT_CONFIG, type CouncilModel, isCouncilModel } from "@/council/agents.config";
import { AGENTS } from "@/council/agents";
import { resolvePolicy, type ResolvedPolicy } from "@/council/policy/schema";
import { councilProvider, isCouncilConfigured } from "@/council/runtime/provider";
import type { AgentName, EvidenceItem, ProposedAction, RecommendationStatus } from "@/council/types";
import { AGENT_NAMES } from "@/council/types";
import type { Tables } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

export type AgentStatusView = {
  agent: AgentName;
  enabled: boolean;
  model: CouncilModel;
  modelIsDefault: boolean;
  budgetUsdCents: number;
  spentUsdMicros: number;
  budgetExhausted: boolean;
  pending: number;
  running: number;
  lastStatus: string | null;
  lastFinishedAt: string | null;
  lastError: string | null;
  runnable: boolean;
  thresholds: Record<string, unknown>;
};

export type ChallengeView = {
  status: string;
  verdict?: string;
  weakAssumptions?: string[];
  risks?: string;
  pessimisticScenario?: string;
  confidence?: string;
  reason?: string;
  evidence?: EvidenceItem[];
};

export type RecommendationView = {
  id: string;
  agent: AgentName;
  kind: string;
  title: string;
  summary: string;
  reasoning: string;
  evidence: EvidenceItem[];
  proposedActions: ProposedAction[];
  missingData: string[];
  impactCents: number | null;
  confidence: string;
  urgency: string;
  risks: string | null;
  requiresProfessionalReview: boolean;
  challenge: ChallengeView | null;
  policyVersion: number | null;
  status: RecommendationStatus;
  decisionNote: string | null;
  postponedUntil: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  createdAt: string;
  tasks: { total: number; done: number };
};

export type TaskView = {
  id: string;
  title: string;
  dueOn: string | null;
  doneAt: string | null;
  recommendationId: string;
  recommendationTitle: string;
  agent: AgentName;
};

export type ReportView = {
  id: string;
  kind: "weekly_briefing" | "monthly_close";
  agent: AgentName;
  periodStart: string;
  periodEnd: string;
  content: Record<string, unknown>;
  evidence: EvidenceItem[];
  policyVersion: number | null;
  status: "published" | "accepted";
  decision: Record<string, unknown> | null;
  decisionNote: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  createdAt: string;
};

export type RunView = {
  id: string;
  agent: AgentName;
  trigger: string;
  status: string;
  runtime: string;
  model: string | null;
  parentRunId: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsdMicros: number;
  durationMs: number | null;
  attempts: number;
  error: string | null;
  toolCalls: { id: string; name: string; input: unknown; status: string; summary: string; durationMs: number }[];
  output: Record<string, unknown> | null;
  startedAt: string;
};

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function memberNames(supabase: Supabase, orgId: string): Promise<Map<string, string>> {
  const { data, error } = await supabase.from("members").select("user_id, full_name").eq("org_id", orgId);
  if (error) throw error;
  return new Map((data ?? []).map((m) => [m.user_id, m.full_name]));
}

function toChallenge(value: unknown): ChallengeView | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  return {
    status: String(v.status ?? ""),
    verdict: typeof v.verdict === "string" ? v.verdict : undefined,
    weakAssumptions: Array.isArray(v.weak_assumptions) ? (v.weak_assumptions as string[]) : undefined,
    risks: typeof v.risks === "string" ? v.risks : undefined,
    pessimisticScenario: typeof v.pessimistic_scenario === "string" ? v.pessimistic_scenario : undefined,
    confidence: typeof v.confidence === "string" ? v.confidence : undefined,
    reason: typeof v.reason === "string" ? v.reason : undefined,
    evidence: Array.isArray(v.evidence) ? (v.evidence as EvidenceItem[]) : undefined,
  };
}

function toRecommendation(r: Tables<"recommendations">, names: Map<string, string>, tasks: Map<string, { total: number; done: number }>): RecommendationView {
  return {
    id: r.id,
    agent: r.agent,
    kind: r.kind,
    title: r.title,
    summary: r.summary,
    reasoning: r.reasoning,
    evidence: (r.evidence ?? []) as unknown as EvidenceItem[],
    proposedActions: (r.proposed_actions ?? []) as unknown as ProposedAction[],
    missingData: (r.missing_data ?? []) as unknown as string[],
    impactCents: r.impact_eur_cents,
    confidence: r.confidence,
    urgency: r.urgency,
    risks: r.risks,
    requiresProfessionalReview: r.requires_professional_review,
    challenge: toChallenge(r.challenge),
    policyVersion: r.policy_version,
    status: r.status,
    decisionNote: r.decision_note,
    postponedUntil: r.postponed_until,
    decidedAt: r.decided_at,
    decidedBy: r.decided_by ? (names.get(r.decided_by) ?? null) : null,
    createdAt: r.created_at,
    tasks: tasks.get(r.id) ?? { total: 0, done: 0 },
  };
}

/** Si el consejo puede trabajar: hace falta la clave de un proveedor, Claude o Groq (solo se lee en el servidor). */
export function councilConfigured(): boolean {
  return isCouncilConfigured();
}

/** Con qué proveedor trabaja el consejo (null sin clave). */
export function councilProviderName(): "anthropic" | "groq" | null {
  return councilProvider();
}

/** Estado de cada agente: ajustes efectivos (los de la org sobre los de por defecto), cola y gasto del mes. */
export async function getAgentStatuses(orgId: string): Promise<AgentStatusView[]> {
  const supabase = await createClient();
  const [settings, status] = await Promise.all([
    supabase.from("agent_settings").select("agent, enabled, model, monthly_budget_usd_cents, thresholds").eq("org_id", orgId),
    supabase.rpc("council_status", { p_org: orgId }),
  ]);
  if (settings.error) throw settings.error;
  if (status.error) throw status.error;
  return AGENT_NAMES.map((agent) => {
    const s = settings.data?.find((row) => row.agent === agent);
    const st = status.data?.find((row) => row.agent === agent);
    const config = AGENT_CONFIG[agent];
    const model = s?.model && isCouncilModel(s.model) ? s.model : config.model;
    const budget = s?.monthly_budget_usd_cents ?? config.monthlyBudgetUsdCents;
    const spent = Number(st?.month_cost_usd_micros ?? 0);
    return {
      agent,
      enabled: s?.enabled ?? true,
      model,
      modelIsDefault: !(s?.model && isCouncilModel(s.model)),
      budgetUsdCents: budget,
      spentUsdMicros: spent,
      budgetExhausted: spent >= budget * 10_000,
      pending: st?.pending_jobs ?? 0,
      running: st?.running_jobs ?? 0,
      lastStatus: st?.last_status ?? null,
      lastFinishedAt: st?.last_finished_at ?? null,
      lastError: st?.last_error ?? null,
      runnable: AGENTS[agent].manualTask !== null,
      thresholds: (s?.thresholds ?? {}) as Record<string, unknown>,
    };
  });
}

export type FeedTab = "new" | "postponed" | "accepted" | "history";

/** Las recomendaciones de una pestaña del feed. "Nuevas" incluye las pospuestas que ya vuelven (hoy o antes). */
export async function listRecommendations(orgId: string, tab: FeedTab, today: string): Promise<RecommendationView[]> {
  const supabase = await createClient();
  let query = supabase.from("recommendations").select("*").eq("org_id", orgId);
  if (tab === "new") query = query.or(`status.eq.nueva,and(status.eq.pospuesta,postponed_until.lte.${today})`);
  if (tab === "postponed") query = query.eq("status", "pospuesta").gt("postponed_until", today);
  if (tab === "accepted") query = query.eq("status", "aceptada");
  if (tab === "history") query = query.in("status", ["hecha", "descartada"]);
  const { data, error } = await query.order(tab === "history" ? "decided_at" : "created_at", { ascending: false }).limit(100);
  if (error) throw error;
  const rows = data ?? [];
  const [names, tasks] = await Promise.all([memberNames(supabase, orgId), taskCounts(supabase, rows.map((r) => r.id))]);
  const urgency = { hoy: 0, esta_semana: 1, este_mes: 2 } as const;
  const views = rows.map((r) => toRecommendation(r, names, tasks));
  if (tab === "new") views.sort((a, b) => urgency[a.urgency as keyof typeof urgency] - urgency[b.urgency as keyof typeof urgency] || (b.impactCents ?? -1) - (a.impactCents ?? -1));
  return views;
}

async function taskCounts(supabase: Supabase, ids: string[]): Promise<Map<string, { total: number; done: number }>> {
  const out = new Map<string, { total: number; done: number }>();
  if (ids.length === 0) return out;
  const { data, error } = await supabase.from("council_tasks").select("recommendation_id, done_at").in("recommendation_id", ids);
  if (error) throw error;
  for (const t of data ?? []) {
    const entry = out.get(t.recommendation_id) ?? { total: 0, done: 0 };
    entry.total += 1;
    if (t.done_at) entry.done += 1;
    out.set(t.recommendation_id, entry);
  }
  return out;
}

/** Cuántas hay en cada pestaña (para los contadores). */
export async function feedCounts(orgId: string, today: string): Promise<Record<FeedTab, number>> {
  const supabase = await createClient();
  const base = () => supabase.from("recommendations").select("id", { count: "exact", head: true }).eq("org_id", orgId);
  const [fresh, postponed, accepted] = await Promise.all([
    base().or(`status.eq.nueva,and(status.eq.pospuesta,postponed_until.lte.${today})`),
    base().eq("status", "pospuesta").gt("postponed_until", today),
    base().eq("status", "aceptada"),
  ]);
  for (const result of [fresh, postponed, accepted]) if (result.error) throw result.error;
  return { new: fresh.count ?? 0, postponed: postponed.count ?? 0, accepted: accepted.count ?? 0, history: 0 };
}

/** En qué pestaña del feed está una recomendación (para abrir un enlace directo, p. ej. desde el briefing). */
export async function recommendationTab(orgId: string, id: string, today: string): Promise<FeedTab | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("recommendations").select("status, postponed_until").eq("org_id", orgId).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (data.status === "nueva" || (data.status === "pospuesta" && data.postponed_until !== null && data.postponed_until <= today)) return "new";
  if (data.status === "pospuesta") return "postponed";
  if (data.status === "aceptada") return "accepted";
  return "history";
}

/** Tareas abiertas del consejo (lo que salió de aceptar recomendaciones). */
export async function listOpenTasks(orgId: string): Promise<TaskView[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("council_tasks")
    .select("id, title, due_on, done_at, recommendation_id, recommendations!inner(title, agent)")
    .eq("org_id", orgId)
    .is("done_at", null)
    .order("due_on", { ascending: true, nullsFirst: false })
    .order("position")
    .limit(50);
  if (error) throw error;
  return (data ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    dueOn: t.due_on,
    doneAt: t.done_at,
    recommendationId: t.recommendation_id,
    recommendationTitle: t.recommendations.title,
    agent: t.recommendations.agent,
  }));
}

function toReport(r: Tables<"council_reports">, names: Map<string, string>): ReportView {
  return {
    id: r.id,
    kind: r.kind,
    agent: r.agent,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    content: (r.content ?? {}) as Record<string, unknown>,
    evidence: (r.evidence ?? []) as unknown as EvidenceItem[],
    policyVersion: r.policy_version,
    status: r.status,
    decision: (r.decision ?? null) as Record<string, unknown> | null,
    decisionNote: r.decision_note,
    decidedAt: r.decided_at,
    decidedBy: r.decided_by ? (names.get(r.decided_by) ?? null) : null,
    createdAt: r.created_at,
  };
}

/** El informe pedido (o el último) de un tipo, y la lista de los anteriores para cambiar de uno a otro. */
export async function getReport(orgId: string, kind: "weekly_briefing" | "monthly_close", id: string | null): Promise<{ report: ReportView | null; history: { id: string; periodStart: string; periodEnd: string; status: string; createdAt: string }[] }> {
  const supabase = await createClient();
  const [list, names] = await Promise.all([
    supabase.from("council_reports").select("id, period_start, period_end, status, created_at").eq("org_id", orgId).eq("kind", kind).order("period_start", { ascending: false }).order("created_at", { ascending: false }).limit(24),
    memberNames(supabase, orgId),
  ]);
  if (list.error) throw list.error;
  const history = (list.data ?? []).map((r) => ({ id: r.id, periodStart: r.period_start, periodEnd: r.period_end, status: r.status, createdAt: r.created_at }));
  const target = id && history.some((h) => h.id === id) ? id : (history.find((h) => h.status === "accepted" && kind === "monthly_close" && h.periodStart === history[0]?.periodStart)?.id ?? history[0]?.id ?? null);
  if (!target) return { report: null, history };
  const { data, error } = await supabase.from("council_reports").select("*").eq("org_id", orgId).eq("id", target).single();
  if (error) throw error;
  return { report: toReport(data, names), history };
}

/** Ejecuciones recientes (solo las ve un owner: RLS). */
export async function listRuns(orgId: string, limit = 60): Promise<RunView[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("agent_runs").select("*").eq("org_id", orgId).order("started_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    agent: r.agent,
    trigger: r.trigger,
    status: r.status,
    runtime: r.runtime,
    model: r.model,
    parentRunId: r.parent_run_id,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    cacheReadTokens: r.cache_read_tokens,
    cacheWriteTokens: r.cache_write_tokens,
    costUsdMicros: Number(r.cost_usd_micros),
    durationMs: r.duration_ms,
    attempts: r.attempts,
    error: r.error,
    toolCalls: (r.tool_calls ?? []) as RunView["toolCalls"],
    output: (r.output ?? null) as Record<string, unknown> | null,
    startedAt: r.started_at,
  }));
}

export type PolicyVersionView = { version: number; createdAt: string; createdBy: string | null; note: string | null };

/** La política vigente (o la de ejemplo) y sus versiones anteriores. */
export async function getPolicyWithHistory(orgId: string): Promise<{ current: ResolvedPolicy; versions: PolicyVersionView[]; invalid: boolean }> {
  const supabase = await createClient();
  const [{ data, error }, names] = await Promise.all([
    supabase.from("financial_policies").select("version, data, note, created_at, created_by").eq("org_id", orgId).order("version", { ascending: false }).limit(30),
    memberNames(supabase, orgId),
  ]);
  if (error) throw error;
  const rows = data ?? [];
  const versions = rows.map((r) => ({ version: r.version, createdAt: r.created_at, createdBy: r.created_by ? (names.get(r.created_by) ?? null) : null, note: r.note }));
  const latest = rows[0];
  try {
    return { current: resolvePolicy(latest ? { version: latest.version, data: latest.data, createdAt: latest.created_at, note: latest.note } : null), versions, invalid: false };
  } catch {
    return { current: resolvePolicy(null), versions, invalid: true };
  }
}

export type UpsellRuleView = Tables<"upsell_rules">;

export async function listUpsellRules(orgId: string): Promise<UpsellRuleView[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("upsell_rules").select("*").eq("org_id", orgId).order("position").order("created_at");
  if (error) throw error;
  return data ?? [];
}

/** Acierto de previsiones por agente: los seguimientos a 30/60/90 días ya hechos. */
export async function reviewAccuracy(orgId: string): Promise<Record<AgentName, { hit: number; partial: number; miss: number; noData: number }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("recommendation_reviews").select("outcome, recommendations!inner(agent)").eq("org_id", orgId).eq("state", "done");
  if (error) throw error;
  const out = Object.fromEntries(AGENT_NAMES.map((a) => [a, { hit: 0, partial: 0, miss: 0, noData: 0 }])) as Record<AgentName, { hit: number; partial: number; miss: number; noData: number }>;
  for (const row of data ?? []) {
    const entry = out[row.recommendations.agent];
    if (row.outcome === "hit") entry.hit += 1;
    else if (row.outcome === "partial") entry.partial += 1;
    else if (row.outcome === "miss") entry.miss += 1;
    else entry.noData += 1;
  }
  return out;
}
