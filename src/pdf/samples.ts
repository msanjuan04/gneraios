import { brand } from "@/brand";
import { computeInvoiceTotals, computeLine } from "@/domain/tax";
import type { InvoiceDocumentData, PdfIssuer, PdfLine, PdfParty } from "./types";

// Facturas de ejemplo con datos inventados (NIF con provincia 00, IBAN a ceros, correos de
// example.com), para los tests y `scripts/render-sample-invoice.tsx`. Los importes salen
// del cálculo del dominio, así que cuadran como en una factura real.

type SampleLine = Omit<PdfLine, "baseCents">;
type SampleHeader = Omit<InvoiceDocumentData, "lines" | "totals" | "vatBreakdown">;

/** Completa bases, totales y desglose de IVA con `computeLine` y `computeInvoiceTotals`. */
export function buildSampleInvoice(header: SampleHeader, lines: SampleLine[], irpfBps = 0): InvoiceDocumentData {
  const computed = lines.map((line) => ({
    line,
    amounts: computeLine({
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
      discountBps: line.discountBps,
      vatBps: line.vatBps,
      irpfBps,
      irpfApplies: irpfBps > 0,
    }),
  }));
  const totals = computeInvoiceTotals(
    computed.map(({ line, amounts }) => ({
      baseCents: amounts.baseCents,
      vatCents: amounts.vatCents,
      irpfCents: amounts.irpfCents,
      vatBps: line.vatBps,
      vatRegime: line.vatRegime,
    })),
  );
  return {
    ...header,
    lines: computed.map(({ line, amounts }) => ({ ...line, baseCents: amounts.baseCents })),
    totals: {
      subtotalCents: totals.subtotalCents,
      vatCents: totals.vatCents,
      irpfCents: totals.irpfCents,
      totalCents: totals.totalCents,
      irpfBps,
    },
    vatBreakdown: totals.breakdown,
  };
}

/**
 * Un QR de mentira (patrones de posición y módulos pseudoaleatorios) en SVG, para ver el
 * hueco de Verifactu ocupado. El de verdad lo devolverá el proveedor.
 */
export function sampleQrDataUrl(seed = 7): string {
  const size = 25;
  const quiet = 2;
  const full = size + quiet * 2;
  const modules = new Set<string>();
  const finder = (ox: number, oy: number) => {
    for (let y = 0; y < 7; y += 1) {
      for (let x = 0; x < 7; x += 1) {
        const ring = x === 0 || y === 0 || x === 6 || y === 6;
        const core = x >= 2 && x <= 4 && y >= 2 && y <= 4;
        if (ring || core) modules.add(`${ox + x},${oy + y}`);
      }
    }
  };
  finder(0, 0);
  finder(size - 7, 0);
  finder(0, size - 7);
  const reserved = (x: number, y: number) =>
    (x < 8 && y < 8) || (x >= size - 8 && y < 8) || (x < 8 && y >= size - 8) || x === 6 || y === 6;
  for (let i = 8; i < size - 8; i += 2) {
    modules.add(`${i},6`);
    modules.add(`6,${i}`);
  }
  let state = seed;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (reserved(x, y)) continue;
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      if ((state >> 16) & 1) modules.add(`${x},${y}`);
    }
  }
  const path = [...modules]
    .map((key) => {
      const [x, y] = key.split(",").map(Number);
      return `M${x + quiet} ${y + quiet}h1v1h-1z`;
    })
    .join("");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}">` +
    `<rect width="${full}" height="${full}" fill="${brand.palette.white}"/>` +
    `<path fill="${brand.palette.black}" d="${path}"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

export const sampleCompanyIssuer: PdfIssuer = {
  kind: "company",
  legalName: `${brand.name} SL`,
  taxId: "B00000000",
  addressLine: "Carrer de la Mostra, 12, 2n 1a",
  postalCode: "08301",
  city: "Mataró",
  province: "Barcelona",
  countryCode: "ES",
  email: "factures@example.com",
  phone: "+34 900 000 000",
  iban: "ES0000000000000000000000",
  registryInfo:
    "Inscrita en el Registro Mercantil de Barcelona, tomo 00000, folio 000, hoja B-000000, inscripción 1.ª",
};

export const sampleSelfEmployedIssuer: PdfIssuer = {
  kind: "self_employed",
  legalName: "Laia Mostra Exemple",
  tradeName: brand.name,
  taxId: "00000000T",
  addressLine: "Passeig de l'Exemple, 7, 3r 2a",
  postalCode: "08350",
  city: "Arenys de Mar",
  province: "Barcelona",
  countryCode: "ES",
  email: "laia@example.com",
  phone: "+34 600 000 000",
  iban: "ES0000000000000000000000",
};

export const sampleSpanishClient: PdfParty = {
  legalName: "Cal Exemple Restauració SL",
  tradeName: "Cal Exemple",
  taxId: "B00000018",
  addressLine: "Plaça de la Mostra, 3, baixos",
  postalCode: "08330",
  city: "Premià de Mar",
  province: "Barcelona",
  countryCode: "ES",
  email: "administracio@example.com",
};

export const sampleEuClient: PdfParty = {
  legalName: "Harbour Example Studio Ltd",
  taxId: "IE0000000X",
  addressLine: "Unit 4, Sample Quay",
  postalCode: "D02 X000",
  city: "Dublin",
  countryCode: "IE",
  email: "accounts@example.com",
};

export const sampleCatalanClient: PdfParty = {
  legalName: "Viver Exemple del Maresme SL",
  taxId: "B00000026",
  addressLine: "Camí de la Mostra, 21",
  postalCode: "08340",
  city: "Vilassar de Mar",
  province: "Barcelona",
  countryCode: "ES",
  email: "comptabilitat@example.com",
};

/** es · ordinaria de autónomo con IRPF 15 %, un descuento y una cuota mensual prorrateada. */
export const sampleSpanishInvoice = buildSampleInvoice(
  {
    locale: "es",
    kind: "ordinary",
    isDraft: false,
    number: "2026-0042",
    issuedOn: "2026-10-15",
    dueOn: "2026-11-14",
    issuer: sampleSelfEmployedIssuer,
    client: sampleSpanishClient,
    legalNotes: [],
    payment: { method: "transfer" },
    notes: "Pago a 30 días. Indica el número de factura en el concepto de la transferencia.",
  },
  [
    {
      description: "Diseño y desarrollo de la nueva web corporativa · hito 1 de 2 (50 % a la firma)",
      quantity: "1",
      unitPriceCents: 240_000,
      discountBps: 0,
      vatBps: 2100,
      vatRegime: "general",
      billingType: "one_off",
    },
    {
      description: "Sesión de fotografía de producto y edición",
      quantity: "1",
      unitPriceCents: 45_000,
      discountBps: 1000,
      vatBps: 2100,
      vatRegime: "general",
      billingType: "one_off",
    },
    {
      // 500 € al mes desde el 15 de octubre: 17/31 → 274,19 € (ARCHITECTURE.md §7.2).
      description: "Gestión de redes sociales · alta a mitad de mes (prorrata 17/31 días)",
      quantity: "1",
      unitPriceCents: 27_419,
      discountBps: 0,
      vatBps: 2100,
      vatRegime: "general",
      billingType: "monthly",
      periodStart: "2026-10-15",
      periodEnd: "2026-10-31",
    },
    {
      description: "Horas de soporte y cambios fuera del plan",
      quantity: "3.500",
      unitPriceCents: 6_000,
      discountBps: 0,
      vatBps: 2100,
      vatRegime: "general",
      billingType: "usage",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
    },
  ],
  1500,
);

/** en · cliente de la UE con inversión del sujeto pasivo (IVA 0 %) y fecha de operación distinta. */
export const sampleReverseChargeInvoice = buildSampleInvoice(
  {
    locale: "en",
    kind: "ordinary",
    isDraft: false,
    number: "2026-0043",
    issuedOn: "2026-11-02",
    operationOn: "2026-10-31",
    dueOn: "2026-12-02",
    issuer: sampleCompanyIssuer,
    client: sampleEuClient,
    legalNotes: [
      "Reverse charge: VAT to be accounted for by the recipient (Article 196 of Council Directive 2006/112/EC).",
    ],
    payment: { method: "transfer" },
    notes: "Please quote the invoice number as the payment reference.",
  },
  [
    {
      description: "Brand strategy workshop (two days, on site in Dublin)",
      quantity: "2",
      unitPriceCents: 120_000,
      discountBps: 0,
      vatBps: 0,
      vatRegime: "reverse_charge_eu",
      billingType: "one_off",
    },
    {
      description: "SEO retainer",
      quantity: "1",
      unitPriceCents: 95_000,
      discountBps: 0,
      vatBps: 0,
      vatRegime: "reverse_charge_eu",
      billingType: "monthly",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
    },
    {
      description: "Paid social campaign management",
      quantity: "1",
      unitPriceCents: 70_000,
      discountBps: 0,
      vatBps: 0,
      vatRegime: "reverse_charge_eu",
      billingType: "monthly",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
    },
    {
      description: "Brand localisation for the Polish market (Łódź, Gdańsk)",
      quantity: "12.5",
      unitPriceCents: 8_500,
      discountBps: 0,
      vatBps: 0,
      vatRegime: "reverse_charge_eu",
      billingType: "usage",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
    },
  ],
);

/** ca · rectificativa por diferencias (importes negativos) con el QR de Verifactu ocupado. */
export const sampleRectifyingInvoice = buildSampleInvoice(
  {
    locale: "ca",
    kind: "rectifying",
    isDraft: false,
    number: "R-2027-0001",
    issuedOn: "2027-01-12",
    rectifies: {
      number: "2026-0118",
      issuedOn: "2026-12-15",
      reason:
        "Error en el preu unitari del manteniment de desembre i anul·lació de la campanya que no es va executar.",
    },
    issuer: sampleCompanyIssuer,
    client: sampleCatalanClient,
    legalNotes: [],
    notes: "L'import es compensarà a la propera factura de gener.",
    verifactu: { qrDataUrl: sampleQrDataUrl(), legend: "Factura verificable en la sede electrónica de la AEAT" },
  },
  [
    {
      description: "Manteniment web · desembre (diferència de preu)",
      quantity: "1",
      unitPriceCents: -5_000,
      discountBps: 0,
      vatBps: 2100,
      vatRegime: "general",
      billingType: "monthly",
      periodStart: "2026-12-01",
      periodEnd: "2026-12-31",
    },
    {
      description: "Campanya de Google Ads · desembre (no executada)",
      quantity: "1",
      unitPriceCents: -60_000,
      discountBps: 0,
      vatBps: 2100,
      vatRegime: "general",
      billingType: "monthly",
      periodStart: "2026-12-01",
      periodEnd: "2026-12-31",
    },
  ],
);

/** Factura con `count` líneas mensuales, para probar la paginación. */
export function sampleLongInvoice(count: number, overrides: Partial<SampleHeader> = {}): InvoiceDocumentData {
  const lines: SampleLine[] = Array.from({ length: count }, (_, index) => ({
    description: `Mantenimiento web y hosting gestionado · sitio ${index + 1}`,
    quantity: "1",
    unitPriceCents: 9_900 + index * 100,
    discountBps: 0,
    vatBps: 2100,
    vatRegime: "general",
    billingType: "monthly",
    periodStart: "2026-10-01",
    periodEnd: "2026-10-31",
  }));
  return buildSampleInvoice(
    {
      locale: "es",
      kind: "ordinary",
      isDraft: false,
      number: "2026-0044",
      issuedOn: "2026-10-01",
      dueOn: "2026-10-31",
      issuer: sampleCompanyIssuer,
      client: sampleSpanishClient,
      legalNotes: [],
      payment: { method: "sepa_debit", iban: "ES0000000000000000000000" },
      ...overrides,
    },
    lines,
  );
}
