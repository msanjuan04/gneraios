// Guardarraíles de salida: la evidencia existe y sale de las tools de esta ejecución, cada cifra
// del texto está en la evidencia, el impacto es una métrica en €, la política se respeta y lo
// fiscal, laboral o legal va marcado. Si algo falla, el runner devuelve los problemas al agente y
// le pide que lo rehaga (como mucho dos veces).

import type {
  BriefingOutput,
  ChallengeOutput,
  MonthlyCloseOutput,
  RecommendationDraft,
  ReviewOutput,
  ScanOutput,
} from "../agents/schemas";
import type { ResolvedPolicy } from "../policy/schema";
import type { RunLedger } from "../runtime/ledger";
import type { AgentName, EvidenceItem, ProposedAction } from "../types";
import { ungroundedFigures } from "./numbers";
import { policyIssues } from "./policy";
import { adviceClaims, needsProfessionalReview } from "./professional";

export type CheckContext = { ledger: RunLedger; policy: ResolvedPolicy; agent: AgentName };

/** Una recomendación ya comprobada, con la evidencia resuelta, lista para guardar. */
export type CheckedRecommendation = {
  kind: RecommendationDraft["kind"];
  title: string;
  summary: string;
  reasoning: string;
  evidence: EvidenceItem[];
  proposedActions: ProposedAction[];
  missingData: string[];
  impactCents: number | null;
  confidence: RecommendationDraft["confidence"];
  urgency: RecommendationDraft["urgency"];
  risks: string | null;
  requiresProfessionalReview: boolean;
  subject: string;
  dedupeKey: string;
  /** El runner la marcó para revisión profesional aunque el agente no lo hiciera. */
  flaggedByRunner: boolean;
};

function resolveAll(ledger: RunLedger, refs: readonly string[], where: string, issues: string[]): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  for (const ref of refs) {
    const item = ledger.resolve(ref);
    if (!item) issues.push(`${where}: la evidencia «${ref}» no existe en esta ejecución (cita ids de métricas como m12 que te hayan devuelto las tools).`);
    else if (!out.some((e) => e.ref === item.ref)) out.push(item);
  }
  return out;
}

function numberIssues(where: string, text: string, evidence: readonly EvidenceItem[], ledger: RunLedger): string[] {
  const bad = ungroundedFigures(text, evidence, ledger.literals());
  if (bad.length === 0) return [];
  return [
    `${where}: estas cifras no salen de la evidencia citada: ${bad.map((b) => `«${b}»`).join(", ")}. Cada cifra tiene que ser el valor de una métrica que cites (o redondearlo); si necesitas un cálculo, pídeselo a una tool (p. ej. simulate).`,
  ];
}

/**
 * Quita del texto las referencias internas a la evidencia («(m33)», «(m8, m9)», «(missing en t6)»):
 * van en `evidence`, no en lo que leen los socios (algunos modelos las escriben igualmente).
 */
export function tidyText(text: string): string {
  return text
    .replace(/\s*\((?:(?:missing|sin datos)\s+(?:en\s+)?)?[mt]\d+(?:\s*(?:,|y|e)\s*[mt]\d+)*\)/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,;:])/g, "$1")
    .trim();
}

/** Comprueba una recomendación y la convierte en lo que se guarda. */
export function checkDraft(draft: RecommendationDraft, c: CheckContext, where = "Recomendación"): { issues: string[]; rec: CheckedRecommendation | null } {
  const issues: string[] = [];
  const label = `${where} «${draft.title.slice(0, 60)}»`;
  const evidence = resolveAll(c.ledger, draft.evidence, label, issues);
  if (draft.evidence.length === 0) issues.push(`${label}: cita al menos una métrica en evidence.`);

  let impactCents: number | null = null;
  if (draft.impact_ref) {
    const impact = c.ledger.resolve(draft.impact_ref);
    if (!impact) issues.push(`${label}: impact_ref «${draft.impact_ref}» no existe en esta ejecución.`);
    else if (impact.unit !== "eur_cents" || impact.value === null) issues.push(`${label}: impact_ref tiene que ser una métrica en euros.`);
    else {
      impactCents = Math.abs(impact.value);
      if (!evidence.some((e) => e.ref === impact.ref)) evidence.push(impact);
    }
  }

  if (!c.ledger.subjects().has(draft.subject)) {
    const sample = [...c.ledger.subjects()].slice(0, 8).join(", ");
    issues.push(`${label}: subject «${draft.subject}» no es el subject de ningún resultado o fila de las tools (por ejemplo: ${sample}).`);
  }

  const texts = [draft.title, draft.summary, draft.reasoning, draft.risks, ...draft.proposed_actions.map((a) => a.title), ...draft.missing_data];
  const all = texts.join("\n");
  issues.push(...numberIssues(label, all, evidence, c.ledger));
  for (const claim of adviceClaims(all)) issues.push(`${label}: no lo presentes como asesoramiento («${claim}»): es una recomendación a validar con la gestoría.`);
  issues.push(
    ...policyIssues({
      text: all,
      policyRule: draft.policy_rule,
      ledger: c.ledger,
      version: c.policy.version,
      isExample: c.policy.isExample,
      citesPolicy: evidence.some((e) => e.key.startsWith("policy.")),
    }).map((i) => `${label}: ${i}`),
  );

  const detected = c.agent === "fiscal" || needsProfessionalReview(all);
  if (issues.length > 0) return { issues, rec: null };
  return {
    issues,
    rec: {
      kind: draft.kind,
      title: tidyText(draft.title),
      summary: tidyText(draft.summary),
      reasoning: tidyText(draft.reasoning),
      evidence,
      proposedActions: draft.proposed_actions.map((a) => ({ title: a.title.trim(), due_in_days: a.due_in_days })),
      missingData: draft.missing_data,
      impactCents,
      confidence: draft.confidence,
      urgency: draft.urgency,
      risks: tidyText(draft.risks) || null,
      requiresProfessionalReview: draft.requires_professional_review || detected,
      subject: draft.subject,
      dedupeKey: `${c.agent}:${draft.subject}`,
      flaggedByRunner: detected && !draft.requires_professional_review,
    },
  };
}

export function checkScan(output: ScanOutput, c: CheckContext): { issues: string[]; recs: CheckedRecommendation[] } {
  const issues: string[] = [];
  const recs: CheckedRecommendation[] = [];
  const subjects = new Set<string>();
  for (const draft of output.recommendations) {
    const checked = checkDraft(draft, c);
    issues.push(...checked.issues);
    if (checked.rec) {
      if (subjects.has(checked.rec.subject)) issues.push(`Dos recomendaciones tratan lo mismo (${checked.rec.subject}): júntalas en una.`);
      subjects.add(checked.rec.subject);
      recs.push(checked.rec);
    }
  }
  if (output.recommendations.length === 0 && !output.silence_reason) issues.push("Sin recomendaciones, explica en silence_reason por qué no hay nada relevante.");
  return { issues, recs };
}

export type CheckedClose = {
  headline: string;
  summary: string;
  highlights: { text: string; evidence: EvidenceItem[] }[];
  distributionComment: string;
  evidence: EvidenceItem[];
};

export function checkClose(output: MonthlyCloseOutput, c: CheckContext): { issues: string[]; close: CheckedClose | null; recs: CheckedRecommendation[] } {
  const issues: string[] = [];
  if (!c.ledger.calledTools().includes("get_monthly_close")) issues.push("El cierre tiene que salir de get_monthly_close: llámala.");
  const evidence = resolveAll(c.ledger, output.close.evidence, "Cierre", issues);
  const highlights = output.close.highlights.map((h, i) => {
    const items = resolveAll(c.ledger, h.evidence, `Punto ${i + 1} del cierre`, issues);
    for (const item of items) if (!evidence.some((e) => e.ref === item.ref)) evidence.push(item);
    issues.push(...numberIssues(`Punto ${i + 1} del cierre`, h.text, items.length > 0 ? items : evidence, c.ledger));
    return { text: tidyText(h.text), evidence: items };
  });
  const general = [output.close.headline, output.close.summary, output.close.distribution_comment].join("\n");
  issues.push(...numberIssues("Resumen del cierre", general, evidence, c.ledger));
  for (const claim of adviceClaims(general)) issues.push(`Cierre: no lo presentes como asesoramiento («${claim}»).`);
  if (c.policy.isExample && !/ejemplo/i.test(general)) issues.push("Cierre: la política es la de EJEMPLO; dilo en el resumen o en el comentario del reparto.");
  const scan = checkScan({ recommendations: output.recommendations, silence_reason: "cierre" }, c);
  issues.push(...scan.issues);
  if (issues.length > 0) return { issues, close: null, recs: [] };
  return {
    issues,
    close: { headline: tidyText(output.close.headline), summary: tidyText(output.close.summary), highlights, distributionComment: tidyText(output.close.distribution_comment), evidence },
    recs: scan.recs,
  };
}

export type CheckedBriefingItem = {
  title: string;
  why: string;
  /** Lo que se gana, se pierde o se ahorra (de impact_ref); null si no se ha podido cuantificar. */
  impactCents: number | null;
  recommendationId: string | null;
  fromAgents: string[];
  evidence: EvidenceItem[];
};

export type CheckedBriefing = {
  headline: string;
  topActions: (CheckedBriefingItem & { urgency: string; ifNotDone: string })[];
  riskAlerts: (CheckedBriefingItem & { risk: string })[];
  optimizations: CheckedBriefingItem[];
  conflicts: { agents: string[]; tension: string; decision: string; evidence: EvidenceItem[] }[];
  cash: { text: string; evidence: EvidenceItem[] };
  areas: { area: string; status: string; note: string; evidence: EvidenceItem[] }[];
  evidence: EvidenceItem[];
};

/**
 * El briefing del Chief of Staff: cada punto con sus cifras en la evidencia, su impacto en € como
 * métrica (nunca un número escrito), la recomendación abierta en la que se basa (si la cita) y,
 * en los conflictos, agentes distintos.
 */
export function checkBriefing(output: BriefingOutput, c: CheckContext & { openRecommendationIds: ReadonlySet<string> }): { issues: string[]; briefing: CheckedBriefing | null } {
  const issues: string[] = [];
  const b = output.briefing;
  const all: EvidenceItem[] = [];
  const collect = (items: EvidenceItem[]) => {
    for (const item of items) if (!all.some((e) => e.ref === item.ref)) all.push(item);
    return items;
  };
  const item = (
    where: string,
    d: { title: string; why: string; impact_ref: string | null; recommendation_id: string | null; from_agents: readonly string[]; evidence: readonly string[] },
    extraText = "",
  ): CheckedBriefingItem => {
    const items = collect(resolveAll(c.ledger, d.evidence, where, issues));
    if (d.recommendation_id && !c.openRecommendationIds.has(d.recommendation_id)) {
      issues.push(`${where}: la recomendación ${d.recommendation_id} no está entre las abiertas (usa el id que devuelve get_past_recommendations o null).`);
    }
    let impactCents: number | null = null;
    if (d.impact_ref) {
      const impact = c.ledger.resolve(d.impact_ref);
      if (!impact) issues.push(`${where}: impact_ref «${d.impact_ref}» no existe en esta ejecución.`);
      else if (impact.unit !== "eur_cents" || impact.value === null) issues.push(`${where}: impact_ref tiene que ser una métrica en euros.`);
      else {
        impactCents = Math.abs(impact.value);
        if (!items.some((e) => e.ref === impact.ref)) items.push(impact);
        collect([impact]);
      }
    }
    issues.push(...numberIssues(where, `${d.title}\n${d.why}\n${extraText}`, items, c.ledger));
    return { title: tidyText(d.title), why: tidyText(d.why), impactCents, recommendationId: d.recommendation_id, fromAgents: [...new Set(d.from_agents)], evidence: items };
  };

  const topActions = b.top_actions.map((d, i) => ({
    ...item(`Acción crítica ${i + 1}`, d, d.if_not_done),
    urgency: d.urgency,
    ifNotDone: tidyText(d.if_not_done),
  }));
  const riskAlerts = b.risk_alerts.map((d, i) => ({ ...item(`Alerta de riesgo ${i + 1}`, d), risk: d.risk }));
  const optimizations = b.optimizations.map((d, i) => item(`Optimización ${i + 1}`, d));
  const conflicts = b.conflicts.map((d, i) => {
    const where = `Conflicto ${i + 1}`;
    const items = collect(resolveAll(c.ledger, d.evidence, where, issues));
    if (new Set(d.agents).size < 2) issues.push(`${where}: un conflicto es entre al menos dos agentes distintos.`);
    issues.push(...numberIssues(where, `${d.tension}\n${d.decision}`, items, c.ledger));
    return { agents: [...new Set(d.agents)], tension: tidyText(d.tension), decision: tidyText(d.decision), evidence: items };
  });
  const titles = [...b.top_actions, ...b.risk_alerts, ...b.optimizations].map((d) => d.title.trim().toLowerCase());
  if (new Set(titles).size !== titles.length) issues.push("Cada punto va en una sola sección del briefing: no repitas la misma acción como alerta u optimización.");

  const cashItems = collect(resolveAll(c.ledger, b.cash.evidence, "Caja", issues));
  issues.push(...numberIssues("Caja", b.cash.text, cashItems, c.ledger));
  const areas = b.areas.map((a) => {
    const items = collect(resolveAll(c.ledger, a.evidence, `Área ${a.area}`, issues));
    if (a.status !== "sin_datos" && items.length === 0) issues.push(`Área ${a.area}: un semáforo ${a.status} necesita evidencia; sin datos, usa sin_datos.`);
    issues.push(...numberIssues(`Área ${a.area}`, a.note, items, c.ledger));
    return { area: a.area, status: a.status, note: tidyText(a.note), evidence: items };
  });
  if (new Set(b.areas.map((a) => a.area)).size !== b.areas.length) issues.push("Cada área va una sola vez en el semáforo.");
  issues.push(...numberIssues("Titular del briefing", b.headline, all, c.ledger));
  if (issues.length > 0) return { issues, briefing: null };
  return {
    issues,
    briefing: {
      headline: tidyText(b.headline),
      topActions,
      riskAlerts,
      optimizations,
      conflicts,
      cash: { text: tidyText(b.cash.text), evidence: cashItems },
      areas,
      evidence: all,
    },
  };
}

/**
 * Un briefing rechazado por unos pocos puntos (una cifra sin su métrica en un conflicto, un
 * semáforo con un recuento hecho a mano…) no se pierde entero: se quitan los puntos que no pasan
 * por sí solos, el titular y la caja se sustituyen por textos sin cifras si hace falta, y se
 * vuelve a comprobar todo. `omitted` dice qué se ha quitado.
 */
export function salvageBriefing(
  output: BriefingOutput,
  c: CheckContext & { openRecommendationIds: ReadonlySet<string> },
): { briefing: CheckedBriefing | null; omitted: string[] } {
  const b = output.briefing;
  const omitted: string[] = [];
  const neutral: BriefingOutput["briefing"] = {
    headline: "El briefing de esta semana",
    top_actions: [],
    risk_alerts: [],
    optimizations: [],
    conflicts: [],
    cash: { text: "Esta semana no hay datos de caja fiables.", evidence: [] },
    areas: [],
  };
  const passes = (briefing: BriefingOutput["briefing"]) => checkBriefing({ briefing }, c).issues.length === 0;
  const keep = <K extends "top_actions" | "risk_alerts" | "optimizations" | "conflicts" | "areas">(key: K, label: (item: BriefingOutput["briefing"][K][number]) => string) =>
    (b[key] as BriefingOutput["briefing"][K][number][]).filter((item) => {
      const ok = passes({ ...neutral, [key]: [item] });
      if (!ok) omitted.push(label(item));
      return ok;
    }) as BriefingOutput["briefing"][K];

  const seen = new Set<string>();
  const unique = <T extends { title: string }>(items: T[]) =>
    items.filter((item) => {
      const key = item.title.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const areas = new Set<string>();
  const candidate: BriefingOutput["briefing"] = {
    headline: b.headline,
    top_actions: unique(keep("top_actions", (d) => d.title)),
    risk_alerts: unique(keep("risk_alerts", (d) => d.title)),
    optimizations: unique(keep("optimizations", (d) => d.title)),
    conflicts: keep("conflicts", (d) => d.tension),
    cash: passes({ ...neutral, cash: b.cash }) ? b.cash : (omitted.push("caja"), neutral.cash),
    areas: keep("areas", (a) => a.area).filter((a) => (areas.has(a.area) ? false : (areas.add(a.area), true))),
  };
  let checked = checkBriefing({ briefing: candidate }, c);
  if (checked.issues.length > 0) {
    // Lo que queda es el titular: sin cifras justificadas, el de la primera acción.
    candidate.headline = candidate.top_actions[0]?.title ?? candidate.risk_alerts[0]?.title ?? neutral.headline;
    checked = checkBriefing({ briefing: candidate }, c);
  }
  return { briefing: checked.briefing, omitted };
}

export function checkChallenge(output: ChallengeOutput, c: CheckContext): { issues: string[]; evidence: EvidenceItem[] } {
  const issues: string[] = [];
  const evidence = resolveAll(c.ledger, output.evidence, "Revisión", issues);
  const text = [output.risks, output.pessimistic_scenario, ...output.weak_assumptions].join("\n");
  issues.push(...numberIssues("Revisión del abogado del diablo", text, evidence, c.ledger));
  return { issues, evidence };
}

export function checkReview(output: ReviewOutput, c: CheckContext): { issues: string[]; evidence: EvidenceItem[]; actualCents: number | null } {
  const issues: string[] = [];
  const evidence = resolveAll(c.ledger, output.evidence, "Seguimiento", issues);
  let actualCents: number | null = null;
  if (output.actual_ref) {
    const actual = c.ledger.resolve(output.actual_ref);
    if (!actual || actual.unit !== "eur_cents" || actual.value === null) issues.push("Seguimiento: actual_ref tiene que ser una métrica en euros de esta ejecución.");
    else {
      actualCents = actual.value;
      if (!evidence.some((e) => e.ref === actual.ref)) evidence.push(actual);
    }
  }
  issues.push(...numberIssues("Seguimiento", output.notes, evidence, c.ledger));
  return { issues, evidence, actualCents };
}
