"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";
import { dbFailure, failure, forbidden, idSchema, invalidInput, memberContext, partnerContext } from "@/server/action-utils";
import { feedUrl, generateFeedToken, getMyActiveFeed, hashFeedToken, type MemberFeed } from "./feeds";

// Acciones del calendario. Solo mueven fechas que viven en un único sitio y cuyo cambio es
// legítimo (la próxima acción de un deal, la fecha prevista de un hito sin facturar, la fecha de
// una tarea sin hacer), con la misma escritura guardada por RLS que su módulo; y gestionan el
// enlace ICS de cada socio.

const dateSchema = z.iso.date();
const scopeSchema = z.enum(["mine", "all"]);

const knownMilestoneErrors = (error: PostgrestError) =>
  error.hint === "milestone_billed"
    ? "calendar.errors.milestoneBilled"
    : error.hint === "milestone_not_found"
      ? "calendar.errors.milestoneNotFound"
      : undefined;

/** El calendario y la tarjeta del dashboard. */
function revalidateCalendar(slug: string) {
  revalidatePath(`/${slug}/calendar`);
  revalidatePath(`/${slug}`);
}

/** Mueve la próxima acción de un deal (arrastrarla en el calendario). Lo mismo que editarla en el pipeline. */
export async function rescheduleDealAction(slug: string, dealId: string, date: string): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(dealId);
  const on = dateSchema.safeParse(date);
  if (!id.success || !on.success) return invalidInput();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("deals")
    .update({ next_action_on: on.data })
    .eq("id", id.data)
    .eq("org_id", ctx.org.id)
    .is("archived_at", null)
    .select("id, client_id")
    .maybeSingle();
  if (error) return dbFailure(error, "rescheduleDealAction");
  if (!data) return failure("calendar.errors.dealNotFound");

  revalidateCalendar(ctx.org.slug);
  revalidatePath(`/${ctx.org.slug}/pipeline`);
  revalidatePath(`/${ctx.org.slug}/clients/${data.client_id}`);
  return { ok: true };
}

/** Mueve la fecha prevista de un hito que aún no se ha facturado (reschedule_milestone lo comprueba y lo bloquea). */
export async function rescheduleMilestoneAction(slug: string, milestoneId: string, date: string): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(milestoneId);
  const on = dateSchema.safeParse(date);
  if (!id.success || !on.success) return invalidInput();

  const supabase = await createClient();
  // Que sea de esta org (la RPC solo mira la RLS, y el socio puede serlo de varias).
  const { data: milestone, error: readError } = await supabase
    .from("contract_milestones")
    .select("id, contract_id")
    .eq("id", id.data)
    .eq("org_id", ctx.org.id)
    .maybeSingle();
  if (readError) return dbFailure(readError, "rescheduleMilestoneAction.read");
  if (!milestone) return failure("calendar.errors.milestoneNotFound");

  const { error } = await supabase.rpc("reschedule_milestone", { p_milestone_id: id.data, p_planned_on: on.data });
  if (error) return dbFailure(error, "rescheduleMilestoneAction", knownMilestoneErrors);

  revalidateCalendar(ctx.org.slug);
  revalidatePath(`/${ctx.org.slug}/contracts/${milestone.contract_id}`);
  return { ok: true };
}

/**
 * Mueve la fecha de una tarea sin hacer (arrastrarla en el calendario): lo mismo que cambiarla en
 * su proyecto, con la RLS de project_tasks (escribe un socio). Una tarea hecha no se mueve.
 */
export async function rescheduleTaskAction(slug: string, taskId: string, date: string): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(taskId);
  const on = dateSchema.safeParse(date);
  if (!id.success || !on.success) return invalidInput();

  const supabase = await createClient();
  // De esta org (el socio puede serlo de varias) y sin hacer: la condición va en la propia escritura.
  const { data, error } = await supabase
    .from("project_tasks")
    .update({ due_on: on.data })
    .eq("id", id.data)
    .eq("org_id", ctx.org.id)
    .neq("status", "done")
    .select("id")
    .maybeSingle();
  if (error) return dbFailure(error, "rescheduleTaskAction");
  if (!data) {
    // No se ha movido nada: o ya está hecha, o no existe (o no es de esta org).
    const { data: task } = await supabase.from("project_tasks").select("status").eq("id", id.data).eq("org_id", ctx.org.id).maybeSingle();
    return failure(task?.status === "done" ? "calendar.errors.taskDone" : "calendar.errors.taskNotFound");
  }

  revalidateCalendar(ctx.org.slug);
  // El listado, la ficha del proyecto y "Mis tareas".
  revalidatePath(`/${ctx.org.slug}/projects`, "layout");
  return { ok: true };
}

/**
 * Crea el enlace ICS del socio (y revoca el que tuviera). El token solo sale aquí: la base de
 * datos guarda su hash, así que la URL se enseña una vez.
 */
export async function createCalendarFeedAction(slug: string, scope: string): Promise<ActionResult<{ url: string; feed: MemberFeed }>> {
  const ctx = await memberContext(slug);
  if (!ctx) return forbidden();
  const parsed = scopeSchema.safeParse(scope);
  if (!parsed.success) return invalidInput();

  const token = generateFeedToken();
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_calendar_feed", {
    p_org: ctx.org.id,
    p_token_hash: hashFeedToken(token),
    p_scope: parsed.data,
  });
  if (error) return dbFailure(error, "createCalendarFeedAction");
  const feed = await getMyActiveFeed(supabase, ctx.org.id, ctx.member.id);
  if (!feed) return failure("common.errorGeneric");

  revalidatePath(`/${ctx.org.slug}/calendar`);
  return { ok: true, url: feedUrl(token), feed };
}

/** Revoca el enlace ICS del socio: deja de funcionar al momento en todos los calendarios. */
export async function revokeCalendarFeedAction(slug: string): Promise<ActionResult> {
  const ctx = await memberContext(slug);
  if (!ctx) return forbidden();
  const supabase = await createClient();
  const feed = await getMyActiveFeed(supabase, ctx.org.id, ctx.member.id);
  if (feed) {
    const { error } = await supabase.rpc("revoke_calendar_feed", { p_feed_id: feed.id });
    if (error) return dbFailure(error, "revokeCalendarFeedAction");
  }
  revalidatePath(`/${ctx.org.slug}/calendar`);
  return { ok: true };
}
