// Sin "server-only": es una traducción pura de orgs.settings y se prueba con Vitest. La usan el
// cron (renewals.ts) y Finanzas → Infraestructura.
import { readOrgSettings } from "@/app/[org]/settings/schema";
import type { RenewalSettings } from "@/domain/finance/renewals";

/**
 * Los avisos de renovación de una org (orgs.settings.finance), con los valores por defecto del
 * mismo lector que el resto de ajustes (readOrgSettings): nada de esto vive en el código.
 */
export function renewalSettings(settings: unknown): RenewalSettings {
  const { finance } = readOrgSettings(settings);
  return { warningDays: finance.renewal_warning_days, monthlyMinCents: finance.monthly_renewal_min_cents };
}
