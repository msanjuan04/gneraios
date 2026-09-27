// Sin "server-only": es una traducción pura de orgs.settings y se prueba con Vitest.
import { readOrgSettings } from "@/app/[org]/settings/schema";
import type { ProfitabilitySettings } from "@/domain/profitability";

/**
 * Umbrales de la rentabilidad de una org (orgs.settings.profitability), con los valores por defecto
 * del mismo lector que el resto de ajustes (readOrgSettings): nada de esto vive en el código.
 */
export function profitabilitySettings(settings: unknown): ProfitabilitySettings {
  const { profitability } = readOrgSettings(settings);
  return {
    defaultHourlyCostCents: profitability.default_hourly_cost_cents,
    minMarginBps: profitability.min_margin_bps,
    minHourlyRateCents: profitability.min_hourly_rate_cents,
  };
}
