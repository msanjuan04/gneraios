import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { FunnelBoard } from "@/components/crm/funnel-board";
import { estimateFromHistory, funnelStages, isLiveLead } from "@/domain/crm";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/domain/money";
import { getCrmConfig } from "@/server/crm/config";
import { pastQuotes } from "@/server/crm/lead-board";
import { getOrgContext } from "@/server/session";
import { FunnelEmptyState } from "./empty-state";
import { loadFunnelData } from "./queries";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("funnel"))("metaTitle") };
}

/**
 * El embudo: una caja por etapa con una bola por oportunidad y, a la derecha, cuántas son y cuánto
 * suman. Solo eso: es una foto de ahora, a todo el ancho de la página. El análisis histórico
 * (conversión, tiempos, motivos de pérdida) ya no cuelga de aquí.
 */
export default async function FunnelPage({ params }: PageProps<"/[org]/pipeline/funnel">) {
  const { org: slug } = await params;
  const { org } = await getOrgContext(slug);
  const [config, { deals }, history] = await Promise.all([getCrmConfig(org.id), loadFunnelData(org.id), pastQuotes(org.id)]);
  const boardHref = `/${org.slug}/pipeline`;
  if (deals.length === 0) return <FunnelEmptyState boardHref={boardHref} />;

  const t = await getTranslations("funnel.board");
  const estimate = estimateFromHistory(history);

  // La etapa de entrada solo cuenta los leads vivos (novedad en las últimas dos semanas o calientes):
  // un contacto del que no se sabe nada desde hace semanas no es una oportunidad que se esté trabajando.
  const firstOpen = config.stages.filter((stage) => stage.kind === "open").sort((a, b) => a.position - b.position)[0];
  const stale = new Set<string>();
  if (firstOpen) {
    const supabase = await createClient();
    const { data: entry, error } = await supabase
      .from("deals_board")
      .select("id, created_at, last_contact_at, temperature")
      .eq("org_id", org.id)
      .eq("stage_id", firstOpen.id)
      .limit(2000);
    if (error) throw error;
    const now = new Date();
    for (const deal of entry ?? []) {
      if (deal.id && !isLiveLead({ lastContactAt: deal.last_contact_at ?? null, createdAt: deal.created_at ?? "", temperature: deal.temperature ?? null }, now)) stale.add(deal.id);
    }
  }
  // Las etapas del embudo: las que se trabajan y la de cerrado. Lo perdido no es parte del embudo.
  const stages = funnelStages(
    config.stages.filter((stage) => stage.kind === "open" || stage.kind === "won"),
    deals
      .filter((deal) => !stale.has(deal.id))
      .map((deal) => {
      // Una oportunidad sin importe se estima con lo que hemos presupuestado antes (y se dice).
      const empty = deal.estOneOffCents === 0 && deal.estMrrCents === 0 && estimate.basedOn > 0;
      return {
        stageId: deal.stageId,
        estOneOffCents: empty ? estimate.oneOffCents : deal.estOneOffCents,
        estMrrCents: empty ? estimate.monthlyCents : deal.estMrrCents,
        estimated: empty,
      };
    }),
  );
  const money = (cents: number) => formatMoney(cents, { locale: org.locale, currency: org.currency, wholeUnits: true });

  return (
    <div className="w-full">
      <div className="mb-6">
        <h2 className="text-3xl font-extrabold heading-tight md:text-4xl">{t("title")}</h2>
        <p className="mt-2 text-muted-foreground">{t("description")}</p>
      </div>
      <FunnelBoard stages={stages} money={money} />
    </div>
  );
}
