import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { BoardDeal } from "@/components/crm/board-types";
import { PipelineBoard } from "@/components/crm/pipeline-board";
import { daysBetween } from "@/domain/dates/civil-date";
import { nowInZone } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { getCrmConfig } from "@/server/crm/config";
import { getOrgContext, hasRole } from "@/server/session";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("pipeline"))("title") };
}

const param = (value: string | string[] | undefined) => (typeof value === "string" && value ? value : undefined);

export default async function PipelinePage(props: PageProps<"/[org]/pipeline">) {
  const [{ org: slug }, searchParams] = await Promise.all([props.params, props.searchParams]);
  const { org, member } = await getOrgContext(slug);
  const config = await getCrmConfig(org.id);
  const supabase = await createClient();

  const [deals, clients] = await Promise.all([
    supabase.from("deals_board").select("*").eq("org_id", org.id),
    supabase.from("clients").select("id, display_name").eq("org_id", org.id).is("archived_at", null).order("display_name"),
  ]);
  if (deals.error) throw deals.error;
  if (clients.error) throw clients.error;

  // Los días y los vencimientos se cuentan en fechas civiles de la zona de la org.
  const today = nowInZone(org.timezone).date;
  const boardDeals: BoardDeal[] = (deals.data ?? []).flatMap((d) => {
    if (!d.id || !d.stage_id || !d.client_id) return [];
    const entered = d.stage_entered_at ? nowInZone(org.timezone, new Date(d.stage_entered_at)).date : today;
    return [
      {
        id: d.id,
        title: d.title ?? "",
        clientId: d.client_id,
        clientName: d.client_name ?? "",
        stageId: d.stage_id,
        estOneOffCents: d.est_one_off_cents ?? 0,
        estMrrCents: d.est_mrr_cents ?? 0,
        probabilityBps: d.probability_bps ?? 0,
        probabilityOverrideBps: d.probability_override_bps,
        sourceId: d.source_id,
        broughtById: d.brought_by_member_id,
        ownerId: d.owner_member_id,
        ownerInitials: d.owner_initials,
        nextAction: d.next_action,
        nextActionOn: d.next_action_on,
        nextActionOverdue: d.next_action_on !== null && daysBetween(d.next_action_on, today) > 0,
        daysInStage: Math.max(0, daysBetween(entered, today)),
        lossReasonId: d.loss_reason_id,
        lossNote: d.loss_note,
      },
    ];
  });

  // Dentro de cada etapa: primero lo que tiene próxima acción más cercana.
  boardDeals.sort(
    (a, b) =>
      (a.nextActionOn ?? "9999").localeCompare(b.nextActionOn ?? "9999") || b.daysInStage - a.daysInStage,
  );

  return (
    <PipelineBoard
      slug={org.slug}
      stages={config.stages}
      deals={boardDeals}
      clients={(clients.data ?? []).map((c) => ({ id: c.id, name: c.display_name }))}
      sources={config.sources}
      lossReasons={config.lossReasons}
      members={config.members}
      currentMemberId={member.id}
      canEdit={hasRole(member.role, "partner")}
      initial={{
        newDeal: param(searchParams.new) === "1",
        clientId: param(searchParams.client),
        dealId: param(searchParams.deal),
      }}
    />
  );
}
