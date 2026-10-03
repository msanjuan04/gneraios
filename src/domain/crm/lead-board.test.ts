import { describe, expect, it } from "vitest";
import { dotsFor, funnelStages, leadInitials, type LeadSummary, leadTotals, sortLeads } from "./lead-board";

const lead = (overrides: Partial<LeadSummary> = {}): LeadSummary => ({
  dealId: "d1",
  clientId: "c1",
  clientName: "Metrickal",
  title: "Web nueva",
  stageId: "s1",
  stageName: "Lead",
  stagePosition: 1,
  temperature: null,
  estOneOffCents: 100_000,
  estMrrCents: 0,
  estimated: false,
  probabilityBps: 1000,
  nextAction: null,
  nextActionOn: null,
  lastContactDaysAgo: null,
  awaitingOurReply: false,
  quotes: 0,
  messages: 0,
  ...overrides,
});

describe("las iniciales de la carpeta", () => {
  it("usa las dos primeras palabras que distinguen", () => {
    expect(leadInitials("Little Forest")).toBe("LF");
    expect(leadInitials("Nadia Pérez")).toBe("NP");
    expect(leadInitials("BAKoffice")).toBe("BA");
  });

  it("se salta la forma jurídica y los artículos", () => {
    expect(leadInitials("La Casa de Marc")).toBe("CM");
    expect(leadInitials("Maher S.L.")).toBe("MA");
  });

  it("no se queda sin nada con un nombre raro", () => {
    expect(leadInitials("···")).toBe("?");
    expect(leadInitials("")).toBe("?");
  });
});

describe("los totales de leads", () => {
  it("suma sin ponderar y aparte lo ya presupuestado", () => {
    const totals = leadTotals([
      lead({ estOneOffCents: 300_000, estMrrCents: 20_000, quotes: 1 }),
      lead({ estOneOffCents: 150_000, estMrrCents: 0, quotes: 0, awaitingOurReply: true }),
    ]);
    expect(totals).toMatchObject({
      openDeals: 2,
      oneOffCents: 450_000,
      mrrCents: 20_000,
      quotedDeals: 1,
      quotedOneOffCents: 300_000,
      quotedMrrCents: 20_000,
      awaitingReply: 1,
    });
  });

  it("lo estimado se cuenta aparte y no engorda lo real", () => {
    const totals = leadTotals([
      lead({ estOneOffCents: 100_000, quotes: 1 }),
      lead({ estOneOffCents: 150_000, estMrrCents: 20_000, estimated: true }),
    ]);
    expect(totals).toMatchObject({ openDeals: 2, oneOffCents: 100_000, mrrCents: 0, estimatedDeals: 1, estimatedOneOffCents: 150_000, estimatedMrrCents: 20_000 });
  });

  it("sin leads, todo a cero", () => {
    expect(leadTotals([])).toMatchObject({ openDeals: 0, oneOffCents: 0, quotedDeals: 0 });
  });
});

describe("el orden de las carpetas", () => {
  it("primero lo que toca contestar, luego lo caliente y lo frío al final", () => {
    const order = sortLeads([
      lead({ dealId: "frio", temperature: "cold" }),
      lead({ dealId: "caliente", temperature: "hot" }),
      lead({ dealId: "sin-calificar" }),
      lead({ dealId: "contestar", temperature: "cold", awaitingOurReply: true }),
    ]).map((item) => item.dealId);
    expect(order).toEqual(["contestar", "caliente", "sin-calificar", "frio"]);
  });

  it("a igual temperatura, la acción con fecha más cercana antes que la que no tiene fecha", () => {
    const order = sortLeads([
      lead({ dealId: "sin-fecha", temperature: "warm" }),
      lead({ dealId: "tarde", temperature: "warm", nextActionOn: "2026-10-20" }),
      lead({ dealId: "pronto", temperature: "warm", nextActionOn: "2026-10-05" }),
    ]).map((item) => item.dealId);
    expect(order).toEqual(["pronto", "tarde", "sin-fecha"]);
  });

  it("a igualdad de todo, manda lo que más vale (el recurrente cuenta a un año)", () => {
    const order = sortLeads([
      lead({ dealId: "pequeno", estOneOffCents: 100_000, estMrrCents: 0 }),
      lead({ dealId: "recurrente", estOneOffCents: 0, estMrrCents: 50_000 }),
    ]).map((item) => item.dealId);
    expect(order).toEqual(["recurrente", "pequeno"]);
  });
});

describe("el embudo", () => {
  const stages = [
    { id: "s1", name: "Lead", position: 1, kind: "open" },
    { id: "s2", name: "Reunión", position: 2, kind: "open" },
    { id: "s3", name: "Propuesta", position: 3, kind: "open" },
  ];

  it("cuenta y suma por etapa, y las vacías también salen", () => {
    const funnel = funnelStages(stages, [
      { stageId: "s1", estOneOffCents: 100_000, estMrrCents: 0 },
      { stageId: "s1", estOneOffCents: 50_000, estMrrCents: 10_000 },
      { stageId: "s3", estOneOffCents: 400_000, estMrrCents: 0 },
    ]);
    expect(funnel.map((stage) => [stage.name, stage.deals, stage.oneOffCents, stage.mrrCents])).toEqual([
      ["Lead", 2, 150_000, 10_000],
      ["Reunión", 0, 0, 0],
      ["Propuesta", 1, 400_000, 0],
    ]);
  });

  it("un deal de una etapa que ya no existe no rompe nada", () => {
    expect(funnelStages(stages, [{ stageId: "borrada", estOneOffCents: 1, estMrrCents: 0 }]).every((stage) => stage.deals === 0)).toBe(true);
  });

  it("las bolas se cortan y el resto se dice en número", () => {
    expect(dotsFor(5)).toEqual({ dots: 5, rest: 0 });
    expect(dotsFor(30, 12)).toEqual({ dots: 12, rest: 18 });
  });
});
