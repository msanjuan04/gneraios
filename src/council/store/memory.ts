// CouncilStore en memoria (tests y evals). Imita las reglas de la base de datos que importan al
// runner: una sola recomendación abierta por clave, la cola con su deduplicación por periodo y el
// coste por agente.

import { randomUUID } from "node:crypto";
import type { CivilDate } from "@/domain/dates/civil-date";
import type { PolicyRecord } from "../policy/schema";
import type { PastRecommendation, PastRecommendationFilter, UpsellRule } from "../tools/types";
import { OPEN_STATUSES, type AgentName, type RecommendationStatus } from "../types";
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
  RunRecord,
  RunStart,
  StoredRecommendation,
} from "./types";

export type StoredReport = NewReport & { id: string; createdAt: string };
export type StoredReview = ReviewDue & { orgId: string; state: "pending" | "done" | "skipped"; result: ReviewResult | null };

export class MemoryCouncilStore implements CouncilStore {
  readonly jobs: JobRecord[] = [];
  readonly runs: RunRecord[] = [];
  readonly recommendations: StoredRecommendation[] = [];
  readonly reports: StoredReport[] = [];
  readonly reviews: StoredReview[] = [];
  settings = new Map<string, AgentSettingsRecord[]>();
  policies = new Map<string, PolicyRecord>();
  rules = new Map<string, UpsellRule[]>();
  orgList: { id: string; timezone: string }[] = [];
  /** Reloj del almacén (instantes ISO de created_at, started_at…). */
  now: () => Date = () => new Date();

  constructor(init: { orgs?: { id: string; timezone: string }[]; now?: () => Date } = {}) {
    this.orgList = init.orgs ?? [];
    if (init.now) this.now = init.now;
  }

  private iso(): string {
    return this.now().toISOString();
  }

  async orgs() {
    return this.orgList;
  }

  async enqueueJob(job: NewJob) {
    if (job.dedupeKey) {
      const existing = this.jobs.find((j) => j.orgId === job.orgId && j.dedupeKey === job.dedupeKey);
      if (existing) return { id: existing.id, created: false };
    }
    const record: JobRecord = {
      id: randomUUID(),
      orgId: job.orgId,
      agent: job.agent,
      trigger: job.trigger,
      payload: job.payload ?? {},
      status: "pending",
      attempts: 0,
      maxAttempts: job.maxAttempts ?? 2,
      runAfter: job.runAfter ?? this.iso(),
      dedupeKey: job.dedupeKey ?? null,
      requestedBy: null,
      createdAt: this.iso(),
    };
    this.jobs.push(record);
    return { id: record.id, created: true };
  }

  async claimJobs(opts: { limit: number; orgId?: string; jobIds?: string[] }) {
    const now = this.iso();
    const claimed = this.jobs
      .filter((j) => j.status === "pending" && j.runAfter <= now && (!opts.orgId || j.orgId === opts.orgId) && (!opts.jobIds || opts.jobIds.includes(j.id)))
      .sort((a, b) => a.runAfter.localeCompare(b.runAfter) || a.createdAt.localeCompare(b.createdAt))
      .slice(0, opts.limit);
    for (const job of claimed) {
      job.status = "running";
      job.attempts += 1;
    }
    return claimed.map((j) => ({ ...j }));
  }

  async finishJob(id: string, outcome: { status: JobStatus; error?: string | null; runAfter?: string }) {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) return;
    job.status = outcome.status;
    if (outcome.runAfter) job.runAfter = outcome.runAfter;
  }

  async agentSettings(orgId: string) {
    return this.settings.get(orgId) ?? [];
  }

  async latestPolicy(orgId: string) {
    return this.policies.get(orgId) ?? null;
  }

  async upsellRules(orgId: string) {
    return this.rules.get(orgId) ?? [];
  }

  private toPast(r: StoredRecommendation): PastRecommendation {
    return {
      id: r.id,
      agent: r.agent,
      kind: r.kind,
      title: r.title,
      summary: r.summary,
      status: r.status,
      subject: r.subject,
      dedupeKey: r.dedupeKey,
      impactCents: r.impactCents,
      confidence: r.confidence,
      urgency: r.urgency,
      requiresProfessionalReview: r.requiresProfessionalReview,
      decisionNote: r.decisionNote,
      postponedUntil: r.postponedUntil,
      decidedAt: r.decidedAt,
      createdAt: r.createdAt,
    };
  }

  async pastRecommendations(orgId: string, filter: PastRecommendationFilter) {
    return this.recommendations
      .filter(
        (r) =>
          r.orgId === orgId &&
          (!filter.agent || r.agent === filter.agent) &&
          (!filter.statuses || filter.statuses.includes(r.status)) &&
          (!filter.since || r.createdAt >= filter.since || (r.decidedAt !== null && r.decidedAt >= filter.since)),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, filter.limit ?? 50)
      .map((r) => this.toPast(r));
  }

  async recommendation(orgId: string, id: string) {
    return this.recommendations.find((r) => r.orgId === orgId && r.id === id) ?? null;
  }

  async blockingDuplicates(orgId: string, dedupeKeys: string[], dismissedSince: string) {
    const keys = new Set(dedupeKeys);
    return this.recommendations
      .filter(
        (r) =>
          r.orgId === orgId &&
          keys.has(r.dedupeKey) &&
          (OPEN_STATUSES.includes(r.status) || (r.status === "descartada" && (r.decidedAt ?? r.createdAt) >= dismissedSince)),
      )
      .map((r) => ({ dedupeKey: r.dedupeKey, status: r.status }));
  }

  async insertRecommendations(orgId: string, recs: NewRecommendation[]) {
    const ids: string[] = [];
    for (const rec of recs) {
      const clash = this.recommendations.some((r) => r.orgId === orgId && r.dedupeKey === rec.dedupeKey && OPEN_STATUSES.includes(r.status));
      if (clash) continue;
      const stored: StoredRecommendation = {
        ...rec,
        id: randomUUID(),
        orgId,
        status: "nueva",
        decisionNote: null,
        postponedUntil: null,
        decidedAt: null,
        createdAt: this.iso(),
      };
      this.recommendations.push(stored);
      ids.push(stored.id);
    }
    return ids;
  }

  /** Para los tests: decide una recomendación como lo haría un socio. */
  decide(id: string, status: RecommendationStatus, note: string | null = null) {
    const rec = this.recommendations.find((r) => r.id === id);
    if (!rec) throw new Error(`No existe la recomendación ${id}`);
    rec.status = status;
    rec.decisionNote = note;
    rec.decidedAt = this.iso();
  }

  async insertReport(report: NewReport) {
    const stored = { ...report, id: randomUUID(), createdAt: this.iso() };
    this.reports.push(stored);
    return stored.id;
  }

  async startRun(run: RunStart) {
    const id = randomUUID();
    this.runs.push({
      ...run,
      id,
      startedAt: this.iso(),
      status: "succeeded",
      toolCalls: [],
      output: null,
      error: null,
      attempts: 0,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      costUsdMicros: 0,
      durationMs: 0,
    });
    return id;
  }

  async finishRun(id: string, result: RunFinish) {
    const run = this.runs.find((r) => r.id === id);
    if (run) Object.assign(run, result);
  }

  async costSince(orgId: string, agent: AgentName, since: string) {
    return this.runs.filter((r) => r.orgId === orgId && r.agent === agent && r.startedAt >= since).reduce((sum, r) => sum + r.costUsdMicros, 0);
  }

  async dueReviews(orgId: string, today: CivilDate) {
    return this.reviews
      .filter((r) => r.orgId === orgId && r.state === "pending" && r.dueOn <= today)
      .map((r) => {
        const due: Partial<typeof r> = { ...r };
        delete due.orgId;
        delete due.state;
        delete due.result;
        return due as Omit<typeof r, "orgId" | "state" | "result">;
      });
  }

  async completeReview(orgId: string, id: string, result: ReviewResult) {
    const review = this.reviews.find((r) => r.orgId === orgId && r.id === id);
    if (!review) return;
    review.state = result.state;
    review.result = result;
  }
}
