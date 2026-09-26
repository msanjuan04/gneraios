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
});

export type GeneralSettingsInput = z.input<typeof generalSettingsSchema>;

export const ORG_SETTINGS_DEFAULTS = {
  payment_terms_days: 30,
  billing_day: 1,
  dunning_days: [7, 15],
  renewal_alert_days: [60, 30, 7],
};

const storedSettingsSchema = z.object({
  payment_terms_days: z.number().int().min(0).max(MAX_DAYS).catch(ORG_SETTINGS_DEFAULTS.payment_terms_days),
  billing_day: z.number().int().min(1).max(31).catch(ORG_SETTINGS_DEFAULTS.billing_day),
  dunning_days: z.array(z.number().int().min(0).max(MAX_DAYS)).catch(ORG_SETTINGS_DEFAULTS.dunning_days),
  renewal_alert_days: z.array(z.number().int().min(0).max(MAX_DAYS)).catch(ORG_SETTINGS_DEFAULTS.renewal_alert_days),
});

/** Reglas guardadas en `orgs.settings`; lo que falte o no sea válido toma el valor por defecto. */
export function readOrgSettings(value: unknown): typeof ORG_SETTINGS_DEFAULTS {
  return storedSettingsSchema.catch(ORG_SETTINGS_DEFAULTS).parse(value);
}
