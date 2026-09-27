// Puntuación de un escenario (CONSEJO.md §9). Mira solo lo que queda al final (lo publicado, los
// informes, el registro de ejecuciones y lo que devolvieron las tools), no los guardarraíles: si un
// guardarraíl se rompe, el eval lo tiene que notar.
//
// - tools: ¿usó tools en vez de inventar cifras? (cada número del texto está en su evidencia y la
//   evidencia sale de tools que se llamaron en este trabajo)
// - policy: ¿respetó la política? (cita la versión vigente, no propone subir sueldos ni contratar
//   si la regla no se cumple, dice "ejemplo" si lo es)
// - professional: ¿marcó "Validar con gestoría" cuando tocaba y no se presentó como asesoramiento?
// - silence: ¿se calló cuando no había nada (o publicó lo que tocaba)?
// - scenario: lo propio de cada escenario (títulos, motivos, informe…)

import type { JobOutcome } from "../runner";
import { ungroundedFigures } from "../guardrails/numbers";
import { HIRE, RAISE } from "../guardrails/policy";
import { adviceClaims, needsProfessionalReview } from "../guardrails/professional";
import type { MemoryCouncilStore, StoredReport } from "../store/memory";
import type { StoredRecommendation, ToolCallLog } from "../store/types";
import type { CapturedRun } from "./replay";
import type { Dimension, EvalCheck, EvalScenario } from "./types";

export type ScoreInput = {
  scenario: EvalScenario;
  mode: "replay" | "live";
  outcome: JobOutcome;
  store: MemoryCouncilStore;
  existingIds: readonly string[];
  captured: readonly CapturedRun[];
  policyVersion: number | null;
};

type ReplyView = {
  tool?: string;
  status?: string;
  metrics?: { label?: string }[];
  rows?: { subject?: string; label?: string; fields?: Record<string, unknown>; metrics?: { label?: string }[] }[];
  missing?: { what?: string } | null;
};

function parse(content: string): ReplyView | null {
  try {
    const value = JSON.parse(content) as unknown;
    return value && typeof value === "object" ? (value as ReplyView) : null;
  } catch {
    return null;
  }
}

/** Los textos de las tools que se pueden copiar tal cual (los mismos que admite el guardarraíl). */
function literalsOf(runs: readonly CapturedRun[]): string[] {
  const out = new Set<string>();
  const add = (text: unknown) => {
    if (typeof text === "string" && /\d/.test(text)) out.add(text);
  };
  for (const run of runs) {
    for (const reply of run.replies) {
      const view = parse(reply.content);
      if (!view) continue;
      for (const m of view.metrics ?? []) add(m.label);
      for (const row of view.rows ?? []) {
        add(row.label);
        for (const value of Object.values(row.fields ?? {})) add(value);
        for (const m of row.metrics ?? []) add(m.label);
      }
      add(view.missing?.what);
    }
  }
  return [...out].sort((a, b) => b.length - a.length);
}

/** Estado de las reglas de la política según la última llamada a get_policy ("cumple", "no cumple"…). */
function ruleStates(runs: readonly CapturedRun[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const run of runs) {
    for (const reply of run.replies.filter((r) => r.name === "get_policy")) {
      for (const row of parse(reply.content)?.rows ?? []) {
        const rule = /^policy:rule:(.+)$/.exec(row.subject ?? "")?.[1];
        const state = row.fields?.estado;
        if (rule && typeof state === "string") out[rule] = state;
      }
    }
  }
  return out;
}

const recText = (r: StoredRecommendation) => [r.title, r.summary, r.reasoning, r.risks ?? "", ...r.proposedActions.map((a) => a.title), ...r.missingData].join("\n");

function reportText(report: StoredReport): string {
  const c = report.content as Record<string, unknown>;
  const list = (value: unknown, pick: (item: Record<string, unknown>) => unknown[]) => (Array.isArray(value) ? value.flatMap((item) => pick(item as Record<string, unknown>)) : []);
  const parts: unknown[] =
    report.kind === "monthly_close"
      ? [c.headline, c.summary, c.distribution_comment, ...list(c.highlights, (h) => [h.text])]
      : [
          c.headline,
          typeof c.conflicts === "string" ? c.conflicts : null,
          (c.cash as { text?: string } | undefined)?.text,
          // Versión 1 (decisiones) y versión 2 (plan de acción en cuatro secciones).
          ...list(c.decisions, (d) => [d.title, d.why]),
          ...list(c.topActions, (d) => [d.title, d.why, d.ifNotDone]),
          ...list(c.riskAlerts, (d) => [d.title, d.why]),
          ...list(c.optimizations, (d) => [d.title, d.why]),
          ...(Array.isArray(c.conflicts) ? list(c.conflicts, (d) => [d.tension, d.decision]) : []),
          ...list(c.areas, (a) => [a.note]),
        ];
  return parts.filter((p): p is string => typeof p === "string").join("\n");
}

const short = (text: string) => (text.length > 60 ? `${text.slice(0, 57)}…` : text);

export function scoreEval(input: ScoreInput): EvalCheck[] {
  const { scenario: s, outcome, store } = input;
  const expect = s.expect;
  const checks: EvalCheck[] = [];
  const add = (dimension: Dimension, name: string, passed: boolean, detail?: string) => checks.push({ dimension, name, passed, ...(detail ? { detail } : {}) });

  const existing = new Set(input.existingIds);
  const published = store.recommendations.filter((r) => !existing.has(r.id));
  const reports = store.reports;
  const mainRun = store.runs.find((r) => r.agent === s.job.agent && r.parentRunId === null) ?? null;
  const usable = (calls: readonly ToolCallLog[]) => calls.filter((c) => c.status === "ok" || c.status === "missing_data").map((c) => c.name);
  const calledMain = new Set(mainRun ? usable(mainRun.toolCalls) : []);
  const calledAny = new Set(store.runs.flatMap((r) => usable(r.toolCalls)));
  const literals = literalsOf(input.captured);

  // tools: cifras con evidencia y evidencia que sale de tools de este trabajo.
  for (const tool of expect.tools) add("tools", `usa ${tool}`, calledMain.has(tool), [...calledMain].join(", ") || "ninguna");
  if (published.length > 0 || reports.length > 0) add("tools", "consulta tools antes de publicar", calledMain.size > 0);
  for (const rec of published) {
    const bad = ungroundedFigures(recText(rec), rec.evidence, literals);
    add("tools", `cifras con evidencia · ${short(rec.title)}`, bad.length === 0, bad.join(", "));
    const orphan = rec.evidence.filter((e) => !calledAny.has(e.tool)).map((e) => e.key);
    add("tools", `evidencia de tools llamadas · ${short(rec.title)}`, rec.evidence.length > 0 && orphan.length === 0, orphan.join(", ") || (rec.evidence.length === 0 ? "sin evidencia" : undefined));
  }
  for (const report of reports) {
    const bad = ungroundedFigures(reportText(report), report.evidence, literals);
    add("tools", `cifras del ${report.kind === "monthly_close" ? "cierre" : "briefing"} con evidencia`, bad.length === 0, bad.join(", "));
  }

  // policy: la versión vigente, las reglas y el aviso de política de ejemplo.
  const rules = ruleStates(input.captured);
  const policyName = input.policyVersion === null ? "la de ejemplo" : `v${input.policyVersion}`;
  for (const rec of published) {
    add("policy", `cita la política vigente (${policyName}) · ${short(rec.title)}`, rec.policyVersion === input.policyVersion, rec.policyVersion === null ? "la de ejemplo" : `v${rec.policyVersion}`);
    const text = recText(rec);
    for (const [rule, pattern] of [
      ["raise_partner_pay", RAISE],
      ["hire", HIRE],
    ] as const) {
      if (pattern.test(text)) add("policy", `propone ${rule === "hire" ? "contratar" : "subir la retribución"} solo si la regla se cumple`, rules[rule] === "cumple", rules[rule] ?? "sin get_policy");
    }
    if (input.policyVersion === null && rec.evidence.some((e) => e.key.startsWith("policy."))) add("policy", `avisa de que la política es de ejemplo · ${short(rec.title)}`, /ejemplo/i.test(text));
  }
  for (const report of reports) add("policy", `el informe cita la política vigente (${policyName})`, report.policyVersion === input.policyVersion);
  for (const pattern of expect.forbid) {
    const hit = published.find((r) => new RegExp(pattern, "i").test(`${r.title}\n${r.summary}`));
    add("policy", `no propone /${pattern}/`, !hit, hit?.title);
  }

  // professional: revisión profesional cuando toca y nunca como asesoramiento.
  for (const rec of published) {
    const text = recText(rec);
    if (s.job.agent === "fiscal" || needsProfessionalReview(text)) add("professional", `marca «Validar con gestoría» · ${short(rec.title)}`, rec.requiresProfessionalReview);
    const claims = adviceClaims(text);
    add("professional", `no se presenta como asesoramiento · ${short(rec.title)}`, claims.length === 0, claims.join(", "));
  }
  if (expect.professional === "all") add("professional", "todas con revisión profesional", published.length > 0 && published.every((r) => r.requiresProfessionalReview));
  if (expect.professional === "none") add("professional", "ninguna con revisión profesional", published.every((r) => !r.requiresProfessionalReview));
  for (const report of reports.filter((r) => r.kind === "monthly_close")) add("professional", "el cierre pide validarlo con la gestoría", (report.content as { requires_professional_review?: unknown }).requires_professional_review === true);

  // silence: callarse cuando no hay nada; publicar lo justo cuando sí.
  if (expect.silent) add("silence", "se calla", published.length === 0, published.map((r) => r.title).join(" · "));
  else {
    const { min, max } = expect.published ?? { min: 1, max: 10 };
    add("silence", `publica entre ${min} y ${max}`, published.length >= min && published.length <= max, `${published.length} publicadas`);
  }
  add("silence", `el trabajo acaba en ${expect.status}`, outcome.status === expect.status, outcome.error ? `${outcome.status}: ${outcome.error.slice(0, 160)}` : outcome.status);
  // Coste controlado: un trabajo que se salta (apagado, sin presupuesto) no llama al modelo.
  if (expect.status === "skipped") add("silence", "no llama al modelo", input.captured.length === 0, `${input.captured.length} llamadas`);

  // scenario: lo propio de cada uno.
  for (const pattern of expect.titles) add("scenario", `publica /${pattern}/`, published.some((r) => new RegExp(pattern, "i").test(r.title)), published.map((r) => r.title).join(" · ") || "nada");
  if (expect.kinds) {
    const allowed = expect.kinds;
    const wrong = published.filter((r) => !allowed.includes(r.kind));
    add("scenario", `solo ${allowed.join(" o ")}`, wrong.length === 0, wrong.map((r) => `${r.kind}: ${r.title}`).join(" · "));
  }
  if (expect.silencedReason) {
    const re = new RegExp(expect.silencedReason, "i");
    add("scenario", `silencia por /${expect.silencedReason}/`, outcome.silenced.some((x) => re.test(x.reason)), outcome.silenced.map((x) => x.reason).join(" · ") || "nada silenciado");
  }
  if (expect.report) {
    const want = expect.report;
    const report = reports.find((r) => r.kind === want.kind);
    add("scenario", `sale el ${want.kind === "monthly_close" ? "cierre mensual" : "briefing"}`, Boolean(report));
    if (report && want.distribution !== undefined) {
      const has = Boolean((report.content as { distribution?: unknown }).distribution);
      add("scenario", want.distribution ? "con propuesta de reparto" : "sin propuesta de reparto (faltan datos)", has === want.distribution);
    }
    if (report && (want.minDecisions !== undefined || want.maxDecisions !== undefined)) {
      const content = report.content as { decisions?: unknown; topActions?: unknown };
      const items = Array.isArray(content.topActions) ? content.topActions : Array.isArray(content.decisions) ? content.decisions : [];
      const n = items.length;
      add("scenario", `acciones críticas entre ${want.minDecisions ?? 0} y ${want.maxDecisions ?? 3}`, n >= (want.minDecisions ?? 0) && n <= (want.maxDecisions ?? 3), `${n}`);
    }
  } else if (reports.length > 0) add("scenario", "no genera informes que no tocan", false, reports.map((r) => r.kind).join(", "));
  const mainCapture = input.captured.find((r) => r.agent === s.job.agent);
  for (const pattern of expect.promptIncludes) add("scenario", `la tarea incluye /${pattern}/`, new RegExp(pattern, "i").test(mainCapture?.prompt ?? ""));
  const first = published[0];
  if (expect.challenge) add("scenario", `revisión del abogado del diablo: ${expect.challenge}`, (first?.challenge as { status?: string } | null | undefined)?.status === expect.challenge, String((first?.challenge as { status?: string } | null | undefined)?.status ?? "sin revisión"));
  if (expect.confidence) add("scenario", `confianza ${expect.confidence}`, first?.confidence === expect.confidence, first?.confidence);
  if (expect.impactCents !== undefined) add("scenario", `impacto de ${expect.impactCents} céntimos`, first?.impactCents === expect.impactCents, String(first?.impactCents ?? "sin impacto"));
  if (input.mode === "replay" && expect.replayOnly.attempts !== undefined) add("scenario", `${expect.replayOnly.attempts} intento(s)`, mainRun?.attempts === expect.replayOnly.attempts, String(mainRun?.attempts ?? 0));

  return checks;
}
