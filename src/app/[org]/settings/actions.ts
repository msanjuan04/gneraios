"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/action-result";
import { dbFailure, forbidden, invalidInput, ownerContext, revalidateSettings } from "@/server/action-utils";
import { type GeneralSettingsInput, generalSettingsSchema, parseDaysList } from "./schema";

function isJsonObject(value: Json): value is { [key: string]: Json | undefined } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Guarda el nombre de la org y sus reglas de negocio (`orgs.settings`). */
export async function saveGeneralSettings(slug: string, input: GeneralSettingsInput): Promise<ActionResult> {
  const ctx = await ownerContext(slug);
  if (!ctx) return forbidden();
  const parsed = generalSettingsSchema.safeParse(input);
  if (!parsed.success) return invalidInput();

  const { name, payment_terms_days, billing_day, quote_validity_days } = parsed.data;
  const concentration_alert_bps = parsed.data.concentration_alert_percent * 100;
  const target_hourly_rate_cents = parsed.data.target_hourly_rate_euros * 100;
  // Recordatorios de menos a más días de retraso; avisos de renovación de más a menos antelación.
  const dunning_days = (parseDaysList(parsed.data.dunning_days) ?? []).sort((a, b) => a - b);
  const renewal_alert_days = (parseDaysList(parsed.data.renewal_alert_days) ?? []).sort((a, b) => b - a);

  // Se conservan las claves de `settings` que esta pantalla no gestiona.
  const current = isJsonObject(ctx.org.settings) ? ctx.org.settings : {};
  const settings: Json = {
    ...current,
    payment_terms_days,
    billing_day,
    dunning_days,
    renewal_alert_days,
    quote_validity_days,
    concentration_alert_bps,
    target_hourly_rate_cents,
  };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orgs")
    .update({ name, settings })
    .eq("id", ctx.org.id)
    .select("id");
  if (error) return dbFailure(error, "saveGeneralSettings");
  if (data.length === 0) return forbidden();

  revalidateSettings(ctx.org.slug);
  return { ok: true };
}

const euros = z.string().trim().regex(/^\d{0,9}$/);
const goalsSchema = z.object({
  mrr_euros: euros,
  mrr_by: z.string().trim().regex(/^(\d{4}-\d{2}-\d{2})?$/),
  revenue_euros: euros,
  revenue_year: z.number().int().min(2000).max(2100),
});

export type GoalsInput = z.input<typeof goalsSchema>;

/**
 * Objetivos de los socios (`orgs.settings.goals`): un MRR a una fecha y la facturación del año.
 * Vacío = sin objetivo. El progreso lo calcula el dashboard (src/domain/metrics/goals.ts).
 */
export async function saveGoals(slug: string, input: GoalsInput): Promise<ActionResult> {
  const ctx = await ownerContext(slug);
  if (!ctx) return forbidden();
  const parsed = goalsSchema.safeParse(input);
  if (!parsed.success) return invalidInput();
  const { mrr_euros, mrr_by, revenue_euros, revenue_year } = parsed.data;
  const mrrCents = mrr_euros === "" ? 0 : Number(mrr_euros) * 100;
  const revenueCents = revenue_euros === "" ? 0 : Number(revenue_euros) * 100;
  // Un objetivo de MRR sin fecha vale para el final del año.
  const by = mrr_by === "" ? `${revenue_year}-12-31` : mrr_by;

  const current = isJsonObject(ctx.org.settings) ? ctx.org.settings : {};
  const goals: Json = {
    mrr_target_cents: mrrCents > 0 ? mrrCents : null,
    mrr_target_by: mrrCents > 0 ? by : null,
    revenue_year_target_cents: revenueCents > 0 ? revenueCents : null,
    revenue_year: revenue_year,
  };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orgs")
    .update({ settings: { ...current, goals } })
    .eq("id", ctx.org.id)
    .select("id");
  if (error) return dbFailure(error, "saveGoals");
  if (data.length === 0) return forbidden();
  revalidateSettings(ctx.org.slug);
  revalidatePath(`/${ctx.org.slug}`);
  return { ok: true };
}
