"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { LayoutTemplate } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { type ProjectFormInput, projectFormSchema, type ProjectFormValues } from "@/app/[org]/projects/schema";
import { FormField, ToggleField } from "@/components/settings/form-field";
import { SettingsSheet, SheetForm } from "@/components/settings/settings-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { addDays } from "@/domain/dates/civil-date";
import { durationToInput, PROJECT_KINDS, PROJECT_STATUSES } from "@/domain/projects";
import { saveProject } from "@/server/projects/actions";
import { OptionSelect, useProjectValidationMessage } from "./fields";
import { useProjectFormat } from "./format";
import type { ProjectFormOptions, ProjectListItem } from "./types";

export type ProjectSheetDefaults = { clientId?: string; contractId?: string; name?: string; templateId?: string };

type Props = {
  slug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: ProjectFormOptions;
  /** Proyecto a editar (con sus notas); sin él, se crea uno. */
  project?: (ProjectListItem & { notes: string | null }) | null;
  /** Lo que llega de la URL (?new=1&client=…&contract=…&name=…). */
  defaults?: ProjectSheetDefaults;
  currentMemberId: string;
  today: string;
  onSaved?: (id: string, created: boolean) => void;
};

/** "Nuevo proyecto" (en blanco o desde una plantilla) y "Editar proyecto" en el mismo panel. */
export function ProjectSheet(props: Props) {
  const t = useTranslations("projects.sheet");
  return (
    <SettingsSheet
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.project ? t("editTitle") : t("createTitle")}
      description={props.project ? undefined : t("description")}
    >
      {props.open && <ProjectForm key={props.project?.id ?? "new"} {...props} />}
    </SettingsSheet>
  );
}

function budgetInput(minutes: number | null): string {
  if (minutes === null) return "";
  return minutes % 60 === 0 ? String(minutes / 60) : durationToInput(minutes);
}

function ProjectForm({ slug, onOpenChange, options, project, defaults = {}, currentMemberId, today, onSaved }: Props) {
  const t = useTranslations("projects.sheet");
  const tKind = useTranslations("projects.kind");
  const tStatus = useTranslations("projects.status");
  const tCommon = useTranslations("common");
  const message = useProjectValidationMessage();
  const fmt = useProjectFormat();
  const [pending, startTransition] = useTransition();

  // Un contrato de la URL trae su cliente aunque no venga en la URL.
  const urlContract = options.contracts.find((c) => c.id === defaults.contractId);
  const urlClient = options.clients.find((c) => c.id === (defaults.clientId ?? urlContract?.clientId));
  const urlTemplate = options.templates.find((tpl) => tpl.id === defaults.templateId);

  const form = useForm<ProjectFormInput, unknown, ProjectFormValues>({
    resolver: zodResolver(projectFormSchema),
    defaultValues: project
      ? {
          name: project.name,
          client_id: project.clientId ?? "",
          contract_id: project.contractId ?? "",
          kind: project.kind,
          status: project.status,
          owner_member_id: project.ownerId ?? "",
          starts_on: project.startsOn ?? "",
          due_on: project.dueOn ?? "",
          budget: budgetInput(project.budgetMinutes),
          portal_visible: project.portalVisible,
          notes: project.notes ?? "",
          template_id: "",
        }
      : {
          name: defaults.name?.slice(0, 200) ?? urlTemplate?.name ?? "",
          client_id: urlClient?.id ?? "",
          contract_id: urlContract && urlContract.clientId === urlClient?.id ? urlContract.id : "",
          kind: urlTemplate?.kind ?? "web",
          status: "active",
          owner_member_id: currentMemberId,
          starts_on: today,
          due_on: urlTemplate?.summary.spanDays != null ? addDays(today, urlTemplate.summary.spanDays) : "",
          budget: budgetInput(urlTemplate?.summary.estimateMinutes ?? null),
          portal_visible: false,
          notes: "",
          template_id: urlTemplate?.id ?? "",
        },
  });
  const { errors } = form.formState;
  const [clientId, templateId, startsOn] = useWatch({ control: form.control, name: ["client_id", "template_id", "starts_on"] });
  const contracts = options.contracts.filter((c) => c.clientId === clientId);
  const template = options.templates.find((tpl) => tpl.id === templateId);
  const members = options.members.filter((m) => m.active || m.id === project?.ownerId);

  /** Elegir plantilla propone su tipo, su nombre, su presupuesto y la entrega (inicio + días de la plantilla). */
  function chooseTemplate(id: string) {
    form.setValue("template_id", id);
    const tpl = options.templates.find((x) => x.id === id);
    if (!tpl) return;
    form.setValue("kind", tpl.kind);
    if (!form.getValues("name").trim()) form.setValue("name", tpl.name);
    if (!form.getValues("budget").trim() && tpl.summary.estimateMinutes) form.setValue("budget", budgetInput(tpl.summary.estimateMinutes));
    const start = form.getValues("starts_on");
    if (!form.getValues("due_on") && start && tpl.summary.spanDays !== null) form.setValue("due_on", addDays(start, tpl.summary.spanDays));
  }

  const submit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = await saveProject(slug, project?.id ?? null, values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(project ? t("saved") : t("created"));
      onOpenChange(false);
      onSaved?.(result.id, !project);
    }),
  );

  return (
    <SheetForm
      onSubmit={submit}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {tCommon("cancel")}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? tCommon("saving") : project ? t("save") : t("create")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {!project && options.templates.length > 0 && (
          <FormField
            id="template_id"
            label={
              <span className="flex items-center gap-1.5">
                <LayoutTemplate className="size-3.5 text-muted-foreground" />
                {t("template")}
              </span>
            }
            description={
              template
                ? t("templateSummary", {
                    tasks: template.summary.tasks,
                    hours: template.summary.estimateMinutes ? fmt.hours(template.summary.estimateMinutes) : "—",
                  })
                : t("templateHint")
            }
            className="sm:col-span-2"
          >
            <OptionSelect
              id="template_id"
              value={templateId}
              onChange={chooseTemplate}
              noneLabel={t("blank")}
              options={options.templates.map((tpl) => ({ value: tpl.id, label: tpl.name, hint: `· ${tKind(tpl.kind)}` }))}
            />
          </FormField>
        )}

        <FormField id="name" label={t("name")} error={message(errors.name?.message)} className="sm:col-span-2">
          <Input id="name" autoFocus={!project} placeholder={t("namePlaceholder")} {...form.register("name")} />
        </FormField>

        <FormField id="client_id" label={t("client")} error={message(errors.client_id?.message)}>
          <Controller
            control={form.control}
            name="client_id"
            render={({ field }) => (
              <OptionSelect
                id="client_id"
                value={field.value}
                onChange={(value) => {
                  field.onChange(value);
                  // El contrato tiene que ser del cliente.
                  const contract = options.contracts.find((c) => c.id === form.getValues("contract_id"));
                  if (!contract || contract.clientId !== value) form.setValue("contract_id", "");
                  if (!value) form.setValue("portal_visible", false);
                }}
                noneLabel={t("internal")}
                options={options.clients.map((c) => ({ value: c.id, label: c.name }))}
              />
            )}
          />
        </FormField>

        <FormField
          id="contract_id"
          label={t("contract")}
          optional
          error={message(errors.contract_id?.message)}
          description={clientId ? t("contractHint") : t("contractNeedsClient")}
        >
          <Controller
            control={form.control}
            name="contract_id"
            render={({ field }) => (
              <OptionSelect
                id="contract_id"
                value={field.value}
                onChange={field.onChange}
                disabled={!clientId || contracts.length === 0}
                noneLabel={contracts.length === 0 && clientId ? t("noContracts") : t("noContract")}
                options={contracts.map((c) => ({ value: c.id, label: c.title, hint: c.signed ? undefined : `· ${t("unsigned")}` }))}
              />
            )}
          />
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

        <FormField id="status" label={t("status")}>
          <Controller
            control={form.control}
            name="status"
            render={({ field }) => (
              <OptionSelect
                id="status"
                value={field.value}
                onChange={field.onChange}
                options={PROJECT_STATUSES.map((s) => ({ value: s, label: tStatus(s) }))}
              />
            )}
          />
        </FormField>

        <FormField id="owner_member_id" label={t("owner")}>
          <Controller
            control={form.control}
            name="owner_member_id"
            render={({ field }) => (
              <OptionSelect
                id="owner_member_id"
                value={field.value}
                onChange={field.onChange}
                noneLabel={t("noOwner")}
                options={members.map((m) => ({ value: m.id, label: `${m.fullName} · ${m.initials}` }))}
              />
            )}
          />
        </FormField>

        <FormField
          id="budget"
          label={t("budget")}
          optional
          error={message(errors.budget?.message)}
          description={
            template?.summary.estimateMinutes ? t("budgetSuggestion", { hours: fmt.hours(template.summary.estimateMinutes) }) : t("budgetHint")
          }
        >
          <div className="relative">
            <Input id="budget" inputMode="decimal" placeholder="40" className="pr-7 text-right tabular" {...form.register("budget")} />
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">h</span>
          </div>
        </FormField>

        <FormField id="starts_on" label={t("startsOn")} optional error={message(errors.starts_on?.message)}>
          <Input id="starts_on" type="date" {...form.register("starts_on")} />
        </FormField>
        <FormField
          id="due_on"
          label={t("dueOn")}
          optional
          error={message(errors.due_on?.message)}
          description={template?.summary.spanDays != null && startsOn ? t("dueHint", { days: template.summary.spanDays }) : undefined}
        >
          <Input id="due_on" type="date" {...form.register("due_on")} />
        </FormField>

        <Controller
          control={form.control}
          name="portal_visible"
          render={({ field }) => (
            <ToggleField
              id="portal_visible"
              label={t("portal")}
              description={clientId ? t("portalHint") : t("portalNeedsClient")}
              checked={field.value}
              onCheckedChange={field.onChange}
              disabled={!clientId}
              className="sm:col-span-2"
            />
          )}
        />

        <FormField id="notes" label={t("notes")} optional error={message(errors.notes?.message)} className="sm:col-span-2">
          <Textarea id="notes" rows={4} placeholder={t("notesPlaceholder")} {...form.register("notes")} />
        </FormField>
      </div>
    </SheetForm>
  );
}
