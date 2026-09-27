// Lo que el runner lee y escribe del propio consejo (cola, ajustes, política, ejecuciones,
// recomendaciones, informes y revisiones). Dos implementaciones: Supabase con service_role
// (store/supabase.ts, siempre filtrando por org) y memoria (store/memory.ts) para tests y evals.
// El negocio se lee aparte, por CouncilData, que es de solo lectura.

import type { CivilDate } from "@/domain/dates/civil-date";
import type { PolicyRecord } from "../policy/schema";
import type { PastRecommendation, PastRecommendationFilter, UpsellRule } from "../tools/types";
import type {
  AgentName,
  Confidence,
  EvidenceItem,
  ProposedAction,
  RecommendationKind,
  RecommendationStatus,
  ReviewOutcome,
  Urgency,
} from "../types";

export type JobStatus = "pending" | "running" | "done" | "failed" | "skipped" | "cancelled";

export type JobRecord = {
  id: string;
  orgId: string;
  agent: AgentName;
  trigger: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  runAfter: string;
  dedupeKey: string | null;
  requestedBy: string | null;
  createdAt: string;
};

export type NewJob = {
  orgId: string;
  agent: AgentName;
  trigger: string;
  payload?: Record<string, unknown>;
  dedupeKey?: string | null;
  runAfter?: string;
  maxAttempts?: number;
};

export type AgentSettingsRecord = {
  agent: AgentName;
  enabled: boolean;
  model: string | null;
  monthlyBudgetUsdCents: number | null;
  thresholds: Record<string, unknown>;
};

/** Una llamada a una tool tal como queda en el registro de la ejecución. */
export type ToolCallLog = {
  id: string;
  name: string;
  input: unknown;
  status: "ok" | "missing_data" | "error" | "denied";
  summary: string;
  durationMs: number;
};

export type Usage = { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };

export type RunStart = {
  orgId: string;
  agent: AgentName;
  jobId: string | null;
  parentRunId: string | null;
  trigger: string;
  runtime: string;
  model: string | null;
  input: Record<string, unknown>;
  policyVersion: number | null;
};

export type RunFinish = {
  status: "succeeded" | "failed" | "skipped";
  toolCalls: ToolCallLog[];
  output: unknown;
  error: string | null;
  attempts: number;
  usage: Usage;
  costUsdMicros: number;
  durationMs: number;
};

export type RunRecord = RunStart & RunFinish & { id: string; startedAt: string };

export type NewRecommendation = {
  agent: AgentName;
  runId: string | null;
  kind: RecommendationKind;
  title: string;
  summary: string;
  reasoning: string;
  evidence: EvidenceItem[];
  proposedActions: ProposedAction[];
  missingData: string[];
  impactCents: number | null;
  confidence: Confidence;
  urgency: Urgency;
  risks: string | null;
  requiresProfessionalReview: boolean;
  challenge: Record<string, unknown> | null;
  policyVersion: number | null;
  subject: string;
  dedupeKey: string;
};

export type StoredRecommendation = NewRecommendation & {
  id: string;
  orgId: string;
  status: RecommendationStatus;
  decisionNote: string | null;
  postponedUntil: CivilDate | null;
  decidedAt: string | null;
  createdAt: string;
};

export type ReportKind = "weekly_briefing" | "monthly_close";

export type NewReport = {
  orgId: string;
  kind: ReportKind;
  agent: AgentName;
  runId: string | null;
  periodStart: CivilDate;
  periodEnd: CivilDate;
  content: Record<string, unknown>;
  evidence: EvidenceItem[];
  policyVersion: number | null;
};

export type ReviewDue = {
  id: string;
  recommendationId: string;
  horizonDays: number;
  dueOn: CivilDate;
  estimatedImpactCents: number | null;
};

export type ReviewResult = {
  state: "done" | "skipped";
  outcome: ReviewOutcome | null;
  actualImpactCents: number | null;
  notes: string | null;
  evidence: EvidenceItem[];
  runId: string | null;
};

export interface CouncilStore {
  /** Orgs con su zona horaria (para programar los trabajos de cada una). */
  orgs(): Promise<{ id: string; timezone: string }[]>;
  enqueueJob(job: NewJob): Promise<{ id: string; created: boolean }>;
  claimJobs(opts: { limit: number; orgId?: string; jobIds?: string[] }): Promise<JobRecord[]>;
  finishJob(id: string, outcome: { status: JobStatus; error?: string | null; runAfter?: string }): Promise<void>;
  agentSettings(orgId: string): Promise<AgentSettingsRecord[]>;
  latestPolicy(orgId: string): Promise<PolicyRecord | null>;
  upsellRules(orgId: string): Promise<UpsellRule[]>;
  pastRecommendations(orgId: string, filter: PastRecommendationFilter): Promise<PastRecommendation[]>;
  recommendation(orgId: string, id: string): Promise<StoredRecommendation | null>;
  /** Recomendaciones con esas claves que siguen abiertas o se descartaron desde `since`. */
  blockingDuplicates(orgId: string, dedupeKeys: string[], dismissedSince: string): Promise<{ dedupeKey: string; status: RecommendationStatus }[]>;
  /** Inserta las que no chocan con una abierta (índice único) y devuelve sus ids. */
  insertRecommendations(orgId: string, recs: NewRecommendation[]): Promise<string[]>;
  insertReport(report: NewReport): Promise<string>;
  startRun(run: RunStart): Promise<string>;
  finishRun(id: string, result: RunFinish): Promise<void>;
  /** Coste estimado de un agente desde un instante (el inicio del mes en la zona de la org). */
  costSince(orgId: string, agent: AgentName, since: string): Promise<number>;
  dueReviews(orgId: string, today: CivilDate): Promise<ReviewDue[]>;
  completeReview(orgId: string, id: string, result: ReviewResult): Promise<void>;
}
