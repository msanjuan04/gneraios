// Esquemas de salida de los agentes (JSON validado con Zod; con Claude, además, salida
// estructurada). Las cifras no viajan aquí: el agente cita métricas por su id (m12) y el runner
// las convierte en evidencia. El impacto en € también es una métrica (impact_ref), nunca un número
// que escriba el modelo.

import { z } from "zod";
import { CONFIDENCES, RECOMMENDATION_KINDS, REVIEW_OUTCOMES, URGENCIES } from "../types";

const refs = (max: number) => z.array(z.string().min(1).max(200)).max(max);

export const POLICY_RULE_KEYS = ["raise_partner_pay", "hire"] as const;

export const recommendationDraftSchema = z.object({
  kind: z.enum(RECOMMENDATION_KINDS).describe("decision: propone algo · alert: algo que vigilar · data_gap: falta un dato para decidir"),
  title: z.string().min(8).max(140).describe("Título accionable, en imperativo"),
  summary: z.string().min(10).max(600).describe("Qué proponer y por qué, en dos o tres frases"),
  reasoning: z.string().min(10).max(3000).describe("El razonamiento, citando las cifras tal como vienen en las métricas"),
  evidence: refs(20).describe("Ids de las métricas usadas (m12) o de la llamada que devolvió missing_data (t3)"),
  impact_ref: z.string().max(200).nullable().describe("Id de la métrica en € que mide el impacto; null si no hay"),
  proposed_actions: z
    .array(z.object({ title: z.string().min(3).max(200), due_in_days: z.number().int().min(0).max(90).nullable() }))
    .max(5)
    .describe("Tareas que se crean si los socios aceptan"),
  confidence: z.enum(CONFIDENCES),
  urgency: z.enum(URGENCIES),
  risks: z.string().max(800).describe("Riesgos y supuestos débiles"),
  requires_professional_review: z.boolean().describe("true si toca algo fiscal, laboral o legal"),
  subject: z.string().min(1).max(200).describe("El `subject` de la fila o del resultado de la tool del que trata"),
  policy_rule: z.enum(POLICY_RULE_KEYS).nullable().describe("raise_partner_pay o hire si propone subir la retribución o contratar"),
  missing_data: z.array(z.string().min(3).max(200)).max(5).describe("Qué dato falta para decidir mejor"),
});
export type RecommendationDraft = z.infer<typeof recommendationDraftSchema>;

/** Revisión de un área: 0..N recomendaciones; ninguna = silencio útil (y se explica por qué). */
export const scanOutputSchema = z.object({
  recommendations: z.array(recommendationDraftSchema).max(5),
  silence_reason: z.string().max(400).nullable().describe("Si no hay recomendaciones, por qué"),
});
export type ScanOutput = z.infer<typeof scanOutputSchema>;

/** Cierre mensual del CFO: el comentario del cierre (la propuesta de reparto la calcula la tool). */
export const monthlyCloseOutputSchema = z.object({
  close: z.object({
    headline: z.string().min(8).max(200),
    summary: z.string().min(10).max(1500),
    highlights: z.array(z.object({ text: z.string().min(3).max(400), evidence: refs(6) })).max(6),
    distribution_comment: z.string().max(1000).describe("Comentario sobre la propuesta de reparto de get_monthly_close (o por qué no la hay)"),
    evidence: refs(40),
  }),
  recommendations: z.array(recommendationDraftSchema).max(3),
});
export type MonthlyCloseOutput = z.infer<typeof monthlyCloseOutputSchema>;

export const BRIEFING_AREAS = ["caja", "ingresos", "comercial", "clientes", "fiscal", "crecimiento", "operaciones"] as const;
export const TRAFFIC_LIGHTS = ["verde", "ambar", "rojo", "sin_datos"] as const;

/** Los 8 agentes especialistas: de cuyos resultados sale cada punto del briefing. */
export const SPECIALIST_AGENTS = ["cfo", "commercial", "pricing", "retention", "operations", "growth", "fiscal", "devils_advocate"] as const;
/** Qué puede romper el negocio: el tipo de cada alerta de riesgo del briefing. */
export const RISK_KINDS = ["caja", "legal", "fiscal", "cliente", "cuello_de_botella", "margen", "otro"] as const;

/**
 * Un punto del briefing, en síntesis ejecutiva: qué hacer y por qué (con sus cifras y a qué se
 * debe), cuánto dinero se gana, se pierde o se ahorra (una métrica en €, nunca un número escrito),
 * y de qué recomendación y de qué agentes sale.
 */
const briefingItem = {
  title: z.string().min(5).max(160).describe("Qué hacer, en imperativo: «Ajustar la retribución de los socios»"),
  why: z
    .string()
    .min(5)
    .max(600)
    .describe("Por qué, con sus cifras y a qué se debe («debido a la alerta de caja»). Nunca «el CFO dice…»: la síntesis es tuya"),
  impact_ref: z.string().max(200).nullable().describe("Id de la métrica en € de lo que se gana, se pierde o se ahorra; null si no se puede cuantificar"),
  recommendation_id: z.string().max(80).nullable().describe("Id de la recomendación abierta en la que se basa (get_past_recommendations), si la hay"),
  from_agents: z.array(z.enum(SPECIALIST_AGENTS)).max(4).describe("Los agentes de cuyos resultados sale"),
  evidence: refs(8),
};

/**
 * Briefing del lunes del Chief of Staff: no analiza los datos en bruto sino lo que han visto los
 * otros 8 agentes, y lo convierte en un plan de acción. Cada punto se clasifica por impacto en € y
 * por urgencia/riesgo (qué pasa si no se hace). Además, la caja y el semáforo por área.
 */
export const briefingOutputSchema = z.object({
  briefing: z.object({
    headline: z.string().min(8).max(200),
    top_actions: z
      .array(
        z.object({
          ...briefingItem,
          urgency: z.enum(URGENCIES),
          if_not_done: z.string().min(5).max(300).describe("Qué pasa si no se hace antes del martes: riesgo legal, pérdida de un cliente, cuello de botella…"),
        }),
      )
      .max(3)
      .describe("Las 3 acciones críticas, antes del martes, ordenadas por impacto en € y urgencia. Nunca de relleno"),
    risk_alerts: z
      .array(z.object({ ...briefingItem, risk: z.enum(RISK_KINDS) }))
      .max(4)
      .describe("Lo que puede romper el negocio esta semana (caja, legal, fiscal, un cliente, un cuello de botella, el margen)"),
    optimizations: z.array(z.object(briefingItem)).max(4).describe("Lo que os hará más eficientes: ahorros, precios, procesos"),
    conflicts: z
      .array(
        z.object({
          agents: z.array(z.enum(SPECIALIST_AGENTS)).min(2).max(3),
          tension: z.string().min(5).max(400).describe("En qué chocan, en una frase (el comercial quiere cerrar rápido y pricing avisa de que el margen no llega)"),
          decision: z.string().min(5).max(600).describe("La solución equilibrada que propones, con sus cifras"),
          evidence: refs(8),
        }),
      )
      .max(3)
      .describe("Solo conflictos reales entre recomendaciones de distintos agentes, ya resueltos"),
    cash: z.object({ text: z.string().min(5).max(800), evidence: refs(10) }),
    areas: z.array(z.object({ area: z.enum(BRIEFING_AREAS), status: z.enum(TRAFFIC_LIGHTS), note: z.string().min(3).max(400), evidence: refs(6) })).max(7),
  }),
});
export type BriefingOutput = z.infer<typeof briefingOutputSchema>;

/** Abogado del diablo: revisa una recomendación de impacto alto antes de publicarla. */
export const challengeOutputSchema = z.object({
  verdict: z.enum(["publicar", "publicar_con_cambios", "descartar"]),
  weak_assumptions: z.array(z.string().min(3).max(300)).max(5),
  risks: z.string().max(800),
  pessimistic_scenario: z.string().max(800),
  evidence: refs(12),
  confidence: z.enum(CONFIDENCES).describe("La confianza que tú le darías"),
});
export type ChallengeOutput = z.infer<typeof challengeOutputSchema>;

/** Revisión a 30/60/90 días: ¿se cumplió lo que se estimó? */
export const reviewOutputSchema = z.object({
  outcome: z.enum(REVIEW_OUTCOMES).describe("hit: se cumplió · partial: en parte · miss: no · no_data: no se puede saber"),
  actual_ref: z.string().max(200).nullable().describe("Id de la métrica en € con el impacto real, si se puede medir"),
  notes: z.string().min(3).max(1000),
  evidence: refs(10),
});
export type ReviewOutput = z.infer<typeof reviewOutputSchema>;

export const OUTPUT_SCHEMAS = {
  scan: scanOutputSchema,
  monthly_close: monthlyCloseOutputSchema,
  weekly_briefing: briefingOutputSchema,
  challenge: challengeOutputSchema,
  review: reviewOutputSchema,
} as const;
