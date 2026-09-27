import { z } from "zod";
import { isCivilDate } from "@/app/[org]/contracts/schema";
import {
  MAX_TASK_ESTIMATE_MINUTES,
  parseDurationInput,
  parseEstimateInput,
  PROJECT_KINDS,
  PROJECT_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TemplateTask,
} from "@/domain/projects";
import type { Enums } from "@/lib/supabase/database.types";
import { emptyToNull, requiredText, text } from "@/lib/validation/fiscal";

/**
 * Formularios de proyectos, tareas, horas y plantillas, compartidos por los paneles (cliente) y
 * las acciones (servidor). Todo llega como texto, tal y como se escribe ("1:30", "40 h"), y se
 * convierte aquí a minutos y fechas civiles. Los mensajes son claves de `projects.validation.*`
 * o de `validation.*`.
 */

// Los valores del dominio son los de los enums de la base de datos (si cambian, esto no compila).
export const KINDS = PROJECT_KINDS satisfies readonly Enums<"project_kind">[];
export const STATUSES = PROJECT_STATUSES satisfies readonly Enums<"project_status">[];
export const TASK_STATES = TASK_STATUSES satisfies readonly Enums<"project_task_status">[];
export const PRIORITIES = TASK_PRIORITIES satisfies readonly Enums<"project_task_priority">[];

const optionalDate = z
  .string()
  .trim()
  .refine((v) => v === "" || isCivilDate(v), "date");
const requiredDate = z.string().trim().min(1, "required").refine(isCivilDate, "date");
const optionalId = z.union([z.literal(""), z.guid()]);

const budgetInput = z
  .string()
  .trim()
  .refine((v) => v === "" || parseEstimateInput(v) !== null, "estimate");
const taskEstimateInput = z
  .string()
  .trim()
  .refine((v) => v === "" || parseEstimateInput(v, MAX_TASK_ESTIMATE_MINUTES) !== null, "estimate");

/** "" → null; "40" → 2400 (horas); "1:30" → 90. */
export function budgetToMinutes(value: string): number | null {
  return value.trim() === "" ? null : parseEstimateInput(value);
}

export function taskEstimateToMinutes(value: string): number | null {
  return value.trim() === "" ? null : parseEstimateInput(value, MAX_TASK_ESTIMATE_MINUTES);
}

// ---------------------------------------------------------------------------
// Proyecto
// ---------------------------------------------------------------------------

export const projectFormSchema = z
  .object({
    name: requiredText(200),
    /** "" = proyecto interno. */
    client_id: optionalId,
    contract_id: optionalId,
    kind: z.enum(KINDS),
    status: z.enum(STATUSES),
    owner_member_id: optionalId,
    starts_on: optionalDate,
    due_on: optionalDate,
    budget: budgetInput,
    portal_visible: z.boolean(),
    notes: text(10_000),
    /** Solo al crear: "" = en blanco. */
    template_id: optionalId,
  })
  .superRefine((v, ctx) => {
    if (v.starts_on && v.due_on && isCivilDate(v.starts_on) && isCivilDate(v.due_on) && v.due_on < v.starts_on) {
      ctx.addIssue({ code: "custom", path: ["due_on"], message: "dueBeforeStart" });
    }
    if (v.contract_id && !v.client_id) ctx.addIssue({ code: "custom", path: ["contract_id"], message: "contractNeedsClient" });
    if (v.portal_visible && !v.client_id) ctx.addIssue({ code: "custom", path: ["portal_visible"], message: "portalNeedsClient" });
  });

export type ProjectFormInput = z.input<typeof projectFormSchema>;
export type ProjectFormValues = z.output<typeof projectFormSchema>;

/** Valores ya validados → columnas de `projects` (sin org_id). */
export function projectRow(v: ProjectFormValues) {
  return {
    name: v.name,
    client_id: emptyToNull(v.client_id),
    contract_id: v.client_id ? emptyToNull(v.contract_id) : null,
    kind: v.kind,
    status: v.status,
    owner_member_id: emptyToNull(v.owner_member_id),
    starts_on: emptyToNull(v.starts_on),
    due_on: emptyToNull(v.due_on),
    budget_minutes: budgetToMinutes(v.budget),
    portal_visible: v.client_id ? v.portal_visible : false,
    notes: emptyToNull(v.notes),
  };
}

export const projectStatusSchema = z.object({ project_id: z.guid(), status: z.enum(STATUSES) });

// ---------------------------------------------------------------------------
// Tareas
// ---------------------------------------------------------------------------

export const taskFormSchema = z.object({
  title: requiredText(300),
  description: text(10_000),
  status: z.enum(TASK_STATES),
  assignee_member_id: optionalId,
  due_on: optionalDate,
  priority: z.enum(PRIORITIES),
  estimate: taskEstimateInput,
  client_visible: z.boolean(),
});

export type TaskFormInput = z.input<typeof taskFormSchema>;
export type TaskFormValues = z.output<typeof taskFormSchema>;

export function taskRow(v: TaskFormValues) {
  return {
    title: v.title,
    description: emptyToNull(v.description),
    status: v.status,
    assignee_member_id: emptyToNull(v.assignee_member_id),
    due_on: emptyToNull(v.due_on),
    priority: v.priority,
    estimate_minutes: taskEstimateToMinutes(v.estimate),
    client_visible: v.client_visible,
  };
}

/** Alta rápida: desde una columna del tablero o desde "Mis tareas". */
export const quickTaskSchema = z.object({
  project_id: z.guid(),
  title: requiredText(300),
  status: z.enum(TASK_STATES).default("todo"),
  due_on: optionalDate.default(""),
  /** Desde "Mis tareas": nace asignada a quien la crea. */
  assign_to_me: z.boolean().default(false),
});

export type QuickTaskInput = z.input<typeof quickTaskSchema>;

const position = z.number().finite().min(-1e15).max(1e15);

/** Soltar una tarjeta: columna y posición (y, si no cabía, la columna renumerada). */
export const moveTaskSchema = z.object({
  task_id: z.guid(),
  status: z.enum(TASK_STATES),
  position,
  renumber: z.array(z.object({ id: z.guid(), position })).max(500).default([]),
});

export type MoveTaskInput = z.input<typeof moveTaskSchema>;

// ---------------------------------------------------------------------------
// Horas
// ---------------------------------------------------------------------------

export const timeEntryFormSchema = z.object({
  worked_on: requiredDate,
  duration: z
    .string()
    .trim()
    .min(1, "required")
    .refine((v) => parseDurationInput(v) !== null, "duration"),
  task_id: optionalId,
  note: text(2000),
  billable: z.boolean(),
  /** Solo un owner registra horas de otro; "" = las de quien las registra. */
  member_id: optionalId,
});

export type TimeEntryFormInput = z.input<typeof timeEntryFormSchema>;
export type TimeEntryFormValues = z.output<typeof timeEntryFormSchema>;

export function timeEntryRow(v: TimeEntryFormValues) {
  return {
    worked_on: v.worked_on,
    minutes: parseDurationInput(v.duration)!,
    task_id: emptyToNull(v.task_id),
    note: emptyToNull(v.note),
    billable: v.billable,
  };
}

// ---------------------------------------------------------------------------
// Plantillas
// ---------------------------------------------------------------------------

const offsetDays = z
  .string()
  .trim()
  .refine((v) => v === "" || (/^\d{1,4}$/.test(v) && Number(v) <= 3650), "offsetDays");

export const templateFormSchema = z.object({
  name: requiredText(120),
  kind: z.enum(KINDS),
  tasks: z
    .array(
      z.object({
        title: requiredText(300),
        estimate: taskEstimateInput,
        offset_days: offsetDays,
        client_visible: z.boolean(),
      }),
    )
    .max(200, "tooManyTasks"),
});

export type TemplateFormInput = z.input<typeof templateFormSchema>;
export type TemplateFormValues = z.output<typeof templateFormSchema>;

/** Las tareas tal y como las guarda (y valida) la base de datos. */
export function templateTasksPayload(v: TemplateFormValues): TemplateTask[] {
  return v.tasks.map((t) => ({
    title: t.title,
    estimate_minutes: taskEstimateToMinutes(t.estimate),
    offset_days: t.offset_days === "" ? null : Number(t.offset_days),
    client_visible: t.client_visible,
  }));
}
