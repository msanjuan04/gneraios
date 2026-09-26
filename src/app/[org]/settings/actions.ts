"use server";

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

  const { name, payment_terms_days, billing_day } = parsed.data;
  // Recordatorios de menos a más días de retraso; avisos de renovación de más a menos antelación.
  const dunning_days = (parseDaysList(parsed.data.dunning_days) ?? []).sort((a, b) => a - b);
  const renewal_alert_days = (parseDaysList(parsed.data.renewal_alert_days) ?? []).sort((a, b) => b - a);

  // Se conservan las claves de `settings` que esta pantalla no gestiona.
  const current = isJsonObject(ctx.org.settings) ? ctx.org.settings : {};
  const settings: Json = { ...current, payment_terms_days, billing_day, dunning_days, renewal_alert_days };

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
