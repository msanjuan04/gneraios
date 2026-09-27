// La política financiera tal y como se escribe en Ajustes → Consejo (a la española: "25" es un
// 25 %, "10.000" o "10000" son 10.000 €) y de vuelta. La validación de verdad es la del esquema
// (financialPolicySchema), que se repite en el servidor; aquí solo se leen los campos.

import { bpsToInput, centsToInput, parsePercentInput } from "@/domain/catalog";
import { parseMoneyInput } from "@/domain/money";
import { type FinancialPolicy, financialPolicySchema } from "./schema";

export type PolicyFormValues = {
  cushion_months: string;
  corporate_tax_provision: string;
  reinvestment: string;
  partners: string;
  raise_consecutive_months: string;
  raise_min_mrr: string;
  raise_require_cushion: boolean;
  raise_min_margin: string;
  hire_min_capacity: string;
  hire_weeks: string;
  hire_min_pipeline: string;
  min_project_margin: string;
  target_hourly_rate: string;
  impact_threshold: string;
  high_impact_threshold: string;
};

export type PolicyField = Exclude<keyof PolicyFormValues, "raise_require_cushion">;
export type PolicyFormErrors = Partial<Record<PolicyField, string>>;

/** Qué es cada campo: la interfaz pone la unidad y el lector correcto. */
export const POLICY_FIELD_KIND: Record<PolicyField, "integer" | "percent" | "money"> = {
  cushion_months: "integer",
  corporate_tax_provision: "percent",
  reinvestment: "percent",
  partners: "percent",
  raise_consecutive_months: "integer",
  raise_min_mrr: "money",
  raise_min_margin: "percent",
  hire_min_capacity: "percent",
  hire_weeks: "integer",
  hire_min_pipeline: "money",
  min_project_margin: "percent",
  target_hourly_rate: "money",
  impact_threshold: "money",
  high_impact_threshold: "money",
};

export function policyToForm(p: FinancialPolicy): PolicyFormValues {
  return {
    cushion_months: String(p.cushion_months),
    corporate_tax_provision: bpsToInput(p.corporate_tax_provision_bps),
    reinvestment: bpsToInput(p.distribution.reinvestment_bps),
    partners: bpsToInput(p.distribution.partners_bps),
    raise_consecutive_months: String(p.raise_partner_pay.consecutive_months),
    raise_min_mrr: centsToInput(p.raise_partner_pay.min_mrr_cents),
    raise_require_cushion: p.raise_partner_pay.require_cushion,
    raise_min_margin: bpsToInput(p.raise_partner_pay.min_margin_bps),
    hire_min_capacity: bpsToInput(p.hire.min_capacity_bps),
    hire_weeks: String(p.hire.weeks),
    hire_min_pipeline: centsToInput(p.hire.min_weighted_pipeline_mrr_cents),
    min_project_margin: bpsToInput(p.min_project_margin_bps),
    target_hourly_rate: centsToInput(p.target_hourly_rate_cents),
    impact_threshold: centsToInput(p.impact_threshold_cents),
    high_impact_threshold: centsToInput(p.high_impact_threshold_cents),
  };
}

const INTEGER = /^\d{1,4}$/;

function read(kind: "integer" | "percent" | "money", raw: string): number | null {
  const value = raw.trim();
  if (value === "") return null;
  if (kind === "integer") return INTEGER.test(value) ? Number(value) : null;
  if (kind === "percent") return parsePercentInput(value);
  const cents = parseMoneyInput(value);
  return cents !== null && cents >= 0 ? cents : null;
}

/** Del esquema a los campos del formulario (para colocar cada error en su sitio). */
const PATH_TO_FIELD: Record<string, PolicyField> = {
  cushion_months: "cushion_months",
  corporate_tax_provision_bps: "corporate_tax_provision",
  "distribution.reinvestment_bps": "reinvestment",
  "distribution.partners_bps": "partners",
  "raise_partner_pay.consecutive_months": "raise_consecutive_months",
  "raise_partner_pay.min_mrr_cents": "raise_min_mrr",
  "raise_partner_pay.min_margin_bps": "raise_min_margin",
  "hire.min_capacity_bps": "hire_min_capacity",
  "hire.weeks": "hire_weeks",
  "hire.min_weighted_pipeline_mrr_cents": "hire_min_pipeline",
  min_project_margin_bps: "min_project_margin",
  target_hourly_rate_cents: "target_hourly_rate",
  impact_threshold_cents: "impact_threshold",
  high_impact_threshold_cents: "high_impact_threshold",
};

/** Lee el formulario. Los errores son claves de i18n (`council.policy.errors.*`). */
export function formToPolicy(values: PolicyFormValues): { ok: true; policy: FinancialPolicy } | { ok: false; errors: PolicyFormErrors } {
  const errors: PolicyFormErrors = {};
  const n = {} as Record<PolicyField, number>;
  for (const [field, kind] of Object.entries(POLICY_FIELD_KIND) as [PolicyField, "integer" | "percent" | "money"][]) {
    const value = read(kind, values[field]);
    if (value === null) errors[field] = `council.policy.errors.${kind}`;
    else n[field] = value;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const candidate: FinancialPolicy = {
    cushion_months: n.cushion_months,
    corporate_tax_provision_bps: n.corporate_tax_provision,
    distribution: { reinvestment_bps: n.reinvestment, partners_bps: n.partners },
    raise_partner_pay: {
      consecutive_months: n.raise_consecutive_months,
      min_mrr_cents: n.raise_min_mrr,
      require_cushion: values.raise_require_cushion,
      min_margin_bps: n.raise_min_margin,
    },
    hire: { min_capacity_bps: n.hire_min_capacity, weeks: n.hire_weeks, min_weighted_pipeline_mrr_cents: n.hire_min_pipeline },
    min_project_margin_bps: n.min_project_margin,
    target_hourly_rate_cents: n.target_hourly_rate,
    impact_threshold_cents: n.impact_threshold,
    high_impact_threshold_cents: n.high_impact_threshold,
  };
  const parsed = financialPolicySchema.safeParse(candidate);
  if (parsed.success) return { ok: true, policy: parsed.data };
  for (const issue of parsed.error.issues) {
    const field = PATH_TO_FIELD[issue.path.join(".")];
    if (!field || errors[field]) continue;
    errors[field] = issue.message.startsWith("council.") ? issue.message : "council.policy.errors.range";
  }
  return { ok: false, errors };
}

/** Los campos que cambian respecto a otra política (para enseñar qué se va a guardar). */
export function changedFields(a: PolicyFormValues, b: PolicyFormValues): (keyof PolicyFormValues)[] {
  return (Object.keys(a) as (keyof PolicyFormValues)[]).filter((key) => a[key] !== b[key]);
}
