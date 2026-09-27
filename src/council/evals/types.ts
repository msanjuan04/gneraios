// Escenarios de evaluación del consejo (CONSEJO.md §9). Cada uno es un JSON en ./scenarios con:
//
// - los datos (el escenario de referencia de testing.ts con cambios: sin un deal, con Finanzas,
//   con horas registradas en Proyectos…),
//   la política, los ajustes y las recomendaciones que ya existían;
// - el trabajo que se lanza (agente, disparador, payload);
// - las respuestas grabadas del modelo (`replay`): en cada intento, qué tools llama y qué JSON
//   devuelve. Con ellas el eval corre sin red (FakeRuntime); con `--live`, contra el modelo real;
// - lo que se espera (`expect`): los rasgos que puntúa el script.

import { z } from "zod";
import { AGENT_NAMES, CONFIDENCES, RECOMMENDATION_KINDS, RECOMMENDATION_STATUSES, URGENCIES } from "../types";

const attemptSchema = z.object({
  /** Las tools que "llama el modelo" en este intento, en orden. */
  calls: z.array(z.object({ name: z.string().min(1), input: z.record(z.string(), z.unknown()).optional() })).default([]),
  /**
   * La salida del modelo. Dentro, "@call:N" es el id de la llamada N (desde 0) de este intento y
   * "@rec:N" el id de la recomendación N de `existing`.
   */
  output: z.unknown(),
});
export type ReplayAttempt = z.infer<typeof attemptSchema>;

const existingSchema = z.object({
  agent: z.enum(AGENT_NAMES),
  kind: z.enum(RECOMMENDATION_KINDS).default("decision"),
  title: z.string().min(3),
  summary: z.string().default(""),
  subject: z.string().min(1),
  status: z.enum(RECOMMENDATION_STATUSES).default("nueva"),
  decisionNote: z.string().nullable().default(null),
  /** Hace cuántos días se creó (y se decidió, si está decidida). */
  daysAgo: z.number().int().min(0).default(3),
  impactCents: z.number().int().nullable().default(null),
  urgency: z.enum(URGENCIES).default("esta_semana"),
  confidence: z.enum(CONFIDENCES).default("media"),
});
export type ExistingRecommendation = z.infer<typeof existingSchema>;

const expectSchema = z.object({
  /** Estado final del trabajo. */
  status: z.enum(["done", "failed", "skipped"]).default("done"),
  /** Silencio útil: no se publica nada (y el trabajo acaba bien). */
  silent: z.boolean().default(false),
  /** Cuántas recomendaciones nuevas (si no es silencioso: al menos una por defecto). */
  published: z.object({ min: z.number().int().min(0).default(1), max: z.number().int().min(0).default(10) }).optional(),
  /** Tools que el agente tiene que haber usado. */
  tools: z.array(z.string()).default([]),
  /** Revisión profesional: en todas las publicadas, en ninguna o da igual. */
  professional: z.enum(["all", "none", "any"]).default("any"),
  /** Expresiones regulares: cada una tiene que casar con el título de alguna publicada. */
  titles: z.array(z.string()).default([]),
  /** …y ninguna de estas con ninguna publicada (lo que la política no permite proponer). */
  forbid: z.array(z.string()).default([]),
  /** Tipos permitidos de lo publicado. */
  kinds: z.array(z.enum(RECOMMENDATION_KINDS)).optional(),
  /** Alguna recomendación silenciada con un motivo que case con esto. */
  silencedReason: z.string().optional(),
  /** El informe que tiene que salir (cierre mensual o briefing). */
  report: z
    .object({
      kind: z.enum(["monthly_close", "weekly_briefing"]),
      distribution: z.boolean().optional(),
      minDecisions: z.number().int().min(0).optional(),
      maxDecisions: z.number().int().min(0).optional(),
    })
    .nullable()
    .default(null),
  /** Lo que tiene que llegarle al agente en su tarea (p. ej. el motivo de un descarte). */
  promptIncludes: z.array(z.string()).default([]),
  /** Estado de la revisión del abogado del diablo en la publicada. */
  challenge: z.enum(["revisada", "sin_revisar"]).optional(),
  confidence: z.enum(CONFIDENCES).optional(),
  /** Impacto de la primera publicada, en céntimos. */
  impactCents: z.number().int().optional(),
  /** Solo con las respuestas grabadas (con el modelo real varía). */
  replayOnly: z.object({ attempts: z.number().int().min(1).max(3).optional() }).default({}),
});
export type EvalExpectation = z.infer<typeof expectSchema>;

const settingSchema = z.object({
  agent: z.enum(AGENT_NAMES),
  enabled: z.boolean().default(true),
  model: z.string().nullable().default(null),
  monthlyBudgetUsdCents: z.number().int().min(0).nullable().default(null),
  thresholds: z.record(z.string(), z.number().int()).default({}),
});

export const evalScenarioSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(3),
  /** Qué mide y por qué importa. */
  description: z.string().min(3),
  job: z.object({ agent: z.enum(AGENT_NAMES), trigger: z.string().min(1), payload: z.record(z.string(), z.unknown()).default({}) }),
  /** Instante de la ejecución (por defecto, el 26/09/2026 a las 10:00 en Madrid). */
  now: z.string().datetime().optional(),
  data: z
    .object({
      /** "default": el saldo y los gastos de testing.ts; o un objeto con los suyos. Sin clave: sin Finanzas. */
      finance: z.union([z.literal("default"), z.record(z.string(), z.unknown())]).optional(),
      /** "default": los proyectos con horas y tareas de testing.ts (projectsFixture); o los suyos. Sin clave: nadie registra horas. */
      projects: z.union([z.literal("default"), z.array(z.record(z.string(), z.unknown()))]).optional(),
      seo: z.record(z.string(), z.unknown()).optional(),
      removeClients: z.array(z.string()).default([]),
      removeDeals: z.array(z.string()).default([]),
      /** Facturas sin cobrar por cliente (sustituye las del escenario de referencia). */
      unpaid: z.record(z.string(), z.array(z.string())).optional(),
      clients: z.array(z.record(z.string(), z.unknown())).default([]),
      deals: z.array(z.record(z.string(), z.unknown())).default([]),
      activities: z.array(z.record(z.string(), z.unknown())).default([]),
    })
    .default({ removeClients: [], removeDeals: [], clients: [], deals: [], activities: [] }),
  /** "example": sin política guardada; o los cambios sobre la de ejemplo, guardados como v1. */
  policy: z.union([z.literal("example"), z.record(z.string(), z.unknown())]).default("example"),
  settings: z.array(settingSchema).default([]),
  existing: z.array(existingSchema).default([]),
  /** Respuestas grabadas por "agente:tarea". */
  replay: z.record(z.string(), z.array(attemptSchema).min(1)).default({}),
  expect: expectSchema,
});
export type EvalScenario = z.infer<typeof evalScenarioSchema>;

/** Las cuatro preguntas de CONSEJO.md §9, más lo propio de cada escenario. */
export const DIMENSIONS = ["tools", "policy", "professional", "silence", "scenario"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export type EvalCheck = { dimension: Dimension; name: string; passed: boolean; detail?: string };

export type EvalResult = {
  id: string;
  title: string;
  agent: string;
  mode: "replay" | "live";
  passed: boolean;
  checks: EvalCheck[];
  status: string;
  published: { title: string; impactCents: number | null; professional: boolean }[];
  silenced: { title: string; reason: string }[];
  attempts: number;
  costUsdMicros: number;
  durationMs: number;
  error: string | null;
};
