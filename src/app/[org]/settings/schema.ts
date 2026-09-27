import { z } from "zod";
import { requiredText } from "@/lib/validation/fiscal";

const MAX_DAYS = 365;
const MAX_LIST = 10;

/** "7, 15" → [7, 15] sin repetidos. null si algo no es un número de días válido. */
export function parseDaysList(value: string): number[] | null {
  const parts = value.split(/[\s,;]+/).filter(Boolean);
  if (parts.length > MAX_LIST) return null;
  const days: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > MAX_DAYS) return null;
    if (!days.includes(n)) days.push(n);
  }
  return days;
}

const days = z.number("days").int("days").min(0, "days").max(MAX_DAYS, "days");
const daysList = z.string().refine((value) => parseDaysList(value) !== null, "daysList");

/** Nombre de la org y reglas de negocio de `orgs.settings`, como se escriben en el formulario. */
export const generalSettingsSchema = z.object({
  name: requiredText(120),
  payment_terms_days: days,
  billing_day: z.number("billingDay").int("billingDay").min(1, "billingDay").max(31, "billingDay"),
  dunning_days: daysList,
  renewal_alert_days: daysList,
  quote_validity_days: z.number("days").int("days").min(1, "days").max(MAX_DAYS, "days"),
  /** Aviso de concentración: % de la facturación de 12 meses en un solo cliente. */
  concentration_alert_percent: z.number("percent").int("percent").min(1, "percent").max(100, "percent"),
  /** Objetivo de €/hora con el que los proyectos comparan lo facturado entre las horas dedicadas. */
  target_hourly_rate_euros: z.number("hourlyRate").int("hourlyRate").min(1, "hourlyRate").max(1000, "hourlyRate"),
});

export type GeneralSettingsInput = z.input<typeof generalSettingsSchema>;

export const ORG_SETTINGS_DEFAULTS = {
  payment_terms_days: 30,
  billing_day: 1,
  dunning_days: [7, 15],
  renewal_alert_days: [60, 30, 7],
  quote_validity_days: 30,
  concentration_alert_bps: 2500,
  target_hourly_rate_cents: 6000,
  /** Finanzas → Rentabilidad: coste por hora de quien no tiene uno propio y umbrales de aviso. */
  profitability: {
    default_hourly_cost_cents: 3000,
    min_margin_bps: 3000,
    min_hourly_rate_cents: 4500,
  },
  /** Webs: cuándo avisar del certificado SSL y del dominio, cuándo va lenta y cuántos fallos seguidos son una caída. */
  sites: {
    ssl_warn_days: 14,
    domain_warn_days: 30,
    slow_ms: 3000,
    down_after_failures: 2,
  },
  /**
   * Finanzas: cuántos días antes avisar de la renovación de una suscripción (y resaltarla en
   * Infraestructura) y desde qué importe por cargo avisan las mensuales (las anuales, siempre).
   */
  finance: {
    renewal_warning_days: 14,
    monthly_renewal_min_cents: 5000,
  },
};

const PROFITABILITY_DEFAULTS = ORG_SETTINGS_DEFAULTS.profitability;
const storedProfitabilitySchema = z.object({
  default_hourly_cost_cents: z.number().int().min(0).max(100_000).catch(PROFITABILITY_DEFAULTS.default_hourly_cost_cents),
  min_margin_bps: z.number().int().min(0).max(10_000).catch(PROFITABILITY_DEFAULTS.min_margin_bps),
  min_hourly_rate_cents: z.number().int().min(0).max(100_000).catch(PROFITABILITY_DEFAULTS.min_hourly_rate_cents),
});

const SITES_DEFAULTS = ORG_SETTINGS_DEFAULTS.sites;
/** Límites de los umbrales de Webs (los mismos que el formulario, src/app/[org]/sites/schema.ts). */
export const SITE_THRESHOLD_LIMITS = {
  ssl_warn_days: { min: 1, max: 90 },
  domain_warn_days: { min: 1, max: 365 },
  slow_ms: { min: 500, max: 30_000 },
  down_after_failures: { min: 1, max: 10 },
} as const;
const siteLimit = (key: keyof typeof SITE_THRESHOLD_LIMITS) =>
  z.number().int().min(SITE_THRESHOLD_LIMITS[key].min).max(SITE_THRESHOLD_LIMITS[key].max).catch(SITES_DEFAULTS[key]);
const storedSitesSchema = z.object({
  ssl_warn_days: siteLimit("ssl_warn_days"),
  domain_warn_days: siteLimit("domain_warn_days"),
  slow_ms: siteLimit("slow_ms"),
  down_after_failures: siteLimit("down_after_failures"),
});

const FINANCE_DEFAULTS = ORG_SETTINGS_DEFAULTS.finance;
/** Límites de los avisos de renovación (los mismos que el formulario, src/app/[org]/finance/infrastructure/schema.ts). */
export const FINANCE_SETTINGS_LIMITS = {
  renewal_warning_days: { min: 1, max: 180 },
  monthly_renewal_min_cents: { min: 0, max: 10_000_000 },
} as const;
const financeLimit = (key: keyof typeof FINANCE_SETTINGS_LIMITS) =>
  z.number().int().min(FINANCE_SETTINGS_LIMITS[key].min).max(FINANCE_SETTINGS_LIMITS[key].max).catch(FINANCE_DEFAULTS[key]);
const storedFinanceSchema = z.object({
  renewal_warning_days: financeLimit("renewal_warning_days"),
  monthly_renewal_min_cents: financeLimit("monthly_renewal_min_cents"),
});

const storedSettingsSchema = z.object({
  payment_terms_days: z.number().int().min(0).max(MAX_DAYS).catch(ORG_SETTINGS_DEFAULTS.payment_terms_days),
  billing_day: z.number().int().min(1).max(31).catch(ORG_SETTINGS_DEFAULTS.billing_day),
  dunning_days: z.array(z.number().int().min(0).max(MAX_DAYS)).catch(ORG_SETTINGS_DEFAULTS.dunning_days),
  renewal_alert_days: z.array(z.number().int().min(0).max(MAX_DAYS)).catch(ORG_SETTINGS_DEFAULTS.renewal_alert_days),
  quote_validity_days: z.number().int().min(1).max(MAX_DAYS).catch(ORG_SETTINGS_DEFAULTS.quote_validity_days),
  concentration_alert_bps: z.number().int().min(100).max(10_000).catch(ORG_SETTINGS_DEFAULTS.concentration_alert_bps),
  target_hourly_rate_cents: z.number().int().min(100).max(100_000).catch(ORG_SETTINGS_DEFAULTS.target_hourly_rate_cents),
  profitability: storedProfitabilitySchema.catch(PROFITABILITY_DEFAULTS),
  sites: storedSitesSchema.catch(SITES_DEFAULTS),
  finance: storedFinanceSchema.catch(FINANCE_DEFAULTS),
});

/** Reglas guardadas en `orgs.settings`; lo que falte o no sea válido toma el valor por defecto. */
export function readOrgSettings(value: unknown): typeof ORG_SETTINGS_DEFAULTS {
  return storedSettingsSchema.catch(ORG_SETTINGS_DEFAULTS).parse(value);
}
