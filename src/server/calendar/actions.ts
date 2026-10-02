"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { addDays } from "@/domain/dates/civil-date";
import { dateInZone, fromDateTimeLocal } from "@/domain/dates/zoned-time";
import type { ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";
import { dbFailure, failure, forbidden, idSchema, invalidInput, memberContext, partnerContext } from "@/server/action-utils";
import { feedUrl, generateFeedToken, getMyActiveFeed, hashFeedToken, type MemberFeed } from "./feeds";
import { syncGoogleCalendar } from "./google";

// Acciones del calendario. Solo mueven fechas que viven en un único sitio y cuyo cambio es
// legítimo (la próxima acción de un deal, la fecha prevista de un hito sin facturar, la fecha de
// una tarea sin hacer), con la misma escritura guardada por RLS que su módulo; y gestionan el
// enlace ICS de cada socio.

const dateSchema = z.iso.date();
const scopeSchema = z.enum(["mine", "all"]);
const entrySchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(10000).default(""),
  date: z.iso.date(),
  endDate: z.iso.date(),
  allDay: z.boolean(),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});

export type CalendarEntryInput = z.input<typeof entrySchema>;

/** Cita privada del socio. Si Google está conectado, syncGoogleCalendar la publica. */
export async function saveCalendarEntryAction(slug: string, input: CalendarEntryInput, entryId?: string): Promise<ActionResult<{ id: string }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const parsed = entrySchema.safeParse(input);
  const id = entryId ? idSchema.safeParse(entryId) : null;
  if (!parsed.success || (id && !id.success)) return invalidInput();
  const value = parsed.data;
  const start = value.allDay ? new Date(`${value.date}T00:00:00.000Z`) : fromDateTimeLocal(`${value.date}T${value.startTime}`, ctx.org.timezone);
  const end = value.allDay ? new Date(`${addDays(value.endDate, 1)}T00:00:00.000Z`) : fromDateTimeLocal(`${value.endDate}T${value.endTime}`, ctx.org.timezone);
  if (!start || !end || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start || end.getTime() > start.getTime() + 31 * 86400000) return invalidInput();
  const supabase = await createClient();
  const payload = { title: value.title, description: value.description, starts_at: start.toISOString(), ends_at: end.toISOString(), all_day: value.allDay, dirty: true };
  const result = id?.success
    ? await supabase.from("calendar_entries").update(payload).eq("id", id.data).eq("org_id", ctx.org.id).eq("member_id", ctx.member.id).is("deleted_at", null).select("id").maybeSingle()
    : await supabase.from("calendar_entries").insert({ ...payload, org_id: ctx.org.id, member_id: ctx.member.id, created_by: ctx.user.id }).select("id").maybeSingle();
  if (result.error) return dbFailure(result.error, "saveCalendarEntryAction");
  if (!result.data) return failure("common.errorGeneric");
  await syncGoogleCalendar(ctx.org.id, ctx.member.id, ctx.org.timezone, value.date, value.date);
  revalidateCalendar(ctx.org.slug);
  return { ok: true, id: result.data.id };
}

/** El borrado queda pendiente de Google si ya había un evento sincronizado. */
export async function deleteCalendarEntryAction(slug: string, entryId: string): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(entryId);
  if (!id.success) return invalidInput();
  const supabase = await createClient();
  const { data: entry, error: readError } = await supabase.from("calendar_entries")
    .select("id, google_event_id, starts_at, all_day").eq("id", id.data).eq("org_id", ctx.org.id).eq("member_id", ctx.member.id).is("deleted_at", null).maybeSingle();
  if (readError) return dbFailure(readError, "deleteCalendarEntryAction.read");
  if (!entry) return failure("common.errorGeneric");
  const result = entry.google_event_id
    ? await supabase.from("calendar_entries").update({ deleted_at: new Date().toISOString(), dirty: true }).eq("id", id.data).eq("org_id", ctx.org.id).eq("member_id", ctx.member.id)
    : await supabase.from("calendar_entries").delete().eq("id", id.data).eq("org_id", ctx.org.id).eq("member_id", ctx.member.id);
  if (result.error) return dbFailure(result.error, "deleteCalendarEntryAction");
  const date = entry.all_day ? entry.starts_at.slice(0, 10) : dateInZone(new Date(entry.starts_at), ctx.org.timezone);
  await syncGoogleCalendar(ctx.org.id, ctx.member.id, ctx.org.timezone, date, date);
  revalidateCalendar(ctx.org.slug);
  return { ok: true };
}

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
