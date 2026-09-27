"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { dbFailure, forbidden, invalidInput, ownerContext } from "@/server/action-utils";
import { amountToCents, type RenewalSettingsFormInput, renewalSettingsFormSchema } from "./schema";

function isJsonObject(value: Json): value is { [key: string]: Json | undefined } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Avisos de renovación de la org (orgs.settings.finance): cuántos días antes y desde qué importe
 * avisan las mensuales. Solo un owner (la RLS de orgs lo vuelve a comprobar); se conservan las
 * demás claves de `settings`, también las de `finance` que esta pantalla no gestiona.
 */
export async function saveRenewalSettings(slug: string, input: RenewalSettingsFormInput): Promise<ActionResult> {
  const ctx = await ownerContext(slug);
  if (!ctx) return forbidden();
  const parsed = renewalSettingsFormSchema.safeParse(input);
  if (!parsed.success) return invalidInput();

  const current = isJsonObject(ctx.org.settings) ? ctx.org.settings : {};
  const finance = current.finance !== undefined && isJsonObject(current.finance) ? current.finance : {};
  const settings: Json = {
    ...current,
    finance: {
      ...finance,
      renewal_warning_days: parsed.data.renewal_warning_days,
      monthly_renewal_min_cents: amountToCents(parsed.data.monthly_renewal_min),
    },
  };

  const supabase = await createClient();
  const { data, error } = await supabase.from("orgs").update({ settings }).eq("id", ctx.org.id).select("id");
  if (error) return dbFailure(error, "saveRenewalSettings");
  if (data.length === 0) return forbidden();

  revalidatePath(`/${ctx.org.slug}/finance/infrastructure`);
  return { ok: true };
}
