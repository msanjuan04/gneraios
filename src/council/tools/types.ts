// Contrato de las tools del consejo. Una tool es una función determinista y testeada que lee el
// negocio (solo lectura) y devuelve cifras con su periodo, su fuente y un enlace a la pantalla de
// la app donde se ven. El modelo nunca calcula: cita las métricas por su id y el runner comprueba
// que cada número del texto sale de ellas.

import { z } from "zod";
import type { CivilDate } from "@/domain/dates/civil-date";
import type { Thresholds } from "../agents.config";
import type { CouncilData } from "../data/types";
import type { ResolvedPolicy } from "../policy/schema";
import type { AgentName, Confidence, RecommendationKind, RecommendationStatus, Urgency } from "../types";

/** `minutes`: minutos enteros (como time_entries.minutes); se escriben en horas ("12,5 h"). */
export const METRIC_UNITS = ["eur_cents", "bps", "count", "days", "months", "minutes", "number", "position", "flag"] as const;
export type MetricUnit = (typeof METRIC_UNITS)[number];

export const metricSchema = z.object({
  /** Clave estable (la misma en cada ejecución): `mrr.current`, `deal.<id>.days_stalled`… */
  key: z.string().min(1).max(200),
  label: z.string().min(1).max(200),
  value: z.number().finite(),
  unit: z.enum(METRIC_UNITS),
  /** `2026-08` (un mes), `2026-09-26` (un día) o `2025-10-01/2026-09-30` (un rango). */
  period: z.string().min(1).max(40),
  href: z.string().startsWith("/").optional(),
});
export type Metric = z.infer<typeof metricSchema>;

const fieldValue = z.union([z.string(), z.boolean(), z.null()]);

export const toolRowSchema = z.object({
  /** De qué trata la fila: `client:<id>`, `deal:<id>`, `line:<id>`… */
  subject: z.string().min(1).max(200),
  label: z.string().min(1).max(300),
  href: z.string().startsWith("/").optional(),
  /** Solo texto: toda cifra va como métrica, para poder citarla. */
  fields: z.record(z.string(), fieldValue).default({}),
  metrics: z.array(metricSchema).default([]),
});
export type ToolRow = z.infer<typeof toolRowSchema>;

export const toolResultSchema = z.object({
  tool: z.string().min(1),
  /** ok, o missing_data si falta lo principal (entonces `missing` dice qué). */
  status: z.enum(["ok", "missing_data"]),
  /** De qué trata el resultado en conjunto: `receivables`, `mrr`, `close:2026-08`… */
  subject: z.string().min(1).max(200),
  period: z.object({ from: z.string(), to: z.string() }).nullable(),
  source: z.string().min(1),
  href: z.string().startsWith("/"),
  summary: z.string(),
  metrics: z.array(metricSchema),
  rows: z.array(toolRowSchema).default([]),
  /** Lo que falta (también en un resultado parcial con status ok). */
  missing: z.object({ what: z.string(), needs: z.array(z.string()), href: z.string().startsWith("/").optional() }).nullable().default(null),
  notes: z.array(z.string()).default([]),
  /** Datos estructurados para el runner (p. ej. el reparto del cierre). No se enseñan al modelo. */
  data: z.record(z.string(), z.unknown()).optional(),
});
export type ToolResult = z.infer<typeof toolResultSchema>;
export type ToolResultInput = z.input<typeof toolResultSchema>;

/** Una regla de venta cruzada (tabla upsell_rules). */
export type UpsellRule = {
  id: string;
  label: string;
  requiresAny: string[];
  excludesAny: string[];
  maxServices: number | null;
  minMonths: number | null;
  suggestion: string;
  referenceMrrCents: number | null;
};

/** Una recomendación anterior, para el contexto ("descartasteis X porque…") y el Chief of Staff. */
export type PastRecommendation = {
  id: string;
  agent: AgentName;
  kind: RecommendationKind;
  title: string;
  summary: string;
  status: RecommendationStatus;
  subject: string;
  dedupeKey: string;
  impactCents: number | null;
  confidence: Confidence;
  urgency: Urgency;
  requiresProfessionalReview: boolean;
  decisionNote: string | null;
  postponedUntil: CivilDate | null;
  decidedAt: string | null;
  createdAt: string;
};

export type PastRecommendationFilter = {
  agent?: AgentName;
  statuses?: RecommendationStatus[];
  /** Creadas o decididas desde este instante ISO. */
  since?: string;
  limit?: number;
};

/** Lo que las tools leen del propio consejo (también solo lectura). */
export interface CouncilReadPort {
  pastRecommendations(filter: PastRecommendationFilter): Promise<PastRecommendation[]>;
  upsellRules(): Promise<UpsellRule[]>;
}

export type ToolContext = {
  orgId: string;
  today: CivilDate;
  timeZone: string;
  data: CouncilData;
  council: CouncilReadPort;
  policy: ResolvedPolicy;
  /** Umbrales efectivos de todos los agentes (las claves no se repiten entre agentes). */
  thresholds: Thresholds;
  /** Ventana de renovaciones y aviso de concentración (orgs.settings). */
  renewalWindowDays: number;
  concentrationAlertBps: number;
  /** €/hora objetivo de la org (orgs.settings.target_hourly_rate_cents): el mismo con el que Proyectos pinta la tarifa. */
  targetHourlyRateCents: number;
  /** Capacidad semanal por persona: orgs.settings.weekly_capacity_minutes o, si no está, el supuesto por defecto. */
  weeklyCapacity: { minutes: number; fromSettings: boolean };
};

export type ToolDefinition<Input extends z.ZodType = z.ZodType> = {
  name: string;
  /** Para el modelo: qué devuelve y cuándo usarla. */
  description: string;
  input: Input;
  run: (ctx: ToolContext, input: z.output<Input>) => Promise<ToolResultInput>;
};

/** Ayuda de tipos: una tool con su esquema de entrada. */
export function defineTool<Input extends z.ZodType>(tool: ToolDefinition<Input>): ToolDefinition<Input> {
  return tool;
}
