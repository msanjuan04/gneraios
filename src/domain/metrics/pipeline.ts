// Pipeline ponderado (ARCHITECTURE.md §7.8): Σ importe × probabilidad de los deals abiertos, en
// dos cifras que nunca se suman: one-off ponderado y MRR ponderado. Exacto y redondeado una sola
// vez (half away from zero). Las filas son las de `deals_board` (hoy) u `open_deals_on` (en una
// fecha de corte): la probabilidad ya viene resuelta (la del deal o, si no tiene, la de su etapa).

import type { StageKind } from "../pipeline/funnel";
import { divRoundHalfAwayFromZero, type Cents } from "../money";

export type PipelineDeal = {
  stageKind: StageKind;
  estOneOffCents: Cents;
  estMrrCents: Cents;
  probabilityBps: number;
};

export type WeightedPipeline = {
  oneOffCents: Cents;
  mrrCents: Cents;
  openDeals: number;
};

const BPS = BigInt(10_000);

function weigh(deals: readonly PipelineDeal[]): WeightedPipeline {
  let oneOff = BigInt(0);
  let mrr = BigInt(0);
  let openDeals = 0;
  for (const deal of deals) {
    if (deal.stageKind !== "open") continue;
    const bps = BigInt(Math.min(10_000, Math.max(0, deal.probabilityBps)));
    oneOff += BigInt(deal.estOneOffCents) * bps;
    mrr += BigInt(deal.estMrrCents) * bps;
    openDeals += 1;
  }
  return {
    oneOffCents: Number(divRoundHalfAwayFromZero(oneOff, BPS)),
    mrrCents: Number(divRoundHalfAwayFromZero(mrr, BPS)),
    openDeals,
  };
}

/** Pipeline ponderado de los deals abiertos. */
export function weightedPipeline(deals: readonly PipelineDeal[]): WeightedPipeline {
  return weigh(deals);
}

export type PipelineStage = { id: string; position: number; kind: StageKind };

export type StagePipeline = {
  stageId: string;
  deals: number;
  /** Importes sin ponderar (lo que se está negociando). */
  oneOffCents: Cents;
  mrrCents: Cents;
  weighted: WeightedPipeline;
};

/** Deals abiertos por etapa, en el orden del pipeline (también las etapas vacías). */
export function pipelineByStage(
  deals: readonly (PipelineDeal & { stageId: string })[],
  stages: readonly PipelineStage[],
): StagePipeline[] {
  return [...stages]
    .filter((s) => s.kind === "open")
    .sort((a, b) => a.position - b.position)
    .map((stage) => {
      const inStage = deals.filter((d) => d.stageId === stage.id && d.stageKind === "open");
      return {
        stageId: stage.id,
        deals: inStage.length,
        oneOffCents: inStage.reduce((sum, d) => sum + d.estOneOffCents, 0),
        mrrCents: inStage.reduce((sum, d) => sum + d.estMrrCents, 0),
        weighted: weigh(inStage),
      };
    });
}
