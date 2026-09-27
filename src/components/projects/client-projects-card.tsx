"use client";

import { FolderKanban, Plus } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { SettingsCard } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ProjectStatusBadge, RateValue } from "./badges";
import { newProjectHref } from "./create-project-button";
import { useProjectFormat } from "./format";
import { MemberAvatar, memberLookup } from "./member-avatar";
import { BurnMeter, ProgressMeter } from "./meters";
import type { ClientProjectsData } from "./types";

type Props = {
  slug: string;
  /** `/{slug}`: prefijo de las rutas de la org. */
  basePath: string;
  clientId: string;
  /** De `getClientProjects(org, clientId, memberId)` (src/server/projects/cards.ts). */
  data: ClientProjectsData;
  /** Socio u owner (y cliente sin archivar): puede crear proyectos. */
  canEdit: boolean;
};

/**
 * Proyectos del cliente en su ficha 360: estado, avance, horas y €/h de cada uno, y la tarifa
 * efectiva del cliente (lo facturado de sus contratos entre todas las horas de sus proyectos).
 */
export function ClientProjectsCard({ slug, basePath, clientId, data, canEdit }: Props) {
  const t = useTranslations("projects.client");
  const fmt = useProjectFormat();
  const member = memberLookup(data.members);
  const live = data.projects.filter((p) => !p.archived && (p.status === "active" || p.status === "planned" || p.status === "paused")).length;
  const newHref = newProjectHref(slug, { clientId });

  const summary =
    data.projects.length === 0
      ? undefined
      : [t("live", { count: live }), data.totals.minutes > 0 ? t("hours", { hours: fmt.hours(data.totals.minutes) }) : null].filter(Boolean).join(" · ");

  return (
    <SettingsCard
      title={t("title")}
      description={summary}
      actions={
        <div className="flex items-center gap-3">
          {data.totals.rateCents !== null && (
            <span className="text-xs text-muted-foreground">
              {t("rate")}{" "}
              <RateValue rateCents={data.totals.rateCents} standing={data.totals.standing} targetCents={data.targetCents} className="text-sm" />
            </span>
          )}
          {canEdit && (
            <Button asChild variant="outline" size="sm">
              <Link href={newHref}>
                <Plus data-icon="inline-start" />
                {t("new")}
              </Link>
            </Button>
          )}
        </div>
      }
      bodyClassName={data.projects.length > 0 ? "p-0" : undefined}
    >
      {data.projects.length === 0 ? (
        <div className="text-center">
          <FolderKanban className="mx-auto size-5 text-muted-foreground" />
          <p className="mt-2 text-muted-foreground">{t("empty")}</p>
          {canEdit && (
            <Button asChild variant="secondary" size="sm" className="mt-3">
              <Link href={newHref}>
                <Plus data-icon="inline-start" />
                {t("new")}
              </Link>
            </Button>
          )}
        </div>
      ) : (
        <ul className="divide-y">
          {data.projects.map((project) => {
            const muted = project.archived || project.status === "done" || project.status === "cancelled";
            return (
              <li key={project.id}>
                <Link
                  href={`${basePath}/projects/${project.id}`}
                  className="group grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-5 py-3 transition-colors outline-none hover:bg-muted/40 focus-visible:bg-muted/40 sm:grid-cols-[1fr_7rem_6.5rem_4.5rem_1.5rem]"
                >
                  <div className="min-w-0">
                    <p className={cn("truncate font-semibold group-hover:text-primary", muted && "text-muted-foreground")}>{project.name}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <ProjectStatusBadge status={project.status} />
                      {project.dueOn && (
                        <span className={cn("tabular", project.overdue && "font-semibold text-destructive")}>
                          {t("due", { date: fmt.date(project.dueOn, "short") })}
                        </span>
                      )}
                    </div>
                  </div>
                  <ProgressMeter progress={project.progress} className="hidden sm:flex" />
                  <BurnMeter loggedMinutes={project.loggedMinutes} budgetMinutes={project.budgetMinutes} burn={project.burn} className="hidden sm:block" />
                  <div className="text-right text-sm">
                    {project.contractId ? (
                      <RateValue rateCents={project.rateCents} standing={project.standing} targetCents={data.targetCents} shared={project.sharedContract} />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </div>
                  <MemberAvatar member={member(project.ownerId)} size="xs" className="hidden sm:flex" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </SettingsCard>
  );
}
