import { describe, expect, it } from "vitest";
import { upcomingRenewals, type RenewalLine } from "./renewals";

type Line = RenewalLine & { id: string };

const yearly = (overrides: Partial<Line> = {}): Line => ({
  id: "hosting",
  billingType: "yearly",
  startsOn: "2025-10-01",
  endsOn: null,
  pauses: [],
  quantity: "1",
  unitPriceCents: 24_000,
  discountBps: 0,
  ...overrides,
});

describe("renovaciones próximas", () => {
  it("el próximo aniversario dentro de la ventana, con su base anual", () => {
    const renewals = upcomingRenewals([yearly(), yearly({ id: "analitica", startsOn: "2025-08-01", unitPriceCents: 120_000 })], "2026-09-26", 60);
    expect(renewals.map((r) => [r.line.id, r.renewsOn, r.daysLeft, r.amountCents])).toEqual([["hosting", "2026-10-01", 5, 24_000]]);
  });

  it("no cuenta la primera facturación, lo que se factura hoy, lo terminado ni las mensuales", () => {
    const today = "2026-09-26";
    expect(upcomingRenewals([yearly({ startsOn: "2026-10-15" })], today, 60)).toEqual([]);
    expect(upcomingRenewals([yearly({ startsOn: "2025-09-26" })], today, 60)).toEqual([]);
    expect(upcomingRenewals([yearly({ endsOn: "2026-09-30" })], today, 60)).toEqual([]);
    expect(upcomingRenewals([yearly({ billingType: "monthly" })], today, 60)).toEqual([]);
    expect(upcomingRenewals([yearly({ startsOn: "2025-12-01" })], today, 60)).toEqual([]);
    expect(upcomingRenewals([yearly({ startsOn: "2025-11-24" })], today, 60)[0]?.daysLeft).toBe(59);
  });

  it("ordena por fecha", () => {
    const renewals = upcomingRenewals(
      [yearly({ id: "b", startsOn: "2025-11-10" }), yearly({ id: "a", startsOn: "2025-10-05" })],
      "2026-09-26",
      60,
    );
    expect(renewals.map((r) => r.line.id)).toEqual(["a", "b"]);
  });
});
