import { describe, expect, it } from "vitest";
import { buildDraftLine, defaultIrpfBps, lineAmountsMatch, recomputeDraftLine } from "./draft-line";

const vat21 = { id: "iva21", rateBps: 2100, regime: "general" as const, legalNote: null };
const reverse = { id: "isp", rateBps: 0, regime: "reverse_charge_eu" as const, legalNote: "Inversión del sujeto pasivo" };

describe("líneas de borrador", () => {
  it("calcula con el IRPF de la factura solo si la línea está sujeta", () => {
    const subject = buildDraftLine(
      { id: "a", position: 0, description: " Campaña ", quantity: 2, unitPriceCents: 37_500, discountBps: 0, taxRate: vat21, irpfApplies: true, billingType: "usage" },
      1500,
    );
    expect(subject).toMatchObject({ description: "Campaña", quantity: "2", base_cents: 75_000, vat_cents: 15_750, irpf_cents: 11_250 });
    const exempt = buildDraftLine({ ...{ id: "b", position: 1, description: "Suplido", quantity: "1", unitPriceCents: 5_000, discountBps: 0, taxRate: vat21, irpfApplies: false, billingType: "one_off" } }, 1500);
    expect(exempt.irpf_cents).toBe(0);
  });

  it("congela la mención legal del régimen en la línea", () => {
    const line = buildDraftLine(
      { id: "c", position: 0, description: "SEO", quantity: "1", unitPriceCents: 50_000, discountBps: 0, taxRate: reverse, irpfApplies: false, billingType: "monthly" },
      0,
    );
    expect(line).toMatchObject({ vat_bps: 0, vat_cents: 0, vat_regime: "reverse_charge_eu", legal_note: "Inversión del sujeto pasivo" });
  });

  it("recalcula al cambiar el IRPF de la factura y detecta importes manipulados", () => {
    const line = buildDraftLine(
      { id: "d", position: 0, description: "Web", quantity: "1", unitPriceCents: 150_000, discountBps: 1000, taxRate: vat21, irpfApplies: true, billingType: "one_off" },
      1500,
    );
    expect(lineAmountsMatch(line, 1500)).toBe(true);
    expect(recomputeDraftLine(line, 700).irpf_cents).toBe(9_450);
    expect(lineAmountsMatch({ ...line, vat_cents: line.vat_cents + 1 }, 1500)).toBe(false);
  });

  it("IRPF por defecto solo para empresas y profesionales españoles", () => {
    const freelancer = { defaultIrpfBps: 1500 };
    expect(defaultIrpfBps(freelancer, { isBusiness: true, taxIdKind: "es", countryCode: "ES" })).toBe(1500);
    expect(defaultIrpfBps(freelancer, { isBusiness: false, taxIdKind: "es", countryCode: "ES" })).toBe(0);
    expect(defaultIrpfBps(freelancer, { isBusiness: true, taxIdKind: "eu_vat", countryCode: "FR" })).toBe(0);
  });
});
