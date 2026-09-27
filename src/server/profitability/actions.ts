"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import {
  hourlyToCents,
  type MemberCostFormInput,
  memberCostFormSchema,
  percentToBps,
  type ProfitabilitySettingsFormInput,
  profitabilitySettingsFormSchema,
} from "@/app/[org]/finance/profitability/schema";
import type { ActionResult } from "@/lib/action-result";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { dbFailure, forbidden, idSchema, invalidInput, ownerContext } from "@/server/action-utils";

/**
 * Acciones de la rentabilidad: el coste por hora de cada miembro (con su fecha) y los umbrales de
 * la org. Solo un owner (la RLS de member_costs y la de orgs lo vuelven a comprobar).
 */

// FK compuesta (un miembro de otra org) o checks de la tabla: el formulario ya los evita.
const knownCostError = (error: PostgrestError) =>
  error.code === "23503" ? "profitability.errors.memberNotFound" : error.code === "23514" ? "profitability.errors.invalidCost" : undefined;

/** Vuelve a pintar lo que enseña costes: Ajustes → Equipo, Finanzas → Rentabilidad y «Por hacer». */
function revalidateProfitability(slug: string) {
  revalidatePath(`/${slug}/settings/team`);
  revalidatePath(`/${slug}/finance/profitability`);
  revalidatePath(`/${slug}`);
}

function isJsonObject(value: Json): value is { [key: string]: Json | undefined } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Guarda el coste por hora de un miembro desde un día. Si ya había uno ese mismo día, lo corrige
 * (uno por persona y día); si no, se añade al historial y lo anterior no cambia.
 */
export async function saveMemberCost(slug: string, input: MemberCostFormInput): Promise<ActionResult> {
  const ctx = await ownerContext(slug);
  if (!ctx) return forbidden();
  const parsed = memberCostFormSchema.safeParse(input);
  if (!parsed.success) return invalidInput();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("member_costs")
    .upsert(
      {
        org_id: ctx.org.id,
        member_id: parsed.data.member_id,
        valid_from: parsed.data.valid_from,
        hourly_cost_cents: hourlyToCents(parsed.data.hourly_cost),
      },
      { onConflict: "org_id,member_id,valid_from" },
    )
    .select("id");
  if (error) return dbFailure(error, "saveMemberCost", knownCostError);
  if (data.length === 0) return forbidden();

  revalidateProfitability(ctx.org.slug);
  return { ok: true };
}

/** Borra una fila del historial (una corrección: lo que le tocaba pasa a valorarse con la anterior). */
export async function deleteMemberCost(slug: string, costId: string): Promise<ActionResult> {
  const ctx = await ownerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(costId);
  if (!id.success) return invalidInput();

  const supabase = await createClient();
  const { data, error } = await supabase.from("member_costs").delete().eq("id", id.data).eq("org_id", ctx.org.id).select("id");
  if (error) return dbFailure(error, "deleteMemberCost");
  if (data.length === 0) return forbidden();

  revalidateProfitability(ctx.org.slug);
  return { ok: true };
}

/** Coste por hora por defecto y umbrales de aviso (orgs.settings.profitability). Conserva el resto de ajustes. */
export async function saveProfitabilitySettings(slug: string, input: ProfitabilitySettingsFormInput): Promise<ActionResult> {
  const ctx = await ownerContext(slug);
  if (!ctx) return forbidden();
  const parsed = profitabilitySettingsFormSchema.safeParse(input);
  if (!parsed.success) return invalidInput();

  const current = isJsonObject(ctx.org.settings) ? ctx.org.settings : {};
  const settings: Json = {
    ...current,
    profitability: {
      default_hourly_cost_cents: hourlyToCents(parsed.data.default_hourly_cost),
      min_margin_bps: percentToBps(parsed.data.min_margin_percent),
      min_hourly_rate_cents: hourlyToCents(parsed.data.min_hourly_rate),
    },
  };

  const supabase = await createClient();
  const { data, error } = await supabase.from("orgs").update({ settings }).eq("id", ctx.org.id).select("id");
  if (error) return dbFailure(error, "saveProfitabilitySettings");
  if (data.length === 0) return forbidden();

  revalidateProfitability(ctx.org.slug);
  return { ok: true };
}
