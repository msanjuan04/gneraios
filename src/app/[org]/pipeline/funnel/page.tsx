import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import {
  type CivilRange,
  cohort,
  computeCloseRates,
  computeConversion,
  computeTimeInStage,
  FUNNEL_PRESETS,
  type FunnelStage,
  funnelSequence,
  matchPreset,
  parseCivilRange,
  presetRange,
  summary,
  toDateRange,
  topLossReasons,
} from "@/domain/pipeline";
import { nowInZone } from "@/lib/clock";
import { getCrmConfig } from "@/server/crm/config";
import { getOrgContext } from "@/server/session";
import { CloseRateCard, ConversionCard, LossReasonsCard, type RateRow, TimeInStageCard } from "./charts";
import { stageColor } from "./colors";
import { FunnelEmptyState } from "./empty-state";
import { FunnelFilters } from "./filters";
import { FunnelContent, FunnelFrame } from "./frame";
import { FunnelKpis } from "./kpis";
import { loadFunnelData } from "./queries";

/** Motivos de pérdida que se listan; el resto se resume debajo de la gráfica. */
const LOSS_REASONS_SHOWN = 6;

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("funnel"))("metaTitle") };
}

/** La página con un rango civil en la URL; sin parámetros es todo el histórico. */
function rangeHref(path: string, range: CivilRange): string {
  const params = new URLSearchParams();
  if (range.from) params.set("from", range.from);
  if (range.to) params.set("to", range.to);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

/** Nombre de una fuente, socio o motivo. Lo que ya no está en la configuración (archivado) se nombra aparte. */
function namer(options: { id: string; name: string }[], none: string, missing: string) {
  const names = new Map(options.map((option) => [option.id, option.name]));
  return (key: string | null) => (key === null ? none : (names.get(key) ?? missing));
}

/** Orden de la configuración, para desempatar como el usuario ve la lista: lo archivado y lo vacío, al final. */
function rankOf(options: { id: string }[]) {
  const ranks = new Map(options.map((option, index) => [option.id, index]));
  return (key: string | null) => (key === null ? options.length + 1 : (ranks.get(key) ?? options.length));
}

/** Embudo del pipeline (ARCHITECTURE.md §7.9): cohortes por fecha de creación y cierres por fecha de cierre. */
export default async function FunnelPage({ params, searchParams }: PageProps<"/[org]/pipeline/funnel">) {
  const [{ org: slug }, query] = await Promise.all([params, searchParams]);
  const { org } = await getOrgContext(slug);
  const [config, { deals, history }] = await Promise.all([getCrmConfig(org.id), loadFunnelData(org.id)]);
  const boardHref = `/${org.slug}/pipeline`;
  const funnelHref = `${boardHref}/funnel`;

  if (deals.length === 0) return <FunnelEmptyState boardHref={boardHref} />;

  const t = await getTranslations("funnel");
  const format = await getFormatter();

  // El periodo son fechas civiles (?from&to, ambas incluidas) en la zona horaria de la org.
  const today = nowInZone(org.timezone).date;
  const civil = parseCivilRange(query.from, query.to);
  const range = toDateRange(civil, today, org.timezone);

  const stages: FunnelStage[] = config.stages.map(({ id, name, position, kind }) => ({ id, name, position, kind }));
  const sequence = funnelSequence(stages);
  const color = (index: number) => stageColor(index, sequence.length);

  const totals = summary(deals, history, stages, range);
  const conversionRows = computeConversion(stages, deals, history, range).map((row, index) => ({
    id: row.stageId,
    name: sequence[index].name,
    color: color(index),
    reached: row.reached,
    conversionToNext: row.conversionToNext,
  }));

  // El tiempo en etapa, de la misma cohorte que la conversión.
  const cohortIds = new Set(cohort(deals, range).map((deal) => deal.id));
  const times = new Map(
    computeTimeInStage(stages, history.filter((change) => cohortIds.has(change.dealId))).map((row) => [row.stageId, row]),
  );
  const timeRows = sequence.map((stage, index) => {
    const row = times.get(stage.id);
    return {
      id: stage.id,
      name: stage.name,
      color: color(index),
      avgDays: row?.avgDays ?? null,
      medianDays: row?.medianDays ?? null,
      samples: row?.samples ?? 0,
    };
  });

  const members = config.members.map((member) => ({ id: member.id, name: member.fullName }));
  const sourceName = namer(config.sources, t("labels.noSource"), t("labels.archivedSource"));
  const partnerName = namer(members, t("labels.noPartner"), t("labels.inactivePartner"));
  const reasonName = namer(config.lossReasons, t("labels.noReason"), t("labels.archivedReason"));

  // Más cerrados primero (y más ganados); a igualdad, en el orden de la configuración.
  const rateRows = (groupBy: "source" | "broughtBy", options: { id: string; name: string }[], name: typeof sourceName) => {
    const rank = rankOf(options);
    return computeCloseRates(deals, history, stages, range, groupBy)
      .sort((a, b) => b.won + b.lost - (a.won + a.lost) || b.won - a.won || rank(a.key) - rank(b.key))
      .map((row): RateRow => ({ key: row.key ?? "none", name: name(row.key), won: row.won, lost: row.lost, rate: row.rate }));
  };
  const reasonRank = rankOf(config.lossReasons);
  const lossRows = topLossReasons(deals, history, stages, range, Number.MAX_SAFE_INTEGER)
    .sort((a, b) => b.count - a.count || reasonRank(a.reasonId) - reasonRank(b.reasonId))
    .slice(0, LOSS_REASONS_SHOWN)
    .map((row) => ({ key: row.reasonId ?? "none", name: reasonName(row.reasonId), count: row.count }));

  // Las fechas civiles se formatean a mediodía UTC para que ninguna zona las mueva de día.
  const day = (date: string) => new Date(`${date}T12:00:00Z`);
  const dateOptions = { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" } as const;
  const caption =
    civil.from && civil.to
      ? format.dateTimeRange(day(civil.from), day(civil.to), dateOptions)
      : civil.from
        ? t("filters.since", { date: format.dateTime(day(civil.from), dateOptions) })
        : civil.to
          ? t("filters.until", { date: format.dateTime(day(civil.to), dateOptions) })
          : null;

  return (
    <FunnelFrame>
      <div className="w-full max-w-6xl space-y-6">
        <FunnelFilters
          basePath={funnelHref}
          presets={FUNNEL_PRESETS.map((preset) => ({ preset, href: rangeHref(funnelHref, presetRange(preset, today)) }))}
          active={matchPreset(civil, today)}
          from={civil.from}
          to={civil.to}
          today={today}
          caption={caption}
        />
        <FunnelContent className="space-y-6">
          <FunnelKpis totals={totals} allTime={range === null} money={{ locale: org.locale, currency: org.currency }} />
          <div className="grid gap-4 xl:grid-cols-5">
            <ConversionCard
              className="xl:col-span-3"
              rows={conversionRows}
              created={totals.created}
              seeAllHref={range === null ? null : funnelHref}
            />
            <TimeInStageCard className="xl:col-span-2" rows={timeRows} created={totals.created} />
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <CloseRateCard by="source" rows={rateRows("source", config.sources, sourceName)} />
            <CloseRateCard by="partner" rows={rateRows("broughtBy", members, partnerName)} />
            <LossReasonsCard className="md:col-span-2 xl:col-span-1" rows={lossRows} total={totals.lost} />
          </div>
        </FunnelContent>
      </div>
    </FunnelFrame>
  );
}
