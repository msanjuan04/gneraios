import { Check, Compass } from "lucide-react";
import type { SpaceData, SpaceProject, SpaceWorkProject, SpaceWorkTask } from "@/components/portal/types";
import type { PortalLocale } from "@/domain/portal";
import { progressPercent, type ProjectStatus } from "@/domain/projects";
import { cn } from "@/lib/utils";
import { portalCopy } from "@/server/portal/copy";
import { Chip, civil, EmptyState, Eyebrow, SectionCard } from "../ui";
import { SPACE_SECTION_ICONS } from "./icons";

const STATUS_TONES: Record<ProjectStatus, "primary" | "success" | "warning" | "neutral"> = {
  active: "primary",
  planned: "neutral",
  paused: "warning",
  done: "success",
  cancelled: "neutral",
};

const TASK_DOTS: Record<SpaceWorkTask["status"], string> = {
  doing: "bg-primary",
  review: "bg-warning",
  todo: "bg-border",
};

function ProgressBar({ percent, label, valueText }: { percent: number; label: string; valueText?: string }) {
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={valueText}
      aria-label={label}
      className="mt-3 h-2 overflow-hidden rounded-full bg-muted"
    >
      <div className="h-full rounded-full bg-brand-gradient transition-[width]" style={{ width: `${Math.max(percent, 3)}%` }} />
    </div>
  );
}

/** Un proyecto visible: su estado, el avance de sus tareas visibles, la próxima fecha y lo siguiente. */
function WorkProject({ project, locale }: { project: SpaceWorkProject; locale: PortalLocale }) {
  const t = portalCopy(locale);
  const percent = progressPercent(project.progress);
  const tasks = project.progress.total > 0 ? t("space.sections.progress.tasks", { done: project.progress.done, total: project.progress.total }) : null;
  const meta = [tasks, project.nextDueOn ? t("space.sections.progress.nextDue", { date: civil(project.nextDueOn, locale, "medium") }) : null].filter(Boolean);
  return (
    <article className="rounded-2xl border bg-background/50 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Eyebrow>{t(`space.sections.progress.kinds.${project.kind}`)}</Eyebrow>
          <h3 className="mt-1 font-bold leading-snug">{project.name}</h3>
        </div>
        <Chip tone={STATUS_TONES[project.status]} className="mt-0.5 shrink-0">
          {t(`space.sections.progress.statuses.${project.status}`)}
        </Chip>
      </div>
      {percent !== null && <ProgressBar percent={percent} label={project.name} valueText={tasks ?? undefined} />}
      {meta.length > 0 && <p className="mt-2 text-sm text-muted-foreground tabular">{meta.join(" · ")}</p>}

      {project.nextTasks.length > 0 && (
        <div className="mt-4">
          <Eyebrow>{t("space.sections.progress.nextTasks")}</Eyebrow>
          <ul className="mt-2 divide-y divide-border rounded-xl border">
            {project.nextTasks.map((task) => (
              <li key={task.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                <span className="flex min-w-0 items-start gap-2.5">
                  <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", TASK_DOTS[task.status])} />
                  <span className="min-w-0 text-sm leading-snug font-medium break-words">{task.title}</span>
                </span>
                <span className={cn("shrink-0 text-xs font-semibold text-muted-foreground", task.status === "doing" && "text-primary")}>
                  {t(`space.sections.progress.taskStates.${task.status}`)}
                </span>
              </li>
            ))}
          </ul>
          {project.moreOpen > 0 && <p className="mt-2 text-xs text-muted-foreground">{t("space.sections.progress.moreTasks", { count: project.moreOpen })}</p>}
        </div>
      )}
    </article>
  );
}

/** Un proyecto por fases: los hitos de su contrato. */
function PhasedProject({ project, locale }: { project: SpaceProject; locale: PortalLocale }) {
  const t = portalCopy(locale);
  const percent = Math.round(project.progress.ratio * 100);
  return (
    <article className="rounded-2xl border bg-background/50 p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-bold">{project.title}</h3>
        <p className="text-sm text-muted-foreground tabular">
          {t("space.sections.progress.progress", { done: project.progress.done, total: project.progress.total })}
        </p>
      </div>
      <ProgressBar percent={percent} label={project.title} />

      <ol className="mt-5 space-y-0">
        {project.phases.map((phase, index) => {
          const last = index === project.phases.length - 1;
          return (
            <li key={phase.id} className="relative flex gap-4 pb-5 last:pb-0">
              {!last && (
                <span
                  aria-hidden
                  className={cn("absolute top-7 bottom-0 left-[13px] w-0.5 rounded-full", phase.state === "done" ? "bg-primary/50" : "bg-border")}
                />
              )}
              <span
                aria-hidden
                className={cn(
                  "relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border-2",
                  phase.state === "done" && "border-transparent bg-brand-gradient text-white",
                  phase.state === "current" && "portal-pulse border-primary bg-background",
                  phase.state === "upcoming" && "border-border bg-background",
                )}
              >
                {phase.state === "done" && <Check className="size-4" strokeWidth={3} />}
                {phase.state === "current" && <span className="size-2.5 rounded-full bg-primary" />}
              </span>
              <div className="min-w-0 pt-0.5">
                <p className={cn("font-semibold leading-snug", phase.state === "upcoming" && "text-muted-foreground")}>{phase.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  <span className={cn("font-semibold", phase.state === "current" && "text-primary", phase.state === "done" && "text-success")}>
                    {t(`space.sections.progress.${phase.state}`)}
                  </span>
                  {phase.state !== "done" && phase.plannedOn && <> · {t("space.sections.progress.plannedOn", { date: civil(phase.plannedOn, locale) })}</>}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </article>
  );
}

/**
 * «En qué estamos»: los próximos pasos que escribe el socio, los proyectos que ha hecho visibles
 * (con sus tareas visibles) y las fases de cada contrato (sus hitos). Sin promesas: lo que hay.
 */
export function ProgressSection({ data }: { data: SpaceData }) {
  const t = portalCopy(data.locale);
  const progress = data.progress;
  const empty = !progress || (progress.projects.length === 0 && progress.workProjects.length === 0 && !progress.nextSteps);
  return (
    <SectionCard id="progress" icon={SPACE_SECTION_ICONS.progress} title={t("space.sections.progress.title")} subtitle={t("space.sections.progress.subtitle")}>
      {empty ? (
        <EmptyState icon={Compass}>{t("space.sections.progress.empty")}</EmptyState>
      ) : (
        <div className="space-y-4">
          {progress.nextSteps && (
            <div className="relative overflow-hidden rounded-2xl border border-primary/25 bg-primary/8 p-4 sm:p-5">
              <p className="text-[11px] font-bold tracking-[0.14em] text-primary uppercase">{t("space.sections.progress.nextSteps")}</p>
              <p className="mt-2 whitespace-pre-line">{progress.nextSteps}</p>
            </div>
          )}
          {progress.workProjects.map((project) => (
            <WorkProject key={project.id} project={project} locale={data.locale} />
          ))}
          {progress.projects.map((project) => (
            <PhasedProject key={project.contractId} project={project} locale={data.locale} />
          ))}
        </div>
      )}
    </SectionCard>
  );
}
