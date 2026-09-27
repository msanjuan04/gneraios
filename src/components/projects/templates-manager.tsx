"use client";

import { Eye, LayoutTemplate, Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useHotkeys } from "@/components/app-shell/use-hotkeys";
import { PageHeader } from "@/components/page-header";
import { ReadOnlyNotice } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { KindChip } from "./badges";
import { useProjectFormat } from "./format";
import { TemplateSheet } from "./template-sheet";
import type { TemplateItem } from "./types";

type SheetState = { open: false } | { open: true; template: TemplateItem | null };

/** Plantillas de proyecto: las tareas tipo de una web, un SEO mensual, una campaña… para arrancar en un clic. */
export function TemplatesManager({ slug, basePath, templates, canEdit }: { slug: string; basePath: string; templates: TemplateItem[]; canEdit: boolean }) {
  const t = useTranslations("projects.templates");
  const fmt = useProjectFormat();
  const [sheet, setSheet] = useState<SheetState>({ open: false });

  useHotkeys({
    c: (event) => {
      if (!canEdit || sheet.open) return;
      event.preventDefault();
      setSheet({ open: true, template: null });
    },
  });

  const newButton = canEdit ? (
    <Button onClick={() => setSheet({ open: true, template: null })}>
      <Plus data-icon="inline-start" />
      {t("new")}
      <Kbd className="ml-1 hidden bg-primary-foreground/15 text-primary-foreground sm:inline-flex">C</Kbd>
    </Button>
  ) : undefined;

  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} actions={newButton} />
      {!canEdit && <ReadOnlyNotice className="-mt-4 mb-6">{t("readOnly")}</ReadOnlyNotice>}

      {templates.length === 0 ? (
        <div className="rounded-3xl border bg-card/50 px-8 py-14 text-center md:py-16">
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-brand-gradient text-primary-foreground">
            <LayoutTemplate className="size-5" />
          </div>
          <h3 className="mt-5 text-2xl font-extrabold heading-tight">{t("emptyTitle")}</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{t("emptyBody")}</p>
          {canEdit && (
            <Button className="mt-6" onClick={() => setSheet({ open: true, template: null })}>
              <Plus data-icon="inline-start" />
              {t("new")}
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((template) => (
            <article key={template.id} className="flex flex-col rounded-2xl border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate font-bold">{template.name}</h3>
                  <p className="mt-1 text-xs text-muted-foreground tabular">
                    {t("tasksCount", { count: template.summary.tasks })}
                    {template.summary.estimateMinutes !== null && ` · ${t("estimate", { time: fmt.hours(template.summary.estimateMinutes) })}`}
                    {template.summary.spanDays !== null && ` · ${t("span", { days: template.summary.spanDays })}`}
                  </p>
                </div>
                <KindChip kind={template.kind} />
              </div>
              <ol className="mt-3 flex-1 space-y-1 text-sm">
                {template.tasks.slice(0, 6).map((task, i) => (
                  <li key={i} className="flex items-baseline gap-2">
                    <span className="w-8 shrink-0 text-right text-[11px] text-muted-foreground tabular">
                      {task.offset_days !== null && task.offset_days !== undefined ? `+${task.offset_days}` : ""}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{task.title}</span>
                    {task.client_visible && <Eye className="size-3 shrink-0 text-primary" aria-label={t("clientVisible")} />}
                  </li>
                ))}
                {template.tasks.length > 6 && <li className="pl-10 text-xs text-muted-foreground">{t("more", { count: template.tasks.length - 6 })}</li>}
              </ol>
              <div className="mt-4 flex items-center gap-2 border-t pt-3">
                {canEdit && (
                  <Button asChild size="sm" variant="secondary">
                    <Link href={`${basePath}/projects?new=1&template=${template.id}`}>{t("use")}</Link>
                  </Button>
                )}
                {canEdit && (
                  <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSheet({ open: true, template })}>
                    <Pencil data-icon="inline-start" />
                    {t("edit")}
                  </Button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {canEdit && (
        <TemplateSheet slug={slug} open={sheet.open} onOpenChange={(open) => !open && setSheet({ open: false })} template={sheet.open ? sheet.template : null} />
      )}
    </div>
  );
}
