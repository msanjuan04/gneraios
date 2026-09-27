"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { runPendingJobs } from "@/council/runner";
import { isCouncilConfigured } from "@/council/runtime/provider";
import { councilDeps } from "@/council/service";
import { isAgentName } from "@/council/types";
import type { ActionResult } from "@/lib/action-result";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { dbFailure, failure, forbidden, idSchema, invalidInput, partnerContext } from "@/server/action-utils";
import { closeDecisionSchema, decisionSchema, type CloseDecisionInput, type DecisionInput } from "./schema";

const HINTS: Record<string, string> = {
  discard_reason_required: "council.errors.discardReason",
  postpone_date_required: "council.errors.postponeDate",
  recommendation_transition: "council.errors.transition",
  close_sum_mismatch: "council.errors.closeSum",
  close_invalid: "council.errors.closeInvalid",
  close_already_accepted: "council.errors.closeAccepted",
  close_not_available: "council.errors.closeNotAvailable",
  agent_not_runnable: "council.errors.notRunnable",
  report_immutable: "council.errors.closeAccepted",
};

const known = (error: PostgrestError) => (error.hint && HINTS[error.hint]) || (error.code === "23505" ? "council.errors.duplicate" : undefined);

function revalidateCouncil(slug: string) {
  revalidatePath(`/${slug}/council`, "layout");
}

/**
 * "Ejecutar ahora": encola el trabajo del agente (o reutiliza el que ya está en cola) y lo ejecuta
 * después de responder, fuera de la petición. Sin clave de la API no encola nada.
 */
export async function runAgentNow(slug: string, agent: string): Promise<ActionResult<{ jobId: string }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  if (!isAgentName(agent) || agent === "devils_advocate") return invalidInput();
  if (!isCouncilConfigured()) return failure("council.errors.noApiKey");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("council_enqueue_run", { p_org: ctx.org.id, p_agent: agent });
  if (error) return dbFailure(error, "council.runNow", known);
  const jobId = data;
  after(async () => {
    try {
      await runPendingJobs(councilDeps(createAdminClient()), { jobIds: [jobId], limit: 1, deadlineMs: 280_000 });
    } catch (runError) {
      console.error("[council] run now", ctx.org.id, agent, runError);
    }
  });
  revalidateCouncil(ctx.org.slug);
  return { ok: true, jobId };
}

/** Decidir una recomendación: aceptar (crea las tareas), descartar con motivo, posponer, hecha o reabrir. */
export async function decideRecommendation(slug: string, recommendationId: string, input: DecisionInput): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(recommendationId);
  const parsed = decisionSchema.safeParse(input);
  if (!id.success) return invalidInput();
  if (!parsed.success) return failure(parsed.error.issues[0]?.message.startsWith("council.") ? parsed.error.issues[0].message : "common.errorGeneric");
  const decision = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recommendations")
    .update({
      status: decision.status,
      decision_note: decision.status === "descartada" ? decision.note : null,
      postponed_until: decision.status === "pospuesta" ? decision.postponedUntil : null,
    })
    .eq("org_id", ctx.org.id)
    .eq("id", id.data)
    .select("id");
  if (error) return dbFailure(error, "council.decide", known);
  if (data.length === 0) return forbidden();
  revalidateCouncil(ctx.org.slug);
  return { ok: true };
}

/** Marcar una tarea del consejo como hecha (o deshacerlo). */
export async function setTaskDone(slug: string, taskId: string, done: boolean): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(taskId);
  if (!id.success || typeof done !== "boolean") return invalidInput();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("council_tasks")
    .update({ done_at: done ? new Date().toISOString() : null })
    .eq("org_id", ctx.org.id)
    .eq("id", id.data)
    .select("id");
  if (error) return dbFailure(error, "council.task", known);
  if (data.length === 0) return forbidden();
  revalidateCouncil(ctx.org.slug);
  return { ok: true };
}

/** Aceptar el cierre mensual con el reparto elegido: queda registrado con la versión de la política. */
export async function acceptMonthlyClose(slug: string, reportId: string, input: CloseDecisionInput): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(reportId);
  const parsed = closeDecisionSchema.safeParse(input);
  if (!id.success || !parsed.success) return invalidInput();
  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_monthly_close", {
    p_report_id: id.data,
    p_buckets: parsed.data.buckets,
    p_note: parsed.data.note || undefined,
  });
  if (error) return dbFailure(error, "council.acceptClose", known);
  revalidateCouncil(ctx.org.slug);
  return { ok: true };
}
