"use client";

import {
  Building2,
  ChevronDown,
  ChevronsUp,
  ChevronUp,
  Folder,
  Globe,
  type LucideIcon,
  Megaphone,
  MessagesSquare,
  Palette,
  Search,
  Wrench,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ProjectKind, ProjectStatus, RateStanding, TaskPriority, TaskStatus } from "@/domain/projects";
import { cn } from "@/lib/utils";
import { useProjectFormat } from "./format";

/** Estados de un proyecto (una decisión humana): en marcha en verde, en pausa en ámbar. */
export const PROJECT_STATUS_STYLES: Record<ProjectStatus, string> = {
  planned: "bg-primary/15 text-primary",
  active: "bg-success/15 text-success",
  paused: "bg-warning/15 text-warning",
  done: "bg-secondary text-secondary-foreground",
  cancelled: "border-border bg-transparent text-muted-foreground",
};

export const PROJECT_STATUS_DOTS: Record<ProjectStatus, string> = {
  planned: "bg-primary",
  active: "bg-success",
  paused: "bg-warning",
  done: "bg-muted-foreground",
  cancelled: "bg-muted-foreground/50",
};

export const TASK_STATUS_DOTS: Record<TaskStatus, string> = {
  todo: "bg-muted-foreground",
  doing: "bg-primary",
  review: "bg-warning",
  done: "bg-success",
};

export const STANDING_TEXT: Record<RateStanding, string> = {
  good: "text-success",
  warning: "text-warning",
  bad: "text-destructive",
  none: "text-muted-foreground",
};

const STANDING_DOT: Record<RateStanding, string> = {
  good: "bg-success",
  warning: "bg-warning",
  bad: "bg-destructive",
  none: "bg-muted-foreground/40",
};

const KIND_ICONS: Record<ProjectKind, LucideIcon> = {
  web: Globe,
  seo: Search,
  ads: Megaphone,
  branding: Palette,
  social: MessagesSquare,
  maintenance: Wrench,
  internal: Building2,
  other: Folder,
};

export function ProjectStatusBadge({ status, className }: { status: ProjectStatus; className?: string }) {
  const t = useTranslations("projects.status");
  return <Badge className={cn(PROJECT_STATUS_STYLES[status], className)}>{t(status)}</Badge>;
}

/** Tipo de proyecto en píldora, con su icono. */
export function KindChip({ kind, className }: { kind: ProjectKind; className?: string }) {
  const t = useTranslations("projects.kind");
  const Icon = KIND_ICONS[kind];
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-2 text-[11px] font-semibold text-muted-foreground",
        className,
      )}
    >
      <Icon className="size-3" aria-hidden />
      {t(kind)}
    </span>
  );
}

export function KindIcon({ kind, className }: { kind: ProjectKind; className?: string }) {
  const Icon = KIND_ICONS[kind];
  return <Icon className={className} aria-hidden />;
}

const PRIORITY_ICONS: Record<TaskPriority, { icon: LucideIcon; tone: string } | null> = {
  urgent: { icon: ChevronsUp, tone: "text-destructive" },
  high: { icon: ChevronUp, tone: "text-warning" },
  // "Normal" no se pinta: menos ruido en el tablero.
  normal: null,
  low: { icon: ChevronDown, tone: "text-muted-foreground" },
};

export function PriorityIcon({ priority, className }: { priority: TaskPriority; className?: string }) {
  const t = useTranslations("projects.priority");
  const spec = PRIORITY_ICONS[priority];
  if (!spec) return null;
  const Icon = spec.icon;
  return (
    <span className={cn("inline-flex", spec.tone, className)} title={t(priority)}>
      <Icon className="size-3.5" aria-hidden />
      <span className="sr-only">{t(priority)}</span>
    </span>
  );
}

/** Tarifa efectiva frente al objetivo: verde, ámbar o rojo, con el detalle al pasar el ratón. */
export function RateValue({
  rateCents,
  standing,
  targetCents,
  shared,
  className,
}: {
  rateCents: number | null;
  standing: RateStanding;
  targetCents: number;
  shared?: boolean;
  className?: string;
}) {
  const t = useTranslations("projects.rate");
  const fmt = useProjectFormat();
  if (rateCents === null) return <span className={cn("text-muted-foreground", className)}>—</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("inline-flex items-center gap-1.5 font-semibold tabular", STANDING_TEXT[standing], className)}>
          <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", STANDING_DOT[standing])} />
          {fmt.rate(rateCents)}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {t(`standing.${standing}`)} · {t("target", { rate: fmt.rate(targetCents) })}
        {shared ? ` · ${t("shared")}` : ""}
      </TooltipContent>
    </Tooltip>
  );
}
