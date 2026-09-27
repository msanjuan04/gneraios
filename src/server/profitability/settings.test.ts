import { describe, expect, it } from "vitest";
import { readOrgSettings } from "@/app/[org]/settings/schema";
import { profitabilitySettings } from "./settings";

describe("umbrales de la rentabilidad (orgs.settings.profitability)", () => {
  it("sin nada guardado, los valores por defecto del lector de ajustes", () => {
    expect(profitabilitySettings({})).toEqual({ defaultHourlyCostCents: 3000, minMarginBps: 3000, minHourlyRateCents: 4500 });
    expect(profitabilitySettings(null)).toEqual(profitabilitySettings({}));
  });

  it("lo guardado manda; lo que falta o no es válido toma su valor por defecto, clave a clave", () => {
    expect(
      profitabilitySettings({ profitability: { default_hourly_cost_cents: 3800, min_margin_bps: 2500, min_hourly_rate_cents: 5000 } }),
    ).toEqual({ defaultHourlyCostCents: 3800, minMarginBps: 2500, minHourlyRateCents: 5000 });
    expect(profitabilitySettings({ profitability: { default_hourly_cost_cents: 0 } })).toEqual({
      defaultHourlyCostCents: 0,
      minMarginBps: 3000,
      minHourlyRateCents: 4500,
    });
    expect(
      profitabilitySettings({ profitability: { default_hourly_cost_cents: -5, min_margin_bps: 12_000, min_hourly_rate_cents: "45" } }),
    ).toEqual({ defaultHourlyCostCents: 3000, minMarginBps: 3000, minHourlyRateCents: 4500 });
    expect(profitabilitySettings({ profitability: "30 €" })).toEqual(profitabilitySettings({}));
  });

  it("no toca el resto de ajustes de la org", () => {
    const settings = readOrgSettings({ payment_terms_days: 15, profitability: { min_margin_bps: 4000 } });
    expect(settings.payment_terms_days).toBe(15);
    expect(settings.target_hourly_rate_cents).toBe(6000);
    expect(settings.profitability.min_margin_bps).toBe(4000);
  });
});
