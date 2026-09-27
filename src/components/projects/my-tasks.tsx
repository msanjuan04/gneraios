"use client";

import { CalendarClock, CheckCheck, Plus } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { ReadOnlyNotice } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { groupMyTasks, isTaskOverdue, type MyTaskGroup } from "@/domain/projects";
import { cn } from "@/lib/utils";
import { quickAddTask, setTaskStatus } from "@/server/projects/actions";
import { PriorityIcon } from "./badges";
import { OptionSelect } from "./fields";
import { useProjectFormat } from "./format";
import type { MyTask, TimerProjectOption } from "./types";

const GROUP_TONES: Record<MyTaskGroup, string> = {
  overdue: "text-destructive",
  today: "text-primary",
  thisWeek: "text-foreground",
  later: "text-muted-foreground",
  noDate: "text-muted-foreground",
};

type Change = { type: "done"; id: string } | { type: "undo"; id: string } | { type: "add"; task: MyTask };

/** "Mis tareas": lo asignado en todos los proyectos, por cuándo toca; se completan con la casilla. */
export function MyTasks({
  slug,
  basePath,
  tasks: initialTasks,
  projects,
  today,
  canEdit,
}: {
  slug: string;
  basePath: string;
  tasks: MyTask[];
  projects: TimerProjectOption[];
  today: string;
  canEdit: boolean;
}) {
  const t = useTranslations("projects.myTasks");
  const [, startTransition] = useTransition();
  // Las recién completadas se quedan tachadas hasta la próxima carga (y se pueden deshacer).
  const [done, setDone] = useState<Set<string>>(new Set());
  const [tasks, apply] = useOptimistic(initialTasks, (state, change: Change) =>
    change.type === "add" ? [...state, change.task] : state,
  );

  function complete(task: MyTask, checked: boolean) {
    setDone((prev) => {
      const next = new Set(prev);
      if (checked) next.add(task.id);
      else next.delete(task.id);
      return next;
    });
    startTransition(async () => {
      const result = await setTaskStatus(slug, { task_id: task.id, status: checked ? "done" : "todo" });
      if (!result.ok) {
        toast.error(result.error);
        setDone((prev) => {
          const next = new Set(prev);
          next.delete(task.id);
          return next;
        });
        return;
      }
      if (checked) {
        toast.success(t("completed", { title: task.title }), {
          action: { label: t("undo"), onClick: () => complete(task, false) },
        });
      }
    });
  }

  // Las hechas no desaparecen de golpe: salen tachadas en su grupo.
  const groups = groupMyTasks(
    tasks.map((task) => (done.has(task.id) ? { ...task, status: "todo" as const } : task)),
    today,
  );
  const open = tasks.filter((x) => !done.has(x.id)).length;

  return (
    <div className="max-w-4xl">
      <PageHeader title={t("title")} description={t("description", { count: open })} />
      {!canEdit && <ReadOnlyNotice className="-mt-4 mb-6">{t("readOnly")}</ReadOnlyNotice>}

      {canEdit && (
        <QuickAdd
          projects={projects}
          today={today}
          onAdd={(input, project) =>
            startTransition(async () => {
              apply({
                type: "add",
                task: {
                  id: `temp-${Date.now()}`,
                  title: input.title,
                  status: "todo",
                  priority: "normal",
                  dueOn: input.due_on || null,
                  projectId: project.id,
                  projectName: project.name,
                  clientName: project.clientName,
                },
              });
              const result = await quickAddTask(slug, { project_id: project.id, title: input.title, due_on: input.due_on, assign_to_me: true });
              if (!result.ok) toast.error(result.error);
              else toast.success(t("created", { project: project.name }));
            })
          }
        />
      )}

      {tasks.length === 0 ? (
        <div className="mt-6 rounded-3xl border bg-card/50 px-8 py-14 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-brand-gradient text-primary-foreground">
            <CheckCheck className="size-5" />
          </div>
          <h3 className="mt-5 text-2xl font-extrabold heading-tight">{t("emptyTitle")}</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{t("emptyBody")}</p>
          <Button asChild variant="secondary" className="mt-6">
            <Link href={`${basePath}/projects`}>{t("goProjects")}</Link>
          </Button>
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {groups
            .filter((g) => g.tasks.length > 0)
            .map((g) => (
              <section key={g.group} aria-labelledby={`group-${g.group}`}>
                <h3 id={`group-${g.group}`} className={cn("mb-2 flex items-center gap-2 text-sm font-bold", GROUP_TONES[g.group])}>
                  {t(`groups.${g.group}`)}
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-secondary-foreground tabular">{g.tasks.length}</span>
                </h3>
                <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
                  {g.tasks.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      basePath={basePath}
                      today={today}
                      done={done.has(task.id)}
                      canEdit={canEdit && !task.id.startsWith("temp-")}
                      onToggle={(checked) => complete(task, checked)}
                    />
                  ))}
                </ul>
              </section>
            ))}
        </div>
      )}
    </div>
  );
}

function TaskRow({
  task,
  basePath,
  today,
  done,
  canEdit,
  onToggle,
}: {
  task: MyTask;
  basePath: string;
  today: string;
  done: boolean;
  canEdit: boolean;
  onToggle: (checked: boolean) => void;
}) {
  const t = useTranslations("projects.myTasks");
  const fmt = useProjectFormat();
  const overdue = !done && isTaskOverdue(task, today);
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <Checkbox
        checked={done}
        onCheckedChange={(value) => onToggle(value === true)}
        disabled={!canEdit}
        aria-label={done ? t("markOpen", { title: task.title }) : t("markDone", { title: task.title })}
      />
      <div className="min-w-0 flex-1">
        <Link
          href={`${basePath}/projects/${task.projectId}?task=${task.id}`}
          className={cn("block truncate text-sm font-semibold hover:text-primary", done && "text-muted-foreground line-through")}
        >
          <PriorityIcon priority={task.priority} className="mr-1 align-[-2px]" />
          {task.title}
        </Link>
        <p className="truncate text-xs text-muted-foreground">
          {task.projectName}
          {task.clientName && ` · ${task.clientName}`}
        </p>
      </div>
      {task.dueOn && (
        <span className={cn("flex shrink-0 items-center gap-1 text-xs tabular", overdue ? "font-semibold text-destructive" : "text-muted-foreground")}>
          <CalendarClock className="size-3.5" />
          {task.dueOn === today ? t("today") : fmt.date(task.dueOn, "short")}
        </span>
      )}
    </li>
  );
}

function QuickAdd({
  projects,
  today,
  onAdd,
}: {
  projects: TimerProjectOption[];
  today: string;
  onAdd: (input: { title: string; due_on: string }, project: TimerProjectOption) => void;
}) {
  const t = useTranslations("projects.myTasks.quickAdd");
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [dueOn, setDueOn] = useState(today);
  const project = projects.find((p) => p.id === projectId);

  if (projects.length === 0) return <p className="text-sm text-muted-foreground">{t("noProjects")}</p>;

  return (
    <form
      className="flex flex-col gap-2 rounded-2xl border bg-card p-3 sm:flex-row sm:items-center"
      onSubmit={(e) => {
        e.preventDefault();
        const value = title.trim();
        if (!value || !project) return;
        onAdd({ title: value.slice(0, 300), due_on: dueOn }, project);
        setTitle("");
      }}
    >
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("placeholder")} aria-label={t("title")} maxLength={300} className="flex-1" />
      <OptionSelect
        ariaLabel={t("project")}
        value={projectId}
        onChange={setProjectId}
        options={projects.map((p) => ({ value: p.id, label: p.name, hint: p.clientName ? `· ${p.clientName}` : undefined }))}
        className="sm:w-56"
      />
      <Input type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} aria-label={t("due")} className="sm:w-40" />
      <Button type="submit" disabled={!title.trim() || !project}>
        <Plus data-icon="inline-start" />
        {t("submit")}
      </Button>
    </form>
  );
}
