"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { type TemplateFormInput, templateFormSchema, type TemplateFormValues } from "@/app/[org]/projects/schema";
import { FormField } from "@/components/settings/form-field";
import { SettingsSheet, SheetForm } from "@/components/settings/settings-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { durationToInput, PROJECT_KINDS } from "@/domain/projects";
import { cn } from "@/lib/utils";
import { deleteTemplate, saveTemplate } from "@/server/projects/actions";
import { OptionSelect, useProjectValidationMessage } from "./fields";
import type { TemplateItem } from "./types";

type Props = {
  slug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: TemplateItem | null;
};

export function TemplateSheet(props: Props) {
  const t = useTranslations("projects.templateSheet");
  return (
    <SettingsSheet
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.template ? t("editTitle") : t("createTitle")}
      description={t("description")}
    >
      {props.open && <TemplateForm key={props.template?.id ?? "new"} {...props} />}
    </SettingsSheet>
  );
}

function estimateInput(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "";
  return minutes % 60 === 0 ? String(minutes / 60) : durationToInput(minutes);
}

const emptyTask = { title: "", estimate: "", offset_days: "", client_visible: false };

function TemplateForm({ slug, onOpenChange, template }: Props) {
  const t = useTranslations("projects.templateSheet");
  const tKind = useTranslations("projects.kind");
  const tCommon = useTranslations("common");
  const message = useProjectValidationMessage();
  const [pending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const form = useForm<TemplateFormInput, unknown, TemplateFormValues>({
    resolver: zodResolver(templateFormSchema),
    defaultValues: {
      name: template?.name ?? "",
      kind: template?.kind ?? "web",
      tasks: template
        ? template.tasks.map((task) => ({
            title: task.title,
            estimate: estimateInput(task.estimate_minutes),
            offset_days: task.offset_days === null || task.offset_days === undefined ? "" : String(task.offset_days),
            client_visible: task.client_visible === true,
          }))
        : [emptyTask],
    },
  });
  const { errors } = form.formState;
  const tasks = useFieldArray({ control: form.control, name: "tasks" });
  const visible = useWatch({ control: form.control, name: "tasks" });

  const submit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = await saveTemplate(slug, template?.id ?? null, values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(template ? t("saved") : t("created"));
      onOpenChange(false);
    }),
  );

  const remove = () =>
    startTransition(async () => {
      if (!template) return;
      const result = await deleteTemplate(slug, template.id);
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
            {template && (
              <Button type="button" variant="ghost" className="mr-auto" onClick={() => setConfirmDelete(true)}>
                <Trash2 data-icon="inline-start" />
                {t("delete")}
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {tCommon("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? tCommon("saving") : template ? t("save") : t("create")}
            </Button>
          </>
        )
      }
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
        <FormField id="name" label={t("name")} error={message(errors.name?.message)}>
          <Input id="name" autoFocus={!template} placeholder={t("namePlaceholder")} {...form.register("name")} />
        </FormField>
        <FormField id="kind" label={t("kind")}>
          <Controller
            control={form.control}
            name="kind"
            render={({ field }) => (
              <OptionSelect id="kind" value={field.value} onChange={field.onChange} options={PROJECT_KINDS.map((k) => ({ value: k, label: tKind(k) }))} />
            )}
          />
        </FormField>
      </div>

      <div className="mt-6">
        <div className="mb-2 flex items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{t("tasks")}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t("tasksHint")}</p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => tasks.append(emptyTask)} disabled={tasks.fields.length >= 200}>
            <Plus data-icon="inline-start" />
            {t("addTask")}
          </Button>
        </div>
        {errors.tasks?.message && <p className="mb-2 text-xs text-destructive">{message(errors.tasks.message)}</p>}

        {tasks.fields.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{t("noTasks")}</p>
        ) : (
          <div className="overflow-hidden rounded-xl border">
            <div className="hidden grid-cols-[1fr_5.5rem_4.5rem_6rem] gap-2 border-b bg-muted/40 px-3 py-1.5 text-[11px] font-semibold text-muted-foreground sm:grid">
              <span>{t("taskTitle")}</span>
              <span className="text-right">{t("estimate")}</span>
              <span className="text-right">{t("offsetDays")}</span>
              <span className="sr-only">{t("actions")}</span>
            </div>
            <ul className="divide-y">
              {tasks.fields.map((field, i) => {
                const rowErrors = errors.tasks?.[i];
                const clientVisible = visible?.[i]?.client_visible === true;
                return (
                  <li key={field.id} className="grid grid-cols-[1fr_5.5rem_4.5rem_6rem] items-start gap-2 px-3 py-2">
                    <div className="min-w-0">
                      <Input
                        aria-label={t("taskTitle")}
                        aria-invalid={Boolean(rowErrors?.title)}
                        placeholder={t("taskTitlePlaceholder")}
                        className="h-8"
                        {...form.register(`tasks.${i}.title`)}
                      />
                      {rowErrors?.title && <p className="mt-1 text-[11px] text-destructive">{message(rowErrors.title.message)}</p>}
                    </div>
                    <div>
                      <Input
                        aria-label={t("estimate")}
                        aria-invalid={Boolean(rowErrors?.estimate)}
                        inputMode="decimal"
                        placeholder="h"
                        className="h-8 text-right tabular"
                        {...form.register(`tasks.${i}.estimate`)}
                      />
                      {rowErrors?.estimate && <p className="mt-1 text-[11px] text-destructive">{message(rowErrors.estimate.message)}</p>}
                    </div>
                    <div>
                      <Input
                        aria-label={t("offsetDays")}
                        aria-invalid={Boolean(rowErrors?.offset_days)}
                        inputMode="numeric"
                        placeholder="+0"
                        className="h-8 text-right tabular"
                        {...form.register(`tasks.${i}.offset_days`)}
                      />
                      {rowErrors?.offset_days && <p className="mt-1 text-[11px] text-destructive">{message(rowErrors.offset_days.message)}</p>}
                    </div>
                    <div className="flex items-center justify-end gap-0.5">
                      <Controller
                        control={form.control}
                        name={`tasks.${i}.client_visible`}
                        render={({ field: toggle }) => (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-pressed={toggle.value}
                            aria-label={t("clientVisible")}
                            title={toggle.value ? t("clientVisibleOn") : t("clientVisibleOff")}
                            onClick={() => toggle.onChange(!toggle.value)}
                            className={cn(clientVisible ? "text-primary" : "text-muted-foreground")}
                          >
                            {toggle.value ? <Eye /> : <EyeOff />}
                          </Button>
                        )}
                      />
                      <Button type="button" variant="ghost" size="icon-xs" aria-label={t("moveUp")} disabled={i === 0} onClick={() => tasks.move(i, i - 1)}>
                        <ArrowUp />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={t("moveDown")}
                        disabled={i === tasks.fields.length - 1}
                        onClick={() => tasks.move(i, i + 1)}
                      >
                        <ArrowDown />
                      </Button>
                      <Button type="button" variant="ghost" size="icon-xs" aria-label={t("removeTask")} onClick={() => tasks.remove(i)}>
                        <X />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </SheetForm>
  );
}
