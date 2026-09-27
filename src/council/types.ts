// Tipos compartidos del Consejo de agentes (CONSEJO.md). Los valores de la recomendación
// (estado, confianza, urgencia) siguen el formato que fijaron los socios; las etiquetas salen de
// i18n (council.json). Mismo orden que los enums de supabase/migrations/20260926220000_consejo.sql.

export const AGENT_NAMES = [
  "cfo",
  "commercial",
  "pricing",
  "retention",
  "operations",
  "growth",
  "fiscal",
  "devils_advocate",
  "chief_of_staff",
] as const;
export type AgentName = (typeof AGENT_NAMES)[number];

export function isAgentName(value: unknown): value is AgentName {
  return typeof value === "string" && (AGENT_NAMES as readonly string[]).includes(value);
}

export const RECOMMENDATION_STATUSES = ["nueva", "aceptada", "descartada", "pospuesta", "hecha"] as const;
export type RecommendationStatus = (typeof RECOMMENDATION_STATUSES)[number];

export const CONFIDENCES = ["alta", "media", "baja"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export const URGENCIES = ["hoy", "esta_semana", "este_mes"] as const;
export type Urgency = (typeof URGENCIES)[number];

/** decision: propone algo · alert: avisa de algo que vigilar · data_gap: explica qué dato falta. */
export const RECOMMENDATION_KINDS = ["decision", "alert", "data_gap"] as const;
export type RecommendationKind = (typeof RECOMMENDATION_KINDS)[number];

/** Estados abiertos: mientras una recomendación siga así, no se repite (índice único en la base de datos). */
export const OPEN_STATUSES: readonly RecommendationStatus[] = ["nueva", "pospuesta", "aceptada"];

/** Lo que hace un agente en una ejecución. */
export const TASKS = ["scan", "monthly_close", "weekly_briefing", "challenge", "review"] as const;
export type Task = (typeof TASKS)[number];

/** Resultado de la revisión a 30/60/90 días de una recomendación aceptada. */
export const REVIEW_OUTCOMES = ["hit", "partial", "miss", "no_data"] as const;
export type ReviewOutcome = (typeof REVIEW_OUTCOMES)[number];

/** Una cifra de la evidencia tal como se guarda con la recomendación (sale siempre de una tool). */
export type EvidenceItem = {
  /** Id de la métrica en la ejecución (m12) o de la llamada (t3) si cita un dato que falta. */
  ref: string;
  tool: string;
  /** Clave estable de la métrica (p. ej. `receivables.overdue_total`). */
  key: string;
  label: string;
  value: number | null;
  unit: string;
  /** El valor ya formateado, como lo vio el agente. */
  display: string;
  period: string;
  source: string;
  /** Ruta dentro de la org (p. ej. /clients/<id>). */
  href: string | null;
};

export type ProposedAction = { title: string; due_in_days: number | null };
