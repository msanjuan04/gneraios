// Política financiera de la org (CONSEJO.md §4). La fijan los socios en Ajustes → Consejo; cada
// guardado es una versión nueva e inmutable (financial_policies) y cada recomendación guarda la
// versión con la que se hizo. Sin ninguna versión se usan los valores de ejemplo, marcados como
// tales en la interfaz y en el contexto de los agentes.
//
// Dinero en céntimos y porcentajes en puntos básicos (2500 = 25 %), como en todo GNERAI OS.

import { z } from "zod";

const bps = z.number().int().min(0).max(10_000);
const cents = z.number().int().min(0).max(1_000_000_000);

export const financialPolicySchema = z
  .object({
    /** Colchón objetivo: meses de gastos fijos que tienen que quedar en caja. */
    cushion_months: z.number().int().min(0).max(24),
    /** Provisión del Impuesto de Sociedades sobre el beneficio del mes. */
    corporate_tax_provision_bps: bps,
    /** Reparto de lo que queda tras impuestos y colchón. Suma 100 %. */
    distribution: z.object({ reinvestment_bps: bps, partners_bps: bps }),
    /** Cuándo proponer subir la retribución de los socios. */
    raise_partner_pay: z.object({
      /** Meses seguidos con el MRR por encima del mínimo. */
      consecutive_months: z.number().int().min(1).max(24),
      min_mrr_cents: cents,
      /** Exige el colchón cumplido. */
      require_cushion: z.boolean(),
      /** Margen mínimo (beneficio / ingresos) de esos meses. */
      min_margin_bps: bps,
    }),
    /** Cuándo proponer contratar. */
    hire: z.object({
      /** Capacidad comprometida mínima… */
      min_capacity_bps: bps,
      /** …durante tantas semanas seguidas… */
      weeks: z.number().int().min(1).max(52),
      /** …y un pipeline ponderado de al menos este MRR. */
      min_weighted_pipeline_mrr_cents: cents,
    }),
    /** Margen mínimo por proyecto. */
    min_project_margin_bps: bps,
    /** Precio por hora objetivo. */
    target_hourly_rate_cents: cents,
    /** Por debajo de este impacto, el consejo calla (silencio útil). */
    impact_threshold_cents: cents,
    /** Desde este impacto, el abogado del diablo revisa antes de publicar. */
    high_impact_threshold_cents: cents,
  })
  .strict()
  .refine((p) => p.distribution.reinvestment_bps + p.distribution.partners_bps === 10_000, {
    path: ["distribution", "partners_bps"],
    message: "council.policy.errors.distributionSum",
  })
  .refine((p) => p.high_impact_threshold_cents >= p.impact_threshold_cents, {
    path: ["high_impact_threshold_cents"],
    message: "council.policy.errors.highImpactBelow",
  });

export type FinancialPolicy = z.infer<typeof financialPolicySchema>;

/**
 * Valores de EJEMPLO (CONSEJO.md §4). No son una recomendación: están para que el consejo pueda
 * trabajar hasta que los socios fijen los suyos, y así se dice en la interfaz y a los agentes.
 * X, Y y Z del documento (MRR mínimo, margen y pipeline) son también ejemplos.
 */
export const EXAMPLE_POLICY: FinancialPolicy = {
  cushion_months: 4,
  corporate_tax_provision_bps: 2500,
  distribution: { reinvestment_bps: 3000, partners_bps: 7000 },
  raise_partner_pay: { consecutive_months: 3, min_mrr_cents: 1_000_000, require_cushion: true, min_margin_bps: 3000 },
  hire: { min_capacity_bps: 8500, weeks: 6, min_weighted_pipeline_mrr_cents: 300_000 },
  min_project_margin_bps: 4000,
  target_hourly_rate_cents: 6000,
  impact_threshold_cents: 30_000,
  high_impact_threshold_cents: 200_000,
};

/** La política con la que trabaja el consejo: la última versión guardada o la de ejemplo. */
export type ResolvedPolicy = {
  /** null: la de ejemplo (los socios aún no han guardado ninguna). */
  version: number | null;
  isExample: boolean;
  policy: FinancialPolicy;
  /** Cuándo se guardó (instante ISO) y quién; null en la de ejemplo. */
  createdAt: string | null;
  note: string | null;
};

export type PolicyRecord = { version: number; data: unknown; createdAt: string; note: string | null };

/** La política vigente a partir de la última versión guardada (o de ninguna). Lanza si la guardada no es válida. */
export function resolvePolicy(record: PolicyRecord | null): ResolvedPolicy {
  if (!record) return { version: null, isExample: true, policy: EXAMPLE_POLICY, createdAt: null, note: null };
  const parsed = financialPolicySchema.safeParse(record.data);
  if (!parsed.success) {
    throw new Error(`La política financiera v${record.version} no es válida: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
  }
  return { version: record.version, isExample: false, policy: parsed.data, createdAt: record.createdAt, note: record.note };
}
