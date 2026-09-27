import { CircleCheck, Mail, MessageSquare, NotebookPen, Phone, Sparkles, Users } from "lucide-react";
import type { SpaceActivityKind, SpaceData, SpaceWorkItem } from "@/components/portal/types";
import { cn } from "@/lib/utils";
import { portalCopy } from "@/server/portal/copy";
import { civil, EmptyState, SectionCard } from "../ui";
import { SPACE_SECTION_ICONS } from "./icons";

const KIND_ICONS: Record<SpaceActivityKind, typeof Phone> = { call: Phone, meeting: Users, email: Mail, note: NotebookPen };

const iconFor = (item: SpaceWorkItem) => (item.kind === "task" ? CircleCheck : (KIND_ICONS[item.kind] ?? MessageSquare));

/**
 * «Lo que hemos hecho»: las actividades que el socio marca como visibles (título, texto y día) y las
 * tareas visibles de sus proyectos que se han terminado hace poco (título y día), lo último primero.
 */
export function WorkLogSection({ data }: { data: SpaceData }) {
  const t = portalCopy(data.locale);
  const items = data.workLog ?? [];
  return (
    <SectionCard id="work_log" icon={SPACE_SECTION_ICONS.work_log} title={t("space.sections.work_log.title")} subtitle={t("space.sections.work_log.subtitle")}>
      {items.length === 0 ? (
        <EmptyState icon={Sparkles}>{t("space.sections.work_log.empty")}</EmptyState>
      ) : (
        <ol className="space-y-3">
          {items.map((item) => {
            const Icon = iconFor(item);
            return (
              <li key={`${item.kind}:${item.id}`} className="flex gap-4 rounded-2xl border bg-background/50 p-4">
                <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full bg-muted", item.kind === "task" ? "text-success" : "text-primary")}>
                  <Icon className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <h3 className="font-semibold leading-snug">{item.title}</h3>
                    <time dateTime={item.occurredOn} className="shrink-0 text-xs text-muted-foreground tabular">
                      {civil(item.occurredOn, data.locale, "medium")}
                    </time>
                  </div>
                  {item.kind === "task" && item.project && (
                    <p className="mt-1 text-xs text-muted-foreground">{t("space.sections.work_log.taskDone", { project: item.project })}</p>
                  )}
                  {item.body && <p className="mt-1.5 text-sm whitespace-pre-line text-muted-foreground">{item.body}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </SectionCard>
  );
}
