"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  moveTaskSchema,
  type MoveTaskInput,
  projectFormSchema,
  type ProjectFormInput,
  projectRow,
  projectStatusSchema,
  quickTaskSchema,
  type QuickTaskInput,
  TASK_STATES,
  taskFormSchema,
  type TaskFormInput,
  taskRow,
  templateFormSchema,
  type TemplateFormInput,
  templateTasksPayload,
  timeEntryFormSchema,
  type TimeEntryFormInput,
  timeEntryRow,
} from "@/app/[org]/projects/schema";
import type { RunningTimer, TimerProjectOption, TimerTaskOption } from "@/components/projects/types";
import { daysBetween } from "@/domain/dates/civil-date";
import { positionAtEnd, type TaskStatus, type TemplateTask } from "@/domain/projects";
import type { ActionResult } from "@/lib/action-result";
import { nowInZone } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { dbFailure, failure, forbidden, idSchema, invalidInput, memberContext, partnerContext } from "@/server/action-utils";
import { hasRole } from "@/server/session";
import { knownProjectError } from "./errors";
import { getOpenProjectOptions } from "./queries";

/**
 * Acciones de proyectos, tareas, horas y plantillas. Todo con el cliente del usuario: la RLS es
 * la barrera (un socio escribe; cada uno, sus horas; un owner corrige las de cualquiera). Las
 * reglas que tienen que ser atómicas viven en Postgres (temporizador, alta desde plantilla).
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;

const fail = (error: PostgrestError, where: string) => dbFailure(error, where, knownProjectError);

/** Vuelve a pintar las pantallas de proyectos (listado, fichas, mis tareas) y lo que las enseña fuera. */
function revalidateProjects(slug: string, clientId?: string | null) {
  revalidatePath(`/${slug}/projects`, "layout");
  revalidatePath(`/${slug}`);
  if (clientId) revalidatePath(`/${slug}/clients/${clientId}`);
}

/** Detrás de la última tarjeta de una columna. */
async function endOfColumn(supabase: Supabase, projectId: string, status: TaskStatus): Promise<number> {
  const { data } = await supabase
    .from("project_tasks")
    .select("position")
    .eq("project_id", projectId)
    .eq("status", status)
    .order("position", { ascending: false })
    .limit(1);
  return positionAtEnd((data ?? []).map((r) => Number(r.position)));
}

// ---------------------------------------------------------------------------
// Proyectos
// ---------------------------------------------------------------------------

/** Crea (en blanco o desde una plantilla) o edita un proyecto. */
export async function saveProject(slug: string, projectId: string | null, input: ProjectFormInput): Promise<ActionResult<{ id: string }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const parsed = projectFormSchema.safeParse(input);
  const id = projectId === null ? null : idSchema.safeParse(projectId);
  if (!parsed.success || (id && !id.success)) return invalidInput();
  const row = projectRow(parsed.data);
  const supabase = await createClient();

  if (id) {
    const { data, error } = await supabase.from("projects").update(row).eq("id", id.data).eq("org_id", ctx.org.id).select("id, client_id").maybeSingle();
    if (error) return fail(error, "saveProject.update");
    if (!data) return failure("projects.errors.notFound");
    revalidateProjects(ctx.org.slug, data.client_id);
    return { ok: true, id: data.id };
  }

  if (parsed.data.template_id) {
    const { data, error } = await supabase.rpc("create_project_from_template", { p_template_id: parsed.data.template_id, p: row });
    if (error) return fail(error, "saveProject.template");
    revalidateProjects(ctx.org.slug, row.client_id);
    return { ok: true, id: data };
  }

  const { data, error } = await supabase
    .from("projects")
    .insert({ ...row, org_id: ctx.org.id })
    .select("id")
    .single();
  if (error) return fail(error, "saveProject.insert");
  revalidateProjects(ctx.org.slug, row.client_id);
  return { ok: true, id: data.id };
}

/** Cambia el estado (planificado, en marcha, en pausa, hecho, cancelado): una decisión humana. */
export async function setProjectStatus(slug: string, input: { project_id: string; status: string }): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const parsed = projectStatusSchema.safeParse(input);
  if (!parsed.success) return invalidInput();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.project_id)
    .eq("org_id", ctx.org.id)
    .select("client_id")
    .maybeSingle();
  if (error) return fail(error, "setProjectStatus");
  if (!data) return failure("projects.errors.notFound");
  revalidateProjects(ctx.org.slug, data.client_id);
  return { ok: true };
}

/** Archiva (o recupera) un proyecto. No se borra: sus horas y su historia siguen contando. */
export async function setProjectArchived(slug: string, projectId: string, archived: boolean): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(projectId);
  if (!id.success || typeof archived !== "boolean") return invalidInput();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id.data)
    .eq("org_id", ctx.org.id)
    .select("client_id")
    .maybeSingle();
  if (error) return fail(error, "setProjectArchived");
  if (!data) return failure("projects.errors.notFound");
  revalidateProjects(ctx.org.slug, data.client_id);
  return { ok: true };
}

/** Enseña (o esconde) el proyecto en el portal del cliente. */
export async function setProjectPortalVisible(slug: string, projectId: string, visible: boolean): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(projectId);
  if (!id.success || typeof visible !== "boolean") return invalidInput();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .update({ portal_visible: visible })
    .eq("id", id.data)
    .eq("org_id", ctx.org.id)
    .select("client_id")
    .maybeSingle();
  if (error) return error.code === "23514" ? failure("projects.errors.portalNeedsClient") : fail(error, "setProjectPortalVisible");
  if (!data) return failure("projects.errors.notFound");
  revalidateProjects(ctx.org.slug, data.client_id);
  return { ok: true };
}

/** Guarda las tareas de un proyecto como plantilla: sus fechas pasan a días desde el inicio. */
export async function saveProjectAsTemplate(slug: string, projectId: string, name: string): Promise<ActionResult<{ id: string }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(projectId);
  const title = z.string().trim().min(1).max(120).safeParse(name);
  if (!id.success || !title.success) return invalidInput();
  const supabase = await createClient();
  const { data: project } = await supabase.from("projects").select("kind, starts_on").eq("org_id", ctx.org.id).eq("id", id.data).maybeSingle();
  if (!project) return failure("projects.errors.notFound");
  const { data: tasks, error: tasksError } = await supabase
    .from("project_tasks")
    .select("title, estimate_minutes, due_on, client_visible, status, position")
    .eq("project_id", id.data)
    .order("position")
    .limit(200);
  if (tasksError) return fail(tasksError, "saveProjectAsTemplate.tasks");
  const order: Record<string, number> = { todo: 0, doing: 1, review: 2, done: 3 };
  const rows: TemplateTask[] = [...(tasks ?? [])]
    .sort((a, b) => (order[a.status] ?? 0) - (order[b.status] ?? 0) || Number(a.position) - Number(b.position))
    .map((t) => {
      const offset = project.starts_on && t.due_on ? daysBetween(project.starts_on, t.due_on) : null;
      return {
        title: t.title,
        estimate_minutes: t.estimate_minutes,
        offset_days: offset !== null && offset >= 0 && offset <= 3650 ? offset : null,
        client_visible: t.client_visible,
      };
    });
  const { data, error } = await supabase
    .from("project_templates")
    .insert({ org_id: ctx.org.id, name: title.data, kind: project.kind, tasks: rows })
    .select("id")
    .single();
  if (error) return fail(error, "saveProjectAsTemplate");
  revalidateProjects(ctx.org.slug);
  return { ok: true, id: data.id };
}

// ---------------------------------------------------------------------------
// Tareas
// ---------------------------------------------------------------------------

/** Crea o edita una tarea desde su panel. Una nueva va al final de su columna. */
export async function saveTask(
  slug: string,
  projectId: string,
  taskId: string | null,
  input: TaskFormInput,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const parsed = taskFormSchema.safeParse(input);
  const project = idSchema.safeParse(projectId);
  const id = taskId === null ? null : idSchema.safeParse(taskId);
  if (!parsed.success || !project.success || (id && !id.success)) return invalidInput();
  const row = taskRow(parsed.data);
  const supabase = await createClient();

  if (id) {
    // Cambiar de columna desde el panel la deja al final de la nueva.
    const { data: current } = await supabase.from("project_tasks").select("status").eq("id", id.data).eq("org_id", ctx.org.id).maybeSingle();
    if (!current) return failure("projects.errors.taskNotFound");
    const position = current.status === row.status ? undefined : await endOfColumn(supabase, project.data, row.status);
    const { data, error } = await supabase
      .from("project_tasks")
      .update({ ...row, ...(position !== undefined && { position }) })
      .eq("id", id.data)
      .eq("org_id", ctx.org.id)
      .select("id")
      .maybeSingle();
    if (error) return fail(error, "saveTask.update");
    if (!data) return failure("projects.errors.taskNotFound");
    revalidateProjects(ctx.org.slug);
    return { ok: true, id: data.id };
  }

  const position = await endOfColumn(supabase, project.data, row.status);
  const { data, error } = await supabase
    .from("project_tasks")
    .insert({ ...row, org_id: ctx.org.id, project_id: project.data, position })
    .select("id")
    .single();
  if (error) return fail(error, "saveTask.insert");
  revalidateProjects(ctx.org.slug);
  return { ok: true, id: data.id };
}

/** Alta rápida (solo el título): al final de una columna del tablero o desde "Mis tareas". */
export async function quickAddTask(slug: string, input: QuickTaskInput): Promise<ActionResult<{ id: string }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const parsed = quickTaskSchema.safeParse(input);
  if (!parsed.success) return invalidInput();
  const v = parsed.data;
  const supabase = await createClient();
  const position = await endOfColumn(supabase, v.project_id, v.status);
  const { data, error } = await supabase
    .from("project_tasks")
    .insert({
      org_id: ctx.org.id,
      project_id: v.project_id,
      title: v.title,
      status: v.status,
      due_on: v.due_on || null,
      assignee_member_id: v.assign_to_me ? ctx.member.id : null,
      position,
    })
    .select("id")
    .single();
  if (error) return fail(error, "quickAddTask");
  revalidateProjects(ctx.org.slug);
  return { ok: true, id: data.id };
}

/** Suelta una tarjeta en una columna y una posición (drag & drop o teclado). */
export async function moveTask(slug: string, input: MoveTaskInput): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const parsed = moveTaskSchema.safeParse(input);
  if (!parsed.success) return invalidInput();
  const v = parsed.data;
  const supabase = await createClient();
  // Si no cabía un número entre sus vecinas, primero se renumera la columna.
  for (const item of v.renumber) {
    const { error } = await supabase.from("project_tasks").update({ position: item.position }).eq("id", item.id).eq("org_id", ctx.org.id);
    if (error) return fail(error, "moveTask.renumber");
  }
  const { data, error } = await supabase
    .from("project_tasks")
    .update({ status: v.status, position: v.position })
    .eq("id", v.task_id)
    .eq("org_id", ctx.org.id)
    .select("id")
    .maybeSingle();
  if (error) return fail(error, "moveTask");
  if (!data) return failure("projects.errors.taskNotFound");
  revalidateProjects(ctx.org.slug);
  return { ok: true };
}

const taskStatusSchema = z.object({ task_id: z.guid(), status: z.enum(TASK_STATES) });

/** Cambia el estado de una tarea (la casilla de "hecha"): va al final de su nueva columna. */
export async function setTaskStatus(slug: string, input: { task_id: string; status: TaskStatus }): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const parsed = taskStatusSchema.safeParse(input);
  if (!parsed.success) return invalidInput();
  const supabase = await createClient();
  const { data: task } = await supabase.from("project_tasks").select("project_id, status").eq("id", parsed.data.task_id).eq("org_id", ctx.org.id).maybeSingle();
  if (!task) return failure("projects.errors.taskNotFound");
  if (task.status === parsed.data.status) return { ok: true };
  const position = await endOfColumn(supabase, task.project_id, parsed.data.status);
  const { error } = await supabase
    .from("project_tasks")
    .update({ status: parsed.data.status, position })
    .eq("id", parsed.data.task_id)
    .eq("org_id", ctx.org.id);
  if (error) return fail(error, "setTaskStatus");
  revalidateProjects(ctx.org.slug);
  return { ok: true };
}

/** Borra una tarea. Sus horas se quedan en el proyecto (sin tarea). */
export async function deleteTask(slug: string, taskId: string): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(taskId);
  if (!id.success) return invalidInput();
  const supabase = await createClient();
  const { data, error } = await supabase.from("project_tasks").delete().eq("id", id.data).eq("org_id", ctx.org.id).select("id");
  if (error) return fail(error, "deleteTask");
  if (!data || data.length === 0) return failure("projects.errors.taskNotFound");
  revalidateProjects(ctx.org.slug);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Horas
// ---------------------------------------------------------------------------

/**
 * Registra o corrige unas horas. Cada uno registra las suyas; un owner puede apuntarlas a nombre
 * de otro (la RLS lo vuelve a comprobar).
 */
export async function saveTimeEntry(
  slug: string,
  projectId: string,
  entryId: string | null,
  input: TimeEntryFormInput,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const parsed = timeEntryFormSchema.safeParse(input);
  const project = idSchema.safeParse(projectId);
  const id = entryId === null ? null : idSchema.safeParse(entryId);
  if (!parsed.success || !project.success || (id && !id.success)) return invalidInput();
  // Horas de más de un día hacia el futuro: casi siempre un error al elegir la fecha.
  if (daysBetween(nowInZone(ctx.org.timezone).date, parsed.data.worked_on) > 1) return failure("projects.errors.futureDate");
  const isOwner = hasRole(ctx.member.role, "owner");
  const memberId = isOwner && parsed.data.member_id ? parsed.data.member_id : undefined;
  if (parsed.data.member_id && !isOwner && parsed.data.member_id !== ctx.member.id) return forbidden();
  const row = timeEntryRow(parsed.data);
  const supabase = await createClient();

  if (id) {
    const { data, error } = await supabase
      .from("time_entries")
      .update({ ...row, ...(memberId && { member_id: memberId }) })
      .eq("id", id.data)
      .eq("org_id", ctx.org.id)
      .select("id")
      .maybeSingle();
    if (error) return fail(error, "saveTimeEntry.update");
    if (!data) return failure("projects.errors.entryNotFound");
    revalidateProjects(ctx.org.slug);
    return { ok: true, id: data.id };
  }

  const { data, error } = await supabase
    .from("time_entries")
    .insert({ ...row, org_id: ctx.org.id, project_id: project.data, member_id: memberId ?? ctx.member.id })
    .select("id")
    .single();
  if (error) return fail(error, "saveTimeEntry.insert");
  revalidateProjects(ctx.org.slug);
  return { ok: true, id: data.id };
}

export async function deleteTimeEntry(slug: string, entryId: string): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(entryId);
  if (!id.success) return invalidInput();
  const supabase = await createClient();
  const { data, error } = await supabase.from("time_entries").delete().eq("id", id.data).eq("org_id", ctx.org.id).select("id");
  if (error) return fail(error, "deleteTimeEntry");
  if (!data || data.length === 0) return failure("projects.errors.entryNotFound");
  revalidateProjects(ctx.org.slug);
  return { ok: true };
}

/** Pone en marcha el temporizador (y para el que hubiera): start_timer en Postgres. */
export async function startTimer(slug: string, projectId: string, taskId?: string | null): Promise<ActionResult<{ entryId: string }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const project = idSchema.safeParse(projectId);
  const task = taskId ? idSchema.safeParse(taskId) : null;
  if (!project.success || (task && !task.success)) return invalidInput();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("start_timer", { p_project_id: project.data, ...(task?.success && { p_task_id: task.data }) });
  if (error) return fail(error, "startTimer");
  revalidateProjects(ctx.org.slug);
  return { ok: true, entryId: data };
}

/** Para el temporizador en marcha: stop_timer redondea al minuto y fecha el día de inicio. */
export async function stopTimer(slug: string): Promise<ActionResult<{ entryId: string | null }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("stop_timer");
  if (error) return fail(error, "stopTimer");
  revalidateProjects(ctx.org.slug);
  return { ok: true, entryId: data ?? null };
}

/** El temporizador en marcha del usuario en esta org (para la barra superior). */
export async function getTimerState(slug: string): Promise<RunningTimer | null> {
  const ctx = await memberContext(slug);
  if (!ctx) return null;
  const supabase = await createClient();
  const { data: entry, error } = await supabase
    .from("time_entries")
    .select("id, project_id, task_id, started_at")
    .eq("org_id", ctx.org.id)
    .eq("member_id", ctx.member.id)
    .is("minutes", null)
    .maybeSingle();
  if (error) {
    console.error("[timer]", error);
    return null;
  }
  if (!entry?.started_at) return null;
  const [project, task] = await Promise.all([
    supabase.from("projects_overview").select("name, client_name").eq("id", entry.project_id).maybeSingle(),
    entry.task_id ? supabase.from("project_tasks").select("title").eq("id", entry.task_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  return {
    entryId: entry.id,
    projectId: entry.project_id,
    projectName: project.data?.name ?? "",
    clientName: project.data?.client_name ?? null,
    taskId: entry.task_id,
    taskTitle: task.data?.title ?? null,
    startedAt: entry.started_at,
  };
}

/** Proyectos donde se puede poner en marcha el temporizador: primero en los que más se ha trabajado últimamente. */
export async function getTimerProjects(slug: string): Promise<TimerProjectOption[]> {
  const ctx = await memberContext(slug);
  if (!ctx) return [];
  const supabase = await createClient();
  const [options, recent] = await Promise.all([
    getOpenProjectOptions(ctx.org.id),
    supabase
      .from("time_entries")
      .select("project_id")
      .eq("org_id", ctx.org.id)
      .eq("member_id", ctx.member.id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const rank = new Map<string, number>();
  for (const [i, r] of (recent.data ?? []).entries()) if (!rank.has(r.project_id)) rank.set(r.project_id, i);
  return [...options].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) || a.name.localeCompare(b.name, "es"));
}

/** Tareas sin hacer de un proyecto, para apuntar el temporizador a una. */
export async function getTimerTasks(slug: string, projectId: string): Promise<TimerTaskOption[]> {
  const ctx = await memberContext(slug);
  const id = idSchema.safeParse(projectId);
  if (!ctx || !id.success) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("project_tasks")
    .select("id, title, status, assignee_member_id")
    .eq("org_id", ctx.org.id)
    .eq("project_id", id.data)
    .neq("status", "done")
    .order("position")
    .limit(200);
  // Las mías primero.
  return [...(data ?? [])]
    .sort((a, b) => Number(b.assignee_member_id === ctx.member.id) - Number(a.assignee_member_id === ctx.member.id))
    .map((t) => ({ id: t.id, title: t.title, status: t.status as TaskStatus }));
}

// ---------------------------------------------------------------------------
// Plantillas
// ---------------------------------------------------------------------------

export async function saveTemplate(slug: string, templateId: string | null, input: TemplateFormInput): Promise<ActionResult<{ id: string }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const parsed = templateFormSchema.safeParse(input);
  const id = templateId === null ? null : idSchema.safeParse(templateId);
  if (!parsed.success || (id && !id.success)) return invalidInput();
  const row = { name: parsed.data.name, kind: parsed.data.kind, tasks: templateTasksPayload(parsed.data) };
  const supabase = await createClient();
  const result = id
    ? await supabase.from("project_templates").update(row).eq("id", id.data).eq("org_id", ctx.org.id).select("id").maybeSingle()
    : await supabase.from("project_templates").insert({ ...row, org_id: ctx.org.id }).select("id").single();
  if (result.error) return fail(result.error, "saveTemplate");
  if (!result.data) return failure("projects.errors.templateNotFound");
  revalidateProjects(ctx.org.slug);
  return { ok: true, id: result.data.id };
}

export async function deleteTemplate(slug: string, templateId: string): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(templateId);
  if (!id.success) return invalidInput();
  const supabase = await createClient();
  const { data, error } = await supabase.from("project_templates").delete().eq("id", id.data).eq("org_id", ctx.org.id).select("id");
  if (error) return fail(error, "deleteTemplate");
  if (!data || data.length === 0) return failure("projects.errors.templateNotFound");
  revalidateProjects(ctx.org.slug);
  return { ok: true };
}
