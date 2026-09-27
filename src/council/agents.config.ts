// Modelo, esfuerzo, presupuesto y umbrales por agente (CONSEJO.md §5). Son los valores por
// defecto: cada org los cambia en Ajustes → Consejo (agent_settings) sin tocar el código.
//
// Modelos: `claude-sonnet-5` para lo diario; `claude-opus-5-5` para el cierre mensual, el abogado
// del diablo y el Chief of Staff. El modelo es intercambiable: el runtime (src/council/runtime)
// es lo único que sabe de Claude.

import type { AgentName, Task } from "./types";

export const COUNCIL_MODELS = ["claude-sonnet-5", "claude-opus-5-5"] as const;
export type CouncilModel = (typeof COUNCIL_MODELS)[number];

export function isCouncilModel(value: unknown): value is CouncilModel {
  return typeof value === "string" && (COUNCIL_MODELS as readonly string[]).includes(value);
}

export const DAILY_MODEL: CouncilModel = "claude-sonnet-5";
export const DEEP_MODEL: CouncilModel = "claude-opus-5-5";

/** Esfuerzo de razonamiento (output_config.effort). Más esfuerzo = más tokens y más coste. */
export type Effort = "low" | "medium" | "high";

/**
 * Precios públicos de la API en USD por millón de tokens, a 26/09/2026. Solo sirven para estimar
 * el coste de cada ejecución (agent_runs.cost_usd_micros) y aplicar el presupuesto; la factura
 * real es la de Anthropic. Escritura en caché de 5 minutos = 1,25 × entrada.
 */
export const MODEL_PRICES_USD_PER_MTOK: Record<CouncilModel, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  "claude-sonnet-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  "claude-opus-5-5": { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
};

/** Umbrales que usan las tools y el runner. Todos se pueden cambiar por agente en los ajustes. */
export type Thresholds = {
  /** Días sin movimiento (etapa o actividad) para dar un deal por parado. */
  stalled_days?: number;
  /** Días sin actividad con un cliente activo para marcarlo en riesgo. */
  inactivity_days?: number;
  /** Días de vencida de una factura para marcar al cliente en riesgo. */
  overdue_days?: number;
  /** Días de antelación para avisar de un plazo fiscal. */
  deadline_days?: number;
  /** Máximo de recomendaciones por ejecución (menos y mejores). */
  max_recommendations?: number;
  /** Decisiones del briefing semanal. */
  max_decisions?: number;
  /** Días que una recomendación descartada no vuelve a salir. */
  dismissed_cooldown_days?: number;
};

export type AgentConfig = {
  model: CouncilModel;
  /** Modelo para una tarea concreta (el cierre mensual del CFO va con el modelo profundo). */
  modelByTask?: Partial<Record<Task, CouncilModel>>;
  effort: Effort;
  effortByTask?: Partial<Record<Task, Effort>>;
  /** Presupuesto mensual por defecto, en céntimos de dólar. */
  monthlyBudgetUsdCents: number;
  /** Rondas de tools como mucho en una ejecución. */
  maxToolRounds: number;
  maxOutputTokens: number;
  thresholds: Thresholds;
};

const COMMON: Thresholds = { dismissed_cooldown_days: 60 };

export const AGENT_CONFIG: Record<AgentName, AgentConfig> = {
  cfo: {
    model: DAILY_MODEL,
    modelByTask: { monthly_close: DEEP_MODEL },
    effort: "medium",
    effortByTask: { monthly_close: "high" },
    monthlyBudgetUsdCents: 1500,
    maxToolRounds: 8,
    maxOutputTokens: 16_000,
    thresholds: { ...COMMON, max_recommendations: 3 },
  },
  commercial: {
    model: DAILY_MODEL,
    effort: "low",
    monthlyBudgetUsdCents: 800,
    maxToolRounds: 6,
    maxOutputTokens: 12_000,
    thresholds: { ...COMMON, stalled_days: 21, max_recommendations: 3 },
  },
  pricing: {
    model: DAILY_MODEL,
    effort: "medium",
    monthlyBudgetUsdCents: 500,
    maxToolRounds: 6,
    maxOutputTokens: 12_000,
    thresholds: { ...COMMON, max_recommendations: 2 },
  },
  retention: {
    model: DAILY_MODEL,
    effort: "low",
    monthlyBudgetUsdCents: 600,
    maxToolRounds: 6,
    maxOutputTokens: 12_000,
    thresholds: { ...COMMON, inactivity_days: 60, overdue_days: 15, max_recommendations: 3 },
  },
  operations: {
    model: DAILY_MODEL,
    effort: "low",
    monthlyBudgetUsdCents: 300,
    maxToolRounds: 5,
    maxOutputTokens: 10_000,
    thresholds: { ...COMMON, max_recommendations: 2 },
  },
  growth: {
    model: DAILY_MODEL,
    effort: "low",
    monthlyBudgetUsdCents: 300,
    maxToolRounds: 5,
    maxOutputTokens: 10_000,
    thresholds: { ...COMMON, max_recommendations: 2 },
  },
  fiscal: {
    model: DAILY_MODEL,
    effort: "medium",
    monthlyBudgetUsdCents: 300,
    maxToolRounds: 5,
    maxOutputTokens: 10_000,
    thresholds: { ...COMMON, deadline_days: 30, max_recommendations: 3 },
  },
  devils_advocate: {
    model: DEEP_MODEL,
    effort: "medium",
    monthlyBudgetUsdCents: 800,
    maxToolRounds: 5,
    maxOutputTokens: 10_000,
    thresholds: {},
  },
  chief_of_staff: {
    model: DEEP_MODEL,
    effort: "medium",
    monthlyBudgetUsdCents: 1500,
    maxToolRounds: 10,
    maxOutputTokens: 16_000,
    thresholds: { ...COMMON, max_decisions: 3 },
  },
};

/** Claves de umbral que entiende cada agente (las que enseña Ajustes → Consejo). */
export function thresholdKeys(agent: AgentName): (keyof Thresholds)[] {
  return Object.keys(AGENT_CONFIG[agent].thresholds) as (keyof Thresholds)[];
}

/** Límites de cada umbral (validación de los ajustes). */
export const THRESHOLD_LIMITS: Record<keyof Thresholds, { min: number; max: number }> = {
  stalled_days: { min: 1, max: 365 },
  inactivity_days: { min: 7, max: 730 },
  overdue_days: { min: 1, max: 365 },
  deadline_days: { min: 1, max: 120 },
  max_recommendations: { min: 0, max: 10 },
  max_decisions: { min: 1, max: 3 },
  dismissed_cooldown_days: { min: 0, max: 365 },
};

/** Los umbrales efectivos de un agente: los de por defecto con lo que haya guardado la org encima. */
export function effectiveThresholds(agent: AgentName, saved: unknown): Thresholds {
  const out: Thresholds = { ...AGENT_CONFIG[agent].thresholds };
  if (saved && typeof saved === "object" && !Array.isArray(saved)) {
    for (const [key, value] of Object.entries(saved as Record<string, unknown>)) {
      if (!(key in out)) continue;
      const limits = THRESHOLD_LIMITS[key as keyof Thresholds];
      if (limits && typeof value === "number" && Number.isInteger(value) && value >= limits.min && value <= limits.max) {
        out[key as keyof Thresholds] = value;
      }
    }
  }
  return out;
}
