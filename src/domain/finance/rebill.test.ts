import { describe, expect, it } from "vitest";
import type { TaxRateRef } from "../invoicing/draft-line";
import {
  clampLineDescription,
  groupRebillsByClient,
  MAX_LINE_DESCRIPTION,
  planRebillLines,
  rebillAmountCents,
  rebillDate,
  rebillMarkupCents,
  rebillTotals,
  type RebillExpense,
  sortRebills,
} from "./rebill";

const vat21: TaxRateRef = { id: "iva21", rateBps: 2100, regime: "general", legalNote: null };

const server: RebillExpense = {
  id: "e1",
  clientId: "acme",
  description: "Servidor CX22",
  vendorName: "Hetzner",
  issuedOn: "2026-09-01",
  periodStart: "2026-09-01",
  baseCents: 550,
  markupBps: 0,
};

let seq = 0;
const newId = () => `line-${++seq}`;
const describeLine = (e: RebillExpense) => `Repercusión: ${e.description}`;

describe("importe que se repercute", () => {
  it("la base más el margen, redondeado una vez (half away from zero)", () => {
    expect(rebillAmountCents(10_000, 0)).toBe(10_000);
    expect(rebillAmountCents(10_000, 1000)).toBe(11_000);
    // 5,55 € + 12,5 % = 0,69375 € de margen → 0,69 €.
    expect(rebillMarkupCents(555, 1250)).toBe(69);
    expect(rebillAmountCents(555, 1250)).toBe(624);
    // 0,05 € × 10 % = 0,005 € → 0,01 € (se aleja del cero).
    expect(rebillMarkupCents(5, 1000)).toBe(1);
    // Hasta el 1.000 %: se factura 11 veces la base.
    expect(rebillAmountCents(1_000, 100_000)).toBe(11_000);
  });

  it("un abono del proveedor se repercute en negativo, simétrico", () => {
    expect(rebillAmountCents(-555, 1250)).toBe(-624);
    expect(rebillAmountCents(-5, 1000)).toBe(-6);
  });

  it("rechaza márgenes fuera de rango o con decimales y céntimos que no son enteros", () => {
    expect(() => rebillAmountCents(1_000, -1)).toThrow();
    expect(() => rebillAmountCents(1_000, 100_001)).toThrow();
    expect(() => rebillAmountCents(1_000, 10.5)).toThrow();
    expect(() => rebillAmountCents(10.5, 1000)).toThrow();
  });

  it("los totales suman los márgenes de cada gasto ya redondeados (como sus líneas)", () => {
    // Tres gastos de 0,05 € al 10 %: 0,01 € de margen cada uno, no 0,02 € sobre el total.
    const tiny = [
      { baseCents: 5, markupBps: 1000 },
      { baseCents: 5, markupBps: 1000 },
      { baseCents: 5, markupBps: 1000 },
    ];
    expect(rebillTotals(tiny)).toEqual({ count: 3, baseCents: 15, markupCents: 3, amountCents: 18 });
    expect(rebillTotals([])).toEqual({ count: 0, baseCents: 0, markupCents: 0, amountCents: 0 });
  });
});

describe("pendientes por cliente", () => {
  const domain: RebillExpense = { ...server, id: "e2", description: "Dominio acme.es", vendorName: "Dinahosting", issuedOn: "2026-03-10", periodStart: null, baseCents: 1_500, markupBps: 2000 };
  const other: RebillExpense = { ...server, id: "e3", clientId: "bravo", baseCents: 99_00, markupBps: 0 };

  it("la fecha de un gasto: el periodo que cobra o, si no, su factura", () => {
    expect(rebillDate(server)).toBe("2026-09-01");
    expect(rebillDate({ issuedOn: "2026-09-03", periodStart: "2026-08-31" })).toBe("2026-08-31");
    expect(rebillDate(domain)).toBe("2026-03-10");
  });

  it("en orden de fecha, luego por concepto y por id (el orden de las líneas)", () => {
    const sameDay = { ...server, id: "e0", description: "Servidor CX22" };
    expect(sortRebills([server, domain, sameDay]).map((e) => e.id)).toEqual(["e2", "e0", "e1"]);
  });

  it("agrupa por cliente: cada grupo en orden de fecha y con sus totales; los grupos, de más a menos importe", () => {
    const groups = groupRebillsByClient([server, other, domain]);
    expect(groups.map((g) => g.clientId)).toEqual(["bravo", "acme"]);
    expect(groups[1]).toEqual({
      clientId: "acme",
      expenses: [domain, server],
      count: 2,
      baseCents: 2_050,
      markupCents: 300,
      amountCents: 2_350,
    });
    expect(groupRebillsByClient([])).toEqual([]);
  });
});

describe("líneas del borrador", () => {
  it("una línea puntual por gasto: cantidad 1, precio con el margen, IVA de la factura nueva e IRPF de la factura", () => {
    seq = 0;
    const withMarkup = { ...server, id: "e2", issuedOn: "2026-09-02", periodStart: null, baseCents: 10_000, markupBps: 1500 };
    const lines = planRebillLines([withMarkup, server], {
      startPosition: 3,
      taxRate: vat21,
      invoiceIrpfBps: 1500,
      irpfApplies: true,
      describe: describeLine,
      newId,
    });
    expect(lines).toEqual([
      {
        expenseId: "e1",
        line: {
          id: "line-1",
          position: 3,
          description: "Repercusión: Servidor CX22",
          quantity: "1",
          unit_price_cents: 550,
          discount_bps: 0,
          base_cents: 550,
          tax_rate_id: "iva21",
          vat_bps: 2100,
          vat_regime: "general",
          vat_cents: 116,
          irpf_applies: true,
          irpf_cents: 83,
          legal_note: null,
          billing_type: "one_off",
          period_start: null,
          period_end: null,
          contract_line_id: null,
          rectifies_line_id: null,
          billable_item_id: null,
        },
      },
      {
        expenseId: "e2",
        line: expect.objectContaining({ id: "line-2", position: 4, unit_price_cents: 11_500, base_cents: 11_500, vat_cents: 2_415, irpf_cents: 1_725 }),
      },
    ]);
  });

  it("sin IRPF en la línea, o con una factura sin IRPF, la retención es 0", () => {
    const [noIrpf] = planRebillLines([server], { startPosition: 0, taxRate: vat21, invoiceIrpfBps: 1500, irpfApplies: false, describe: describeLine, newId });
    expect(noIrpf!.line).toMatchObject({ irpf_applies: false, irpf_cents: 0 });
    const [sl] = planRebillLines([server], { startPosition: 0, taxRate: vat21, invoiceIrpfBps: 0, irpfApplies: true, describe: describeLine, newId });
    expect(sl!.line).toMatchObject({ irpf_applies: true, irpf_cents: 0 });
  });

  it("el régimen y la mención legal del tipo de IVA pasan a la línea", () => {
    const exempt: TaxRateRef = { id: "exento", rateBps: 0, regime: "exempt", legalNote: "Operación exenta de IVA" };
    const [line] = planRebillLines([server], { startPosition: 0, taxRate: exempt, invoiceIrpfBps: 0, irpfApplies: true, describe: describeLine, newId });
    expect(line!.line).toMatchObject({ vat_bps: 0, vat_cents: 0, vat_regime: "exempt", legal_note: "Operación exenta de IVA" });
  });

  it("el texto se limpia y cabe en la línea (500 caracteres); vacío no vale", () => {
    expect(clampLineDescription("  Repercusión:   dominio \n acme.es ")).toBe("Repercusión: dominio acme.es");
    const long = clampLineDescription(`Repercusión: ${"x".repeat(600)}`);
    expect(long).toHaveLength(MAX_LINE_DESCRIPTION);
    expect(long.endsWith("…")).toBe(true);
    expect(() => planRebillLines([server], { startPosition: 0, taxRate: vat21, invoiceIrpfBps: 0, irpfApplies: true, describe: () => "   ", newId })).toThrow();
  });

  it("todas las líneas de una repercusión son del mismo cliente", () => {
    expect(() =>
      planRebillLines([server, { ...server, id: "e9", clientId: "bravo" }], {
        startPosition: 0,
        taxRate: vat21,
        invoiceIrpfBps: 0,
        irpfApplies: true,
        describe: describeLine,
        newId,
      }),
    ).toThrow();
    expect(planRebillLines([], { startPosition: 0, taxRate: vat21, invoiceIrpfBps: 0, irpfApplies: true, describe: describeLine, newId })).toEqual([]);
  });
});
