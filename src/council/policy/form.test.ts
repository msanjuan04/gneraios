import { describe, expect, it } from "vitest";
import { changedFields, formToPolicy, policyToForm } from "./form";
import { EXAMPLE_POLICY } from "./schema";

describe("formulario de la política financiera", () => {
  it("va y vuelve sin perder nada", () => {
    const form = policyToForm(EXAMPLE_POLICY);
    expect(form.corporate_tax_provision).toBe("25");
    expect(form.raise_min_mrr).toBe("10000");
    expect(form.target_hourly_rate).toBe("60");
    expect(formToPolicy(form)).toEqual({ ok: true, policy: EXAMPLE_POLICY });
  });

  it("lee porcentajes y euros a la española", () => {
    const form = { ...policyToForm(EXAMPLE_POLICY), corporate_tax_provision: "23,5", raise_min_mrr: "12.500", target_hourly_rate: "62,50 €" };
    const result = formToPolicy(form);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.policy.corporate_tax_provision_bps).toBe(2350);
    expect(result.policy.raise_partner_pay.min_mrr_cents).toBe(1_250_000);
    expect(result.policy.target_hourly_rate_cents).toBe(6250);
  });

  it("marca cada campo mal escrito con su error", () => {
    const form = { ...policyToForm(EXAMPLE_POLICY), cushion_months: "4,5", reinvestment: "120", impact_threshold: "-3" };
    expect(formToPolicy(form)).toEqual({
      ok: false,
      errors: { cushion_months: "council.policy.errors.integer", reinvestment: "council.policy.errors.percent", impact_threshold: "council.policy.errors.money" },
    });
  });

  it("exige que el reparto sume 100 % y que el umbral alto no quede por debajo del normal", () => {
    const form = { ...policyToForm(EXAMPLE_POLICY), reinvestment: "40", impact_threshold: "5000", high_impact_threshold: "1000" };
    expect(formToPolicy(form)).toEqual({
      ok: false,
      errors: { partners: "council.policy.errors.distributionSum", high_impact_threshold: "council.policy.errors.highImpactBelow" },
    });
  });

  it("los límites del esquema salen como fuera de rango", () => {
    const form = { ...policyToForm(EXAMPLE_POLICY), cushion_months: "30", hire_weeks: "0" };
    expect(formToPolicy(form)).toEqual({
      ok: false,
      errors: { cushion_months: "council.policy.errors.range", hire_weeks: "council.policy.errors.range" },
    });
  });

  it("dice qué ha cambiado", () => {
    const base = policyToForm(EXAMPLE_POLICY);
    expect(changedFields(base, { ...base, cushion_months: "6", raise_require_cushion: false })).toEqual(["cushion_months", "raise_require_cushion"]);
  });
});
