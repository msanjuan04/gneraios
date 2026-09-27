"use client";

import { ChevronRight, Eye, EyeOff, FolderKanban, FolderOpen, LayoutGrid, ListChecks, Mail, NotebookPen, Phone, Settings2, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FormField, ToggleField } from "@/components/settings/form-field";
import { SettingsCard } from "@/components/settings/settings-card";
import { SettingsSheet } from "@/components/settings/settings-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { PORTAL_SECTIONS, type PortalSectionKey } from "@/domain/portal";
import { cn } from "@/lib/utils";
import { createClientLink, savePortalSettings, setActivityVisible } from "@/server/portal/actions";
import { FilesManager } from "./files-manager";
import { LinkControl } from "./link-control";
import type { ClientPortalCardData, PortalActivityItem, PortalProjectItem } from "./types";

const KIND_ICONS: Record<PortalActivityItem["kind"], typeof Phone> = { call: Phone, meeting: Users, email: Mail, note: NotebookPen };

/** Proyectos que se listan en la tarjeta (los visibles van primero). */
const PROJECTS_SHOWN = 5;

/**
 * «Portal del cliente» en su ficha 360: el enlace de «Tu espacio GNERAI» (crear, copiar, revocar,
 * renovar, visitas) y el panel para decidir qué ve el cliente: secciones, próximos pasos,
 * entregables y qué actividades salen en «Lo que hemos hecho». De sus proyectos solo cuenta qué
 * ve y enlaza a cada uno: lo visible se decide en la ficha del proyecto, no aquí.
 *
 * Para montarlo: `getClientPortalCardData(org.id, client.id)` (src/server/portal/links.ts) en la
 * página del cliente y `<ClientPortalCard slug clientName data canEdit />` en la ficha.
 */
export function ClientPortalCard({
  slug,
  clientName,
  data,
  canEdit,
}: {
  slug: string;
  clientName: string;
  data: ClientPortalCardData;
  /** Socio u owner: gestiona el enlace y lo que se ve. */
  canEdit: boolean;
}) {
  const t = useTranslations("portal.card");
  const tSheet = useTranslations("portal.sheet");
  const [open, setOpen] = useState(false);
  const sectionsOn = PORTAL_SECTIONS.filter((key) => data.sections[key]).length;
  const visibleWork = data.activities.filter((a) => a.visible).length;
  const visibleProjects = data.projects.filter((p) => p.visible);
  const visibleTasks = visibleProjects.reduce((sum, p) => sum + p.visibleTasks, 0);

  return (
    <SettingsCard
      title={t("title")}
      description={t("description", { client: clientName })}
      actions={
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Settings2 data-icon="inline-start" />
          {t("configure")}
        </Button>
      }
      bodyClassName="space-y-4"
    >
      <LinkControl
        slug={slug}
        link={data.link}
        canAct={canEdit}
        blockedReason={data.archived ? t("archived") : null}
        renewable
        create={() => createClientLink(slug, data.clientId)}
      />
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="secondary">
          <LayoutGrid />
          {t("sectionsOn", { count: sectionsOn })}
        </Badge>
        <Badge variant="secondary">
          <FolderOpen />
          {t("files", { count: data.files.length })}
        </Badge>
        <Badge variant="secondary">
          <Eye />
          {t("visibleWork", { count: visibleWork })}
        </Badge>
        <Badge variant="secondary">
          <FolderKanban />
          {t("projects", { count: visibleProjects.length })}
        </Badge>
        {visibleProjects.length > 0 && (
          <Badge variant="secondary">
            <ListChecks />
            {t("visibleTasks", { count: visibleTasks })}
          </Badge>
        )}
      </div>
      <PortalProjects slug={slug} projects={data.projects} />
      <SettingsSheet open={open} onOpenChange={setOpen} title={tSheet("title", { client: clientName })}>
        <PortalSheetBody slug={slug} data={data} canEdit={canEdit} />
      </SettingsSheet>
    </SettingsCard>
  );
}

/** Qué ve el cliente de cada proyecto, con el enlace a su ficha (donde se cambia). */
function PortalProjects({ slug, projects }: { slug: string; projects: PortalProjectItem[] }) {
  const t = useTranslations("portal.card");
  if (projects.length === 0) return null;
  const shown = projects.slice(0, PROJECTS_SHOWN);
  const more = projects.length - shown.length;
  return (
    <div className="space-y-2">
      <ul className="divide-y overflow-hidden rounded-2xl border">
        {shown.map((project) => (
          <li key={project.id}>
            <Link
              href={`/${slug}/projects/${project.id}`}
              className="flex items-center gap-3 px-3 py-2.5 text-sm transition-colors outline-none hover:bg-muted/50 focus-visible:bg-muted/50"
            >
              {project.visible ? (
                <Eye className="size-4 shrink-0 text-success" aria-hidden />
              ) : (
                <EyeOff className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              )}
              <span className={cn("min-w-0 flex-1 truncate font-semibold", !project.visible && "text-muted-foreground")}>{project.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {project.visible ? t("projectTasks", { count: project.visibleTasks }) : t("projectHidden")}
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        {more > 0 && <>{t("projectsMore", { count: more })} </>}
        {t("projectsHint")}
      </p>
    </div>
  );
}

function PortalSheetBody({ slug, data, canEdit }: { slug: string; data: ClientPortalCardData; canEdit: boolean }) {
  const t = useTranslations("portal.sheet");
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
      <p className="mb-4 text-sm text-muted-foreground">{t("description")}</p>
      <Tabs defaultValue="sections">
        <TabsList className="w-full">
          <TabsTrigger value="sections">{t("tabs.sections")}</TabsTrigger>
          <TabsTrigger value="files">{t("tabs.files")}</TabsTrigger>
          <TabsTrigger value="work">{t("tabs.work")}</TabsTrigger>
        </TabsList>
        <TabsContent value="sections" className="pt-3">
          <SectionsForm slug={slug} data={data} canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="files" className="pt-3">
          <FilesManager slug={slug} clientId={data.clientId} files={data.files} contracts={data.contracts} canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="work" className="pt-3">
          <WorkVisibility slug={slug} clientId={data.clientId} activities={data.activities} canEdit={canEdit} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SectionsForm({ slug, data, canEdit }: { slug: string; data: ClientPortalCardData; canEdit: boolean }) {
  const t = useTranslations("portal.sheet");
  const tSections = useTranslations("portal.sections");
  const router = useRouter();
  const [sections, setSections] = useState<Record<PortalSectionKey, boolean>>(data.sections);
  const [nextSteps, setNextSteps] = useState(data.nextSteps);
  const [pending, startTransition] = useTransition();
  const dirty = nextSteps !== data.nextSteps || PORTAL_SECTIONS.some((key) => sections[key] !== data.sections[key]);

  const save = () =>
    startTransition(async () => {
      const result = await savePortalSettings(slug, data.clientId, { sections, nextSteps });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("saved"));
      router.refresh();
    });

  return (
    <div className="space-y-3">
      {PORTAL_SECTIONS.map((key) => (
        <ToggleField
          key={key}
          id={`portal-section-${key}`}
          label={tSections(`${key}.title`)}
          description={
            key === "web_data" && !data.hasWebData ? `${tSections(`${key}.description`)} ${t("webDataUnavailable")}` : tSections(`${key}.description`)
          }
          checked={sections[key]}
          onCheckedChange={(checked) => setSections((current) => ({ ...current, [key]: checked }))}
          disabled={!canEdit || pending}
        />
      ))}
      <FormField id="portal-next-steps" label={t("nextSteps")} description={t("nextStepsHint")} className="pt-2">
        <Textarea
          id="portal-next-steps"
          rows={4}
          maxLength={2000}
          value={nextSteps}
          disabled={!canEdit || pending}
          placeholder={t("nextStepsPlaceholder")}
          onChange={(e) => setNextSteps(e.target.value)}
        />
      </FormField>
      {canEdit && (
        <div className="flex justify-end pt-1">
          <Button type="button" onClick={save} disabled={!dirty || pending}>
            {t("save")}
          </Button>
        </div>
      )}
    </div>
  );
}

function WorkVisibility({ slug, clientId, activities, canEdit }: { slug: string; clientId: string; activities: PortalActivityItem[]; canEdit: boolean }) {
  const t = useTranslations("portal.sheet");
  const format = useFormatter();
  const router = useRouter();
  const [visible, setVisible] = useState<Record<string, boolean>>(() => Object.fromEntries(activities.map((a) => [a.id, a.visible])));
  const [, startTransition] = useTransition();

  const toggle = (id: string, next: boolean) => {
    setVisible((current) => ({ ...current, [id]: next }));
    startTransition(async () => {
      const result = await setActivityVisible(slug, clientId, id, next);
      if (!result.ok) {
        setVisible((current) => ({ ...current, [id]: !next }));
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t("workHint")}</p>
      {activities.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("workEmpty")}</p>
      ) : (
        <ul className="divide-y rounded-2xl border">
          {activities.map((activity) => {
            const Icon = KIND_ICONS[activity.kind] ?? NotebookPen;
            const on = visible[activity.id] ?? activity.visible;
            return (
              <li key={activity.id} className="flex items-center gap-3 p-3">
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className={cn("truncate text-sm font-semibold", !on && "text-muted-foreground")}>{activity.title}</p>
                  <p className="text-xs text-muted-foreground">{format.dateTime(new Date(activity.occurredAt), { dateStyle: "medium" })}</p>
                </div>
                {on ? <Eye className="size-4 text-success" aria-hidden /> : <EyeOff className="size-4 text-muted-foreground" aria-hidden />}
                <Switch
                  checked={on}
                  onCheckedChange={(next) => toggle(activity.id, next)}
                  disabled={!canEdit}
                  aria-label={`${t("visibleToggle")}: ${activity.title}`}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
