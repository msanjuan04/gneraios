"use client";

import {
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { ListTodo, Plus } from "lucide-react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useOptimistic, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { useShell } from "@/components/app-shell/shell-context";
import { useHotkeys } from "@/components/app-shell/use-hotkeys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { comparePositioned, planMove, positionAtEnd, TASK_STATUSES, type TaskStatus } from "@/domain/projects";
import { cn } from "@/lib/utils";
import { moveTask, quickAddTask } from "@/server/projects/actions";
import { TASK_STATUS_DOTS } from "./badges";
import { memberLookup } from "./member-avatar";
import { type CardMove, TaskCard } from "./task-card";
import { TaskSheet } from "./task-sheet";
import type { MemberRef, ProjectTask } from "./types";

type Optimistic =
  | { type: "move"; taskId: string; status: TaskStatus; position: number; renumber: { id: string; position: number }[]; at: string }
  | { type: "add"; task: ProjectTask };

const CARD = "task:";
const COLUMN = "column:";
const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

function closest(target: EventTarget | null, selector: string): boolean {
  return target instanceof Element && target.closest(selector) !== null;
}

/** Primero la tarjeta bajo el puntero (para soltar entre dos), si no la columna; nunca la propia. */
const collision: CollisionDetection = (args) => {
  const byPointer = pointerWithin(args);
  const hits = (byPointer.length > 0 ? byPointer : rectIntersection(args)).filter((h) => String(h.id) !== `${CARD}${args.active.id}`);
  const card = hits.find((h) => String(h.id).startsWith(CARD));
  return card ? [card] : hits;
};

type SheetState = { open: false } | { open: true; taskId: string | null; status?: TaskStatus };

/**
 * Tablero de tareas de un proyecto: por hacer, en curso, en revisión y hechas. Drag & drop entre
 * columnas y dentro de cada una (índice fraccional: cambia una sola fila), alta rápida por columna y
 * panel lateral con todos los campos. Teclado: n (nueva), Enter (abrir), ⇧←/⇧→ y ⇧↑/⇧↓ (mover).
 */
export function TaskBoard({
  slug,
  projectId,
  tasks: initialTasks,
  members,
  today,
  canEdit,
  portalVisible,
  active,
  initialTaskId,
  onSheetClosed,
}: {
  slug: string;
  projectId: string;
  tasks: ProjectTask[];
  members: MemberRef[];
  today: string;
  canEdit: boolean;
  portalVisible: boolean;
  /** La pestaña está a la vista (los atajos solo funcionan entonces). */
  active: boolean;
  initialTaskId?: string;
  onSheetClosed?: () => void;
}) {
  const t = useTranslations("projects.tasks");
  const tStatus = useTranslations("projects.taskStatus");
  const pathname = usePathname();
  const { commandOpen, shortcutsOpen } = useShell();
  const [, startTransition] = useTransition();
  const [tasks, apply] = useOptimistic(initialTasks, (state, change: Optimistic) => {
    if (change.type === "add") return [...state, change.task];
    const positions = new Map(change.renumber.map((r) => [r.id, r.position]));
    return state.map((task) =>
      task.id === change.taskId
        ? { ...task, status: change.status, position: change.position, completedAt: change.status === "done" ? (task.completedAt ?? change.at) : null }
        : positions.has(task.id)
          ? { ...task, position: positions.get(task.id)! }
          : task,
    );
  });
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetState>(() =>
    initialTaskId && initialTasks.some((task) => task.id === initialTaskId) ? { open: true, taskId: initialTaskId } : { open: false },
  );
  const member = memberLookup(members);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] } }),
  );

  const column = (status: TaskStatus, without?: string) =>
    tasks.filter((task) => task.status === status && task.id !== without).sort(comparePositioned);

  function commit(taskId: string, status: TaskStatus, index: number) {
    const task = tasks.find((x) => x.id === taskId);
    if (!canEdit || !task) return;
    const target = column(status, taskId);
    const plan = planMove(target, index);
    const currentIndex = column(status).findIndex((x) => x.id === taskId);
    if (task.status === status && currentIndex === index) return;
    startTransition(async () => {
      apply({ type: "move", taskId, status, position: plan.position, renumber: plan.renumber, at: new Date().toISOString() });
      const result = await moveTask(slug, { task_id: taskId, status, position: plan.position, renumber: plan.renumber });
      if (!result.ok) toast.error(result.error);
      else if (task.status !== status) toast.success(t("moved", { status: tStatus(status) }));
    });
  }

  function moveBy(task: ProjectTask, move: CardMove) {
    if (move === "left" || move === "right") {
      const target = TASK_STATUSES[TASK_STATUSES.indexOf(task.status) + (move === "right" ? 1 : -1)];
      if (target) commit(task.id, target, column(target, task.id).length);
    } else {
      const current = column(task.status).findIndex((x) => x.id === task.id);
      const next = current + (move === "down" ? 1 : -1);
      if (next >= 0 && next < column(task.status).length) commit(task.id, task.status, next);
    }
    // El foco sigue a la tarjeta (se vuelve a pintar en su sitio nuevo).
    requestAnimationFrame(() => document.getElementById(`task-card-${task.id}`)?.focus());
  }

  const onDragStart = (e: DragStartEvent) => setDragId(String(e.active.id));
  const onDragOver = (e: DragOverEvent) => setOverId(e.over ? String(e.over.id) : null);
  function onDragEnd(e: DragEndEvent) {
    setDragId(null);
    setOverId(null);
    const taskId = String(e.active.id);
    const over = e.over ? String(e.over.id) : null;
    if (!over) return;
    if (over.startsWith(COLUMN)) {
      const status = over.slice(COLUMN.length) as TaskStatus;
      commit(taskId, status, column(status, taskId).length);
      return;
    }
    const target = tasks.find((x) => x.id === over.slice(CARD.length));
    if (!target || !e.over) return;
    const siblings = column(target.status, taskId);
    const at = siblings.findIndex((x) => x.id === target.id);
    // Se suelta delante de la tarjeta de debajo, o detrás si el centro de la arrastrada pasa del suyo.
    const dragged = e.active.rect.current.translated;
    const below = dragged ? dragged.top + dragged.height / 2 > e.over.rect.top + e.over.rect.height / 2 : false;
    commit(taskId, target.status, at + (below ? 1 : 0));
  }

  const openSheet = (next: SheetState) => {
    setSheet(next);
    if (!next.open) onSheetClosed?.();
    if (!next.open && window.location.search.includes("task=")) {
      const params = new URLSearchParams(window.location.search);
      params.delete("task");
      const query = params.toString();
      window.history.replaceState(null, "", `${pathname}${query ? `?${query}` : ""}`);
    }
  };

  function addQuick(status: TaskStatus, title: string) {
    const position = positionAtEnd(column(status).map((x) => x.position));
    startTransition(async () => {
      apply({
        type: "add",
        task: {
          id: `temp-${Date.now()}`,
          title,
          description: null,
          status,
          assigneeId: null,
          dueOn: null,
          priority: "normal",
          estimateMinutes: null,
          position,
          clientVisible: false,
          completedAt: null,
          loggedMinutes: 0,
        },
      });
      const result = await quickAddTask(slug, { project_id: projectId, title, status });
      if (!result.ok) toast.error(result.error);
    });
  }

  useHotkeys({
    n: (event) => {
      if (!active || !canEdit || sheet.open || commandOpen || shortcutsOpen || closest(event.target, OVERLAY)) return;
      event.preventDefault();
      openSheet({ open: true, taskId: null, status: "todo" });
    },
  });

  const dragged = dragId ? tasks.find((x) => x.id === dragId) : undefined;
  const editing = sheet.open && sheet.taskId ? (tasks.find((x) => x.id === sheet.taskId) ?? null) : null;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
          {t.rich(canEdit ? "keyboardHint" : "keyboardHintReadOnly", { kbd: (chunks) => <Kbd>{chunks}</Kbd> })}
        </p>
        {canEdit && (
          <Button size="sm" className="ml-auto" onClick={() => openSheet({ open: true, taskId: null, status: "todo" })}>
            <Plus data-icon="inline-start" />
            {t("new")}
            <Kbd className="ml-1 hidden bg-primary-foreground/15 text-primary-foreground sm:inline-flex">N</Kbd>
          </Button>
        )}
      </div>

      {tasks.length === 0 && !canEdit ? (
        <div className="rounded-2xl border border-dashed px-6 py-12 text-center">
          <ListTodo className="mx-auto size-5 text-muted-foreground" />
          <p className="mt-3 font-semibold">{t("emptyTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("emptyReadOnly")}</p>
        </div>
      ) : (
        <DndContext
          id={`task-board-${projectId}`}
          sensors={sensors}
          collisionDetection={collision}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={() => {
            setDragId(null);
            setOverId(null);
          }}
        >
          <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-4 md:-mx-8 md:px-8">
            {TASK_STATUSES.map((status) => {
              const cards = column(status);
              return (
                <Column
                  key={status}
                  status={status}
                  count={cards.length}
                  canEdit={canEdit}
                  highlighted={overId === `${COLUMN}${status}`}
                  footer={canEdit ? <QuickAdd onAdd={(title) => addQuick(status, title)} /> : undefined}
                >
                  {cards.map((task) => (
                    <DraggableTask
                      key={task.id}
                      task={task}
                      assignee={member(task.assigneeId)}
                      today={today}
                      portalVisible={portalVisible}
                      dragging={task.id === dragId}
                      dropTarget={overId === `${CARD}${task.id}` && dragId !== task.id}
                      disabled={!canEdit || task.id.startsWith("temp-")}
                      onOpen={() => !task.id.startsWith("temp-") && openSheet({ open: true, taskId: task.id })}
                      onMove={(move) => moveBy(task, move)}
                    />
                  ))}
                  {cards.length === 0 && tasks.length === 0 && status === "todo" && (
                    <p className="px-2 py-4 text-center text-xs text-muted-foreground">{t("emptyBody")}</p>
                  )}
                </Column>
              );
            })}
          </div>
          <DragOverlay>
            {dragged ? <TaskCard task={dragged} assignee={member(dragged.assigneeId)} today={today} portalVisible={portalVisible} overlay /> : null}
          </DragOverlay>
        </DndContext>
      )}

      <TaskSheet
        slug={slug}
        projectId={projectId}
        open={sheet.open && (sheet.taskId === null || editing !== null)}
        onOpenChange={(open) => !open && openSheet({ open: false })}
        task={editing}
        defaultStatus={sheet.open ? sheet.status : undefined}
        members={members}
        canEdit={canEdit}
        portalVisible={portalVisible}
      />
    </div>
  );
}

function Column({
  status,
  count,
  canEdit,
  highlighted,
  footer,
  children,
}: {
  status: TaskStatus;
  count: number;
  canEdit: boolean;
  highlighted: boolean;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const t = useTranslations("projects.tasks");
  const tStatus = useTranslations("projects.taskStatus");
  const { setNodeRef, isOver } = useDroppable({ id: `${COLUMN}${status}`, disabled: !canEdit });
  return (
    <section
      ref={setNodeRef}
      aria-label={tStatus(status)}
      className={cn(
        "flex w-72 shrink-0 flex-col rounded-2xl border bg-muted/30 transition-colors md:w-auto md:min-w-64 md:flex-1",
        (isOver || highlighted) && "border-primary/60 bg-primary/5",
        status === "done" && "bg-muted/15",
      )}
    >
      <header className="flex items-center justify-between gap-2 border-b px-3 py-2.5">
        <h3 className="flex items-center gap-2 text-sm font-bold">
          <span className={cn("size-2 rounded-full", TASK_STATUS_DOTS[status])} />
          {tStatus(status)}
        </h3>
        <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold tabular">{count}</span>
      </header>
      <div className="flex min-h-24 flex-1 flex-col gap-2 p-2">
        {children}
        {count === 0 && <p className="m-auto py-4 text-xs text-muted-foreground/70">{t("columnEmpty")}</p>}
      </div>
      {footer && <div className="px-2 pb-2">{footer}</div>}
    </section>
  );
}

function DraggableTask({
  task,
  disabled,
  ...props
}: {
  task: ProjectTask;
  assignee: MemberRef | undefined;
  today: string;
  portalVisible: boolean;
  dragging: boolean;
  dropTarget: boolean;
  disabled: boolean;
  onOpen: () => void;
  onMove: (move: CardMove) => void;
}) {
  const drag = useDraggable({ id: task.id, disabled });
  const drop = useDroppable({ id: `${CARD}${task.id}`, disabled });
  return (
    <TaskCard
      ref={(node) => {
        drag.setNodeRef(node);
        drop.setNodeRef(node);
      }}
      task={task}
      {...props}
      {...drag.attributes}
      {...drag.listeners}
    />
  );
}

/** "+ Añadir tarea" al pie de una columna: Enter crea (y deja el campo listo para la siguiente), Esc cierra. */
function QuickAdd({ onAdd }: { onAdd: (title: string) => void }) {
  const t = useTranslations("projects.tasks");
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const input = useRef<HTMLInputElement>(null);

  if (!open) {
    return (
      <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground" onClick={() => setOpen(true)}>
        <Plus data-icon="inline-start" />
        {t("quickAdd")}
      </Button>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const value = title.trim();
        if (!value) return;
        onAdd(value.slice(0, 300));
        setTitle("");
        input.current?.focus();
      }}
    >
      <Input
        ref={input}
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            setOpen(false);
            setTitle("");
          }
        }}
        onBlur={() => !title.trim() && setOpen(false)}
        placeholder={t("quickAddPlaceholder")}
        aria-label={t("quickAdd")}
        maxLength={300}
        className="h-8 bg-card"
      />
      <p className="mt-1 px-1 text-[11px] text-muted-foreground">{t("quickAddHint")}</p>
    </form>
  );
}
