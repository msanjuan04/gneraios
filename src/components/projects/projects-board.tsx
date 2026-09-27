"use client";

import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { CalendarClock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type HTMLAttributes, type KeyboardEvent, type ReactNode, type Ref, useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";
import { PROJECT_STATUSES, type ProjectStatus } from "@/domain/projects";
import { cn } from "@/lib/utils";
import { setProjectStatus } from "@/server/projects/actions";
import { KindIcon, PROJECT_STATUS_DOTS, RateValue } from "./badges";
import { useProjectFormat } from "./format";
import { MemberAvatar, memberLookup } from "./member-avatar";
import { Bar } from "./meters";
import type { MemberRef, ProjectListItem } from "./types";

type Move = { projectId: string; status: ProjectStatus };

/** Tablero de proyectos por estado. Arrastrar (o ⇧←/⇧→) cambia el estado: una decisión humana. */
export function ProjectsBoard({
  slug,
  basePath,
  projects,
  members,
  targetCents,
  canEdit,
}: {
  slug: string;
  basePath: string;
  projects: ProjectListItem[];
  members: MemberRef[];
  targetCents: number;
  canEdit: boolean;
}) {
  const t = useTranslations("projects.board");
  const tStatus = useTranslations("projects.status");
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [items, applyMove] = useOptimistic(projects, (state, move: Move) =>
    state.map((p) => (p.id === move.projectId ? { ...p, status: move.status } : p)),
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const member = memberLookup(members);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] } }),
  );

  function commit(move: Move) {
    const current = items.find((p) => p.id === move.projectId);
    if (!canEdit || !current || current.status === move.status) return;
    startTransition(async () => {
      applyMove(move);
      const result = await setProjectStatus(slug, { project_id: move.projectId, status: move.status });
      if (result.ok) toast.success(t("moved", { status: tStatus(move.status) }));
      else toast.error(result.error);
    });
  }

  function moveBy(project: ProjectListItem, direction: -1 | 1) {
    const target = PROJECT_STATUSES[PROJECT_STATUSES.indexOf(project.status) + direction];
    if (target) commit({ projectId: project.id, status: target });
  }

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    if (e.over) commit({ projectId: String(e.active.id), status: e.over.id as ProjectStatus });
  };

  const active = activeId ? items.find((p) => p.id === activeId) : undefined;
  const open = (id: string) => router.push(`${basePath}/projects/${id}`);

  return (
    <DndContext id="projects-board" sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
      <div className="-mx-4 flex min-h-0 gap-3 overflow-x-auto px-4 pb-4 md:-mx-8 md:px-8">
        {PROJECT_STATUSES.map((status) => (
          <Column key={status} status={status} count={items.filter((p) => p.status === status).length} canEdit={canEdit}>
            {items
              .filter((p) => p.status === status)
              .map((project) => (
                <DraggableCard
                  key={project.id}
                  project={project}
                  owner={member(project.ownerId)}
                  targetCents={targetCents}
                  dragging={project.id === activeId}
                  disabled={!canEdit}
                  onOpen={() => open(project.id)}
                  onMove={(direction) => moveBy(project, direction)}
                />
              ))}
          </Column>
        ))}
      </div>
      <DragOverlay>{active ? <ProjectCard project={active} owner={member(active.ownerId)} targetCents={targetCents} overlay /> : null}</DragOverlay>
    </DndContext>
  );
}

function Column({ status, count, canEdit, children }: { status: ProjectStatus; count: number; canEdit: boolean; children: ReactNode }) {
  const t = useTranslations("projects.board");
  const tStatus = useTranslations("projects.status");
  const { setNodeRef, isOver } = useDroppable({ id: status, disabled: !canEdit });
  return (
    <section
      ref={setNodeRef}
      aria-label={tStatus(status)}
      className={cn(
        "flex w-72 shrink-0 flex-col rounded-2xl border bg-muted/30 transition-colors",
        isOver && "border-primary/60 bg-primary/5",
        (status === "done" || status === "cancelled") && "bg-muted/15",
      )}
    >
      <header className="flex items-center justify-between gap-2 border-b px-3 py-2.5">
        <h3 className="flex items-center gap-2 text-sm font-bold">
          <span className={cn("size-2 rounded-full", PROJECT_STATUS_DOTS[status])} />
          {tStatus(status)}
        </h3>
        <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold tabular">{count}</span>
      </header>
      <div className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto p-2">
        {children}
        {count === 0 && <p className="m-auto py-6 text-xs text-muted-foreground/70">{t("empty")}</p>}
      </div>
    </section>
  );
}

function DraggableCard({
  project,
  owner,
  targetCents,
  dragging,
  disabled,
  onOpen,
  onMove,
}: {
  project: ProjectListItem;
  owner: MemberRef | undefined;
  targetCents: number;
  dragging: boolean;
  disabled: boolean;
  onOpen: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const { setNodeRef, attributes, listeners } = useDraggable({ id: project.id, disabled });
  return (
    <ProjectCard
      ref={setNodeRef}
      project={project}
      owner={owner}
      targetCents={targetCents}
      dragging={dragging}
      onOpen={onOpen}
      onMove={onMove}
      {...attributes}
      {...listeners}
    />
  );
}

type CardProps = {
  project: ProjectListItem;
  owner: MemberRef | undefined;
  targetCents: number;
  dragging?: boolean;
  overlay?: boolean;
  ref?: Ref<HTMLDivElement>;
  onOpen?: () => void;
  onMove?: (direction: -1 | 1) => void;
} & HTMLAttributes<HTMLDivElement>;

function ProjectCard({ project, owner, targetCents, dragging, overlay, ref, onOpen, onMove, className, onKeyDown: dragKeyDown, ...rest }: CardProps) {
  const t = useTranslations("projects.board");
  const tList = useTranslations("projects.list");
  const fmt = useProjectFormat();

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      onOpen?.();
    } else if (e.shiftKey && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
      e.preventDefault();
      onMove?.(e.key === "ArrowRight" ? 1 : -1);
    } else {
      dragKeyDown?.(e);
    }
  }

  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      aria-label={t("open", { name: project.name })}
      title={t("moveHint")}
      onClick={onOpen}
      className={cn(
        "cursor-pointer rounded-xl border bg-card p-3 text-left shadow-sm outline-none transition",
        "hover:border-primary/40 focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/40",
        dragging && "opacity-40",
        overlay && "rotate-1 border-primary/60 shadow-2xl",
        className,
      )}
      {...rest}
      onKeyDown={onKeyDown}
    >
      <p className="flex items-start gap-1.5 text-sm leading-snug font-semibold">
        <KindIcon kind={project.kind} className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <span className="line-clamp-2">{project.name}</span>
      </p>
      <p className="mt-0.5 truncate pl-5 text-xs text-muted-foreground">{project.clientName ?? tList("internal")}</p>
      {project.progress.ratio !== null && (
        <Bar ratio={project.progress.ratio} tone={project.progress.ratio >= 1 ? "bg-success" : "bg-primary"} className="mt-2.5" />
      )}
      <div className="mt-2.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className={cn("flex items-center gap-1 tabular", project.overdue && "font-semibold text-destructive")}>
          {project.dueOn && (
            <>
              <CalendarClock className="size-3.5" />
              {fmt.date(project.dueOn, "short")}
            </>
          )}
        </span>
        <span className="tabular">
          {fmt.hours(project.loggedMinutes)}
          {project.budgetMinutes !== null && <span className="text-muted-foreground/70"> / {fmt.hours(project.budgetMinutes)}</span>}
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between">
        {project.contractId ? (
          <RateValue rateCents={project.rateCents} standing={project.standing} targetCents={targetCents} shared={project.sharedContract} className="text-xs" />
        ) : (
          <span />
        )}
        <MemberAvatar member={owner} size="xs" tooltip={!overlay} />
      </div>
    </div>
  );
}
