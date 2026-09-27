import { describe, expect, it } from "vitest";
import { clientHealth, type HealthInput } from "./health";

const base: HealthInput = {
  status: "active",
  overdue: null,
  lastActivityOn: "2026-09-20",
  renewal: null,
  seoClicksChange: null,
  mrr: null,
};
const today = "2026-09-26";

describe("salud del cliente", () => {
  it("un cliente activo, al día y con contacto reciente está bien", () => {
    expect(clientHealth(base, today)).toEqual({ level: "good", signals: [] });
  });

  it("facturas vencidas: aviso, y alarma si pasan de 30 días o son varias", () => {
    const one = clientHealth({ ...base, overdue: { count: 1, oldestDueOn: "2026-09-10", outstandingCents: 83_740 } }, today);
    expect(one.level).toBe("warning");
    expect(one.signals[0]).toEqual({ key: "overdue", level: "warning", values: { count: 1, days: 16, amount_cents: 83_740 } });
    expect(clientHealth({ ...base, overdue: { count: 1, oldestDueOn: "2026-08-01", outstandingCents: 1 } }, today).level).toBe("danger");
    expect(clientHealth({ ...base, overdue: { count: 2, oldestDueOn: "2026-09-20", outstandingCents: 1 } }, today).level).toBe("danger");
  });

  it("sin contacto: aviso a los 60 días y alarma a los 120 (o si nunca lo hubo); en pausa no cuenta", () => {
    expect(clientHealth({ ...base, lastActivityOn: "2026-07-01" }, today).signals.map((s) => [s.key, s.level])).toEqual([["silent", "warning"]]);
    expect(clientHealth({ ...base, lastActivityOn: "2026-04-01" }, today).level).toBe("danger");
    expect(clientHealth({ ...base, lastActivityOn: null }, today).signals[0]!.values).toEqual({ days: -1 });
    expect(clientHealth({ ...base, status: "paused", lastActivityOn: null }, today).level).toBe("good");
  });

  it("renovación en 30 días, caída del SEO y del MRR", () => {
    const h = clientHealth(
      {
        ...base,
        renewal: { on: "2026-10-10", amountCents: 24_000 },
        seoClicksChange: -0.45,
        mrr: { nowCents: 40_000, beforeCents: 79_000 },
      },
      today,
    );
    expect(h.level).toBe("danger");
    // Primero lo grave.
    expect(h.signals.map((s) => [s.key, s.level])).toEqual([
      ["seoDrop", "danger"],
      ["renewal", "warning"],
      ["mrrDrop", "warning"],
    ]);
    expect(h.signals.find((s) => s.key === "mrrDrop")!.values.percent).toBe(-49);
  });

  it("un lead no tiene salud que vigilar; de un ex-cliente solo cuenta lo que aún debe", () => {
    expect(clientHealth({ ...base, status: "lead", lastActivityOn: null }, today).level).toBe("good");
    const former = clientHealth(
      { ...base, status: "former", lastActivityOn: null, seoClicksChange: -0.9, overdue: { count: 3, oldestDueOn: "2026-01-01", outstandingCents: 1 } },
      today,
    );
    expect(former.signals.map((s) => s.key)).toEqual(["overdue"]);
    expect(clientHealth({ ...base, status: "former", lastActivityOn: null }, today).level).toBe("good");
  });
});
