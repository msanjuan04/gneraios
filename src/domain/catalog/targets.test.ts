import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
// Pruebas de contrato: las líneas que salen del catálogo las aceptan tal cual los esquemas de
// cada editor (y dan los mismos céntimos). El dominio no importa de la app; sus tests, sí.
import { lineFormSchema, toLinePayload as toContractLinePayload } from "@/app/[org]/contracts/schema";
import { draftFormSchema, parseDiscountInput, parseQuantityInput } from "@/app/[org]/invoices/schema";
import { quoteLineFormSchema, toLinePayload as toQuoteLinePayload } from "@/app/[org]/quotes/schema";
import { buildDraftLine } from "../invoicing/draft-line";
import { parseMoneyInput } from "../money";
import { computeLine } from "../tax";
import { bundleLines, type CatalogLine, catalogLineAmounts, itemLine } from "./lines";
import { toContractLineInput, toDraftLineInput, toInvoiceDraftLineInput, toQuoteLineInput } from "./targets";
import type { CatalogBundle, CatalogItem } from "./types";

const VAT = randomUUID();

function item(overrides: Partial<CatalogItem>): CatalogItem {
  return {
    id: randomUUID(),
    category: "web",
    name: "Servicio",
    description: null,
    translations: {},
    billingType: "one_off",
    unitLabel: null,
    unitPriceCents: 100_000,
    defaultQuantity: "1",
    taxRateId: VAT,
    irpfApplies: true,
    isActive: true,
    position: 0,
    ...overrides,
  };
}

const ITEMS = [
  item({ name: "Web corporativa", description: "Hasta 5 páginas, con gestor de contenidos.", unitPriceCents: 180_050 }),
  item({ name: "SEO mensual", billingType: "monthly", unitPriceCents: 45_000 }),
  item({ name: "Hosting (anual)", billingType: "yearly", unitPriceCents: 18_000, irpfApplies: false }),
  item({ name: "Hora de consultoría", billingType: "usage", unitPriceCents: 6_000, defaultQuantity: "2.5" }),
];
const PACK: CatalogBundle = {
  id: randomUUID(),
  name: "Pack",
  description: null,
  translations: {},
  discountBps: 1_250,
  isActive: true,
  position: 0,
  items: ITEMS.map((i) => ({ itemId: i.id, quantity: null })),
};
/** Un servicio suelto de cada tipo y las líneas de un pack con descuento (12,5 %). */
const LINES: CatalogLine[] = [...ITEMS.map((i) => itemLine(i, "es")), ...bundleLines(PACK, ITEMS, "es").lines];

describe("presupuesto", () => {
  it("su esquema acepta cada línea y guarda los mismos céntimos, cantidad y base", () => {
    LINES.forEach((line, position) => {
      const input = toQuoteLineInput(line, randomUUID());
      const parsed = quoteLineFormSchema.safeParse(input);
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
      const payload = toQuoteLinePayload(parsed.data!, position);
      expect(payload).toMatchObject({
        description: line.description,
        billing_type: line.billingType,
        quantity: line.quantity,
        unit_price_cents: line.unitPriceCents,
        discount_bps: line.discountBps,
        tax_rate_id: VAT,
        irpf_applies: line.irpfApplies,
        // Empieza con el contrato y se cobra el día de la org.
        starts_on: null,
        ends_on: null,
        billing_day: null,
        base_cents: catalogLineAmounts(line, 2100).baseCents,
      });
    });
  });
});

describe("contrato", () => {
  it("su esquema acepta cada línea: las recurrentes empiezan hoy y las mensuales se cobran el día de la org", () => {
    const today = "2026-09-26";
    for (const line of LINES) {
      const parsed = lineFormSchema.safeParse(toContractLineInput(line, { today, billingDay: 5 }));
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
      const payload = toContractLinePayload(parsed.data!, 0);
      const recurring = line.billingType === "monthly" || line.billingType === "yearly";
      expect(payload).toMatchObject({
        billing_type: line.billingType,
        quantity: line.quantity,
        unit_price_cents: line.unitPriceCents,
        discount_bps: line.discountBps,
        irpf_applies: line.irpfApplies,
        starts_on: recurring ? today : null,
        ends_on: null,
        billing_day: line.billingType === "monthly" ? 5 : null,
        prorate_first: true,
      });
    }
  });
});

describe("borrador de factura", () => {
  const header = {
    issuer_id: randomUUID(),
    client_id: randomUUID(),
    series_id: "",
    issued_on: "",
    operation_on: "",
    due_mode: "terms" as const,
    due_on: "",
    payment_terms_days: "",
    language: "es" as const,
    irpf_bps: "1500",
    payment_method: "transfer" as const,
    notes: "",
    rectification_reason: "",
  };

  it("su editor acepta las líneas, que se leen con los mismos céntimos y cantidades", () => {
    const lines = LINES.map((line) => toInvoiceDraftLineInput(line, randomUUID()));
    const parsed = draftFormSchema({ kind: "ordinary", today: "2026-09-26", minLines: 1 }).safeParse({ ...header, lines });
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    lines.forEach((input, index) => {
      const line = LINES[index]!;
      expect(parseQuantityInput(input.quantity)).toBe(line.quantity);
      expect(parseMoneyInput(input.unit_price)).toBe(line.unitPriceCents);
      expect(parseDiscountInput(input.discount)).toBe(line.discountBps);
      expect(input).toMatchObject({ billing_type: line.billingType, period_start: "", period_end: "" });
    });
  });

  it("desde el servidor, buildDraftLine calcula los importes con el redondeo de siempre", () => {
    const taxRate = { id: VAT, rateBps: 2100, regime: "general" as const, legalNote: null };
    LINES.forEach((line, position) => {
      const draft = buildDraftLine(toDraftLineInput(line, { id: randomUUID(), position, taxRate }), 1500);
      const amounts = computeLine({ ...line, vatBps: 2100, irpfBps: 1500 });
      expect(draft).toMatchObject({
        position,
        description: line.description,
        quantity: line.quantity,
        base_cents: catalogLineAmounts(line, 2100).baseCents,
        vat_cents: amounts.vatCents,
        irpf_cents: amounts.irpfCents,
        billing_type: line.billingType,
      });
    });
    expect(() => toDraftLineInput(LINES[0]!, { id: randomUUID(), position: 0, taxRate: { ...taxRate, id: randomUUID() } })).toThrow();
  });
});
