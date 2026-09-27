import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";
import { autoMapColumns, type ColumnMapping } from "./fields";
import { readImportFile } from "./import-file";
import {
  type ExistingInvoice,
  type InvoiceImportContext,
  type InvoiceImportOptions,
  inferInvoiceFormats,
  invoiceExternalId,
  planInvoiceImport,
  toImportPayload,
} from "./invoices-import";
import type { ImportTable } from "./table";
import { encodeUtf8 } from "./text";

function table(csv: string): ImportTable {
  const parsed = parseCsv(csv);
  return { headers: parsed.headers, rows: parsed.rows, rowNumbers: parsed.rowNumbers };
}

const baseCtx: InvoiceImportContext = {
  today: "2026-09-26",
  orgPaymentTermsDays: 30,
  issuers: [
    { id: "fl", kind: "self_employed", name: "Marc Sanjuan", taxId: "48174989V", activeFrom: null, activeUntil: null, archived: false, isPrimary: false },
    { id: "sl", kind: "company", name: "GNERAI SL", taxId: null, activeFrom: null, activeUntil: null, archived: false, isPrimary: true },
  ],
  series: [
    { id: "fl-F", issuerId: "fl", code: "F", kind: "ordinary", format: "{yyyy}-{n:4}", resetYearly: true, isDefault: true, archived: false },
    { id: "fl-A", issuerId: "fl", code: "A", kind: "ordinary", format: "A-{n:3}", resetYearly: false, isDefault: false, archived: true },
    { id: "fl-R", issuerId: "fl", code: "R", kind: "rectifying", format: "R{yyyy}-{n:4}", resetYearly: true, isDefault: true, archived: false },
    { id: "sl-F", issuerId: "sl", code: "F", kind: "ordinary", format: "{yyyy}-{n:4}", resetYearly: true, isDefault: true, archived: false },
  ],
  counters: [{ seriesId: "fl-F", year: 2025, lastNumber: 10 }],
  taxRates: [
    { id: "vat21", kind: "vat", rateBps: 2100, regime: "general", legalNote: null, isDefault: true, archived: false },
    { id: "exempt", kind: "vat", rateBps: 0, regime: "exempt", legalNote: "Operación exenta", isDefault: false, archived: false },
    { id: "isp", kind: "vat", rateBps: 0, regime: "reverse_charge_eu", legalNote: "Inversión del sujeto pasivo", isDefault: false, archived: false },
    { id: "irpf15", kind: "irpf", rateBps: 1500, regime: null, legalNote: null, isDefault: true, archived: false },
  ],
  clients: [{ id: "c-port", displayName: "Restaurant del Port", legalName: "Port Mataró SL", taxId: "B12345674", archived: false, paymentTermsDays: null }],
  invoices: [],
};

function options(over: Partial<InvoiceImportOptions> = {}): InvoiceImportOptions {
  return {
    issuerId: "fl",
    defaultVatBps: null,
    paidMode: "all",
    lineTypes: {},
    decimal: ",",
    dateOrder: "dmy",
    defaultDescription: "Servicios profesionales",
    defaultRectificationReason: "Rectificación importada",
    ...over,
  };
}

function plan(csv: string, opts: Partial<InvoiceImportOptions> = {}, ctx: Partial<InvoiceImportContext> = {}, mapping?: ColumnMapping) {
  const t = table(csv);
  return planInvoiceImport(t, mapping ?? autoMapColumns("invoices", t.headers), options(opts), { ...baseCtx, ...ctx });
}

const PER_INVOICE = "Nº Factura;Fecha;Cliente;NIF;Concepto;Base imponible;% IVA;Cuota IVA;% IRPF;Retención;Total\n";

describe("una fila por factura", () => {
  it("crea la factura con su número, su secuencia, su cliente existente y la línea clasificada", () => {
    const p = plan(`${PER_INVOICE}2025-0011;15/03/2025;Port Mataró SL;B12345674;Mantenimiento web marzo;150,00;21;31,50;15;22,50;159,00\n`);
    expect(p.counts).toEqual({ create: 1, update: 0, skip: 0, error: 0 });
    const inv = p.invoices[0]!;
    expect(inv).toMatchObject({
      action: "create",
      number: "2025-0011",
      issuerId: "fl",
      seriesId: "fl-F",
      sequence: 11,
      numberYear: 2025,
      fiscalYear: 2025,
      kind: "ordinary",
      issuedOn: "2025-03-15",
      dueOn: "2025-04-14",
      client: { kind: "existing", id: "c-port" },
      irpfBps: 1500,
      totals: { subtotalCents: 15_000, vatCents: 3150, irpfCents: 2250, totalCents: 15_900 },
      payment: { paidOn: "2025-04-14", amountCents: 15_900 },
      externalId: invoiceExternalId("fl", "2025-0011"),
    });
    expect(inv.lines).toHaveLength(1);
    expect(inv.lines[0]).toMatchObject({
      description: "Mantenimiento web marzo",
      quantity: "1",
      unitPriceCents: 15_000,
      baseCents: 15_000,
      vatBps: 2100,
      vatRegime: "general",
      taxRateId: "vat21",
      irpfApplies: true,
      irpfCents: 2250,
      classification: { billingType: "monthly", source: "keyword", rule: { id: "monthly_service", keyword: "mantenimiento" } },
    });
    expect(p.byCategory).toEqual({ recurring: 15_000, one_off: 0, usage: 0 });
    expect(p.counters).toEqual([{ seriesId: "fl-F", year: 2025, from: 10, to: 11 }]);
  });

  it("deduce el IVA de la cuota y el IRPF del total cuando faltan los tipos", () => {
    const p = plan("Número;Fecha;Cliente;Concepto;Base;IVA;Total\n2025-0012;20/03/2025;Port Mataró SL;Web;900,00;189,00;954,00\n");
    const inv = p.invoices[0]!;
    expect(inv.action).toBe("create");
    expect(inv.lines[0]).toMatchObject({ vatBps: 2100, irpfCents: 13_500 });
    expect(inv.irpfBps).toBe(1500);
    expect(inv.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["vat_rate_inferred", "irpf_inferred"]));
  });

  it("sin nada de IVA: el tipo por defecto (con aviso) o un error", () => {
    const csv = "Número;Fecha;Cliente;Concepto;Base\n2025-0012;20/03/2025;Port Mataró SL;Web;900,00\n";
    expect(plan(csv).invoices[0]!.issues.map((i) => i.code)).toContain("vat_rate_unknown");
    const withDefault = plan(csv, { defaultVatBps: 2100 }).invoices[0]!;
    expect(withDefault).toMatchObject({ action: "create", totals: { vatCents: 18_900, totalCents: 108_900 } });
    expect(withDefault.issues.map((i) => i.code)).toContain("vat_rate_default");
  });

  it("si el total no cuadra con base + IVA − IRPF, error", () => {
    const p = plan(`${PER_INVOICE}2025-0011;15/03/2025;Port Mataró SL;B12345674;Web;150,00;21;31,50;15;22,50;160,00\n`);
    expect(p.invoices[0]).toMatchObject({ action: "error" });
    expect(p.invoices[0]!.issues.find((i) => i.code === "totals_mismatch")!.params).toEqual({ expected: 16_000, computed: 15_900 });
  });

  it("un 0 % sin régimen se deduce del país del cliente (UE → inversión del sujeto pasivo)", () => {
    const p = plan("Número;Fecha;Cliente;NIF;País;Concepto;Base;% IVA\n2025-0013;01/04/2025;Maison SARL;FR12345678901;Francia;Diseño web;1.000,00;0\n");
    const inv = p.invoices[0]!;
    expect(inv.lines[0]).toMatchObject({ vatBps: 0, vatRegime: "reverse_charge_eu", taxRateId: "isp", legalNote: "Inversión del sujeto pasivo", irpfApplies: false });
    expect(inv.client).toEqual({ kind: "new", key: "nif:FR12345678901", name: "Maison SARL" });
    expect(p.newClients[0]).toMatchObject({ tax_id: "FR12345678901", tax_id_kind: "eu_vat", country_code: "FR" });
    expect(inv.issues.map((i) => i.code)).toContain("vat_regime_guessed");
  });
});

describe("una fila por línea, agrupadas por número", () => {
  const PER_LINE = "Número;Fecha;Cliente;NIF;Concepto;Cantidad;Precio;% IVA;Base imponible;Cuota IVA;Total\n";

  it("agrupa las líneas, clasifica cada una y comprueba los totales repetidos", () => {
    const p = plan(
      `${PER_LINE}2025-0011;15/03/2025;Fabrik SL;B87654315;Diseño web;1;1.500,00;21;1.850,00;388,50;2.238,50\n` +
        `2025-0011;15/03/2025;Fabrik SL;B87654315;Hosting anual;1;350,00;21;1.850,00;388,50;2.238,50\n`,
    );
    expect(p.counts.create).toBe(1);
    const inv = p.invoices[0]!;
    expect(inv.rowNumbers).toEqual([2, 3]);
    expect(inv.lines.map((l) => [l.description, l.baseCents, l.classification.billingType, l.classification.rule?.id])).toEqual([
      ["Diseño web", 150_000, "one_off", "one_off_project"],
      ["Hosting anual", 35_000, "yearly", "yearly_period"],
    ]);
    expect(inv.totals).toEqual({ subtotalCents: 185_000, vatCents: 38_850, irpfCents: 0, totalCents: 223_850 });
    expect(p.byCategory).toEqual({ recurring: 35_000, one_off: 150_000, usage: 0 });
    expect(p.rows.map((r) => [r.rowNumber, r.action])).toEqual([
      [2, "create"],
      [3, "create"],
    ]);
  });

  it("cuadra el céntimo cuando la app antigua calculaba el IVA sobre el total", () => {
    // 3 × 0,07 €: por línea 0,01 + 0,01 + 0,01 = 0,03; sobre la base (0,21 €) el IVA es 0,04.
    const rows = [1, 2, 3].map((n) => `2025-0011;15/03/2025;Port Mataró SL;B12345674;Línea ${n};1;0,07;21;0,21;0,04;0,25\n`).join("");
    const inv = plan(`${PER_LINE}${rows}`).invoices[0]!;
    expect(inv.action).toBe("create");
    expect(inv.totals).toEqual({ subtotalCents: 21, vatCents: 4, irpfCents: 0, totalCents: 25 });
    expect(inv.lines.map((l) => l.vatCents)).toEqual([2, 1, 1]);
    expect(inv.issues.find((i) => i.code === "rounding_adjusted")!.params).toEqual({ cents: 1 });
  });

  it("si las filas de una factura no coinciden en un dato de la factura, error", () => {
    const p = plan(
      `${PER_LINE}2025-0011;15/03/2025;Fabrik SL;B87654315;A;1;10,00;21;;;\n2025-0011;16/03/2025;Fabrik SL;B87654315;B;1;10,00;21;;;\n`,
    );
    expect(p.invoices[0]!.issues[0]).toMatchObject({ code: "group_inconsistent", field: "issued_on" });
  });

  it("los clientes nuevos se dan de alta una sola vez", () => {
    const p = plan(
      `${PER_LINE}2025-0011;15/03/2025;Fabrik SL;B87654315;A;1;10,00;21;;;\n2025-0012;16/03/2025;Fabrik SL;B87654315;B;1;10,00;21;;;\n`,
    );
    expect(p.newClients).toHaveLength(1);
    expect(p.newClients[0]).toMatchObject({ key: "nif:B87654315", display_name: "Fabrik SL", rowNumbers: [2, 3] });
  });
});

describe("numeración, contadores y lo que ya existe", () => {
  const CSV = "Número;Fecha;Cliente;Concepto;Base;% IVA\n";

  it("el número tiene que seguir el formato de una serie del emisor (se prueban todas)", () => {
    const p = plan(`${CSV}A-007;10/01/2024;Port Mataró SL;Web;100,00;21\n2025-12;10/01/2025;Port Mataró SL;Web;100,00;21\n`);
    expect(p.invoices.find((i) => i.number === "A-007")).toMatchObject({ action: "create", seriesId: "fl-A", sequence: 7, fiscalYear: 0 });
    const bad = p.invoices.find((i) => i.number === "2025-12")!;
    expect(bad.action).toBe("error");
    expect(bad.issues.find((i) => i.code === "number_format")!.params).toEqual({ formats: "{yyyy}-{n:4} · A-{n:3}" });
  });

  it("los contadores avanzan hasta el último importado (nunca bajan) y se enseñan los huecos", () => {
    const p = plan(`${CSV}2025-0013;10/05/2025;Port Mataró SL;Web;100,00;21\n2025-0011;10/04/2025;Port Mataró SL;Web;100,00;21\n2025-0004;10/02/2025;Port Mataró SL;Web;100,00;21\n`);
    expect(p.counters).toEqual([{ seriesId: "fl-F", year: 2025, from: 10, to: 13 }]);
    expect(p.gaps).toEqual([{ seriesId: "fl-F", year: 2025, ranges: [[1, 3], [5, 10], [12, 12]], count: 10 }]);
    // Orden de confirmación: por fecha.
    expect(p.invoices.map((i) => i.number)).toEqual(["2025-0004", "2025-0011", "2025-0013"]);
  });

  it("avisa si entre históricos un número mayor lleva una fecha anterior", () => {
    const p = plan(`${CSV}2025-0011;10/04/2025;Port Mataró SL;Web;100,00;21\n2025-0012;01/04/2025;Port Mataró SL;Web;100,00;21\n`);
    const later = p.invoices.find((i) => i.number === "2025-0012")!;
    expect(later.action).toBe("create");
    expect(later.issues.find((i) => i.code === "date_order_warning")!.params).toEqual({ number: "2025-0011", date: "2025-04-10" });
  });

  const imported = (over: Partial<ExistingInvoice> = {}): ExistingInvoice => ({
    id: "inv-1",
    issuerId: "fl",
    seriesId: "fl-F",
    clientId: "c-port",
    number: "2025-0011",
    fiscalYear: 2025,
    sequence: 11,
    issuedOn: "2025-04-10",
    source: "import",
    externalId: invoiceExternalId("fl", "2025-0011"),
    kind: "ordinary",
    totalCents: 12_100,
    ...over,
  });

  it("reimportar la misma factura la salta (y avisa si el fichero trae otros importes)", () => {
    const same = plan(`${CSV}2025-0011;10/04/2025;Port Mataró SL;Web;100,00;21\n`, {}, { invoices: [imported()] });
    expect(same.invoices[0]).toMatchObject({ action: "skip", existingId: "inv-1" });
    expect(same.invoices[0]!.issues[0]!.code).toBe("already_imported");
    expect(same.counts).toEqual({ create: 0, update: 0, skip: 1, error: 0 });
    expect(same.counters).toEqual([]);

    const differs = plan(`${CSV}2025-0011;10/04/2025;Port Mataró SL;Web;200,00;21\n`, {}, { invoices: [imported()] });
    expect(differs.invoices[0]).toMatchObject({ action: "skip" });
    expect(differs.invoices[0]!.issues[0]!.code).toBe("already_imported_differs");
  });

  it("un número que GNERAI OS ya ha usado es un error", () => {
    const p = plan(`${CSV}2025-0011;10/04/2025;Port Mataró SL;Web;100,00;21\n`, {}, { invoices: [imported({ source: "app", externalId: null })] });
    expect(p.invoices[0]).toMatchObject({ action: "error" });
    expect(p.invoices[0]!.issues.map((i) => i.code)).toContain("number_taken");
  });

  it("respeta el orden de fechas de lo que GNERAI OS ya ha emitido en la serie y el año", () => {
    const app = imported({ id: "app-5", number: "2026-0005", fiscalYear: 2026, sequence: 5, issuedOn: "2026-03-01", source: "app", externalId: null });
    const p = plan(`${CSV}2026-0007;15/02/2026;Port Mataró SL;Web;100,00;21\n2026-0003;15/02/2026;Port Mataró SL;Web;100,00;21\n2026-0004;02/03/2026;Port Mataró SL;Web;100,00;21\n`, {}, { invoices: [app] });
    const byNumber = Object.fromEntries(p.invoices.map((i) => [i.number, i]));
    expect(byNumber["2026-0007"]!.issues.find((i) => i.code === "series_order_conflict")!.params).toEqual({ number: "2026-0005", date: "2026-03-01" });
    expect(byNumber["2026-0003"]!.action).toBe("create");
    expect(byNumber["2026-0004"]!.action).toBe("error");
  });

  it("fechas futuras y emisores que no estaban activos", () => {
    expect(plan(`${CSV}2026-0100;01/12/2026;Port Mataró SL;Web;100,00;21\n`).invoices[0]!.issues.map((i) => i.code)).toContain("date_future");
    const sl = plan(`${CSV}2025-0001;01/02/2025;Port Mataró SL;Web;100,00;21\n`, { issuerId: "sl" });
    expect(sl.invoices[0]!.issues.map((i) => i.code)).toContain("issuer_inactive");
    expect(plan(`${CSV}2025-0001;01/02/2025;Port Mataró SL;Web;100,00;21\n`, { issuerId: null }).invoices[0]!.issues[0]!.code).toBe(
      "issuer_missing",
    );
  });
});

describe("rectificativas", () => {
  const CSV = "Número;Fecha;Cliente;Concepto;Base;% IVA;Factura rectificada\n";

  it("van a la serie rectificativa, en negativo, y su original tiene que existir", () => {
    const p = plan(
      `${CSV}2025-0011;10/04/2025;Port Mataró SL;Web;100,00;21;\nR2025-0001;20/04/2025;Port Mataró SL;Anulación;100,00;21;2025-0011\nR2025-0002;21/04/2025;Port Mataró SL;Anulación;-50,00;21;2025-0099\n`,
    );
    const byNumber = Object.fromEntries(p.invoices.map((i) => [i.number, i]));
    expect(byNumber["R2025-0001"]).toMatchObject({
      action: "create",
      kind: "rectifying",
      seriesId: "fl-R",
      rectifiesNumber: "2025-0011",
      rectificationReason: "Rectificación importada",
      totals: { subtotalCents: -10_000, vatCents: -2100, totalCents: -12_100 },
      payment: null,
    });
    expect(byNumber["R2025-0001"]!.issues.map((i) => i.code)).toContain("rectifying_negated");
    expect(byNumber["R2025-0002"]!.issues.map((i) => i.code)).toContain("rectified_unknown");
    // Las ordinarias se confirman antes que las rectificativas.
    expect(p.invoices.map((i) => i.kind)).toEqual(["ordinary", "rectifying", "rectifying"]);
  });

  it("una ordinaria en negativo sin factura rectificada es un error", () => {
    const p = plan(`${CSV}2025-0011;10/04/2025;Port Mataró SL;Abono;-100,00;21;\n`);
    expect(p.invoices[0]!.issues.map((i) => i.code)).toContain("negative_total");
  });
});

describe("cobros y clasificación a mano", () => {
  const CSV = "Número;Fecha;Vencimiento;Cliente;Concepto;Base;% IVA;Fecha de cobro;Estado\n";
  const rows =
    "2025-0011;10/04/2025;10/05/2025;Port Mataró SL;Web;100,00;21;12/05/2025;\n" +
    "2025-0012;11/04/2025;11/05/2025;Port Mataró SL;Web;100,00;21;;Cobrada\n" +
    "2025-0013;12/04/2025;12/05/2025;Port Mataró SL;Web;100,00;21;;Pendiente\n" +
    "2026-0001;01/09/2026;01/10/2026;Port Mataró SL;Web;100,00;21;;\n";

  it("según la columna: fecha de cobro, «cobrada» (en su vencimiento) o pendiente", () => {
    const p = plan(`${CSV}${rows}`, { paidMode: "column" });
    expect(p.invoices.map((i) => [i.number, i.payment?.paidOn ?? null])).toEqual([
      ["2025-0011", "2025-05-12"],
      ["2025-0012", "2025-05-11"],
      ["2025-0013", null],
      ["2026-0001", null],
    ]);
  });

  it("todas cobradas (nunca en el futuro) o ninguna", () => {
    const all = plan(`${CSV}${rows}`, { paidMode: "all" });
    expect(all.invoices.find((i) => i.number === "2026-0001")!.payment).toEqual({ paidOn: "2026-09-26", amountCents: 12_100 });
    const none = plan(`${CSV}${rows}`, { paidMode: "none" });
    expect(none.invoices.every((i) => i.payment === null)).toBe(true);
  });

  it("el tipo de línea que elige el socio manda, y se conserva la sugerencia con su regla", () => {
    const p = plan(`${CSV}${rows}`, { lineTypes: { "2": "monthly" } });
    const line = p.invoices.find((i) => i.number === "2025-0011")!.lines[0]!;
    expect(line.classification).toMatchObject({ billingType: "monthly", source: "manual" });
    expect(line.suggested).toMatchObject({ billingType: "one_off", rule: { id: "one_off_project" } });
    expect(toImportPayload(p.invoices[0]!, "c-port").lines[0]!.billing_type).toBe("monthly");
  });
});

describe("la app de facturas (JSON de su localStorage)", () => {
  it("se aplana a una fila por línea, se mapea sola y cuadra con sus totales", () => {
    const facturas = [
      {
        numero: "2026-0036",
        fechaEmision: "2026-06-30",
        fechaVencimiento: "2026-07-30",
        formaPago: "Transferencia",
        cliente: { nombre: "Port Mataró SL", nif: "B12345674", direccion: "Passeig Marítim 3", cp: "08301", ciudad: "Mataró", provincia: "Barcelona", pais: "España", email: "hola@port.cat" },
        lineas: [
          { descripcion: "Mantenimiento web junio", cantidad: 1, precio: 150 },
          { descripcion: "Campaña Meta Ads", cantidad: 2, precio: 375 },
        ],
        notas: "",
        aplicaIRPF: true,
        emitidaEn: "2026-06-30T10:00:00.000Z",
        totales: { base: 900, iva: 189, irpf: 135, total: 954, porcentajeIVA: 21, porcentajeIRPF: 15 },
      },
    ];
    const dump = { "facturas:emitidas": JSON.stringify(facturas), "factura:contador:2026": "37" };
    const read = readImportFile(encodeUtf8(JSON.stringify(dump)));
    if (!read.ok) throw new Error(read.reason);
    expect(read.meta).toMatchObject({ format: "json", rows: 2, decimalHint: ".", legacyCounters: [{ year: 2026, lastNumber: 37 }] });
    const mapping = autoMapColumns("invoices", read.table.headers);
    const formats = inferInvoiceFormats(read.table, mapping, read.meta.decimalHint);
    expect(formats).toEqual({ decimal: ".", dateOrder: "dmy" });
    const p = planInvoiceImport(read.table, mapping, options({ ...formats }), baseCtx);
    const inv = p.invoices[0]!;
    expect(inv).toMatchObject({
      action: "create",
      number: "2026-0036",
      sequence: 36,
      issuedOn: "2026-06-30",
      dueOn: "2026-07-30",
      irpfBps: 1500,
      paymentMethod: "transfer",
      totals: { subtotalCents: 90_000, vatCents: 18_900, irpfCents: 13_500, totalCents: 95_400 },
    });
    expect(inv.lines.map((l) => [l.quantity, l.unitPriceCents, l.baseCents, l.classification.billingType])).toEqual([
      ["1", 15_000, 15_000, "monthly"],
      ["2", 37_500, 75_000, "usage"],
    ]);
    expect(p.byCategory).toEqual({ recurring: 15_000, one_off: 0, usage: 75_000 });
  });

  it("un .xlsx se rechaza con un motivo claro (hay que guardarlo como CSV)", () => {
    expect(readImportFile(Uint8Array.of(0x50, 0x4b, 0x03, 0x04, 0x00))).toEqual({ ok: false, reason: "xlsx" });
    expect(readImportFile(new Uint8Array())).toEqual({ ok: false, reason: "empty" });
    expect(readImportFile(encodeUtf8('{"otra":"cosa"}'))).toEqual({ ok: false, reason: "json_unsupported" });
    expect(readImportFile(encodeUtf8("Solo;Cabecera\n"))).toEqual({ ok: false, reason: "no_rows" });
  });

  it("un CSV de Excel en Windows-1252 con ';' y coma decimal", () => {
    // "Número;Fecha;Cliente;Concepto;Base;% IVA\r\n2025-0011;10/04/2025;Mataró SL;Diseño;1.234,56;21\r\n" en Windows-1252.
    const text = "Número;Fecha;Cliente;Concepto;Base;% IVA\r\n2025-0011;10/04/2025;Mataró SL;Diseño;1.234,56;21\r\n";
    const bytes = Uint8Array.from([...text].map((c) => c.charCodeAt(0)));
    const read = readImportFile(bytes);
    if (!read.ok) throw new Error(read.reason);
    expect(read.meta).toMatchObject({ format: "csv", encoding: "windows-1252", delimiter: ";", decimalHint: "," });
    expect(read.table.rows[0]).toEqual(["2025-0011", "10/04/2025", "Mataró SL", "Diseño", "1.234,56", "21"]);
    const mapping = autoMapColumns("invoices", read.table.headers);
    const p = planInvoiceImport(read.table, mapping, options(inferInvoiceFormats(read.table, mapping, read.meta.decimalHint)), baseCtx);
    expect(p.invoices[0]).toMatchObject({ action: "create", totals: { subtotalCents: 123_456 } });
  });
});

describe("toImportPayload", () => {
  it("el JSON de import_historical_invoice", () => {
    const p = plan(`${PER_INVOICE}2025-0011;15/03/2025;Port Mataró SL;B12345674;Web;150,00;21;31,50;15;22,50;159,00\n`);
    expect(toImportPayload(p.invoices[0]!, "c-port")).toEqual({
      external_id: "invoice:fl:2025-0011",
      issuer_id: "fl",
      series_id: "fl-F",
      client_id: "c-port",
      number: "2025-0011",
      sequence: 11,
      number_year: 2025,
      kind: "ordinary",
      rectifies_number: null,
      rectification_reason: null,
      issued_on: "2025-03-15",
      operation_on: null,
      due_on: "2025-04-14",
      irpf_bps: 1500,
      payment_method: "transfer",
      notes: null,
      client_party: {
        legal_name: "Port Mataró SL",
        tax_id: "B12345674",
        tax_id_kind: "es",
        address_line: null,
        postal_code: null,
        city: null,
        province: null,
        country_code: "ES",
      },
      totals: { subtotal_cents: 15_000, vat_cents: 3150, irpf_cents: 2250, total_cents: 15_900 },
      lines: [
        {
          position: 0,
          description: "Web",
          quantity: "1",
          unit_price_cents: 15_000,
          discount_bps: 0,
          base_cents: 15_000,
          tax_rate_id: "vat21",
          vat_bps: 2100,
          vat_regime: "general",
          vat_cents: 3150,
          irpf_applies: true,
          irpf_cents: 2250,
          legal_note: null,
          billing_type: "one_off",
          period_start: null,
          period_end: null,
        },
      ],
      payment: { paid_on: "2025-04-14", amount_cents: 15_900, method: "transfer" },
    });
    expect(() => toImportPayload({ ...p.invoices[0]!, action: "error" }, "c-port")).toThrow();
  });
});
