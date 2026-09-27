"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { dbFailure, failure, forbidden, idSchema, invalidInput, ownerContext } from "@/server/action-utils";
import { type AgentSettingsInput, agentSettingsSchema, type SavePolicyInput, savePolicySchema, type UpsellRuleInput, upsellRuleSchema } from "./schema";

/** Los ajustes se ven en la pestaña y en todo el consejo (política, agentes, presupuestos). */
function revalidateCouncilSettings(slug: string) {
  revalidatePath(`/${slug}/settings/council`);
  revalidatePath(`/${slug}/council`, "layout");
}

const firstMessage = (issues: { message: string }[]) => {
  const message = issues[0]?.message;
  return message?.startsWith("council.") ? failure(message) : invalidInput();
};

/** Guarda la política financiera como una versión nueva (las anteriores no se tocan). */
export async function saveFinancialPolicy(slug: string, input: SavePolicyInput): Promise<ActionResult<{ version: number }>> {
  const ctx = await ownerContext(slug);
  if (!ctx) return forbidden();
  const parsed = savePolicySchema.safeParse(input);
  if (!parsed.success) return firstMessage(parsed.error.issues);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_financial_policy", {
    p_org: ctx.org.id,
    p_data: parsed.data.policy as unknown as Json,
    p_note: parsed.data.note || undefined,
  });
  if (error) return dbFailure(error, "council.savePolicy");
  revalidateCouncilSettings(ctx.org.slug);
  return { ok: true, version: data };
}

/** Encender o apagar un agente, su modelo, su presupuesto y sus umbrales. */
export async function saveAgentSettings(slug: string, input: AgentSettingsInput): Promise<ActionResult> {
  const ctx = await ownerContext(slug);
  if (!ctx) return forbidden();
  const parsed = agentSettingsSchema.safeParse(input);
  if (!parsed.success) return firstMessage(parsed.error.issues);
  const { agent, enabled, model, monthly_budget_usd_cents, thresholds } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase
    .from("agent_settings")
    .upsert({ org_id: ctx.org.id, agent, enabled, model, monthly_budget_usd_cents, thresholds }, { onConflict: "org_id,agent" });
  if (error) return dbFailure(error, "council.saveAgent");
  revalidateCouncilSettings(ctx.org.slug);
  return { ok: true };
}

/** Crea (al final de la lista) o edita una regla de venta cruzada. */
export async function saveUpsellRule(slug: string, ruleId: string | null, input: UpsellRuleInput): Promise<ActionResult> {
  const ctx = await ownerContext(slug);
  if (!ctx) return forbidden();
  const parsed = upsellRuleSchema.safeParse(input);
  const id = ruleId === null ? null : idSchema.safeParse(ruleId);
  if (!parsed.success || (id && !id.success)) return invalidInput();
  if (parsed.data.requires_any.length === 0) return failure("council.settings.rules.errors.requiresAny");
  const supabase = await createClient();
  if (id) {
    const { data, error } = await supabase.from("upsell_rules").update(parsed.data).eq("org_id", ctx.org.id).eq("id", id.data).select("id");
    if (error) return dbFailure(error, "council.saveRule.update");
    if (data.length === 0) return forbidden();
  } else {
    const { data: last, error: lastError } = await supabase.from("upsell_rules").select("position").eq("org_id", ctx.org.id).order("position", { ascending: false }).limit(1);
    if (lastError) return dbFailure(lastError, "council.saveRule.position");
    const { error } = await supabase.from("upsell_rules").insert({ ...parsed.data, org_id: ctx.org.id, position: Math.min(32_000, (last[0]?.position ?? -1) + 1) });
    if (error) return dbFailure(error, "council.saveRule.insert");
  }
  revalidateCouncilSettings(ctx.org.slug);
  return { ok: true };
}

/** Archivar (el agente deja de usarla) o recuperar una regla. No se borra: las recomendaciones la citan. */
export async function setUpsellRuleArchived(slug: string, ruleId: string, archived: boolean): Promise<ActionResult> {
  const ctx = await ownerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(ruleId);
  if (!id.success || typeof archived !== "boolean") return invalidInput();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("upsell_rules")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("org_id", ctx.org.id)
    .eq("id", id.data)
    .select("id");
  if (error) return dbFailure(error, "council.archiveRule");
  if (data.length === 0) return forbidden();
  revalidateCouncilSettings(ctx.org.slug);
  return { ok: true };
}
