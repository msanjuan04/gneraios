import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { ReadOnlyNotice, SettingsCard } from "@/components/settings/settings-card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatBps } from "@/domain/money";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { getOrgContext, hasRole } from "@/server/session";
import { NameListCard } from "./name-list";
import { isOnlyOfKind, sortByPosition } from "./positions";
import { countStageDeals } from "./queries";
import type { StageItem, StageKind } from "./schema";
import { AddStageButton, StageRowActions } from "./stage-controls";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: `${t("tabs.pipeline")} · ${t("title")}` };
}

// Ganada y perdida con los colores de estado; abierta, neutra.
const KIND_BADGE: Record<StageKind, { variant: "outline" | "default"; className?: string }> = {
  open: { variant: "outline" },
  won: { variant: "default", className: "bg-success/15 text-success" },
  lost: { variant: "default", className: "bg-destructive/15 text-destructive" },
};

export default async function PipelineSettingsPage({ params }: PageProps<"/[org]/settings/pipeline">) {
  const { org: slug } = await params;
  const { org, member } = await getOrgContext(slug);
  const canEdit = hasRole(member.role, "owner");
  const t = await getTranslations("settings.pipeline");
  const tKind = await getTranslations("crm.stageKind");
  const tCommon = await getTranslations("common");
  const format = await getFormatter();
  const locale = await getLocale();
  const supabase = await createClient();

  const [stagesRes, sourcesRes, reasonsRes] = await Promise.all([
    supabase
      .from("pipeline_stages")
      .select("id, name, kind, position, created_at, default_probability_bps")
      .eq("org_id", org.id)
      .is("archived_at", null),
    supabase
      .from("acquisition_sources")
      .select("id, name, position, created_at")
      .eq("org_id", org.id)
      .is("archived_at", null),
    supabase.from("loss_reasons").select("id, name, position, created_at").eq("org_id", org.id).is("archived_at", null),
  ]);
  if (stagesRes.error) throw stagesRes.error;
  if (sourcesRes.error) throw sourcesRes.error;
  if (reasonsRes.error) throw reasonsRes.error;

  const stages = sortByPosition(stagesRes.data);
  const sources = sortByPosition(sourcesRes.data).map(({ id, name }) => ({ id, name }));
  const reasons = sortByPosition(reasonsRes.data).map(({ id, name }) => ({ id, name }));

  // Deals por etapa: los del tablero y todos (con alguno, aunque esté archivado, el tipo ya no cambia).
  const counts = await Promise.all(
    stages.map(async (stage) => {
      const [active, all] = await Promise.all([
        countStageDeals(supabase, org.id, stage.id, "active"),
        countStageDeals(supabase, org.id, stage.id, "all"),
      ]);
      if (active.error) throw active.error;
      if (all.error) throw all.error;
      return { active: active.count, total: all.count };
    }),
  );

  const items: StageItem[] = stages.map((stage, index) => ({
    id: stage.id,
    name: stage.name,
    kind: stage.kind,
    default_probability_bps: stage.default_probability_bps,
    activeDeals: counts[index].active,
    totalDeals: counts[index].total,
    onlyOfKind: isOnlyOfKind(stages, stage.id),
  }));

  const wonNames = stages.filter((stage) => stage.kind === "won").map((stage) => stage.name);
  const stagesDescription =
    wonNames.length > 0
      ? t("stages.description", { won: format.list(wonNames, { type: "conjunction" }) })
      : t("stages.descriptionNoWon");

  return (
    <div>
      {!canEdit && <ReadOnlyNotice className="mb-4">{tCommon("ownerOnly")}</ReadOnlyNotice>}
      <div className="space-y-6">
        <SettingsCard
          title={t("stages.title")}
          description={stagesDescription}
          actions={canEdit ? <AddStageButton slug={org.slug} /> : undefined}
          bodyClassName="px-2 py-1"
        >
          {items.length === 0 ? (
            <p className="px-3 py-8 text-center text-muted-foreground">{t("stages.empty")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-8">
                    <span className="sr-only">{t("stages.order")}</span>
                  </TableHead>
                  <TableHead className="text-xs text-muted-foreground">{t("stages.stage")}</TableHead>
                  <TableHead className="text-xs text-muted-foreground">{t("stages.kind")}</TableHead>
                  <TableHead className="text-right text-xs text-muted-foreground">{t("stages.probability")}</TableHead>
                  <TableHead className="text-right text-xs text-muted-foreground">{t("stages.deals")}</TableHead>
                  {canEdit && (
                    <TableHead className="w-0">
                      <span className="sr-only">{t("actions")}</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((stage, index) => (
                  <TableRow key={stage.id}>
                    <TableCell className="text-xs text-muted-foreground tabular">{index + 1}</TableCell>
                    <TableCell className="font-medium">{stage.name}</TableCell>
                    <TableCell>
                      <Badge variant={KIND_BADGE[stage.kind].variant} className={KIND_BADGE[stage.kind].className}>
                        {tKind(stage.kind)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular">
                      {formatBps(stage.default_probability_bps, locale)}
                    </TableCell>
                    <TableCell className={cn("text-right tabular", stage.activeDeals === 0 && "text-muted-foreground")}>
                      {stage.activeDeals}
                    </TableCell>
                    {canEdit && (
                      <TableCell>
                        <StageRowActions
                          slug={org.slug}
                          stage={stage}
                          isFirst={index === 0}
                          isLast={index === items.length - 1}
                        />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SettingsCard>

        <NameListCard slug={org.slug} list="sources" items={sources} canEdit={canEdit} />
        <NameListCard slug={org.slug} list="reasons" items={reasons} canEdit={canEdit} />
      </div>
    </div>
  );
}
