import { describe, expect, it } from "vitest";
import type { QueryDailyFact } from "./provider";
import { capQueryRows, historyStart, mergeCoverage, planSync, splitNewestFirst } from "./sync-plan";

const availability = { from: historyStart("2026-09-26"), to: "2026-09-25" };
const opts = { availability, resyncDays: 5, windowDays: 30 };

describe("qué descargar", () => {
  it("el histórico empieza 16 meses atrás", () => {
    expect(historyStart("2026-09-26")).toBe("2025-05-27");
  });

  it("parte un rango en tramos, del más reciente al más antiguo", () => {
    expect(splitNewestFirst({ from: "2026-09-01", to: "2026-09-10" }, 4)).toEqual([
      { from: "2026-09-07", to: "2026-09-10" },
      { from: "2026-09-03", to: "2026-09-06" },
      { from: "2026-09-01", to: "2026-09-02" },
    ]);
  });

  it("la primera vez carga todo el histórico, lo más reciente primero", () => {
    const plan = planSync(null, opts);
    expect(plan[0]).toEqual({ from: "2026-08-27", to: "2026-09-25" });
    expect(plan.at(-1)!.from).toBe("2025-05-27");
    expect(plan).toHaveLength(Math.ceil(487 / 30));
  });

  it("después, vuelve a pedir los últimos días y sigue hacia atrás lo que falte", () => {
    // Una carga anterior que se cortó: solo tiene desde marzo.
    const plan = planSync({ from: "2026-03-01", to: "2026-09-22" }, opts);
    expect(plan[0]).toEqual({ from: "2026-09-18", to: "2026-09-25" });
    expect(plan[1]).toEqual({ from: "2026-01-30", to: "2026-02-28" });
    expect(plan.at(-1)!.from).toBe("2025-05-27");
    // Al día y completa: solo los últimos días.
    expect(planSync({ from: "2025-05-27", to: "2026-09-25" }, opts)).toEqual([{ from: "2026-09-21", to: "2026-09-25" }]);
  });

  it("un rango explícito se descarga tal cual, dentro de lo disponible", () => {
    expect(planSync(null, opts, { from: "2026-09-20", to: "2026-09-30" })).toEqual([{ from: "2026-09-20", to: "2026-09-25" }]);
    expect(planSync(null, opts, { from: "2020-01-01", to: "2020-02-01" })).toEqual([]);
  });

  it("une lo descargado con lo que había si se toca o se solapa", () => {
    expect(mergeCoverage(null, { from: "2026-09-01", to: "2026-09-10" })).toEqual({ from: "2026-09-01", to: "2026-09-10" });
    expect(mergeCoverage({ from: "2026-09-01", to: "2026-09-10" }, { from: "2026-09-11", to: "2026-09-20" })).toEqual({
      from: "2026-09-01",
      to: "2026-09-20",
    });
    expect(mergeCoverage({ from: "2026-09-01", to: "2026-09-10" }, { from: "2026-08-01", to: "2026-08-31" })).toEqual({
      from: "2026-08-01",
      to: "2026-09-10",
    });
    // Un hueco en medio: se queda como estaba.
    expect(mergeCoverage({ from: "2026-09-01", to: "2026-09-10" }, { from: "2026-09-15", to: "2026-09-20" })).toEqual({
      from: "2026-09-01",
      to: "2026-09-10",
    });
  });
});

describe("filas de consultas", () => {
  const row = (metricOn: string, query: string, page: string, clicks: number, impressions: number): QueryDailyFact => ({
    metricOn,
    query,
    page,
    clicks,
    impressions,
    position: 5,
  });

  it("deja las de más clics de cada día y quita duplicados", () => {
    const rows = [
      row("2026-09-02", "a", "/", 1, 10),
      row("2026-09-01", "a", "/", 5, 50),
      row("2026-09-01", "b", "/", 5, 80),
      row("2026-09-01", "c", "/", 0, 500),
      row("2026-09-01", "a", "/", 6, 60), // la misma fila repetida: gana la última
    ];
    expect(capQueryRows(rows, 2).map((r) => [r.metricOn, r.query, r.clicks])).toEqual([
      ["2026-09-01", "a", 6],
      ["2026-09-01", "b", 5],
      ["2026-09-02", "a", 1],
    ]);
  });
});
