import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { BoardColumn } from "@/components/crm/board-types";
import { PipelineBoard } from "@/components/crm/pipeline-board";
import { createClient } from "@/lib/supabase/server";
import { fetchBoard, fetchBoardDeal } from "@/server/crm/board";
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
  const dealId = param(searchParams.deal);

  // Cada columna trae solo su primera página; el resto se pide al pulsar «Ver más».
  const [columns, requested, clients] = await Promise.all([
    fetchBoard(org.id, config.stages.map((stage) => stage.id), org.timezone),
    dealId ? fetchBoardDeal(org.id, dealId, org.timezone) : Promise.resolve(null),
    supabase.from("clients").select("id, display_name").eq("org_id", org.id).is("archived_at", null).order("display_name"),
  ]);
  if (clients.error) throw clients.error;

  // El deal que piden por URL se enseña aunque no esté en la primera página de su columna.
  const boardColumns: BoardColumn[] = requested
    ? columns.map((column) =>
        column.stageId === requested.stageId && !column.deals.some((deal) => deal.id === requested.id)
          ? { ...column, deals: [...column.deals, requested] }
          : column,
      )
    : columns;

  return (
    <PipelineBoard
      slug={org.slug}
      stages={config.stages}
      columns={boardColumns}
      clients={(clients.data ?? []).map((c) => ({ id: c.id, name: c.display_name }))}
      sources={config.sources}
      lossReasons={config.lossReasons}
      members={config.members}
      currentMemberId={member.id}
      canEdit={hasRole(member.role, "partner")}
      initial={{
        newDeal: param(searchParams.new) === "1",
        clientId: param(searchParams.client),
        dealId,
      }}
    />
  );
}
