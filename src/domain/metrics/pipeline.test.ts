import { describe, expect, it } from "vitest";
import { pipelineByStage, weightedPipeline, type PipelineDeal } from "./pipeline";

const deal = (overrides: Partial<PipelineDeal & { stageId: string }> = {}) => ({
  stageId: "s1",
  stageKind: "open" as const,
  estOneOffCents: 100_000,
  estMrrCents: 30_000,
  probabilityBps: 2500,
  ...overrides,
});

describe("pipeline ponderado", () => {
  it("dos cifras separadas, solo de los deals abiertos", () => {
    const result = weightedPipeline([
      deal(),
      deal({ probabilityBps: 7500, estOneOffCents: 200_000, estMrrCents: 0 }),
      deal({ stageKind: "won", probabilityBps: 10_000 }),
      deal({ stageKind: "lost", probabilityBps: 0 }),
    ]);
    expect(result).toEqual({ oneOffCents: 25_000 + 150_000, mrrCents: 7_500, openDeals: 2 });
  });

  it("suma exacta y redondea una sola vez", () => {
    // 3 × (1 céntimo × 50 %) = 1,5 → 2; redondear cada deal daría 3.
    const tiny = deal({ estOneOffCents: 1, estMrrCents: 1, probabilityBps: 5000 });
    expect(weightedPipeline([tiny, tiny, tiny])).toMatchObject({ oneOffCents: 2, mrrCents: 2 });
  });

  it("por etapa, en el orden del pipeline y con las etapas vacías", () => {
    const stages = [
      { id: "s2", position: 2, kind: "open" as const },
      { id: "s1", position: 1, kind: "open" as const },
      { id: "won", position: 5, kind: "won" as const },
      { id: "s3", position: 3, kind: "open" as const },
    ];
    const rows = pipelineByStage([deal(), deal({ stageId: "s2", probabilityBps: 5000 }), deal()], stages);
    expect(rows.map((r) => [r.stageId, r.deals, r.oneOffCents, r.weighted.oneOffCents])).toEqual([
      ["s1", 2, 200_000, 50_000],
      ["s2", 1, 100_000, 50_000],
      ["s3", 0, 0, 0],
    ]);
  });
});
