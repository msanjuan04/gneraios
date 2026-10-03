import "server-only";

// CouncilStore sobre Supabase con la clave de servidor (service_role): la cola, las ejecuciones,
// las recomendaciones, los informes y las revisiones los escribe solo el runner. Todas las
// consultas filtran por la org de forma explícita.

import type { CivilDate } from "@/domain/dates/civil-date";
import { readOrgModules } from "@/domain/org";
import type { Json, Tables } from "@/lib/supabase/database.types";
import { type Db, must } from "@/server/billing/context";
import type { PolicyRecord } from "../policy/schema";
import type { PastRecommendation, PastRecommendationFilter, UpsellRule } from "../tools/types";
import { OPEN_STATUSES, type AgentName, type EvidenceItem, type ProposedAction } from "../types";
import type {
  AgentSettingsRecord,
  CouncilStore,
  JobRecord,
  JobStatus,
  NewJob,
  NewRecommendation,
  NewReport,
  ReviewDue,
  ReviewResult,
  RunFinish,
  RunStart,
  StoredRecommendation,
} from "./types";

const json = (value: unknown) => value as Json;

function toJob(row: Tables<"agent_jobs">): JobRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    agent: row.agent,
    trigger: row.trigger,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    runAfter: row.run_after,
    dedupeKey: row.dedupe_key,
    requestedBy: row.requested_by,
    createdAt: row.created_at,
  };
}

function toPast(r: Tables<"recommendations">): PastRecommendation {
  return {
    id: r.id,
    agent: r.agent,
    kind: r.kind,
    title: r.title,
    summary: r.summary,
    status: r.status,
    subject: r.subject,
    dedupeKey: r.dedupe_key,
    impactCents: r.impact_eur_cents,
    confidence: r.confidence,
    urgency: r.urgency,
    requiresProfessionalReview: r.requires_professional_review,
    decisionNote: r.decision_note,
    postponedUntil: r.postponed_until,
    decidedAt: r.decided_at,
    createdAt: r.created_at,
  };
}

export class SupabaseCouncilStore implements CouncilStore {
  constructor(private readonly db: Db) {}

  async orgs() {
    const rows = must(await this.db.from("orgs").select("id, timezone, settings"), "council.store.orgs");
    return rows.filter((row) => readOrgModules(row.settings).council).map(({ id, timezone }) => ({ id, timezone }));
  }

  async enqueueJob(job: NewJob) {
    const { data, error } = await this.db
      .from("agent_jobs")
      .insert({
        org_id: job.orgId,
        agent: job.agent,
        trigger: job.trigger,
        payload: json(job.payload ?? {}),
        dedupe_key: job.dedupeKey ?? null,
        run_after: job.runAfter,
        max_attempts: job.maxAttempts,
      })
      .select("id")
      .single();
    if (!error) return { id: data.id, created: true };
    if (error.code !== "23505" || !job.dedupeKey) throw error;
    const existing = must(await this.db.from("agent_jobs").select("id").eq("org_id", job.orgId).eq("dedupe_key", job.dedupeKey).single(), "council.store.enqueue");
    return { id: existing.id, created: false };
  }

  async claimJobs(opts: { limit: number; orgId?: string; jobIds?: string[] }) {
    const { data, error } = await this.db.rpc("claim_agent_jobs", { p_limit: opts.limit, p_org: opts.orgId, p_ids: opts.jobIds });
    if (error) throw error;
    return (data ?? []).map(toJob);
  }

  async finishJob(id: string, outcome: { status: JobStatus; error?: string | null; runAfter?: string }) {
    const terminal = outcome.status !== "pending" && outcome.status !== "running";
    const { error } = await this.db
      .from("agent_jobs")
      .update({
        status: outcome.status,
        last_error: outcome.error?.slice(0, 2000) ?? null,
        locked_at: null,
        finished_at: terminal ? new Date().toISOString() : null,
        ...(outcome.runAfter ? { run_after: outcome.runAfter } : {}),
      })
      .eq("id", id);
    if (error) throw error;
  }

  async agentSettings(orgId: string): Promise<AgentSettingsRecord[]> {
    const rows = must(await this.db.from("agent_settings").select("agent, enabled, model, monthly_budget_usd_cents, thresholds").eq("org_id", orgId), "council.store.settings");
    return rows.map((r) => ({
      agent: r.agent,
      enabled: r.enabled,
      model: r.model,
      monthlyBudgetUsdCents: r.monthly_budget_usd_cents,
      thresholds: (r.thresholds ?? {}) as Record<string, unknown>,
    }));
  }

  async latestPolicy(orgId: string): Promise<PolicyRecord | null> {
    const { data, error } = await this.db
      .from("financial_policies")
      .select("version, data, created_at, note")
      .eq("org_id", orgId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data ? { version: data.version, data: data.data, createdAt: data.created_at, note: data.note } : null;
  }

  async upsellRules(orgId: string): Promise<UpsellRule[]> {
    const rows = must(
      await this.db
        .from("upsell_rules")
        .select("id, label, requires_any, excludes_any, max_services, min_months, suggestion, reference_mrr_cents")
        .eq("org_id", orgId)
        .is("archived_at", null)
        .order("position"),
      "council.store.rules",
    );
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      requiresAny: r.requires_any,
      excludesAny: r.excludes_any,
      maxServices: r.max_services,
      minMonths: r.min_months,
      suggestion: r.suggestion,
      referenceMrrCents: r.reference_mrr_cents,
    }));
  }

  async pastRecommendations(orgId: string, filter: PastRecommendationFilter) {
    let query = this.db.from("recommendations").select("*").eq("org_id", orgId);
    if (filter.agent) query = query.eq("agent", filter.agent);
    if (filter.statuses) query = query.in("status", filter.statuses);
    if (filter.since) query = query.or(`created_at.gte.${filter.since},decided_at.gte.${filter.since}`);
    const rows = must(await query.order("created_at", { ascending: false }).limit(filter.limit ?? 50), "council.store.past");
    return rows.map(toPast);
  }

  async recommendation(orgId: string, id: string): Promise<StoredRecommendation | null> {
    const { data, error } = await this.db.from("recommendations").select("*").eq("org_id", orgId).eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      ...toPast(data),
      orgId: data.org_id,
      runId: data.run_id,
      reasoning: data.reasoning,
      evidence: (data.evidence ?? []) as unknown as EvidenceItem[],
      proposedActions: (data.proposed_actions ?? []) as unknown as ProposedAction[],
      missingData: (data.missing_data ?? []) as unknown as string[],
      risks: data.risks,
      challenge: (data.challenge ?? null) as Record<string, unknown> | null,
      policyVersion: data.policy_version,
    };
  }

  async blockingDuplicates(orgId: string, dedupeKeys: string[], dismissedSince: string) {
    if (dedupeKeys.length === 0) return [];
    const rows = must(
      await this.db
        .from("recommendations")
        .select("dedupe_key, status")
        .eq("org_id", orgId)
        .in("dedupe_key", dedupeKeys)
        .or(`status.in.(${OPEN_STATUSES.join(",")}),and(status.eq.descartada,decided_at.gte.${dismissedSince})`),
      "council.store.duplicates",
    );
    return rows.map((r) => ({ dedupeKey: r.dedupe_key, status: r.status }));
  }

  async insertRecommendations(orgId: string, recs: NewRecommendation[]) {
    const ids: string[] = [];
    for (const rec of recs) {
      const { data, error } = await this.db
        .from("recommendations")
        .insert({
          org_id: orgId,
          agent: rec.agent,
          run_id: rec.runId,
          kind: rec.kind,
          title: rec.title,
          summary: rec.summary,
          reasoning: rec.reasoning,
          evidence: json(rec.evidence),
          proposed_actions: json(rec.proposedActions),
          missing_data: json(rec.missingData),
          impact_eur_cents: rec.impactCents,
          confidence: rec.confidence,
          urgency: rec.urgency,
          risks: rec.risks,
          requires_professional_review: rec.requiresProfessionalReview,
          challenge: rec.challenge === null ? null : json(rec.challenge),
          policy_version: rec.policyVersion,
          subject: rec.subject,
          dedupe_key: rec.dedupeKey,
        })
        .select("id")
        .single();
      // Otra ejecución la ha abierto mientras tanto (índice único de las abiertas): no se repite.
      if (error?.code === "23505") continue;
      if (error) throw error;
      ids.push(data.id);
    }
    return ids;
  }

  async insertReport(report: NewReport) {
    return must(
      await this.db
        .from("council_reports")
        .insert({
          org_id: report.orgId,
          kind: report.kind,
          agent: report.agent,
          run_id: report.runId,
          period_start: report.periodStart,
          period_end: report.periodEnd,
          content: json(report.content),
          evidence: json(report.evidence),
          policy_version: report.policyVersion,
        })
        .select("id")
        .single(),
      "council.store.report",
    ).id;
  }

  async startRun(run: RunStart) {
    return must(
      await this.db
        .from("agent_runs")
        .insert({
          org_id: run.orgId,
          agent: run.agent,
          job_id: run.jobId,
          parent_run_id: run.parentRunId,
          trigger: run.trigger.slice(0, 60),
          runtime: run.runtime,
          model: run.model,
          input: json(run.input),
          policy_version: run.policyVersion,
        })
        .select("id")
        .single(),
      "council.store.startRun",
    ).id;
  }

  async finishRun(id: string, result: RunFinish) {
    const { error } = await this.db
      .from("agent_runs")
      .update({
        status: result.status,
        // La columna solo admite [a-z0-9.:_-]: «openai/gpt-oss-120b» se guarda como «openai:gpt-oss-120b».
        ...(result.model ? { model: result.model.toLowerCase().replace(/[^a-z0-9.:_-]/g, ":").slice(0, 81) } : {}),
        tool_calls: json(result.toolCalls),
        output: json(result.output),
        error: result.error?.slice(0, 4000) ?? null,
        attempts: result.attempts,
        input_tokens: result.usage.inputTokens,
        output_tokens: result.usage.outputTokens,
        cache_read_tokens: result.usage.cacheReadTokens,
        cache_write_tokens: result.usage.cacheWriteTokens,
        cost_usd_micros: result.costUsdMicros,
        duration_ms: result.durationMs,
        finished_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) throw error;
  }

  async costSince(orgId: string, agent: AgentName, since: string) {
    const rows = must(await this.db.from("agent_runs").select("cost_usd_micros").eq("org_id", orgId).eq("agent", agent).gte("started_at", since), "council.store.cost");
    return rows.reduce((sum, r) => sum + Number(r.cost_usd_micros), 0);
  }

  async dueReviews(orgId: string, today: CivilDate): Promise<ReviewDue[]> {
    const rows = must(
      await this.db
        .from("recommendation_reviews")
        .select("id, recommendation_id, horizon_days, due_on, estimated_impact_cents")
        .eq("org_id", orgId)
        .eq("state", "pending")
        .lte("due_on", today)
        .order("due_on"),
      "council.store.reviews",
    );
    return rows.map((r) => ({ id: r.id, recommendationId: r.recommendation_id, horizonDays: r.horizon_days, dueOn: r.due_on, estimatedImpactCents: r.estimated_impact_cents }));
  }

  async completeReview(orgId: string, id: string, result: ReviewResult) {
    const { error } = await this.db
      .from("recommendation_reviews")
      .update({
        state: result.state,
        outcome: result.outcome,
        actual_impact_cents: result.actualImpactCents,
        notes: result.notes,
        evidence: json(result.evidence),
        run_id: result.runId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("org_id", orgId)
      .eq("id", id);
    if (error) throw error;
  }
}
