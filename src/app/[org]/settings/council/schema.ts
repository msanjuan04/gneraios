// Entradas de Ajustes → Consejo. El servidor las vuelve a validar; la base de datos, con su RLS
// (solo un owner) y sus checks, otra vez.

import { z } from "zod";
import { COUNCIL_MODELS, THRESHOLD_LIMITS, type Thresholds, thresholdKeys } from "@/council/agents.config";
import { financialPolicySchema } from "@/council/policy/schema";
import { AGENT_NAMES } from "@/council/types";

const note = z
  .string()
  .trim()
  .max(300)
  .refine((v) => !/[\n\r]/.test(v));

export const savePolicySchema = z.object({ policy: financialPolicySchema, note: note.optional() });
export type SavePolicyInput = z.infer<typeof savePolicySchema>;

export const agentSettingsSchema = z
  .object({
    agent: z.enum(AGENT_NAMES),
    enabled: z.boolean(),
    /** null: el modelo por defecto del agente. */
    model: z.enum(COUNCIL_MODELS).nullable(),
    /** Céntimos de dólar; null: el presupuesto por defecto. */
    monthly_budget_usd_cents: z.number().int().min(0).max(10_000_000).nullable(),
    thresholds: z.record(z.string(), z.number().int()),
  })
  .superRefine((value, ctx) => {
    const allowed = thresholdKeys(value.agent) as string[];
    for (const [key, n] of Object.entries(value.thresholds)) {
      const limits = THRESHOLD_LIMITS[key as keyof Thresholds];
      if (!allowed.includes(key) || !limits) ctx.addIssue({ code: "custom", path: ["thresholds", key], message: "council.settings.errors.unknownThreshold" });
      else if (n < limits.min || n > limits.max) ctx.addIssue({ code: "custom", path: ["thresholds", key], message: "council.settings.errors.thresholdRange" });
    }
  });
export type AgentSettingsInput = z.infer<typeof agentSettingsSchema>;

const words = z
  .array(z.string().trim().min(2).max(60))
  .max(20)
  .transform((list) => [...new Set(list.map((w) => w.toLowerCase()))]);

export const upsellRuleSchema = z.object({
  label: z.string().trim().min(1).max(120),
  requires_any: words,
  excludes_any: words,
  max_services: z.number().int().min(1).max(20).nullable(),
  min_months: z.number().int().min(0).max(120).nullable(),
  suggestion: z.string().trim().min(1).max(300),
  reference_mrr_cents: z.number().int().min(0).max(1_000_000_000).nullable(),
});
export type UpsellRuleInput = z.input<typeof upsellRuleSchema>;

/** "mantenimiento, seo local" → ["mantenimiento", "seo local"]. */
export function splitWords(value: string): string[] {
  return value
    .split(/[,;\n]/)
    .map((w) => w.trim())
    .filter(Boolean);
}
