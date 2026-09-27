// Importar facturas históricas (ya emitidas en otra herramienta) desde un CSV: una fila por factura
// o una por línea, agrupadas por número. Para cada factura se resuelven emisor, serie (el número
// tiene que seguir su formato: de ahí sale la secuencia con la que continúa el contador, §7.4) y
// cliente (existente o nuevo), se construyen las líneas con su tipo (recurrente / puntual / uso,
// por reglas de palabras clave, §7.8) y se cuadran los importes con los que imprimía la factura.
//
// El resultado es un plan: qué se crea, qué se salta (ya importada) y qué tiene errores, con los
// motivos. La base de datos vuelve a comprobar lo esencial al confirmar (import_historical_invoice).

import { addDays, compareCivil, minCivil, parseCivilDate, type CivilDate } from "../dates/civil-date";
import { divRoundHalfAwayFromZero } from "../money";
import { computeLine, type VatRegime } from "../tax";
import {
  classifyFromColumn,
  classifyLine,
  type ImportBillingType,
  type LineClassification,
  manualClassification,
  type RevenueCategory,
} from "./classify";
import type { ColumnMapping, ImportField } from "./fields";
import { formatHasYear, parseInvoiceNumber } from "./invoice-number";
import { type ActionCounts, emptyCounts, error, hasErrors, info, type Issue, type IssueCode, type RowAction, warning } from "./issues";
import { cellOf, fieldValues, type ImportTable } from "./table";
import { cleanText, normalizeKey } from "./text";
import {
  classifyTaxId,
  type DateOrder,
  type DecimalSeparator,
  EU_COUNTRIES,
  inferDateOrder,
  inferDecimalSeparator,
  parseAmountCents,
  parseBooleanLoose,
  parseCountry,
  parseDateLoose,
  parseEmails,
  parsePaymentMethod,
  parsePostalCode,
  parseQuantity,
  parseRateBps,
  type PaymentMethod,
  type TaxIdKind,
} from "./values";

// ---------------------------------------------------------------------------
// Contexto y opciones
// ---------------------------------------------------------------------------

export type ImportIssuer = {
  id: string;
  kind: "company" | "self_employed";
  name: string;
  taxId: string | null;
  activeFrom: CivilDate | null;
  activeUntil: CivilDate | null;
  archived: boolean;
  isPrimary: boolean;
};

export type ImportSeries = {
  id: string;
  issuerId: string;
  code: string;
  kind: "ordinary" | "rectifying";
  format: string;
  resetYearly: boolean;
  isDefault: boolean;
  archived: boolean;
};

export type ImportTaxRate = {
  id: string;
  kind: "vat" | "irpf";
  rateBps: number;
  regime: VatRegime | null;
  legalNote: string | null;
  isDefault: boolean;
  archived: boolean;
};

export type ImportClient = {
  id: string;
  displayName: string;
  legalName: string | null;
  taxId: string | null;
  archived: boolean;
  paymentTermsDays: number | null;
};

/** Facturas con número que ya están en GNERAI OS (emitidas desde la app o importadas). */
export type ExistingInvoice = {
  id: string;
  issuerId: string;
  seriesId: string | null;
  clientId: string;
  number: string;
  fiscalYear: number | null;
  sequence: number | null;
  issuedOn: CivilDate;
  source: "app" | "import";
  externalId: string | null;
  kind: "ordinary" | "rectifying";
  totalCents: number;
};

export type InvoiceImportContext = {
  today: CivilDate;
  orgPaymentTermsDays: number;
  issuers: readonly ImportIssuer[];
  series: readonly ImportSeries[];
  counters: readonly { seriesId: string; year: number; lastNumber: number }[];
  taxRates: readonly ImportTaxRate[];
  clients: readonly ImportClient[];
  invoices: readonly ExistingInvoice[];
};

export type PaidMode = "column" | "all" | "none";

export type InvoiceImportOptions = {
  /** Emisor de todas las facturas si el fichero no trae la columna del NIF del emisor. */
  issuerId: string | null;
  /** IVA que se aplica cuando el fichero no permite saberlo (null: es un error). */
  defaultVatBps: number | null;
  /** Cobradas según la columna, todas (en su vencimiento) o ninguna. */
  paidMode: PaidMode;
  /** Tipos de línea corregidos a mano en la simulación, por número de fila. */
  lineTypes: Readonly<Record<string, ImportBillingType>>;
  decimal: DecimalSeparator;
  dateOrder: DateOrder;
  /** Concepto de una línea sin descripción. */
  defaultDescription: string;
  /** Motivo de una rectificativa que no lo trae. */
  defaultRectificationReason: string;
};

/** Separador decimal y orden de las fechas que se deducen de las columnas mapeadas. */
export function inferInvoiceFormats(
  table: ImportTable,
  mapping: ColumnMapping,
  fallbackDecimal: DecimalSeparator,
): { decimal: DecimalSeparator; dateOrder: DateOrder } {
  const amounts = fieldValues(table, mapping, ["line_amount", "unit_price", "base", "vat_amount", "irpf_amount", "total", "quantity"]);
  const dates = fieldValues(table, mapping, ["issued_on", "due_on", "operation_on", "paid_on", "period_start", "period_end"]);
  return { decimal: inferDecimalSeparator(amounts, fallbackDecimal), dateOrder: inferDateOrder(dates) };
}

// ---------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------

export type PlannedLine = {
  rowNumber: number;
  description: string;
  quantity: string;
  unitPriceCents: number;
  discountBps: number;
  baseCents: number;
  vatBps: number;
  vatRegime: VatRegime;
  vatCents: number;
  irpfApplies: boolean;
  irpfCents: number;
  taxRateId: string | null;
  legalNote: string | null;
  periodStart: CivilDate | null;
  periodEnd: CivilDate | null;
  /** La que se usa: la del socio si la ha cambiado; si no, la sugerida. */
  classification: LineClassification;
  /** La automática (columna o palabras clave), para enseñar la regla aunque se haya cambiado. */
  suggested: LineClassification;
};

/** Datos del cliente tal y como salían en la factura (su copia congelada). */
export type ClientParty = {
  legal_name: string | null;
  tax_id: string | null;
  tax_id_kind: TaxIdKind;
  address_line: string | null;
  postal_code: string | null;
  city: string | null;
  province: string | null;
  country_code: string;
};

export type PlannedClient = { kind: "existing"; id: string; name: string } | { kind: "new"; key: string; name: string };

/** Cliente que no está en GNERAI OS y se da de alta con los datos de su primera factura. */
export type NewClientDraft = ClientParty & {
  key: string;
  display_name: string;
  email: string | null;
  rowNumbers: number[];
};

export type Totals = { subtotalCents: number; vatCents: number; irpfCents: number; totalCents: number };

export type PlannedInvoice = {
  externalId: string;
  rowNumbers: number[];
  action: "create" | "skip" | "error";
  issues: Issue[];
  number: string;
  issuerId: string | null;
  seriesId: string | null;
  sequence: number | null;
  /** Año del número (con el que se formatea y, si la serie se reinicia, el del contador). */
  numberYear: number | null;
  fiscalYear: number | null;
  kind: "ordinary" | "rectifying";
  rectifiesNumber: string | null;
  rectificationReason: string | null;
  issuedOn: CivilDate | null;
  operationOn: CivilDate | null;
  dueOn: CivilDate | null;
  client: PlannedClient | null;
  clientParty: ClientParty | null;
  lines: PlannedLine[];
  irpfBps: number;
  totals: Totals | null;
  paymentMethod: PaymentMethod;
  payment: { paidOn: CivilDate; amountCents: number } | null;
  notes: string | null;
  /** La factura que ya existe, si se salta por estar ya importada. */
  existingId: string | null;
};

export type CounterChange = { seriesId: string; year: number; from: number; to: number };
export type SeriesGap = { seriesId: string; year: number; ranges: [number, number][]; count: number };
export type InvoiceRowResult = { rowNumber: number; action: RowAction; issues: Issue[]; externalId: string | null };

export type InvoiceImportPlan = {
  /** En el orden en que se confirman: ordinarias antes que rectificativas; dentro, por fecha y número. */
  invoices: PlannedInvoice[];
  newClients: NewClientDraft[];
  rows: InvoiceRowResult[];
  /** Por factura. */
  counts: ActionCounts;
  /** Suma de lo que se crea. */
  totals: Totals;
  /** Base de lo que se crea por categoría: recurrente, uso y puntual nunca se mezclan. */
  byCategory: Record<RevenueCategory, number>;
  /** Cómo quedan los contadores de las series (nunca bajan). */
  counters: CounterChange[];
  /** Números de cada serie y año que no estarán en GNERAI OS tras importar. */
  gaps: SeriesGap[];
};

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** Tipos con los que se prueba a deducir el IVA o el IRPF de los importes (además de los de la org). */
const VAT_CANDIDATES = [2100, 1000, 400, 500, 0, 750, 200];
const IRPF_CANDIDATES = [1500, 700, 1900, 1800, 100, 200, 2400, 2000, 900];

/** Campos de la factura (no de la línea): todas las filas de una factura tienen que coincidir. */
const INVOICE_LEVEL = [
  "issued_on",
  "operation_on",
  "due_on",
  "series",
  "kind",
  "rectifies_number",
  "rectification_reason",
  "client_name",
  "client_tax_id",
  "client_address",
  "client_postal_code",
  "client_city",
  "client_province",
  "client_country",
  "client_email",
  "irpf_rate",
  "irpf_amount",
  "vat_amount",
  "base",
  "total",
  "paid",
  "paid_on",
  "payment_method",
] as const satisfies readonly ImportField[];

type InvoiceLevelField = (typeof INVOICE_LEVEL)[number];

const RECTIFYING_WORDS = new Set(["rectificativa", "rectificativo", "factura rectificativa", "r", "abono", "rectifying", "credit note", "si", "s", "yes", "true", "1", "x"]);
const ORDINARY_WORDS = new Set(["ordinaria", "ordinario", "normal", "f", "factura", "ordinary", "invoice", "no", "n", "false", "0"]);

function applyRate(base: number, bps: number): number {
  return Number(divRoundHalfAwayFromZero(BigInt(base) * BigInt(bps), BigInt(10_000)));
}

function lineTax(lines: readonly { baseCents: number }[], bps: number): number {
  return lines.reduce((sum, l) => sum + applyRate(l.baseCents, bps), 0);
}

/** El tipo candidato con el que las líneas dan `target` (± 1 céntimo por línea); el más exacto. */
function snapRate(lines: readonly { baseCents: number }[], target: number, candidates: readonly number[]): number | null {
  const tolerance = Math.max(1, lines.length);
  let best: { bps: number; diff: number } | null = null;
  for (const bps of candidates) {
    const diff = Math.abs(lineTax(lines, bps) - target);
    if (diff <= tolerance && (!best || diff < best.diff)) best = { bps, diff };
  }
  return best?.bps ?? null;
}

/**
 * Reparte `diff` céntimos entre las líneas elegibles (de 1 en 1, empezando por la de mayor base)
 * para que la suma cuadre con lo que imprimía la factura: la app antigua calculaba el IVA sobre la
 * base total y aquí se redondea por línea.
 */
function distribute(values: number[], bases: readonly number[], eligible: readonly boolean[], diff: number): boolean {
  const order = values
    .map((_, i) => i)
    .filter((i) => eligible[i])
    .sort((a, b) => Math.abs(bases[b]!) - Math.abs(bases[a]!));
  if (order.length === 0) return diff === 0;
  const step = diff > 0 ? 1 : -1;
  for (let k = 0; k < Math.abs(diff); k++) values[order[k % order.length]!]! += step;
  return true;
}

/** "1.5" → 1500 milésimas. */
function quantityThousandths(quantity: string): bigint {
  const [integer, fraction = ""] = quantity.split(".");
  return BigInt(`${integer}${fraction.padEnd(3, "0")}`);
}

function parseRectifying(value: string): boolean | null {
  const key = normalizeKey(value);
  if (key === "") return null;
  if (RECTIFYING_WORDS.has(key)) return true;
  if (ORDINARY_WORDS.has(key)) return false;
  return key.includes("rectific") || key.includes("abono") ? true : null;
}

function parseRegime(value: string): VatRegime | null {
  const key = normalizeKey(value);
  if (key === "") return null;
  if (/exent|exempt/.test(key)) return "exempt";
  if (/inversion|isp|reverse|intracomunitari|sujeto pasivo|subjecte passiu/.test(key)) return "reverse_charge_eu";
  if (/no sujet|not subject|no subjecte|fuera|localizacion|export/.test(key)) return "not_subject";
  if (/general|normal/.test(key)) return "general";
  return null;
}

function addToRanges(ranges: [number, number][], n: number) {
  const last = ranges[ranges.length - 1];
  if (last && last[1] === n - 1) last[1] = n;
  else ranges.push([n, n]);
}

function sameClient(a: PlannedClient | null, b: PlannedClient | null): boolean {
  if (!a || !b || a.kind !== b.kind) return false;
  return a.kind === "existing" ? a.id === (b as { id: string }).id : a.key === (b as { key: string }).key;
}

/** Identificador de importación de una factura: su número, que es único por emisor. */
export function invoiceExternalId(issuerId: string, number: string): string {
  return `invoice:${issuerId}:${number}`;
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

type Group = {
  number: string;
  issuerId: string | null;
  issuerIssue: Issue | null;
  rows: { row: readonly string[]; rowNumber: number }[];
};

type Indexes = {
  issuersById: Map<string, ImportIssuer>;
  existingByExternal: Map<string, ExistingInvoice>;
  existingByNumber: Map<string, ExistingInvoice>;
  clientsByTaxId: Map<string, ImportClient>;
  clientsByName: Map<string, ImportClient[]>;
  newClients: Map<string, NewClientDraft>;
};

/**
 * Simula la importación de facturas históricas: el plan dice qué se crea, qué se salta (ya estaba
 * importada) y qué tiene errores, con los motivos, los contadores que avanzan y los números que
 * faltan. Confirmar es aplicar este plan (y la base de datos vuelve a validar cada factura).
 */
export function planInvoiceImport(
  table: ImportTable,
  mapping: ColumnMapping,
  options: InvoiceImportOptions,
  ctx: InvoiceImportContext,
): InvoiceImportPlan {
  const issuersByTaxId = new Map(ctx.issuers.filter((i) => i.taxId).map((i) => [i.taxId!, i]));
  const idx: Indexes = {
    issuersById: new Map(ctx.issuers.map((i) => [i.id, i])),
    existingByExternal: new Map(ctx.invoices.filter((i) => i.externalId).map((i) => [i.externalId!, i])),
    existingByNumber: new Map(ctx.invoices.map((i) => [`${i.issuerId}|${i.number}`, i])),
    clientsByTaxId: new Map(ctx.clients.filter((c) => c.taxId).map((c) => [c.taxId!, c])),
    clientsByName: new Map(),
    newClients: new Map(),
  };
  for (const c of ctx.clients) {
    for (const name of [c.displayName, c.legalName]) {
      if (!name) continue;
      const key = normalizeKey(name);
      const list = idx.clientsByName.get(key) ?? [];
      if (!list.includes(c)) list.push(c);
      idx.clientsByName.set(key, list);
    }
  }

  // 1. Agrupar las filas por emisor y número.
  const rows: InvoiceRowResult[] = [];
  const groups = new Map<string, Group>();
  table.rows.forEach((row, index) => {
    const rowNumber = table.rowNumbers[index] ?? index + 2;
    const number = cleanText(cellOf(row, mapping, "number"), 40);
    if (!number) {
      rows.push({ rowNumber, action: "error", issues: [error("required", { field: "number" })], externalId: null });
      return;
    }
    let issuerId: string | null = options.issuerId && idx.issuersById.has(options.issuerId) ? options.issuerId : null;
    let issuerIssue: Issue | null = issuerId ? null : error("issuer_missing");
    const issuerRaw = cellOf(row, mapping, "issuer_tax_id");
    if (issuerRaw) {
      const taxId = issuerRaw.toUpperCase().replace(/[^A-Z0-9]/g, "");
      const found = issuersByTaxId.get(taxId) ?? issuersByTaxId.get(taxId.replace(/^ES/, ""));
      issuerId = found?.id ?? null;
      issuerIssue = found ? null : error("issuer_unknown", { field: "issuer_tax_id", params: { value: issuerRaw } });
    }
    const key = `${issuerId ?? `?${issuerRaw}`}|${number}`;
    const group = groups.get(key) ?? { number, issuerId, issuerIssue, rows: [] };
    group.rows.push({ row, rowNumber });
    groups.set(key, group);
  });

  // 2. Cada grupo es una factura.
  const invoices = [...groups.values()].map((group) => planOne(group, mapping, options, ctx, idx));

  // 3. Rectificativas: la original tiene que existir (en GNERAI OS o en el fichero), del mismo emisor y cliente.
  for (const inv of invoices) {
    if (inv.kind !== "rectifying" || inv.action !== "create" || !inv.rectifiesNumber || !inv.issuerId) continue;
    const inDb = idx.existingByNumber.get(`${inv.issuerId}|${inv.rectifiesNumber}`);
    const inFile = invoices.find(
      (o) => o.issuerId === inv.issuerId && o.number === inv.rectifiesNumber && o.kind === "ordinary" && o.action !== "error",
    );
    const ok = inDb
      ? inDb.kind === "ordinary" && inv.client?.kind === "existing" && inDb.clientId === inv.client.id
      : inFile !== undefined && sameClient(inFile.client, inv.client);
    if (!ok) {
      inv.issues.push(error("rectified_unknown", { field: "rectifies_number", params: { number: inv.rectifiesNumber } }));
      inv.action = "error";
    }
  }

  // 4. Por serie y año: orden de fechas entre históricos (aviso), contadores y huecos.
  type Item = { sequence: number; issuedOn: CivilDate; number: string; planned: PlannedInvoice | null };
  const bySeriesYear = new Map<string, { seriesId: string; year: number; items: Item[] }>();
  for (const inv of invoices) {
    if (inv.action !== "create" || inv.seriesId === null || inv.fiscalYear === null || inv.sequence === null || !inv.issuedOn) continue;
    const key = `${inv.seriesId}|${inv.fiscalYear}`;
    const entry = bySeriesYear.get(key) ?? { seriesId: inv.seriesId, year: inv.fiscalYear, items: [] };
    entry.items.push({ sequence: inv.sequence, issuedOn: inv.issuedOn, number: inv.number, planned: inv });
    bySeriesYear.set(key, entry);
  }
  const counters: CounterChange[] = [];
  const gaps: SeriesGap[] = [];
  for (const entry of bySeriesYear.values()) {
    for (const e of ctx.invoices) {
      if (e.seriesId === entry.seriesId && e.fiscalYear === entry.year && e.sequence !== null) {
        entry.items.push({ sequence: e.sequence, issuedOn: e.issuedOn, number: e.number, planned: null });
      }
    }
    const items = entry.items.sort((a, b) => a.sequence - b.sequence);
    items.forEach((item, i) => {
      const previous = items[i - 1];
      if (previous && item.planned && compareCivil(item.issuedOn, previous.issuedOn) < 0) {
        item.planned.issues.push(warning("date_order_warning", { params: { number: previous.number, date: previous.issuedOn } }));
      }
    });
    const from = ctx.counters.find((c) => c.seriesId === entry.seriesId && c.year === entry.year)?.lastNumber ?? 0;
    const maxPlanned = Math.max(0, ...items.filter((i) => i.planned).map((i) => i.sequence));
    counters.push({ seriesId: entry.seriesId, year: entry.year, from, to: Math.max(from, maxPlanned) });

    const known = new Set(items.map((i) => i.sequence));
    const top = Math.max(0, ...known);
    const ranges: [number, number][] = [];
    let count = 0;
    for (let n = 1; n <= top; n++) {
      if (known.has(n)) continue;
      addToRanges(ranges, n);
      count += 1;
    }
    if (count > 0) gaps.push({ seriesId: entry.seriesId, year: entry.year, ranges: ranges.slice(0, 20), count });
  }

  // 5. Recuentos, totales y resultado por fila.
  const counts = emptyCounts();
  const totals: Totals = { subtotalCents: 0, vatCents: 0, irpfCents: 0, totalCents: 0 };
  const byCategory: Record<RevenueCategory, number> = { recurring: 0, one_off: 0, usage: 0 };
  for (const inv of invoices) {
    counts[inv.action] += 1;
    for (const rowNumber of inv.rowNumbers) rows.push({ rowNumber, action: inv.action, issues: inv.issues, externalId: inv.externalId });
    if (inv.action !== "create" || !inv.totals) continue;
    totals.subtotalCents += inv.totals.subtotalCents;
    totals.vatCents += inv.totals.vatCents;
    totals.irpfCents += inv.totals.irpfCents;
    totals.totalCents += inv.totals.totalCents;
    for (const line of inv.lines) byCategory[line.classification.category] += line.baseCents;
  }
  rows.sort((a, b) => a.rowNumber - b.rowNumber);

  // Solo se dan de alta los clientes de las facturas que se van a crear.
  const needed = new Set(invoices.flatMap((i) => (i.action === "create" && i.client?.kind === "new" ? [i.client.key] : [])));
  invoices.sort(
    (a, b) =>
      (a.kind === b.kind ? 0 : a.kind === "ordinary" ? -1 : 1) ||
      (a.issuedOn && b.issuedOn ? compareCivil(a.issuedOn, b.issuedOn) : 0) ||
      (a.sequence ?? 0) - (b.sequence ?? 0),
  );

  return {
    invoices,
    newClients: [...idx.newClients.values()].filter((c) => needed.has(c.key)),
    rows,
    counts,
    totals,
    byCategory,
    counters,
    gaps,
  };
}

function planOne(
  group: Group,
  mapping: ColumnMapping,
  options: InvoiceImportOptions,
  ctx: InvoiceImportContext,
  idx: Indexes,
): PlannedInvoice {
  const issues: Issue[] = [];
  const rowNumbers = group.rows.map((r) => r.rowNumber);
  const issuer = group.issuerId ? (idx.issuersById.get(group.issuerId) ?? null) : null;
  if (group.issuerIssue) issues.push(group.issuerIssue);
  const rowError = (code: IssueCode, field: ImportField, value: string, row: number) =>
    issues.push(error(code, { field, params: { value, row } }));

  // Campos de la factura: el primer valor no vacío; si otra fila dice otra cosa, error.
  const values = {} as Record<InvoiceLevelField, string>;
  for (const field of INVOICE_LEVEL) {
    let value = "";
    for (const { row } of group.rows) {
      const v = cellOf(row, mapping, field);
      if (v === "") continue;
      if (value === "") value = v;
      else if (v !== value) {
        issues.push(error("group_inconsistent", { field, params: { a: value, b: v } }));
        break;
      }
    }
    values[field] = value;
  }
  const date = (field: InvoiceLevelField, required: boolean): CivilDate | null => {
    const raw = values[field];
    if (!raw) {
      if (required) issues.push(error("required", { field }));
      return null;
    }
    const parsed = parseDateLoose(raw, options.dateOrder);
    if (!parsed) issues.push(error("date_invalid", { field, params: { value: raw } }));
    return parsed;
  };
  const amount = (field: InvoiceLevelField): number | null => {
    const raw = values[field];
    if (!raw) return null;
    const parsed = parseAmountCents(raw, options.decimal);
    if (parsed === null) issues.push(error("amount_invalid", { field, params: { value: raw } }));
    return parsed;
  };

  const issuedOn = date("issued_on", true);
  const operationOn = date("operation_on", false);
  let dueOn = date("due_on", false);
  const headerBase = amount("base");
  const headerVat = amount("vat_amount");
  const headerIrpf = amount("irpf_amount");
  const headerTotal = amount("total");
  let headerIrpfRate: number | null = null;
  if (values.irpf_rate) {
    headerIrpfRate = parseRateBps(values.irpf_rate, options.decimal);
    if (headerIrpfRate === null) issues.push(error("rate_invalid", { field: "irpf_rate", params: { value: values.irpf_rate } }));
  }

  if (issuedOn && compareCivil(issuedOn, ctx.today) > 0) issues.push(error("date_future", { field: "issued_on" }));
  if (issuer && issuedOn) {
    // La misma regla que la base de datos: la SL sin fecha de alta aún no existía.
    if (
      (issuer.activeFrom === null && issuer.kind === "company") ||
      (issuer.activeFrom !== null && compareCivil(issuedOn, issuer.activeFrom) < 0) ||
      (issuer.activeUntil !== null && compareCivil(issuedOn, issuer.activeUntil) > 0)
    ) {
      issues.push(error("issuer_inactive", { params: { name: issuer.name } }));
    }
    if (issuer.archived) issues.push(info("issuer_archived", { params: { name: issuer.name } }));
  }

  // Ordinaria o rectificativa.
  const rectifiesNumber = cleanText(values.rectifies_number, 40);
  let kind: "ordinary" | "rectifying" = rectifiesNumber ? "rectifying" : "ordinary";
  if (values.kind && parseRectifying(values.kind) === true) kind = "rectifying";
  if (kind === "rectifying" && !rectifiesNumber) issues.push(error("rectified_missing", { field: "rectifies_number" }));

  // Serie y secuencia: el número tiene que seguir el formato de una serie del emisor.
  let seriesId: string | null = null;
  let sequence: number | null = null;
  let numberYear: number | null = null;
  let fiscalYear: number | null = null;
  if (issuer) {
    const candidates = ctx.series
      .filter((s) => s.issuerId === issuer.id && s.kind === kind)
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || Number(a.archived) - Number(b.archived));
    const code = values.series.toUpperCase();
    const pool = code ? candidates.filter((s) => s.code === code) : candidates;
    if (pool.length === 0) {
      issues.push(error("series_unknown", { field: "series", params: { value: code || kind } }));
    } else {
      const fallbackYear = issuedOn ? parseCivilDate(issuedOn).year : Number(ctx.today.slice(0, 4));
      for (const s of pool) {
        const parsed = parseInvoiceNumber(s.format, group.number, fallbackYear);
        if (!parsed) continue;
        seriesId = s.id;
        sequence = parsed.sequence;
        numberYear = parsed.year;
        fiscalYear = s.resetYearly ? parsed.year : 0;
        if (issuedOn && formatHasYear(s.format) && parsed.year !== parseCivilDate(issuedOn).year) {
          issues.push(warning("year_mismatch", { params: { year: parsed.year } }));
        }
        break;
      }
      if (!seriesId) issues.push(error("number_format", { field: "number", params: { formats: pool.map((s) => s.format).join(" · ") } }));
    }
  }

  // Cliente: por NIF, si no por nombre; si no existe, se da de alta con los datos de la factura.
  let countryCode = "ES";
  if (values.client_country) {
    const parsed = parseCountry(values.client_country);
    if (parsed) countryCode = parsed;
    else issues.push(error("country_unknown", { field: "client_country", params: { value: values.client_country } }));
  }
  let taxId: string | null = null;
  let taxIdKind: TaxIdKind = countryCode === "ES" ? "es" : "foreign";
  if (values.client_tax_id) {
    const classified = classifyTaxId(values.client_tax_id, values.client_country ? countryCode : null);
    if (classified.ok) {
      taxId = classified.value;
      taxIdKind = classified.kind;
    } else {
      issues.push(
        error(classified.reason === "control" ? "tax_id_control" : "tax_id_format", {
          field: "client_tax_id",
          params: { value: values.client_tax_id },
        }),
      );
    }
  }
  const clientName = cleanText(values.client_name, 200);
  if (!clientName && !values.client_tax_id) issues.push(error("required", { field: "client_name" }));
  const party: ClientParty = {
    legal_name: clientName,
    tax_id: taxId,
    tax_id_kind: taxIdKind,
    address_line: cleanText(values.client_address, 200),
    postal_code: parsePostalCode(values.client_postal_code, countryCode).value,
    city: cleanText(values.client_city, 80),
    province: cleanText(values.client_province, 80),
    country_code: countryCode,
  };
  let client: PlannedClient | null = null;
  let clientTerms: number | null = null;
  if (clientName || taxId) {
    let existing: ImportClient | null = taxId ? (idx.clientsByTaxId.get(taxId) ?? null) : null;
    let conflict = false;
    if (!existing && clientName) {
      const byName = idx.clientsByName.get(normalizeKey(clientName)) ?? [];
      if (byName.length > 1) {
        issues.push(error("client_ambiguous", { params: { name: clientName } }));
        conflict = true;
      } else if (byName[0] && taxId && byName[0].taxId && byName[0].taxId !== taxId) {
        issues.push(error("name_conflict", { params: { name: byName[0].displayName, taxId: byName[0].taxId } }));
        conflict = true;
      } else if (byName[0]) {
        existing = byName[0];
      }
    }
    if (existing) {
      client = { kind: "existing", id: existing.id, name: existing.displayName };
      clientTerms = existing.paymentTermsDays;
    } else if (!conflict) {
      const key = taxId ? `nif:${taxId}` : `name:${normalizeKey(clientName!)}`;
      const name = clientName ?? taxId!;
      client = { kind: "new", key, name };
      const draft = idx.newClients.get(key);
      if (draft) draft.rowNumbers.push(...rowNumbers);
      else idx.newClients.set(key, { ...party, key, display_name: name, email: parseEmails(values.client_email).email, rowNumbers: [...rowNumbers] });
      issues.push(info("client_new", { params: { name } }));
    }
  }

  // Líneas: una por fila.
  const lines: PlannedLine[] = [];
  const explicitRegime: boolean[] = [];
  let firstRate: number | null = null;
  let descriptionDefaulted = false;
  for (const { row, rowNumber } of group.rows) {
    const cell = (field: ImportField) => cellOf(row, mapping, field);
    let description = cleanText(cell("description"), 500);
    if (!description) {
      description = options.defaultDescription;
      descriptionDefaulted = true;
    }

    let quantity = "1";
    let negative = false;
    const qtyRaw = cell("quantity");
    if (qtyRaw) {
      const parsed = parseQuantity(qtyRaw, options.decimal);
      if (parsed) [quantity, negative] = [parsed.value, parsed.negative];
      else rowError("quantity_invalid", "quantity", qtyRaw, rowNumber);
    }
    let discountBps = 0;
    const discountRaw = cell("discount");
    if (discountRaw) {
      const parsed = parseRateBps(discountRaw, options.decimal);
      if (parsed === null) rowError("rate_invalid", "discount", discountRaw, rowNumber);
      else discountBps = parsed;
    }
    const priceRaw = cell("unit_price");
    let unitPrice = priceRaw ? parseAmountCents(priceRaw, options.decimal) : null;
    if (priceRaw && unitPrice === null) rowError("amount_invalid", "unit_price", priceRaw, rowNumber);
    const amountRaw = cell("line_amount");
    let lineAmount = amountRaw ? parseAmountCents(amountRaw, options.decimal) : null;
    if (amountRaw && lineAmount === null) rowError("amount_invalid", "line_amount", amountRaw, rowNumber);
    if (negative) {
      if (unitPrice !== null) unitPrice = -unitPrice;
      if (lineAmount !== null && lineAmount > 0) lineAmount = -lineAmount;
    }

    let base: number | null = null;
    if (unitPrice !== null) {
      base = computeLine({ quantity, unitPriceCents: unitPrice, discountBps, vatBps: 0, irpfBps: 0, irpfApplies: false }).baseCents;
    }
    if (lineAmount !== null) {
      if (base !== null && Math.abs(base - lineAmount) > 1) issues.push(warning("line_amount_mismatch", { field: "line_amount", params: { row: rowNumber } }));
      base = lineAmount;
    }
    // Una fila por factura sin importe de línea: la línea es la base de la factura.
    if (base === null && group.rows.length === 1 && headerBase !== null) base = headerBase;
    if (base === null) {
      if (!priceRaw && !amountRaw) issues.push(error("line_amount_missing", { params: { row: rowNumber } }));
      continue;
    }
    if (unitPrice === null) {
      // Solo se sabe la base: precio = base / cantidad (informativo; la base es la que manda).
      unitPrice = Number(divRoundHalfAwayFromZero(BigInt(base) * BigInt(1000), quantityThousandths(quantity)));
      discountBps = 0;
    }

    let vatBps = -1;
    const rateRaw = cell("vat_rate");
    if (rateRaw) {
      const parsed = parseRateBps(rateRaw, options.decimal);
      if (parsed === null) rowError("rate_invalid", "vat_rate", rateRaw, rowNumber);
      else {
        vatBps = parsed;
        firstRate ??= parsed;
      }
    }
    const regimeRaw = cell("vat_regime");
    const regime = regimeRaw ? parseRegime(regimeRaw) : null;
    if (regimeRaw && !regime) rowError("rate_invalid", "vat_regime", regimeRaw, rowNumber);
    explicitRegime.push(regime !== null);

    const suggested = classifyFromColumn(cell("billing_type")) ?? classifyLine(descriptionDefaulted && !cell("description") ? "" : description);
    const override = options.lineTypes[String(rowNumber)];

    let periodStart = parseDateLoose(cell("period_start"), options.dateOrder);
    let periodEnd = parseDateLoose(cell("period_end"), options.dateOrder);
    if (!periodStart || !periodEnd || compareCivil(periodEnd, periodStart) < 0) [periodStart, periodEnd] = [null, null];

    lines.push({
      rowNumber,
      description,
      quantity,
      unitPriceCents: unitPrice,
      discountBps,
      baseCents: base,
      vatBps,
      vatRegime: regime ?? "general",
      vatCents: 0,
      irpfApplies: false,
      irpfCents: 0,
      taxRateId: null,
      legalNote: null,
      periodStart,
      periodEnd,
      classification: override ? manualClassification(override) : suggested,
      suggested,
    });
  }
  if (descriptionDefaulted) issues.push(info("description_default"));
  const subtotal = lines.reduce((s, l) => s + l.baseCents, 0);

  // IVA de las líneas sin tipo: el de otra línea; si no, deducido de la cuota (o del total con el
  // IRPF conocido); si no, el de por defecto. Si nada de eso es posible, error.
  const withoutRate = lines.filter((l) => l.vatBps < 0);
  if (withoutRate.length > 0) {
    let rate = firstRate;
    if (rate === null) {
      const orgRates = ctx.taxRates.filter((t) => t.kind === "vat" && !t.archived).map((t) => t.rateBps);
      const knownIrpf = headerIrpf ?? (headerIrpfRate !== null ? lineTax(lines, headerIrpfRate) : null);
      const target = headerVat ?? (headerTotal !== null && knownIrpf !== null ? headerTotal - subtotal + knownIrpf : null);
      if (target !== null) {
        rate = snapRate(lines, target, [...new Set([...VAT_CANDIDATES, ...orgRates])]);
        if (rate !== null) issues.push(info("vat_rate_inferred", { params: { rate } }));
      } else if (options.defaultVatBps !== null) {
        rate = options.defaultVatBps;
        issues.push(warning("vat_rate_default", { params: { rate } }));
      }
      if (rate === null) issues.push(error("vat_rate_unknown"));
    }
    for (const l of withoutRate) l.vatBps = rate ?? 0;
  }

  // Régimen (0 % sin régimen: se deduce del país del cliente) y tipo de la org de cada línea.
  const euClient = EU_COUNTRIES.has(countryCode) && countryCode !== "ES";
  let guessed: VatRegime | null = null;
  lines.forEach((l, i) => {
    if (l.vatBps > 0 && l.vatRegime !== "general") {
      issues.push(error("rate_invalid", { field: "vat_regime", params: { value: l.vatRegime, row: l.rowNumber } }));
    }
    if (l.vatBps === 0 && !explicitRegime[i]) {
      l.vatRegime = countryCode === "ES" ? "exempt" : euClient ? "reverse_charge_eu" : "not_subject";
      guessed = l.vatRegime;
    }
    const matching = ctx.taxRates.filter((t) => t.kind === "vat" && !t.archived && t.rateBps === l.vatBps && t.regime === l.vatRegime);
    const taxRate = matching.find((t) => t.isDefault) ?? matching[0];
    l.taxRateId = taxRate?.id ?? null;
    l.legalNote = l.vatRegime === "general" ? null : (taxRate?.legalNote ?? null);
    l.vatCents = applyRate(l.baseCents, l.vatBps);
  });
  if (guessed) issues.push(warning("vat_regime_guessed", { params: { regime: guessed } }));

  // IRPF: el tipo de la columna; si no, deducido de su importe o del total.
  const tolerance = Math.max(1, lines.length);
  let rounded = 0;
  const reconcile = (target: number, pick: (l: PlannedLine) => number, set: (l: PlannedLine, v: number) => void, eligible: (l: PlannedLine) => boolean, code: IssueCode) => {
    const current = lines.reduce((s, l) => s + pick(l), 0);
    const diff = target - current;
    if (diff === 0) return;
    const values = lines.map(pick);
    if (Math.abs(diff) > tolerance || !distribute(values, lines.map((l) => l.baseCents), lines.map(eligible), diff)) {
      issues.push(error(code, { params: { expected: target, computed: current } }));
      return;
    }
    lines.forEach((l, i) => set(l, values[i]!));
    rounded += Math.abs(diff);
  };

  const vatBeforeReconcile = lines.reduce((s, l) => s + l.vatCents, 0);
  let irpfBps = headerIrpfRate ?? 0;
  let irpfTarget: number | null = headerIrpf;
  if (irpfTarget === null && headerIrpfRate === null && headerTotal !== null) {
    const derived = subtotal + (headerVat ?? vatBeforeReconcile) - headerTotal;
    if (derived < -tolerance) issues.push(error("totals_mismatch", { params: { expected: headerTotal, computed: subtotal + (headerVat ?? vatBeforeReconcile) } }));
    else if (derived > tolerance) irpfTarget = derived;
  }
  if (headerIrpfRate === null && irpfTarget !== null && irpfTarget !== 0) {
    const snapped = snapRate(lines, irpfTarget, IRPF_CANDIDATES);
    if (snapped !== null) {
      irpfBps = snapped;
      issues.push(info("irpf_inferred", { params: { rate: snapped } }));
    } else {
      issues.push(error("irpf_mismatch", { params: { expected: irpfTarget, computed: 0 } }));
      irpfTarget = null;
    }
  }
  for (const l of lines) {
    l.irpfApplies = irpfBps > 0;
    l.irpfCents = irpfBps > 0 ? applyRate(l.baseCents, irpfBps) : 0;
  }
  if (irpfTarget !== null && irpfBps > 0) reconcile(irpfTarget, (l) => l.irpfCents, (l, v) => (l.irpfCents = v), (l) => l.irpfApplies, "irpf_mismatch");
  const lineIrpf = lines.reduce((s, l) => s + l.irpfCents, 0);

  // Cuadre del IVA con la cuota de la factura (o con el total, ya conocido el IRPF).
  const vatTarget = headerVat ?? (headerTotal !== null ? headerTotal - subtotal + lineIrpf : null);
  if (vatTarget !== null && lines.length > 0) reconcile(vatTarget, (l) => l.vatCents, (l, v) => (l.vatCents = v), (l) => l.vatBps > 0, "vat_mismatch");
  if (rounded > 0) issues.push(info("rounding_adjusted", { params: { cents: rounded } }));

  const lineVat = lines.reduce((s, l) => s + l.vatCents, 0);
  let totals: Totals | null =
    lines.length > 0 ? { subtotalCents: subtotal, vatCents: lineVat, irpfCents: lineIrpf, totalCents: subtotal + lineVat - lineIrpf } : null;
  if (totals && headerBase !== null && headerBase !== subtotal) {
    issues.push(error("base_mismatch", { params: { expected: headerBase, computed: subtotal } }));
  }
  if (totals && headerTotal !== null && headerTotal !== totals.totalCents && !issues.some((i) => i.code === "totals_mismatch")) {
    issues.push(error("totals_mismatch", { params: { expected: headerTotal, computed: totals.totalCents } }));
  }

  // Signo: una rectificativa resta; una ordinaria en negativo necesita la factura que rectifica.
  if (totals && kind === "rectifying" && totals.totalCents > 0) {
    for (const l of lines) {
      l.unitPriceCents = -l.unitPriceCents;
      l.baseCents = -l.baseCents;
      l.vatCents = -l.vatCents;
      l.irpfCents = -l.irpfCents;
    }
    totals = { subtotalCents: -totals.subtotalCents, vatCents: -totals.vatCents, irpfCents: -totals.irpfCents, totalCents: -totals.totalCents };
    issues.push(warning("rectifying_negated"));
  }
  if (totals && kind === "ordinary" && totals.totalCents < 0) issues.push(error("negative_total"));

  // Vencimiento y cobro.
  if (issuedOn && !dueOn) dueOn = addDays(issuedOn, clientTerms ?? ctx.orgPaymentTermsDays);
  const paymentMethod: PaymentMethod = (values.payment_method ? parsePaymentMethod(values.payment_method) : null) ?? "transfer";
  let payment: PlannedInvoice["payment"] = null;
  if (issuedOn && totals && kind === "ordinary" && totals.totalCents > 0 && options.paidMode !== "none") {
    const whenDue = minCivil(dueOn ?? issuedOn, ctx.today);
    let paidOn: CivilDate | null = null;
    if (options.paidMode === "all") paidOn = whenDue;
    else {
      if (values.paid_on) {
        paidOn = parseDateLoose(values.paid_on, options.dateOrder);
        if (!paidOn) issues.push(warning("paid_date_invalid", { field: "paid_on", params: { value: values.paid_on } }));
      }
      if (!paidOn && values.paid) {
        const paid = parseBooleanLoose(values.paid);
        if (paid === true) paidOn = whenDue;
        else if (paid === null) issues.push(warning("paid_unknown", { field: "paid", params: { value: values.paid } }));
      }
    }
    if (paidOn) {
      if (compareCivil(paidOn, issuedOn) < 0) issues.push(warning("paid_before_issue", { params: { date: paidOn } }));
      payment = { paidOn: minCivil(paidOn, ctx.today), amountCents: totals.totalCents };
    }
  }

  // ¿Ya está en GNERAI OS? Importada con este identificador: se salta. Con el mismo número pero no importada así: error.
  const externalId = invoiceExternalId(group.issuerId ?? "?", group.number);
  let action: PlannedInvoice["action"] = hasErrors(issues) ? "error" : "create";
  let existingId: string | null = null;
  if (group.issuerId) {
    const imported = idx.existingByExternal.get(externalId);
    if (imported && imported.source === "import") {
      existingId = imported.id;
      action = "skip";
      const differs = totals !== null && totals.totalCents !== imported.totalCents;
      issues.unshift(differs ? warning("already_imported_differs", { params: { total: imported.totalCents } }) : info("already_imported"));
    } else if (idx.existingByNumber.has(`${group.issuerId}|${group.number}`)) {
      issues.push(error("number_taken", { field: "number", params: { number: group.number } }));
      action = "error";
    }
  }

  // Orden de fechas con lo que GNERAI OS ya ha emitido en la serie y el año (la base de datos lo vuelve a comprobar).
  if (action === "create" && seriesId !== null && fiscalYear !== null && sequence !== null && issuedOn) {
    for (const e of ctx.invoices) {
      if (e.source !== "app" || e.seriesId !== seriesId || e.fiscalYear !== fiscalYear) continue;
      if (e.sequence === null) {
        issues.push(error("series_external_numbering"));
        action = "error";
        break;
      }
      const before = e.sequence < sequence && compareCivil(e.issuedOn, issuedOn) > 0;
      const after = e.sequence > sequence && compareCivil(e.issuedOn, issuedOn) < 0;
      if (before || after) {
        issues.push(error("series_order_conflict", { params: { number: e.number, date: e.issuedOn } }));
        action = "error";
        break;
      }
    }
  }

  return {
    externalId,
    rowNumbers,
    action,
    issues,
    number: group.number,
    issuerId: group.issuerId,
    seriesId,
    sequence,
    numberYear,
    fiscalYear,
    kind,
    rectifiesNumber,
    rectificationReason: kind === "rectifying" ? (cleanText(values.rectification_reason, 500) ?? options.defaultRectificationReason) : null,
    issuedOn,
    operationOn,
    dueOn,
    client,
    clientParty: party,
    lines,
    irpfBps,
    totals,
    paymentMethod,
    payment,
    notes: cleanText(cellOf(group.rows[0]!.row, mapping, "notes"), 2000),
    existingId,
  };
}

// ---------------------------------------------------------------------------
// Payload de la RPC
// ---------------------------------------------------------------------------

/** Lo que recibe `import_historical_invoice` para una factura del plan, con el cliente ya resuelto. */
export function toImportPayload(invoice: PlannedInvoice, clientId: string) {
  if (invoice.action !== "create" || !invoice.issuerId || !invoice.seriesId || !invoice.totals || !invoice.issuedOn) {
    throw new Error(`La factura ${invoice.number} no se puede importar`);
  }
  return {
    external_id: invoice.externalId,
    issuer_id: invoice.issuerId,
    series_id: invoice.seriesId,
    client_id: clientId,
    number: invoice.number,
    sequence: invoice.sequence,
    number_year: invoice.numberYear,
    kind: invoice.kind,
    rectifies_number: invoice.rectifiesNumber,
    rectification_reason: invoice.rectificationReason,
    issued_on: invoice.issuedOn,
    operation_on: invoice.operationOn,
    due_on: invoice.dueOn,
    irpf_bps: invoice.irpfBps,
    payment_method: invoice.paymentMethod,
    notes: invoice.notes,
    client_party: invoice.clientParty,
    totals: {
      subtotal_cents: invoice.totals.subtotalCents,
      vat_cents: invoice.totals.vatCents,
      irpf_cents: invoice.totals.irpfCents,
      total_cents: invoice.totals.totalCents,
    },
    lines: invoice.lines.map((l, position) => ({
      position,
      description: l.description,
      quantity: l.quantity,
      unit_price_cents: l.unitPriceCents,
      discount_bps: l.discountBps,
      base_cents: l.baseCents,
      tax_rate_id: l.taxRateId,
      vat_bps: l.vatBps,
      vat_regime: l.vatRegime,
      vat_cents: l.vatCents,
      irpf_applies: l.irpfApplies,
      irpf_cents: l.irpfCents,
      legal_note: l.legalNote,
      billing_type: l.classification.billingType,
      period_start: l.periodStart,
      period_end: l.periodEnd,
    })),
    payment: invoice.payment
      ? { paid_on: invoice.payment.paidOn, amount_cents: invoice.payment.amountCents, method: invoice.paymentMethod }
      : null,
  };
}

export type ImportInvoicePayload = ReturnType<typeof toImportPayload>;
