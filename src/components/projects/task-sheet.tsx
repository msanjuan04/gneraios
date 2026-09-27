"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Play, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { type TaskFormInput, taskFormSchema, type TaskFormValues } from "@/app/[org]/projects/schema";
import { FormField, ToggleField } from "@/components/settings/form-field";
import { SettingsSheet, SheetForm } from "@/components/settings/settings-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { durationToInput, TASK_PRIORITIES, TASK_STATUSES, type TaskStatus } from "@/domain/projects";
import { deleteTask, saveTask, startTimer } from "@/server/projects/actions";
import { announceTimerChange, OptionSelect, useProjectValidationMessage } from "./fields";
import { useProjectFormat } from "./format";
import type { MemberRef, ProjectTask } from "./types";

type Props = {
  slug: string;
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Tarea a editar; sin ella, se crea una. */
  task: ProjectTask | null;
  defaultStatus?: TaskStatus;
  members: MemberRef[];
  canEdit: boolean;
  portalVisible: boolean;
};

export function TaskSheet(props: Props) {
  const t = useTranslations("projects.taskSheet");
  return (
    <SettingsSheet open={props.open} onOpenChange={props.onOpenChange} title={props.task ? t("editTitle") : t("createTitle")}>
      {props.open && <TaskForm key={props.task?.id ?? "new"} {...props} />}
    </SettingsSheet>
  );
}

function estimateInput(minutes: number | null): string {
  if (minutes === null) return "";
  return minutes % 60 === 0 ? String(minutes / 60) : durationToInput(minutes);
}

function TaskForm({ slug, projectId, onOpenChange, task, defaultStatus, members, canEdit, portalVisible }: Props) {
  const t = useTranslations("projects.taskSheet");
  const tStatus = useTranslations("projects.taskStatus");
  const tPriority = useTranslations("projects.priority");
  const tCommon = useTranslations("common");
  const message = useProjectValidationMessage();
  const fmt = useProjectFormat();
  const [pending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const form = useForm<TaskFormInput, unknown, TaskFormValues>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: {
      title: task?.title ?? "",
      description: task?.description ?? "",
      status: task?.status ?? defaultStatus ?? "todo",
      assignee_member_id: task?.assigneeId ?? "",
      due_on: task?.dueOn ?? "",
      priority: task?.priority ?? "normal",
      estimate: estimateInput(task?.estimateMinutes ?? null),
      client_visible: task?.clientVisible ?? false,
    },
  });
  const { errors } = form.formState;
  const assignable = members.filter((m) => m.active || m.id === task?.assigneeId);

  const submit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = await saveTask(slug, projectId, task?.id ?? null, values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(task ? t("saved") : t("created"));
      onOpenChange(false);
    }),
  );

  const remove = () =>
    startTransition(async () => {
      if (!task) return;
      const result = await deleteTask(slug, task.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("deleted"));
      onOpenChange(false);
    });

  const timer = () =>
    startTransition(async () => {
      if (!task) return;
      const result = await startTimer(slug, projectId, task.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("timerStarted", { title: task.title }));
      announceTimerChange();
    });

  return (
    <SheetForm
      onSubmit={submit}
      footer={
        confirmDelete ? (
          <>
            <p className="mr-auto text-xs text-muted-foreground">{t("deleteConfirm")}</p>
            <Button type="button" variant="ghost" onClick={() => setConfirmDelete(false)} disabled={pending}>
              {tCommon("cancel")}
            </Button>
            <Button type="button" variant="destructive" onClick={remove} disabled={pending}>
              {t("delete")}
            </Button>
          </>
        ) : (
          <>
            {task && canEdit && (
              <Button type="button" variant="ghost" className="mr-auto" onClick={() => setConfirmDelete(true)}>
                <Trash2 data-icon="inline-start" />
                {t("delete")}
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {canEdit ? tCommon("cancel") : tCommon("close")}
            </Button>
            {canEdit && (
              <Button type="submit" disabled={pending}>
                {pending ? tCommon("saving") : task ? t("save") : t("create")}
              </Button>
            )}
          </>
        )
      }
    >
      <fieldset disabled={!canEdit} className="grid gap-4 sm:grid-cols-2">
        <FormField id="title" label={t("title")} error={message(errors.title?.message)} className="sm:col-span-2">
          <Input id="title" autoFocus={!task} placeholder={t("titlePlaceholder")} {...form.register("title")} />
        </FormField>

        <FormField id="status" label={t("status")}>
          <Controller
            control={form.control}
            name="status"
            render={({ field }) => (
              <OptionSelect id="status" value={field.value} onChange={field.onChange} options={TASK_STATUSES.map((s) => ({ value: s, label: tStatus(s) }))} />
            )}
          />
        </FormField>
        <FormField id="priority" label={t("priority")}>
          <Controller
            control={form.control}
            name="priority"
            render={({ field }) => (
              <OptionSelect
                id="priority"
                value={field.value}
                onChange={field.onChange}
                options={[...TASK_PRIORITIES].reverse().map((p) => ({ value: p, label: tPriority(p) }))}
              />
            )}
          />
        </FormField>

        <FormField id="assignee_member_id" label={t("assignee")}>
          <Controller
            control={form.control}
            name="assignee_member_id"
            render={({ field }) => (
              <OptionSelect
                id="assignee_member_id"
                value={field.value}
                onChange={field.onChange}
                noneLabel={t("unassigned")}
                options={assignable.map((m) => ({ value: m.id, label: `${m.fullName} · ${m.initials}` }))}
              />
            )}
          />
        </FormField>
        <FormField id="due_on" label={t("dueOn")} optional error={message(errors.due_on?.message)}>
          <Input id="due_on" type="date" {...form.register("due_on")} />
        </FormField>

        <FormField id="estimate" label={t("estimate")} optional error={message(errors.estimate?.message)} description={t("estimateHint")}>
          <div className="relative">
            <Input id="estimate" inputMode="decimal" placeholder="2" className="pr-7 text-right tabular" {...form.register("estimate")} />
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">h</span>
          </div>
        </FormField>
        {task && (
          <div className="flex flex-col justify-end gap-1.5 text-sm">
            <p className="text-xs font-medium text-muted-foreground">{t("logged")}</p>
            <p className="font-semibold tabular">
              {fmt.duration(task.loggedMinutes)}
              {task.estimateMinutes !== null && (
                <span className="font-normal text-muted-foreground"> {t("ofEstimate", { time: fmt.duration(task.estimateMinutes) })}</span>
              )}
            </p>
          </div>
        )}

        <FormField id="description" label={t("description")} optional error={message(errors.description?.message)} className="sm:col-span-2">
          <Textarea id="description" rows={5} placeholder={t("descriptionPlaceholder")} {...form.register("description")} />
        </FormField>

        <Controller
          control={form.control}
          name="client_visible"
          render={({ field }) => (
            <ToggleField
              id="client_visible"
              label={t("clientVisible")}
              description={portalVisible ? t("clientVisibleHint") : t("clientVisibleHiddenHint")}
              checked={field.value}
              onCheckedChange={field.onChange}
              disabled={!canEdit}
              className="sm:col-span-2"
            />
          )}
        />
      </fieldset>

      {task && (
        <div className="mt-6 flex flex-wrap items-center gap-3 border-t pt-5 text-xs text-muted-foreground">
          {task.completedAt && <span>{t("completedAt", { date: fmt.instant(task.completedAt) })}</span>}
          {canEdit && task.status !== "done" && (
            <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={timer} disabled={pending}>
              <Play data-icon="inline-start" />
              {t("startTimer")}
            </Button>
          )}
        </div>
      )}
    </SheetForm>
  );
}
