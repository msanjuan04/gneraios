"use client";

import { Eye, Timer } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { MouseEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { KindChip, ProjectStatusBadge, RateValue } from "./badges";
import { useProjectFormat } from "./format";
import { MemberAvatar, memberLookup } from "./member-avatar";
import { BurnMeter, ProgressMeter } from "./meters";
import type { MemberRef, ProjectListItem } from "./types";

function closest(target: EventTarget | null, selector: string): boolean {
  return target instanceof Element && target.closest(selector) !== null;
}

/**
 * Filas del listado: nombre y tipo, cliente, avance, entrega (en rojo si va con retraso), horas
 * frente al presupuesto, €/h efectivo frente al objetivo y responsable.
 */
export function ProjectsTable({
  basePath,
  projects,
  members,
  targetCents,
  activeId,
  onHover,
}: {
  basePath: string;
  projects: ProjectListItem[];
  members: MemberRef[];
  targetCents: number;
  activeId: string | null;
  onHover: (id: string) => void;
}) {
  const t = useTranslations("projects.list");
  const fmt = useProjectFormat();
  const router = useRouter();
  const member = memberLookup(members);
  const href = (id: string) => `${basePath}/projects/${id}`;

  const onRowClick = (event: MouseEvent<HTMLTableRowElement>, id: string) => {
    if (closest(event.target, "a, button")) return;
    if (event.metaKey || event.ctrlKey) window.open(href(id), "_blank", "noopener");
    else router.push(href(id));
  };

  const head = "text-xs text-muted-foreground";
  return (
    <div className="overflow-hidden rounded-2xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={cn(head, "pl-5")}>{t("columns.project")}</TableHead>
            <TableHead className={cn(head, "hidden md:table-cell")}>{t("columns.client")}</TableHead>
            <TableHead className={cn(head, "hidden lg:table-cell")}>{t("columns.progress")}</TableHead>
            <TableHead className={cn(head, "hidden sm:table-cell")}>{t("columns.due")}</TableHead>
            <TableHead className={cn(head, "text-right")}>{t("columns.hours")}</TableHead>
            <TableHead className={cn(head, "hidden text-right md:table-cell")}>{t("columns.rate")}</TableHead>
            <TableHead className={cn(head, "hidden pr-5 xl:table-cell")}>
              <span className="sr-only">{t("columns.owner")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {projects.map((project) => {
            const active = project.id === activeId;
            const muted = project.archived || project.status === "done" || project.status === "cancelled";
            return (
              <TableRow
                key={project.id}
                id={`project-row-${project.id}`}
                data-active={active}
                aria-selected={active}
                onClick={(e) => onRowClick(e, project.id)}
                onMouseMove={() => !active && onHover(project.id)}
                className={cn("group cursor-pointer hover:bg-transparent data-[active=true]:bg-muted/60", muted && "text-muted-foreground")}
              >
                <TableCell className="relative w-[46%] max-w-0 py-2.5 pl-5 md:w-[30%]">
                  <span
                    aria-hidden
                    className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary opacity-0 group-data-[active=true]:opacity-100"
                  />
                  <div className="flex min-w-0 items-center gap-2">
                    <Link
                      href={href(project.id)}
                      className="truncate font-semibold outline-none hover:text-primary focus-visible:text-primary focus-visible:underline"
                    >
                      {project.name}
                    </Link>
                    {project.runningTimers > 0 && (
                      <Timer className="size-3.5 shrink-0 animate-pulse text-primary" aria-label={t("timerRunning")} />
                    )}
                    {project.portalVisible && <Eye className="size-3.5 shrink-0 text-muted-foreground" aria-label={t("portalVisible")} />}
                  </div>
                  <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
                    <KindChip kind={project.kind} className="h-4 px-1.5 text-[10px]" />
                    {project.status !== "active" && <ProjectStatusBadge status={project.status} className="h-4 px-1.5 text-[10px]" />}
                    {project.archived && (
                      <Badge variant="outline" className="h-4 px-1.5 text-[10px] text-muted-foreground">
                        {t("archived")}
                      </Badge>
                    )}
                    <span className="truncate text-xs text-muted-foreground md:hidden">{project.clientName ?? t("internal")}</span>
                  </div>
                </TableCell>
                <TableCell className="hidden w-[18%] max-w-0 md:table-cell">
                  {project.clientId ? (
                    <Link href={`${basePath}/clients/${project.clientId}`} className="block truncate text-muted-foreground hover:text-primary">
                      {project.clientName}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">{t("internal")}</span>
                  )}
                </TableCell>
                <TableCell className="hidden w-[14%] lg:table-cell">
                  <ProgressMeter progress={project.progress} />
                </TableCell>
                <TableCell className="hidden text-xs sm:table-cell">
                  {project.dueOn ? (
                    <time
                      dateTime={project.dueOn}
                      className={cn("tabular", project.overdue ? "font-semibold text-destructive" : "text-muted-foreground")}
                      title={project.overdue ? t("overdue") : undefined}
                    >
                      {fmt.date(project.dueOn, "short")}
                    </time>
                  ) : (
                    <span className="text-muted-foreground/70">{t("noDue")}</span>
                  )}
                  {project.tasksOverdue > 0 && (
                    <p className="text-[11px] text-destructive">{t("tasksOverdue", { count: project.tasksOverdue })}</p>
                  )}
                </TableCell>
                <TableCell className="w-[14%]">
                  <BurnMeter loggedMinutes={project.loggedMinutes} budgetMinutes={project.budgetMinutes} burn={project.burn} />
                </TableCell>
                <TableCell className="hidden text-right md:table-cell">
                  {project.contractId ? (
                    <RateValue
                      rateCents={project.rateCents}
                      standing={project.standing}
                      targetCents={targetCents}
                      shared={project.sharedContract}
                      className="justify-end"
                    />
                  ) : project.clientId ? (
                    <span className="text-xs text-muted-foreground/70" title={t("noContractHint")}>
                      {t("noContract")}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/70">—</span>
                  )}
                </TableCell>
                <TableCell className="hidden pr-5 xl:table-cell">
                  <MemberAvatar member={member(project.ownerId)} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
