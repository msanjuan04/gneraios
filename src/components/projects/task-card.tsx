"use client";

import { AlignLeft, CalendarClock, Eye } from "lucide-react";
import { useTranslations } from "next-intl";
import type { HTMLAttributes, KeyboardEvent, Ref } from "react";
import { isTaskOverdue } from "@/domain/projects";
import { cn } from "@/lib/utils";
import { PriorityIcon } from "./badges";
import { useProjectFormat } from "./format";
import { MemberAvatar } from "./member-avatar";
import type { MemberRef, ProjectTask } from "./types";

export type CardMove = "left" | "right" | "up" | "down";

type Props = {
  task: ProjectTask;
  assignee: MemberRef | undefined;
  today: string;
  portalVisible: boolean;
  dragging?: boolean;
  overlay?: boolean;
  /** Resalta la tarjeta sobre la que se va a soltar otra. */
  dropTarget?: boolean;
  ref?: Ref<HTMLDivElement>;
  onOpen?: () => void;
  onMove?: (move: CardMove) => void;
} & HTMLAttributes<HTMLDivElement>;

/** Tarjeta del tablero de tareas: título, prioridad, fecha (en rojo si va tarde), horas y quién la lleva. */
export function TaskCard({
  task,
  assignee,
  today,
  portalVisible,
  dragging,
  overlay,
  dropTarget,
  ref,
  onOpen,
  onMove,
  className,
  onKeyDown: dragKeyDown,
  ...rest
}: Props) {
  const t = useTranslations("projects.tasks.card");
  const fmt = useProjectFormat();
  const overdue = isTaskOverdue(task, today);
  const done = task.status === "done";

  // Enter abre; ⇧←/⇧→ cambian de columna y ⇧↑/⇧↓ la mueven dentro de la suya; Espacio arrastra (dnd-kit).
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, CardMove> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
    if (e.key === "Enter") {
      e.preventDefault();
      onOpen?.();
    } else if (e.shiftKey && moves[e.key]) {
      e.preventDefault();
      onMove?.(moves[e.key]!);
    } else {
      dragKeyDown?.(e);
    }
  }

  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      id={`task-card-${task.id}`}
      aria-label={t("open", { title: task.title })}
      title={t("moveHint")}
      onClick={onOpen}
      className={cn(
        "group relative cursor-pointer rounded-xl border bg-card p-3 text-left shadow-sm outline-none transition",
        "hover:border-primary/40 focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/40",
        dragging && "opacity-40",
        overlay && "rotate-1 border-primary/60 shadow-2xl",
        dropTarget && "before:absolute before:inset-x-2 before:-top-1.5 before:h-0.5 before:rounded-full before:bg-primary",
        className,
      )}
      {...rest}
      onKeyDown={onKeyDown}
    >
      <p className={cn("line-clamp-3 text-sm leading-snug font-semibold", done && "text-muted-foreground line-through decoration-muted-foreground/50")}>
        <PriorityIcon priority={task.priority} className="mr-1 align-[-2px]" />
        {task.title}
      </p>

      <div className="mt-2.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <div className="flex min-w-0 items-center gap-2">
          {task.dueOn && (
            <span className={cn("flex items-center gap-1 tabular", overdue && "font-semibold text-destructive")} title={overdue ? t("overdue") : undefined}>
              <CalendarClock className="size-3.5" />
              {fmt.date(task.dueOn, "short")}
            </span>
          )}
          {(task.loggedMinutes > 0 || task.estimateMinutes !== null) && (
            <span
              className={cn("tabular", task.estimateMinutes !== null && task.loggedMinutes > task.estimateMinutes && "text-destructive")}
              title={task.estimateMinutes !== null ? t("estimate", { time: fmt.duration(task.estimateMinutes) }) : undefined}
            >
              {fmt.hours(task.loggedMinutes)}
              {task.estimateMinutes !== null && <span className="text-muted-foreground/70"> / {fmt.hours(task.estimateMinutes)}</span>}
            </span>
          )}
          {task.description && <AlignLeft className="size-3.5 shrink-0" aria-label={t("hasDescription")} />}
          {task.clientVisible && (
            <Eye
              className={cn("size-3.5 shrink-0", portalVisible ? "text-primary" : "text-muted-foreground/60")}
              aria-label={portalVisible ? t("clientVisible") : t("clientVisibleHidden")}
            />
          )}
        </div>
        <MemberAvatar member={assignee} size="xs" tooltip={!overlay} />
      </div>
    </div>
  );
}
