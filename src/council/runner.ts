// El runner del consejo (CONSEJO.md §5): coge trabajos de la cola, ejecuta el agente con sus tools,
// pasa los guardarraíles, aplica el silencio útil y la deduplicación, pide la revisión del abogado
// del diablo para lo de impacto alto y guarda la ejecución (con su coste), las recomendaciones y
// los informes. No escribe nada del negocio: solo lee (CouncilData) y guarda lo del consejo.
//
// Sin clave de la API (runtimeFor devuelve null) el trabajo falla con un mensaje claro y no se
// ejecuta nada. Con el presupuesto del mes agotado, el agente se salta hasta el mes siguiente.

import { startOfDayInZone } from "@/domain/pipeline";
import { AGENT_CONFIG, effectiveThresholds, isCouncilModel, type CouncilModel } from "./agents.config";
import { AGENTS, allowedTools } from "./agents";
import { draftForChallenge, sharedContext, taskPrompt } from "./agents/context";
import { briefingContent } from "./briefing";
import { loadPrompt } from "./agents/prompts";
import {
  OUTPUT_SCHEMAS,
  type BriefingOutput,
  type ChallengeOutput,
  type MonthlyCloseOutput,
  type ReviewOutput,
  type ScanOutput,
} from "./agents/schemas";
import { buildToolContext, cachedData } from "./context";
import type { CouncilData } from "./data/types";
import { checkBriefing, checkChallenge, checkClose, checkDraft, checkReview, checkScan, type CheckContext, type CheckedRecommendation } from "./guardrails";
import { resolvePolicy, type ResolvedPolicy } from "./policy/schema";
import { RunLedger } from "./runtime/ledger";
import type { AgentRuntime, RuntimeResult } from "./runtime/types";
import { localNow, weekRange } from "./schedule";
import type { AgentSettingsRecord, CouncilStore, JobRecord, NewRecommendation, ToolCallLog } from "./store/types";
import { executeTool, isToolName, toolSpecs } from "./tools/registry";
import type { ToolContext } from "./tools/types";
import { OPEN_STATUSES, TASKS, type AgentName, type EvidenceItem, type Task } from "./types";

export type RunnerDeps = {
  store: CouncilStore;
  dataFor: (orgId: string) => CouncilData;
  /** El runtime para un modelo; null si no está configurado (sin ANTHROPIC_API_KEY). */
  runtimeFor: (model: CouncilModel) => AgentRuntime | null;
  now?: () => Date;
  prompts?: (name: AgentName | "shared") => Promise<string>;
};

export type JobOutcome = {
  jobId: string;
  orgId: string;
  agent: AgentName;
  trigger: string;
  status: "done" | "failed" | "skipped" | "retry";
  runId: string | null;
  published: string[];
  reportId: string | null;
  silenced: { title: string; reason: string }[];
  error: string | null;
};

export const MISSING_API_KEY = "Falta ANTHROPIC_API_KEY: el consejo no puede trabajar hasta que se configure la clave de la API.";
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 10 * 60_000;
const URGENCY_RANK = { hoy: 0, esta_semana: 1, este_mes: 2 } as const;

type Env = {
  deps: RunnerDeps;
  orgId: string;
  today: string;
  timeZone: string;
  now: Date;
  data: CouncilData;
  settings: AgentSettingsRecord[];
  policy: ResolvedPolicy;
  ctx: ToolContext;
  shared: string;
};

function taskOf(job: JobRecord): Task | null {
  const requested = job.payload.task;
  if (typeof requested === "string" && (TASKS as readonly string[]).includes(requested)) return requested as Task;
  if (job.trigger === "review") return "review";
  if (job.trigger === "manual") return AGENTS[job.agent].manualTask;
  return "scan";
}

function modelFor(agent: AgentName, task: Task, settings: AgentSettingsRecord | undefined): CouncilModel {
  if (settings?.model && isCouncilModel(settings.model)) return settings.model;
  const config = AGENT_CONFIG[agent];
  return config.modelByTask?.[task] ?? config.model;
}

function budgetMicros(agent: AgentName, settings: AgentSettingsRecord | undefined): number {
  return (settings?.monthlyBudgetUsdCents ?? AGENT_CONFIG[agent].monthlyBudgetUsdCents) * 10_000;
}

function monthStartInstant(today: string, timeZone: string): string {
  return startOfDayInZone(`${today.slice(0, 7)}-01`, timeZone);
}

/** Ejecuta un agente con sus tools y sus guardarraíles. Devuelve el resultado y el libro de la ejecución. */
async function execute(
  env: Env,
  opts: {
    agent: AgentName;
    task: Task;
    trigger: string;
    jobId: string | null;
    parentRunId: string | null;
    reviewing?: AgentName;
    payload: Record<string, unknown>;
    preload?: readonly EvidenceItem[];
    validate: (output: unknown, ledger: RunLedger) => string[];
  },
): Promise<
  | { runId: string; result: RuntimeResult; ledger: RunLedger; toolCalls: ToolCallLog[]; model: CouncilModel; durationMs: number }
  | { skipped: string }
  | { failed: string }
> {
  const { deps } = env;
  const agentSettings = env.settings.find((s) => s.agent === opts.agent);
  if (agentSettings?.enabled === false) return { skipped: "Agente desactivado en los ajustes." };
  const model = modelFor(opts.agent, opts.task, agentSettings);
  const runtime = deps.runtimeFor(model);
  if (!runtime) return { failed: MISSING_API_KEY };
  const budget = budgetMicros(opts.agent, agentSettings);
  const spent = await deps.store.costSince(env.orgId, opts.agent, monthStartInstant(env.today, env.timeZone));
  if (spent >= budget) return { skipped: "Presupuesto del mes agotado: el agente se pausa hasta el mes que viene." };

  const config = AGENT_CONFIG[opts.agent];
  const thresholds = effectiveThresholds(opts.agent, agentSettings?.thresholds);
  const ledger = new RunLedger();
  ledger.preload(opts.preload ?? []);
  const tools = allowedTools(opts.agent, opts.reviewing);
  const toolCalls: ToolCallLog[] = [];
  const handleTool = async (name: string, input: unknown) => {
    if (!isToolName(name) || !tools.has(name)) {
      const denied = ledger.deny(name, input, `La tool ${name} no está en tu lista (${[...tools].join(", ")}).`);
      toolCalls.push(denied.log);
      return denied;
    }
    const started = Date.now();
    const outcome = await executeTool(name, input, env.ctx);
    const recorded = ledger.record(name, input, outcome, Date.now() - started);
    toolCalls.push(recorded.log);
    return recorded;
  };

  const cooldownDays = thresholds.dismissed_cooldown_days ?? 60;
  const since = new Date(env.now.getTime() - cooldownDays * 86_400_000).toISOString();
  const past = opts.task === "scan" || opts.task === "monthly_close" ? await deps.store.pastRecommendations(env.orgId, { agent: opts.agent, statuses: [...OPEN_STATUSES, "descartada"], since, limit: 25 }) : [];
  const prompts = deps.prompts ?? loadPrompt;
  const agentPrompt = await prompts(opts.agent);
  const prompt = taskPrompt({
    agent: opts.agent,
    task: opts.task,
    trigger: opts.trigger,
    today: env.today,
    timeZone: env.timeZone,
    tools: [...tools],
    maxRecommendations: opts.task === "weekly_briefing" ? Math.min(3, thresholds.max_decisions ?? 3) : (thresholds.max_recommendations ?? 3),
    past,
    payload: opts.payload,
  });

  const runId = await deps.store.startRun({
    orgId: env.orgId,
    agent: opts.agent,
    jobId: opts.jobId,
    parentRunId: opts.parentRunId,
    trigger: opts.trigger,
    runtime: runtime.id,
    model,
    input: { task: opts.task, payload: opts.payload, prompt },
    policyVersion: env.policy.version,
  });
  const started = Date.now();
  let result: RuntimeResult;
  try {
    result = await runtime.run({
      agent: opts.agent,
      task: opts.task,
      model,
      effort: config.effortByTask?.[opts.task] ?? config.effort,
      system: { shared: env.shared, agent: agentPrompt },
      prompt,
      tools: toolSpecs(),
      handleTool,
      output: { schema: OUTPUT_SCHEMAS[opts.task], name: opts.task },
      validate: (output) => opts.validate(output, ledger),
      maxRetries: MAX_RETRIES,
      maxToolRounds: config.maxToolRounds,
      maxOutputTokens: config.maxOutputTokens,
      shouldStop: (cost) => (spent + cost >= budget ? "Presupuesto del mes agotado a mitad de la ejecución." : null),
    });
  } catch (error) {
    result = {
      status: "error",
      output: null,
      issues: [],
      attempts: 0,
      toolRounds: 0,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      costUsdMicros: 0,
      model,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  const durationMs = Date.now() - started;
  // El registro se completa al final (con lo publicado); aquí solo lo técnico por si algo falla después.
  await deps.store.finishRun(runId, {
    status: result.status === "ok" ? "succeeded" : "failed",
    toolCalls,
    output: { status: result.status, output: result.output, issues: result.issues },
    error: result.error ?? (result.status === "ok" ? null : result.issues.join(" | ").slice(0, 2000) || result.status),
    attempts: result.attempts,
    usage: result.usage,
    costUsdMicros: result.costUsdMicros,
    durationMs,
  });
  return { runId, result, ledger, toolCalls, model, durationMs };
}

/** El abogado del diablo con el borrador en su prompt (la evidencia heredada entra con ids nuevos). */
async function challengeWithDraft(env: Env, parent: { runId: string; agent: AgentName }, rec: CheckedRecommendation): Promise<{ drop: string | null; challenge: Record<string, unknown>; rec: CheckedRecommendation }> {
  const preview = new RunLedger().preload(rec.evidence);
  const draft = draftForChallenge({
    agent: parent.agent,
    rec,
    evidence: rec.evidence.filter((e) => preview.has(e.ref)).map((e) => ({ ...e, newRef: preview.get(e.ref)! })),
  });
  const outcome = await execute(env, {
    agent: "devils_advocate",
    task: "challenge",
    trigger: "challenge",
    jobId: null,
    parentRunId: parent.runId,
    reviewing: parent.agent,
    payload: { draft },
    preload: rec.evidence,
    validate: (output, ledger) => checkChallenge(output as ChallengeOutput, { ledger, policy: env.policy, agent: "devils_advocate" }).issues,
  });
  if ("skipped" in outcome || "failed" in outcome) {
    const reason = "skipped" in outcome ? outcome.skipped : outcome.failed;
    return { drop: null, challenge: { status: "sin_revisar", reason }, rec };
  }
  const { result, ledger, runId } = outcome;
  if (result.status !== "ok" || !result.output) {
    return { drop: null, challenge: { status: "sin_revisar", reason: result.error ?? result.status, run_id: runId }, rec };
  }
  const output = result.output as ChallengeOutput;
  const checked = checkChallenge(output, { ledger, policy: env.policy, agent: "devils_advocate" });
  const review = {
    status: "revisada",
    verdict: output.verdict,
    weak_assumptions: output.weak_assumptions,
    risks: output.risks,
    pessimistic_scenario: output.pessimistic_scenario,
    confidence: output.confidence,
    evidence: checked.evidence,
    run_id: runId,
  };
  if (output.verdict === "descartar") return { drop: `El abogado del diablo la ha descartado: ${output.risks.slice(0, 200)}`, challenge: review, rec };
  if (output.verdict === "publicar_con_cambios") {
    const risks = [rec.risks, output.risks].filter(Boolean).join(" ").slice(0, 3000);
    return { drop: null, challenge: review, rec: { ...rec, confidence: output.confidence, risks, evidence: mergeEvidence(rec.evidence, checked.evidence) } };
  }
  return { drop: null, challenge: review, rec };
}

function mergeEvidence(a: readonly EvidenceItem[], b: readonly EvidenceItem[]): EvidenceItem[] {
  const out = [...a];
  for (const item of b) if (!out.some((e) => e.key === item.key && e.value === item.value)) out.push(item);
  return out;
}

/** Silencio útil, deduplicación y abogado del diablo; guarda lo que queda. */
async function publish(env: Env, parent: { runId: string; agent: AgentName }, recs: CheckedRecommendation[]): Promise<{ published: string[]; silenced: { title: string; reason: string }[] }> {
  const { policy } = env.policy;
  const agentSettings = env.settings.find((s) => s.agent === parent.agent);
  const thresholds = effectiveThresholds(parent.agent, agentSettings?.thresholds);
  const silenced: { title: string; reason: string }[] = [];

  let kept = recs.filter((rec) => {
    const belowThreshold = rec.impactCents !== null && rec.impactCents < policy.impact_threshold_cents;
    const deadline = rec.requiresProfessionalReview && rec.urgency !== "este_mes";
    if (belowThreshold && !deadline) {
      silenced.push({ title: rec.title, reason: "Impacto por debajo del umbral de la política." });
      return false;
    }
    return true;
  });

  const cooldown = thresholds.dismissed_cooldown_days ?? 60;
  const dismissedSince = new Date(env.now.getTime() - cooldown * 86_400_000).toISOString();
  const blocking = await env.deps.store.blockingDuplicates(env.orgId, kept.map((r) => r.dedupeKey), dismissedSince);
  kept = kept.filter((rec) => {
    const clash = blocking.find((b) => b.dedupeKey === rec.dedupeKey);
    if (clash) silenced.push({ title: rec.title, reason: clash.status === "descartada" ? "Se descartó hace poco." : "Ya hay una abierta sobre lo mismo." });
    return !clash;
  });

  kept.sort((a, b) => URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency] || (b.impactCents ?? -1) - (a.impactCents ?? -1));
  const max = thresholds.max_recommendations ?? 3;
  for (const rec of kept.slice(max)) silenced.push({ title: rec.title, reason: `Más de ${max} recomendaciones en una ejecución.` });
  kept = kept.slice(0, max);

  const rows: NewRecommendation[] = [];
  for (const rec of kept) {
    let final = rec;
    let review: Record<string, unknown> | null = null;
    if (rec.impactCents !== null && rec.impactCents >= policy.high_impact_threshold_cents) {
      const challenged = await challengeWithDraft(env, parent, rec);
      if (challenged.drop) {
        silenced.push({ title: rec.title, reason: challenged.drop });
        continue;
      }
      final = challenged.rec;
      review = challenged.challenge;
    }
    rows.push({
      agent: parent.agent,
      runId: parent.runId,
      kind: final.kind,
      title: final.title,
      summary: final.summary,
      reasoning: final.reasoning,
      evidence: final.evidence,
      proposedActions: final.proposedActions,
      missingData: final.missingData,
      impactCents: final.impactCents,
      confidence: final.confidence,
      urgency: final.urgency,
      risks: final.risks,
      requiresProfessionalReview: final.requiresProfessionalReview,
      challenge: review,
      policyVersion: env.policy.version,
      subject: final.subject,
      dedupeKey: final.dedupeKey,
    });
  }
  const published = rows.length > 0 ? await env.deps.store.insertRecommendations(env.orgId, rows) : [];
  return { published, silenced };
}

/** Las recomendaciones que pasan una a una, aunque la salida entera se haya rechazado. */
function salvage(drafts: ScanOutput["recommendations"], c: CheckContext): { recs: CheckedRecommendation[]; rejected: { title: string; reason: string }[] } {
  const recs: CheckedRecommendation[] = [];
  const rejected: { title: string; reason: string }[] = [];
  for (const draft of drafts) {
    const checked = checkDraft(draft, c);
    if (checked.rec && !recs.some((r) => r.subject === checked.rec!.subject)) recs.push(checked.rec);
    else rejected.push({ title: draft.title, reason: `Rechazada por los guardarraíles: ${checked.issues.join(" ").slice(0, 300)}` });
  }
  return { recs, rejected };
}

async function finishJob(deps: RunnerDeps, job: JobRecord, outcome: Omit<JobOutcome, "jobId" | "orgId" | "agent" | "trigger">): Promise<JobOutcome> {
  const now = deps.now?.() ?? new Date();
  if (outcome.status === "retry") {
    await deps.store.finishJob(job.id, { status: "pending", error: outcome.error, runAfter: new Date(now.getTime() + RETRY_DELAY_MS).toISOString() });
  } else {
    await deps.store.finishJob(job.id, { status: outcome.status, error: outcome.error });
  }
  return { jobId: job.id, orgId: job.orgId, agent: job.agent, trigger: job.trigger, ...outcome };
}

/** Ejecuta un trabajo ya reclamado de la cola. Nunca lanza: todo acaba en el registro. */
export async function runJob(deps: RunnerDeps, job: JobRecord): Promise<JobOutcome> {
  const empty = { runId: null, published: [] as string[], reportId: null, silenced: [] as { title: string; reason: string }[] };
  try {
    const task = taskOf(job);
    if (!task) return finishJob(deps, job, { ...empty, status: "skipped", error: "Este agente no se lanza a mano." });
    const now = deps.now?.() ?? new Date();
    const data = cachedData(deps.dataFor(job.orgId));
    const org = await data.org();
    const today = localNow(now, org.timezone).date;
    const [settings, policyRecord] = await Promise.all([deps.store.agentSettings(job.orgId), deps.store.latestPolicy(job.orgId)]);
    const policy = resolvePolicy(policyRecord);
    const ctx = await buildToolContext({ orgId: job.orgId, today, data, store: deps.store, policy, settings });
    const shared = await sharedContext({ rules: await (deps.prompts ?? loadPrompt)("shared"), data, policy, today });
    const env: Env = { deps, orgId: job.orgId, today, timeZone: org.timezone, now, data, settings, policy, ctx, shared };

    let openIds: Set<string> = new Set();
    // Lo abierto con su impacto: un punto del briefing que cite una recomendación hereda su €.
    let openImpact = new Map<string, number | null>();
    let reviewRec: Awaited<ReturnType<CouncilStore["recommendation"]>> = null;
    if (task === "weekly_briefing") {
      const open = await deps.store.pastRecommendations(job.orgId, { statuses: [...OPEN_STATUSES], limit: 50 });
      openIds = new Set(open.map((r) => r.id));
      openImpact = new Map(open.map((r) => [r.id, r.impactCents]));
    }
    if (task === "review") {
      reviewRec = await deps.store.recommendation(job.orgId, String(job.payload.recommendation_id ?? ""));
      if (!reviewRec) return finishJob(deps, job, { ...empty, status: "skipped", error: "La recomendación ya no existe." });
    }
    const check = (ledger: RunLedger): CheckContext => ({ ledger, policy, agent: job.agent });
    const validators: Record<Task, (output: unknown, ledger: RunLedger) => string[]> = {
      scan: (o, l) => checkScan(o as ScanOutput, check(l)).issues,
      monthly_close: (o, l) => checkClose(o as MonthlyCloseOutput, check(l)).issues,
      weekly_briefing: (o, l) => checkBriefing(o as BriefingOutput, { ...check(l), openRecommendationIds: openIds }).issues,
      challenge: (o, l) => checkChallenge(o as ChallengeOutput, check(l)).issues,
      review: (o, l) => checkReview(o as ReviewOutput, check(l)).issues,
    };
    const payload = { ...job.payload };
    if (task === "review" && reviewRec) {
      payload.recommendation = JSON.stringify(
        {
          titulo: reviewRec.title,
          resumen: reviewRec.summary,
          aceptada: reviewRec.decidedAt?.slice(0, 10) ?? null,
          seguimiento_a_dias: job.payload.horizon_days ?? null,
          evidencia_original: reviewRec.evidence.map((e) => ({ label: e.label, value: e.display, period: e.period, tool: e.tool })),
        },
        null,
        2,
      );
    }
    const outcome = await execute(env, {
      agent: job.agent,
      task,
      trigger: job.trigger,
      jobId: job.id,
      parentRunId: null,
      payload,
      preload: reviewRec?.evidence,
      validate: validators[task],
    });
    if ("skipped" in outcome) return finishJob(deps, job, { ...empty, status: "skipped", error: outcome.skipped });
    if ("failed" in outcome) return finishJob(deps, job, { ...empty, status: "failed", error: outcome.failed });

    const { result, ledger, runId, toolCalls, durationMs } = outcome;
    const parent = { runId, agent: job.agent };
    let published: string[] = [];
    let silenced: { title: string; reason: string }[] = [];
    let reportId: string | null = null;

    if (result.status === "ok" || (result.status === "rejected" && task === "scan")) {
      if (task === "scan") {
        const output = result.output as ScanOutput;
        const { recs, rejected } = result.status === "ok" ? { recs: checkScan(output, check(ledger)).recs, rejected: [] } : salvage(output.recommendations, check(ledger));
        const done = await publish(env, parent, recs);
        published = done.published;
        silenced = [...rejected, ...done.silenced];
      } else if (task === "monthly_close") {
        const output = result.output as MonthlyCloseOutput;
        const checked = checkClose(output, check(ledger));
        const tool = ledger.results("get_monthly_close").at(-1)!;
        const data = (tool.data ?? {}) as { month?: string; distribution?: unknown };
        const month = String(data.month ?? `${today.slice(0, 7)}-01`);
        reportId = await deps.store.insertReport({
          orgId: job.orgId,
          kind: "monthly_close",
          agent: job.agent,
          runId,
          periodStart: month,
          periodEnd: tool.period?.to ?? month,
          content: {
            month,
            headline: checked.close!.headline,
            summary: checked.close!.summary,
            highlights: checked.close!.highlights.map((h) => ({ text: h.text, evidence: h.evidence.map((e) => e.ref) })),
            distribution_comment: checked.close!.distributionComment,
            distribution: data.distribution ?? null,
            figures: ledger.itemsOf("get_monthly_close"),
            missing: tool.missing,
            notes: tool.notes,
            requires_professional_review: true,
            policy: { version: policy.version, is_example: policy.isExample },
          },
          evidence: checked.close!.evidence,
          policyVersion: policy.version,
        });
        const done = await publish(env, parent, checked.recs);
        published = done.published;
        silenced = done.silenced;
      } else if (task === "weekly_briefing") {
        const checked = checkBriefing(result.output as BriefingOutput, { ...check(ledger), openRecommendationIds: openIds });
        const b = checked.briefing!;
        const week = weekRange(today);
        reportId = await deps.store.insertReport({
          orgId: job.orgId,
          kind: "weekly_briefing",
          agent: job.agent,
          runId,
          periodStart: week.from,
          periodEnd: week.to,
          content: briefingContent(b, { week, openImpact, policy: { version: policy.version, is_example: policy.isExample } }),
          evidence: b.evidence,
          policyVersion: policy.version,
        });
      } else if (task === "review" && reviewRec) {
        const output = result.output as ReviewOutput;
        const checked = checkReview(output, check(ledger));
        await deps.store.completeReview(job.orgId, String(job.payload.review_id ?? ""), {
          state: "done",
          outcome: output.outcome,
          actualImpactCents: checked.actualCents,
          notes: output.notes,
          evidence: checked.evidence,
          runId,
        });
      }
    }

    // El registro completo de la ejecución: lo publicado, lo silenciado y por qué.
    await deps.store.finishRun(runId, {
      status: result.status === "ok" || published.length > 0 || reportId ? "succeeded" : "failed",
      toolCalls,
      output: { status: result.status, output: result.output, issues: result.issues, published, silenced, report_id: reportId },
      error: result.status === "ok" ? null : (result.error ?? (result.issues.join(" | ").slice(0, 2000) || result.status)),
      attempts: result.attempts,
      usage: result.usage,
      costUsdMicros: result.costUsdMicros,
      durationMs,
    });

    if (result.status === "ok" || published.length > 0 || reportId) return finishJob(deps, job, { runId, published, reportId, silenced, status: "done", error: null });
    if (result.status === "budget_exceeded") return finishJob(deps, job, { runId, published, reportId, silenced, status: "skipped", error: result.error });
    const retry = result.status === "error" && result.retryable === true && job.attempts < job.maxAttempts;
    return finishJob(deps, job, { runId, published, reportId, silenced, status: retry ? "retry" : "failed", error: result.error ?? result.issues.join(" | ").slice(0, 1000) ?? result.status });
  } catch (error) {
    return finishJob(deps, job, { ...empty, status: "failed", error: error instanceof Error ? error.message : String(error) });
  }
}

/** Coge trabajos de la cola de uno en uno hasta que no quede ninguno, el límite o el tiempo. */
export async function runPendingJobs(deps: RunnerDeps, opts: { orgId?: string; jobIds?: string[]; limit?: number; deadlineMs?: number } = {}): Promise<JobOutcome[]> {
  const outcomes: JobOutcome[] = [];
  const deadline = Date.now() + (opts.deadlineMs ?? 240_000);
  const limit = opts.limit ?? 20;
  while (outcomes.length < limit && Date.now() < deadline) {
    const [job] = await deps.store.claimJobs({ limit: 1, orgId: opts.orgId, jobIds: opts.jobIds });
    if (!job) break;
    outcomes.push(await runJob(deps, job));
  }
  return outcomes;
}

