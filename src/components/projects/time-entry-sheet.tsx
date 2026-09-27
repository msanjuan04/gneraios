"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { type TimeEntryFormInput, timeEntryFormSchema, type TimeEntryFormValues } from "@/app/[org]/projects/schema";
import { FormField, ToggleField } from "@/components/settings/form-field";
import { SettingsSheet, SheetForm } from "@/components/settings/settings-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { addDays } from "@/domain/dates/civil-date";
import { durationToInput } from "@/domain/projects";
import { deleteTimeEntry, saveTimeEntry } from "@/server/projects/actions";
import { OptionSelect, useProjectValidationMessage } from "./fields";
import type { MemberRef, ProjectTask, TimeEntry } from "./types";

type Props = {
  slug: string;
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Registro a corregir; sin él, se registra uno nuevo. */
  entry: TimeEntry | null;
  tasks: ProjectTask[];
  members: MemberRef[];
  currentMemberId: string;
  /** Un owner puede apuntar horas a nombre de otro. */
  isOwner: boolean;
  today: string;
  defaultTaskId?: string;
};

export function TimeEntrySheet(props: Props) {
  const t = useTranslations("projects.entrySheet");
  return (
    <SettingsSheet
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.entry ? t("editTitle") : t("createTitle")}
      description={props.entry ? undefined : t("description")}
    >
      {props.open && <EntryForm key={props.entry?.id ?? "new"} {...props} />}
    </SettingsSheet>
  );
}

function EntryForm({ slug, projectId, onOpenChange, entry, tasks, members, currentMemberId, isOwner, today, defaultTaskId }: Props) {
  const t = useTranslations("projects.entrySheet");
  const tCommon = useTranslations("common");
  const message = useProjectValidationMessage();
  const [pending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const form = useForm<TimeEntryFormInput, unknown, TimeEntryFormValues>({
    resolver: zodResolver(timeEntryFormSchema),
    defaultValues: {
      worked_on: entry?.workedOn ?? today,
      duration: entry?.minutes ? durationToInput(entry.minutes) : "",
      task_id: entry?.taskId ?? defaultTaskId ?? "",
      note: entry?.note ?? "",
      billable: entry?.billable ?? true,
      member_id: entry?.memberId ?? currentMemberId,
    },
  });
  const { errors } = form.formState;
  const taskOptions = tasks
    .filter((task) => task.status !== "done" || task.id === entry?.taskId)
    .map((task) => ({ value: task.id, label: task.title }));
  const memberOptions = members.filter((m) => m.active || m.id === entry?.memberId).map((m) => ({ value: m.id, label: `${m.fullName} · ${m.initials}` }));

  const submit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = await saveTimeEntry(slug, projectId, entry?.id ?? null, values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(entry ? t("saved") : t("created"));
      onOpenChange(false);
    }),
  );

  const remove = () =>
    startTransition(async () => {
      if (!entry) return;
      const result = await deleteTimeEntry(slug, entry.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("deleted"));
      onOpenChange(false);
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
            {entry && (
              <Button type="button" variant="ghost" className="mr-auto" onClick={() => setConfirmDelete(true)}>
                <Trash2 data-icon="inline-start" />
                {t("delete")}
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {tCommon("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? tCommon("saving") : entry ? t("save") : t("create")}
            </Button>
          </>
        )
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="worked_on" label={t("workedOn")} error={message(errors.worked_on?.message)}>
          <Input id="worked_on" type="date" max={addDays(today, 1)} {...form.register("worked_on")} />
        </FormField>
        <FormField id="duration" label={t("duration")} error={message(errors.duration?.message)} description={t("durationHint")}>
          <Input id="duration" autoFocus inputMode="decimal" placeholder="1:30" className="tabular" {...form.register("duration")} />
        </FormField>

        <FormField id="task_id" label={t("task")} optional className="sm:col-span-2">
          <Controller
            control={form.control}
            name="task_id"
            render={({ field }) => <OptionSelect id="task_id" value={field.value} onChange={field.onChange} noneLabel={t("noTask")} options={taskOptions} />}
          />
        </FormField>

        {isOwner && (
          <FormField id="member_id" label={t("member")} description={t("memberHint")} className="sm:col-span-2">
            <Controller
              control={form.control}
              name="member_id"
              render={({ field }) => <OptionSelect id="member_id" value={field.value} onChange={field.onChange} options={memberOptions} />}
            />
          </FormField>
        )}

        <FormField id="note" label={t("note")} optional error={message(errors.note?.message)} className="sm:col-span-2">
          <Textarea id="note" rows={3} placeholder={t("notePlaceholder")} {...form.register("note")} />
        </FormField>

        <Controller
          control={form.control}
          name="billable"
          render={({ field }) => (
            <ToggleField
              id="billable"
              label={t("billable")}
              description={t("billableHint")}
              checked={field.value}
              onCheckedChange={field.onChange}
              className="sm:col-span-2"
            />
          )}
        />
      </div>
    </SheetForm>
  );
}
