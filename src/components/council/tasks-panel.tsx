"use client";

import { ListTodo } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { setTaskDone } from "@/app/[org]/council/actions";
import { Checkbox } from "@/components/ui/checkbox";
import type { TaskView } from "@/council/queries";
import { cn } from "@/lib/utils";
import { AGENT_ICONS, civil } from "./meta";

/** Las tareas que han salido de aceptar recomendaciones: aceptar crea tareas, nunca mueve dinero. */
export function TasksPanel({ tasks, slug, basePath, canEdit, today }: { tasks: TaskView[]; slug: string; basePath: string; canEdit: boolean; today: string }) {
  const t = useTranslations("council.tasks");
  const format = useFormatter();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(tasks, (state, id: string) => state.filter((task) => task.id !== id));

  const complete = (task: TaskView) =>
    startTransition(async () => {
      setOptimistic(task.id);
      const result = await setTaskDone(slug, task.id, true);
      if (!result.ok) toast.error(result.error);
      else toast.success(t("doneToast"));
      router.refresh();
    });

  return (
    <section aria-labelledby="council-tasks" className="rounded-2xl border bg-card">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <ListTodo aria-hidden className="size-4 text-primary" />
        <h2 id="council-tasks" className="text-sm font-bold">
          {t("title")}
        </h2>
        {optimistic.length > 0 && <span className="ml-auto text-xs text-muted-foreground tabular">{optimistic.length}</span>}
      </header>
      {optimistic.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="divide-y">
          {optimistic.map((task) => {
            const Icon = AGENT_ICONS[task.agent];
            const late = task.dueOn !== null && task.dueOn < today;
            return (
              <li key={task.id} className="flex items-start gap-3 px-4 py-2.5">
                <Checkbox className="mt-0.5" aria-label={t("markDone", { title: task.title })} disabled={!canEdit} onCheckedChange={(value) => value === true && complete(task)} />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="leading-snug">{task.title}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                    <Icon aria-hidden className="size-3" />
                    <Link href={`${basePath}/council?tab=accepted#rec-${task.recommendationId}`} className="truncate hover:text-foreground">
                      {task.recommendationTitle}
                    </Link>
                    {task.dueOn && (
                      <span className={cn(late && "font-semibold text-destructive")}>
                        · {late ? t("late", { date: format.dateTime(civil(task.dueOn), { day: "numeric", month: "short" }) }) : t("due", { date: format.dateTime(civil(task.dueOn), { day: "numeric", month: "short" }) })}
                      </span>
                    )}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
