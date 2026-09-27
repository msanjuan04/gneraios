// La tabla de conceptos de la factura: su cabecera («Concepto · Cantidad · Precio · Importe»), las
// columnas que la forman y cada fila con su descripción (también la que sigue en la línea de
// debajo), su cantidad, su precio, su descuento, su IVA y su importe.

import { computeLine } from "../tax";
import { type DocLine, readDocument } from "./document";
import { wholeLabel } from "./labels";
import { squash } from "./text";
import { findNumbers, percentToBps, quantityOf, type Span } from "./tokens";
import { type Confidence, type ExtractedLine } from "./types";

// «amount» es la base de la línea (importe, subtotal); «lineTotal», un «Total» que puede llevar el IVA.
type ColumnKind = "description" | "quantity" | "unitPrice" | "discount" | "vat" | "amount" | "lineTotal";
type Column = Span & { kind: ColumnKind };

export type LineTable = {
  /** Línea de la cabecera y primera línea que ya no es de la tabla. */
  header: number;
  end: number;
  columns: Column[];
};

const HEADERS: Record<ColumnKind, readonly string[]> = {
  description: [
    "concepto", "conceptos", "descripcion", "descripcio", "description", "detalle", "detall", "servicio", "servicios",
    "servei", "serveis", "articulo", "articulos", "article", "producto", "productos", "item", "items", "partida",
    "trabajo", "treball", "concept", "concepte",
  ],
  quantity: ["cantidad", "cant", "uds", "ud", "unidades", "unid", "u", "quantitat", "quant", "qty", "quantity", "unitats", "horas", "hores", "hours", "unidad"],
  unitPrice: [
    "precio", "preciounitario", "preciounidad", "precioud", "punitario", "punit", "pu", "pvp", "preu", "preuunitari",
    "preuunitat", "price", "unitprice", "importeunitario", "tarifa", "rate", "precioudad",
  ],
  discount: ["descuento", "dto", "desc", "descompte", "dte", "discount", "pctdto", "dtopct", "pctdescuento"],
  vat: ["iva", "pctiva", "ivapct", "tipoiva", "vat", "vatpct", "pctvat", "tax"],
  amount: ["importe", "import", "amount", "subtotal", "base", "importeneto", "neto", "baseimponible", "importeeur"],
  lineTotal: ["total", "totallinea", "importetotal", "totaleur", "totalimporte"],
};

const HEADER_KEYS = new Map<string, ColumnKind>(
  Object.entries(HEADERS).flatMap(([kind, keys]) => keys.map((key) => [key, kind as ColumnKind] as const)),
);

/** Tipo de columna de una celda de cabecera («Precio unitario (€)» → precio). */
function headerKind(text: string): ColumnKind | null {
  const key = squash(text).replace(/(?:eur|pct)+$/, "");
  return HEADER_KEYS.get(key) ?? HEADER_KEYS.get(key.replace(/^pct/, "")) ?? null;
}

function headerColumns(line: DocLine): Column[] | null {
  const columns = line.cells.flatMap((c) => {
    const kind = headerKind(c.text);
    return kind ? [{ kind, start: c.start, end: c.end }] : [];
  });
  const kinds = new Set(columns.map((c) => c.kind));
  if (!kinds.has("description") || columns.length < 2) return null;
  if (!kinds.has("amount") && !kinds.has("lineTotal") && !kinds.has("unitPrice") && !kinds.has("quantity")) return null;
  // Casi todas las celdas de la línea tienen que ser de cabecera (no una frase que menciona «total»).
  return columns.length >= line.cells.length - 1 ? columns : null;
}

/** Una línea de totales o de otro bloque (datos de pago, observaciones): ahí acaba la tabla. */
function endsTable(line: DocLine): boolean {
  return line.cells.some((cell) => {
    const label = wholeLabel(cell.text, ["base", "vat", "irpf", "total", "vatRate", "irpfRate", "stop", "paymentMethod"]);
    if (!label) return false;
    // Una fila cuya descripción empieza como una etiqueta («Base de datos…») lleva más importes.
    return label.kind === "stop" || label.kind === "paymentMethod" || line.money.length <= 1;
  });
}

export function findLineTable(lines: readonly DocLine[]): LineTable | null {
  for (const line of lines) {
    const columns = headerColumns(line);
    if (!columns) continue;
    let end = line.index + 1;
    while (end < lines.length && end - line.index <= 80 && !endsTable(lines[end]!)) end += 1;
    return { header: line.index, end, columns };
  }
  return null;
}

const center = (s: Span) => (s.start + s.end) / 2;

/** La columna de un valor: la que se solapa con él o, si ninguna, la más cercana. */
function columnOf(columns: readonly Column[], token: Span): ColumnKind | null {
  const hit = columns.find((c) => c.start < token.end + 1 && token.start < c.end + 1 && c.kind !== "description");
  if (hit) return hit.kind;
  const numeric = columns.filter((c) => c.kind !== "description");
  if (numeric.length === 0) return null;
  return numeric.reduce((best, c) => (Math.abs(center(c) - center(token)) < Math.abs(center(best) - center(token)) ? c : best)).kind;
}

type Row = {
  description: string[];
  quantity: string | null;
  unitPriceCents: number | null;
  discountBps: number | null;
  vatBps: number | null;
  amountCents: number;
  periodStart: string | null;
  periodEnd: string | null;
};

/** Una línea de detalle que solo es un periodo («Mensual · 01/10/2026 – 31/10/2026»). */
function periodOnly(line: DocLine): { from: string; to: string } | null {
  if (line.dates.length !== 2) return null;
  const [a, b] = line.dates as [(typeof line.dates)[0], (typeof line.dates)[0]];
  if (a.value > b.value) return null;
  const rest = (line.text.slice(0, a.start) + line.text.slice(a.end, b.start) + line.text.slice(b.end)).replace(/[\s·:,\-–()/]+/g, " ").trim();
  // Lo que queda es como mucho una palabra o dos («Mensual», «Por consumo», «Periodo»).
  return rest.split(" ").filter(Boolean).length <= 3 ? { from: a.value, to: b.value } : null;
}

/** El tramo de la línea que es de la descripción: de la columna anterior a la siguiente. */
function descriptionRange(columns: readonly Column[]): Span {
  const desc = columns.find((c) => c.kind === "description")!;
  const others = columns.filter((c) => c.kind !== "description");
  const right = others.filter((c) => c.start > desc.start).map((c) => c.start);
  const left = others.filter((c) => c.start < desc.start).map((c) => c.end);
  return {
    start: left.length > 0 ? Math.max(...left) + 1 : 0,
    end: right.length > 0 ? Math.min(...right) - 1 : Number.POSITIVE_INFINITY,
  };
}

/**
 * El texto de la línea que cae en la descripción: las celdas que empiezan en su tramo, cortadas
 * donde empieza un valor de la fila (un importe alineado bajo su cabecera no es parte del texto).
 */
function descriptionText(line: DocLine, range: Span, values: readonly Span[] = []): string {
  return line.cells
    .filter((c) => c.start >= range.start - 1 && c.start < range.end)
    .map((c) => {
      const cut = values.filter((v) => v.start >= c.start && v.start < c.end).map((v) => v.start);
      return cut.length > 0 ? line.text.slice(c.start, Math.min(...cut)) : c.text;
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Las filas de la tabla, en orden. Una fila sin importe no se cuenta. */
export function readTableLines(lines: readonly DocLine[], table: LineTable): ExtractedLine[] {
  const rows: Row[] = [];
  const range = descriptionRange(table.columns);
  // Un número dentro de la descripción («hito 1 de 2», «Pack 3 × 100,00 €») no es un valor de la
  // fila; uno que llega hasta la columna de al lado (alineado a la derecha bajo su cabecera), sí.
  const isValue = (t: Span) => t.end > range.end + 1 || t.end <= range.start;
  let pending: string[] = [];
  for (let i = table.header + 1; i < table.end; i += 1) {
    const line = lines[i]!;
    if (line.cells.length === 0 || headerColumns(line)) continue;
    const money = line.money.filter(isValue);
    if (money.length === 0) {
      const period = periodOnly(line);
      const previous = rows.at(-1);
      if (period && previous) {
        previous.periodStart ??= period.from;
        previous.periodEnd ??= period.to;
        continue;
      }
      const text = descriptionText(line, range);
      if (text === "") continue;
      if (previous) previous.description.push(text);
      else pending.push(text);
      continue;
    }

    const numbers = findNumbers(line.text, [...line.dates, ...line.percents, ...line.money, ...line.taxIds, ...line.ibans]).filter(isValue);
    const percents = line.percents.filter(isValue);
    const byColumn = (kind: ColumnKind) => ({
      money: money.filter((m) => columnOf(table.columns, m) === kind),
      numbers: numbers.filter((n) => columnOf(table.columns, n) === kind),
      percents: percents.filter((p) => columnOf(table.columns, p) === kind),
    });

    const amountCol = byColumn("amount").money;
    const totalCol = byColumn("lineTotal").money;
    const amount = amountCol.at(-1) ?? totalCol.at(-1) ?? money.at(-1)!;
    const priceCol = byColumn("unitPrice").money.filter((m) => m !== amount);
    const others = money.filter((m) => m !== amount && !totalCol.includes(m) && !amountCol.includes(m));
    const unitPrice = priceCol[0] ?? (others.length > 0 ? others.at(-1)! : null);
    // Solo un «Total» por línea y con columna de IVA: si precio × cantidad cuadra con el total sin
    // el IVA, la base es precio × cantidad.
    const totalIncludesVat = amountCol.length === 0 && totalCol.includes(amount);

    const qtyCol = byColumn("quantity");
    const qtyRaw = qtyCol.numbers[0]?.value ?? (qtyCol.money[0] ? line.text.slice(qtyCol.money[0].start, qtyCol.money[0].end) : null);
    const quantity = qtyRaw ? quantityOf(qtyRaw) : null;

    const discountCol = byColumn("discount");
    const discountBps = discountCol.percents[0]?.bps ?? (discountCol.numbers[0] ? percentToBps(discountCol.numbers[0].value) : null);

    const vatCol = byColumn("vat");
    let vatBps: number | null = vatCol.percents[0]?.bps ?? (vatCol.numbers[0] ? percentToBps(vatCol.numbers[0].value) : null);
    if (vatBps === null && vatCol.money[0]) vatBps = vatCol.money[0].cents <= 10_000 ? vatCol.money[0].cents : null;

    let amountCents = amount.cents;
    if (totalIncludesVat && unitPrice && vatBps !== null && vatBps > 0) {
      const base = computeLine({ quantity: quantity ?? "1", unitPriceCents: unitPrice.cents, discountBps: discountBps ?? 0, vatBps, irpfBps: 0, irpfApplies: false });
      if (Math.abs(base.totalCents - amount.cents) <= 1) amountCents = base.baseCents;
    }

    const description = [...pending, descriptionText(line, range, [...money, ...numbers, ...percents])].filter(Boolean);
    pending = [];
    rows.push({
      description,
      quantity,
      unitPriceCents: unitPrice ? unitPrice.cents : null,
      discountBps,
      vatBps,
      amountCents,
      periodStart: null,
      periodEnd: null,
    });
  }

  return rows.flatMap((row): ExtractedLine[] => {
    const description = row.description.join(" ").replace(/\s+/g, " ").trim().slice(0, 500);
    if (description === "") return [];
    let confidence: Confidence = "medium";
    if (row.quantity !== null && row.unitPriceCents !== null) {
      const computed = computeLine({
        quantity: row.quantity,
        unitPriceCents: row.unitPriceCents,
        discountBps: row.discountBps ?? 0,
        vatBps: 0,
        irpfBps: 0,
        irpfApplies: false,
      }).baseCents;
      confidence = Math.abs(computed - row.amountCents) <= 1 ? "high" : "low";
    }
    return [
      {
        description,
        quantity: row.quantity,
        unitPriceCents: row.unitPriceCents,
        discountBps: row.discountBps,
        vatBps: row.vatBps,
        amountCents: row.amountCents,
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
        confidence,
      },
    ];
  });
}

/** Atajo para los tests: la tabla de un texto. */
export function tableLinesOf(text: string): ExtractedLine[] {
  const lines = readDocument(text);
  const table = findLineTable(lines);
  return table ? readTableLines(lines, table) : [];
}
