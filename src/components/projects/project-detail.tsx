"use client";

import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  CalendarRange,
  Eye,
  EyeOff,
  FileSignature,
  LayoutTemplate,
  MoreHorizontal,
  Pencil,
  Play,
  Square,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useState, useTransition } from "react";
import { toast } from "sonner";
import { RecordPaymentButton } from "@/components/invoices/record-payment-sheet";
import { ReadOnlyNotice } from "@/components/settings/settings-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { daysLate, PROJECT_STATUSES, type ProjectStatus } from "@/domain/projects";
import { cn } from "@/lib/utils";
import { saveProjectAsTemplate, setProjectArchived, setProjectPortalVisible, setProjectStatus, startTimer, stopTimer } from "@/server/projects/actions";
import { KindChip, PROJECT_STATUS_DOTS, RateValue, STANDING_TEXT } from "./badges";
import { announceTimerChange, OptionSelect } from "./fields";
import { useProjectFormat } from "./format";
import { MemberAvatar, memberLookup } from "./member-avatar";
import { Bar } from "./meters";
import { ProjectSheet } from "./project-sheet";
import { DETAIL_TABS, type DetailTab } from "./constants";
import { SummaryTab } from "./summary-tab";
import { TaskBoard } from "./task-board";
import { TimeTab } from "./time-tab";
import { DeliverablesPanel } from "./deliverables-panel";
import type { ProjectDetailData, ProjectFormOptions, ProjectViewer } from "./types";

type Props = {
  data: ProjectDetailData;
  viewer: ProjectViewer;
  options: ProjectFormOptions;
  initial: { tab: DetailTab; taskId?: string };
};

type Pending = null | "archive" | "template";

/** Ficha de un proyecto: cabecera, cifras (avance, horas, facturado y €/h) y las pestañas. */
export function ProjectDetail({ data, viewer, options, initial }: Props) {
  const t = useTranslations("projects.detail");
  const tStatus = useTranslations("projects.status");
  const tCommon = useTranslations("common");
  const fmt = useProjectFormat();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [tab, setTab] = useState<DetailTab>(initial.tab);
  // La tarea de la URL (?task=…) se abre una sola vez: las pestañas se desmontan al cambiar.
  const [taskFromUrl, setTaskFromUrl] = useState(initial.taskId);
  const [editOpen, setEditOpen] = useState(false);
  const [confirm, setConfirm] = useState<Pending>(null);
  const [templateName, setTemplateName] = useState(data.project.name);
  const { project } = data;
  const member = memberLookup(data.members);
  const canEdit = viewer.canEdit && !project.archived;
  const myTimer = data.entries.find((e) => e.minutes === null && e.memberId === viewer.memberId);

  const changeTab = (value: string) => {
    const next = DETAIL_TABS.find((x) => x === value) ?? "tasks";
    setTab(next);
    setTaskFromUrl(undefined);
    const params = new URLSearchParams(window.location.search);
    if (next === "tasks") params.delete("tab");
    else params.set("tab", next);
    params.delete("task");
    const query = params.toString();
    window.history.replaceState(null, "", `${pathname}${query ? `?${query}` : ""}`);
  };

  const run = (action: () => Promise<{ ok: true } | { ok: false; error: string }>, success?: string, after?: () => void) =>
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (success) toast.success(success);
      after?.();
    });

  const changeStatus = (status: string) =>
    run(() => setProjectStatus(viewer.slug, { project_id: project.id, status }), t("statusChanged", { status: tStatus(status as ProjectStatus) }));

  const togglePortal = (visible: boolean) =>
    run(() => setProjectPortalVisible(viewer.slug, project.id, visible), visible ? t("portalShown") : t("portalHidden"));

  const toggleTimer = () =>
    run(
      () => (myTimer ? stopTimer(viewer.slug) : startTimer(viewer.slug, project.id)),
      myTimer ? t("timerStopped") : t("timerStarted"),
      announceTimerChange,
    );

  const archive = () =>
    run(() => setProjectArchived(viewer.slug, project.id, !project.archived), project.archived ? t("unarchived") : t("archived"), () => setConfirm(null));

  const saveTemplate = () =>
    run(() => saveProjectAsTemplate(viewer.slug, project.id, templateName), t("templateSaved"), () => {
      setConfirm(null);
      router.push(`${viewer.basePath}/projects/templates`);
    });

  const late = project.overdue ? daysLate(project.dueOn, viewer.today) : 0;

  return (
    <div>
      <Link
        href={`${viewer.basePath}/projects`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {t("back")}
      </Link>

      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <KindChip kind={project.kind} />
            {project.archived && (
              <Badge variant="outline" className="text-muted-foreground">
                {t("archivedBadge")}
              </Badge>
            )}
            {project.overdue && <Badge className="bg-destructive/15 text-destructive">{t("overdue", { days: late })}</Badge>}
          </div>
          <h2 className="text-3xl font-extrabold break-words heading-tight md:text-4xl">{project.name}</h2>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
            {project.clientId ? (
              <Link href={`${viewer.basePath}/clients/${project.clientId}`} className="font-semibold text-foreground hover:text-primary">
                {project.clientName}
              </Link>
            ) : (
              <span>{t("internal")}</span>
            )}
            {project.contractId ? (
              <Link
                href={`${viewer.basePath}/contracts/${project.contractId}`}
                className="inline-flex items-center gap-1.5 hover:text-primary"
              >
                <FileSignature className="size-3.5" />
                {project.contractTitle}
              </Link>
            ) : (
              project.clientId && <span className="text-muted-foreground/70">{t("noContract")}</span>
            )}
            {(project.startsOn || project.dueOn) && (
              <span className="inline-flex items-center gap-1.5 tabular">
                <CalendarRange className="size-3.5" />
                {project.startsOn ? fmt.date(project.startsOn) : "…"}
                {" → "}
                <span className={cn(project.overdue && "font-semibold text-destructive")}>{project.dueOn ? fmt.date(project.dueOn) : "…"}</span>
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <MemberAvatar member={member(project.ownerId)} size="xs" />
              {member(project.ownerId)?.fullName ?? t("noOwner")}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {viewer.canEdit ? (
            <OptionSelect
              size="sm"
              ariaLabel={t("status")}
              value={project.status}
              onChange={changeStatus}
              disabled={pending || project.archived}
              className="w-36"
              options={PROJECT_STATUSES.map((s) => ({
                value: s,
                label: (
                  <span className="flex items-center gap-2">
                    <span className={cn("size-2 rounded-full", PROJECT_STATUS_DOTS[s])} />
                    {tStatus(s)}
                  </span>
                ),
              }))}
            />
          ) : (
            <Badge variant="outline" className="h-7 gap-2 px-3">
              <span className={cn("size-2 rounded-full", PROJECT_STATUS_DOTS[project.status])} />
              {tStatus(project.status)}
            </Badge>
          )}
          {canEdit && (
            <Button variant={myTimer ? "secondary" : "outline"} size="sm" onClick={toggleTimer} disabled={pending}>
              {myTimer ? <Square data-icon="inline-start" className="fill-current text-destructive" /> : <Play data-icon="inline-start" />}
              {myTimer ? t("stopTimer") : t("startTimer")}
            </Button>
          )}
          {viewer.canEdit && project.clientId && (
            // Cobrar desde el proyecto: las facturas pendientes de su cliente, con las de su contrato marcadas.
            <RecordPaymentButton
              slug={viewer.slug}
              clientId={project.clientId}
              clientName={project.clientName ?? ""}
              projectId={project.id}
              contractId={project.contractId}
            />
          )}
          {canEdit && (
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil data-icon="inline-start" />
              {t("edit")}
            </Button>
          )}
          {viewer.canEdit && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={t("more")}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {!project.archived && (
                  <DropdownMenuItem onSelect={() => setConfirm("template")}>
                    <LayoutTemplate />
                    {t("saveAsTemplate")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => (project.archived ? archive() : setConfirm("archive"))}>
                  {project.archived ? <ArchiveRestore /> : <Archive />}
                  {project.archived ? t("unarchive") : t("archive")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </header>

      {!viewer.canEdit && <ReadOnlyNotice className="-mt-3 mb-5">{t("readOnly")}</ReadOnlyNotice>}

      {confirm && (
        // Confirmación en línea: nunca un modal encima de otro.
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
          {confirm === "archive" ? (
            <p className="mr-auto">{t("archiveConfirm")}</p>
          ) : (
            <label className="mr-auto flex min-w-0 flex-1 items-center gap-3">
              <span className="shrink-0 font-semibold">{t("templateName")}</span>
              <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} maxLength={120} className="max-w-sm" autoFocus />
            </label>
          )}
          <Button variant="ghost" size="sm" onClick={() => setConfirm(null)} disabled={pending}>
            {tCommon("cancel")}
          </Button>
          {confirm === "archive" ? (
            <Button variant="destructive" size="sm" onClick={archive} disabled={pending}>
              {t("archive")}
            </Button>
          ) : (
            <Button size="sm" onClick={saveTemplate} disabled={pending || !templateName.trim()}>
              {t("saveTemplate")}
            </Button>
          )}
        </div>
      )}

      <Kpis data={data} />

      {project.clientId && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border bg-card/60 px-4 py-2.5 text-sm">
          {project.portalVisible ? <Eye className="size-4 text-primary" /> : <EyeOff className="size-4 text-muted-foreground" />}
          <span className="font-semibold">{project.portalVisible ? t("portalOn") : t("portalOff")}</span>
          <span className="text-xs text-muted-foreground">
            {project.portalVisible ? t("portalOnHint", { count: data.tasks.filter((x) => x.clientVisible).length }) : t("portalOffHint")}
          </span>
          {canEdit && (
            <Switch
              className="ml-auto"
              checked={project.portalVisible}
              onCheckedChange={togglePortal}
              disabled={pending}
              aria-label={t("portalToggle")}
            />
          )}
        </div>
      )}

      <Tabs value={tab} onValueChange={changeTab} className="mt-6 gap-4">
        <TabsList className="w-fit">
          <TabsTrigger value="tasks" className="px-3">
            {t("tabs.tasks")}
            <span className="text-xs text-muted-foreground tabular">{data.tasks.length}</span>
          </TabsTrigger>
          <TabsTrigger value="deliveries" className="px-3">
            {t("tabs.deliveries")}
            <span className="text-xs text-muted-foreground tabular">{data.deliverables.length}</span>
          </TabsTrigger>
          <TabsTrigger value="time" className="px-3">
            {t("tabs.time")}
            <span className="text-xs text-muted-foreground tabular">{fmt.hours(project.loggedMinutes)}</span>
          </TabsTrigger>
          <TabsTrigger value="summary" className="px-3">
            {t("tabs.summary")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="tasks">
          <TaskBoard
            slug={viewer.slug}
            projectId={project.id}
            tasks={data.tasks}
            members={data.members}
            today={viewer.today}
            canEdit={canEdit}
            portalVisible={project.portalVisible}
            active={tab === "tasks"}
            initialTaskId={taskFromUrl}
            onSheetClosed={() => setTaskFromUrl(undefined)}
          />
        </TabsContent>
        <TabsContent value="time">
          <TimeTab data={data} viewer={viewer} canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="deliveries">
          <DeliverablesPanel
            projectId={project.id}
            clientId={project.clientId}
            deliverables={data.deliverables}
            files={data.deliveryFiles}
            members={data.members}
            viewer={viewer}
            canEdit={canEdit}
          />
        </TabsContent>
        <TabsContent value="summary">
          <SummaryTab data={data} />
        </TabsContent>
      </Tabs>

      {canEdit && (
        <ProjectSheet
          slug={viewer.slug}
          open={editOpen}
          onOpenChange={setEditOpen}
          options={options}
          project={project}
          currentMemberId={viewer.memberId}
          today={viewer.today}
        />
      )}
    </div>
  );
}

function Kpi({ label, children, footer, className }: { label: string; children: ReactNode; footer?: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-2xl border bg-card p-4", className)}>
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <div className="mt-1.5 text-2xl font-extrabold tracking-[-0.035em] tabular">{children}</div>
      {footer && <div className="mt-2 text-xs text-muted-foreground">{footer}</div>}
    </div>
  );
}

/** Avance, horas frente al presupuesto, lo facturado y la tarifa efectiva frente al objetivo. */
function Kpis({ data }: { data: ProjectDetailData }) {
  const t = useTranslations("projects.kpi");
  const fmt = useProjectFormat();
  const { project, targetCents } = data;
  const burnTone = project.burn.state === "over" ? "bg-destructive" : project.burn.state === "warning" ? "bg-warning" : "bg-primary";

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Kpi
        label={t("progress")}
        footer={
          project.progress.ratio === null ? t("noTasks") : t("progressValue", { done: project.progress.done, total: project.progress.total })
        }
      >
        {project.progress.ratio === null ? "—" : fmt.percent(project.progress.ratio)}
        {project.progress.ratio !== null && <Bar ratio={project.progress.ratio} className="mt-2" tone={project.progress.ratio >= 1 ? "bg-success" : "bg-primary"} />}
      </Kpi>

      <Kpi
        label={t("hours")}
        footer={
          project.budgetMinutes === null
            ? t("noBudget")
            : project.burn.remainingMinutes !== null && project.burn.remainingMinutes >= 0
              ? t("remaining", { time: fmt.duration(project.burn.remainingMinutes), budget: fmt.hours(project.budgetMinutes) })
              : t("over", { time: fmt.duration(-(project.burn.remainingMinutes ?? 0)), budget: fmt.hours(project.budgetMinutes) })
        }
      >
        <span className={cn(project.burn.state === "over" && "text-destructive")}>{fmt.hours(project.loggedMinutes)}</span>
        {project.burn.ratio !== null && <Bar ratio={project.burn.ratio} className="mt-2" tone={burnTone} />}
      </Kpi>

      <Kpi
        label={t("revenue")}
        footer={
          project.revenueCents === null
            ? t("noContract")
            : project.sharedContract
              ? t("shared", { total: fmt.money(project.contractRevenueCents), count: project.contractProjects - 1 })
              : t("revenueHint")
        }
      >
        {project.revenueCents === null ? "—" : fmt.money(project.revenueCents)}
      </Kpi>

      <Kpi
        label={t("rate")}
        footer={
          <span>
            {t("target", { rate: fmt.rate(targetCents) })}
            {project.rateCents !== null && <span className={cn("ml-1 font-semibold", STANDING_TEXT[project.standing])}>· {t(`standing.${project.standing}`)}</span>}
          </span>
        }
      >
        {project.rateCents === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <RateValue rateCents={project.rateCents} standing={project.standing} targetCents={targetCents} shared={project.sharedContract} />
        )}
      </Kpi>
    </div>
  );
}
