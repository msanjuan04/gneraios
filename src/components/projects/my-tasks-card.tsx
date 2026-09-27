"use client";

import { ArrowRight, CalendarClock, CheckCheck } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { isTaskOverdue } from "@/domain/projects";
import { cn } from "@/lib/utils";
import { setTaskStatus } from "@/server/projects/actions";
import { PriorityIcon } from "./badges";
import { useProjectFormat } from "./format";
import type { MyTasksCardData } from "./types";

/**
 * "Mis tareas" en el dashboard (Hoy): lo atrasado, lo de hoy y lo que queda de la semana, con la
 * casilla para terminarlas sin salir. Datos de `getMyTasksCard(orgId, memberId, today)`
 * (src/server/projects/cards.ts).
 */
export function MyTasksCard({ slug, basePath, data, canEdit, className }: { slug: string; basePath: string; data: MyTasksCardData; canEdit: boolean; className?: string }) {
  const t = useTranslations("projects.card");
  const fmt = useProjectFormat();
  const [, startTransition] = useTransition();
  const [done, setDone] = useState<Set<string>>(new Set());
  const { counts } = data;

  const toggle = (id: string, title: string, checked: boolean) => {
    setDone((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
    startTransition(async () => {
      const result = await setTaskStatus(slug, { task_id: id, status: checked ? "done" : "todo" });
      if (!result.ok) {
        toast.error(result.error);
        setDone((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      } else if (checked) {
        toast.success(t("completed", { title }));
      }
    });
  };

  return (
    <Card className={cn("gap-3", className)}>
      <CardHeader>
        <CardTitle className="font-semibold">
          <h3>{t("title")}</h3>
        </CardTitle>
        <CardDescription className="text-xs">
          {counts.open === 0
            ? t("allClear")
            : [
                counts.overdue > 0 ? t("overdue", { count: counts.overdue }) : null,
                t("today", { count: counts.today }),
                counts.thisWeek > 0 ? t("thisWeek", { count: counts.thisWeek }) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
        </CardDescription>
        <CardAction>
          <Button asChild variant="ghost" size="sm">
            <Link href={`${basePath}/projects/tasks`}>
              {t("all")}
              <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {data.tasks.length === 0 ? (
          <p className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
            <CheckCheck className="size-4 text-success" />
            {counts.open === 0 ? t("empty") : t("nothingSoon", { count: counts.open })}
          </p>
        ) : (
          <ul className="-mx-2 space-y-0.5">
            {data.tasks.map((task) => {
              const isDone = done.has(task.id);
              const overdue = !isDone && isTaskOverdue(task, data.today);
              return (
                <li key={task.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/40">
                  <Checkbox
                    checked={isDone}
                    disabled={!canEdit}
                    onCheckedChange={(value) => toggle(task.id, task.title, value === true)}
                    aria-label={t("markDone", { title: task.title })}
                  />
                  <Link href={`${basePath}/projects/${task.projectId}?task=${task.id}`} className="min-w-0 flex-1">
                    <p className={cn("truncate text-sm font-medium hover:text-primary", isDone && "text-muted-foreground line-through")}>
                      <PriorityIcon priority={task.priority} className="mr-1 align-[-2px]" />
                      {task.title}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{task.projectName}</p>
                  </Link>
                  {task.dueOn && (
                    <span className={cn("flex shrink-0 items-center gap-1 text-xs tabular", overdue ? "font-semibold text-destructive" : "text-muted-foreground")}>
                      <CalendarClock className="size-3.5" />
                      {task.dueOn === data.today ? t("todayLabel") : fmt.date(task.dueOn, "short")}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
