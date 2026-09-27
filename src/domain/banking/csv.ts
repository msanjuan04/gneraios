// CSV de movimientos del banco. Cada banco exporta el suyo (y lo cambia de vez en cuando), así que en
// lugar de plantillas por banco hay un mapeo genérico: se reconoce la fila de cabecera (aunque vaya
// después de unas líneas con los datos de la cuenta) por sus títulos en castellano, catalán o
// inglés, y el socio puede corregir qué columna es qué antes de guardar. Se reutiliza el lector de
// CSV de las importaciones (src/domain/dataio): separador, comillas, codificación, importes a la
// española y fechas dd/mm/aaaa.

import { compareCivil } from "../dates/civil-date";
import { parseCsv, type CsvDelimiter } from "../dataio/csv";
import { cleanText, normalizeKey } from "../dataio/text";
import { type DateOrder, type DecimalSeparator, inferDateOrder, inferDecimalSeparator, parseAmountCents, parseDateLoose } from "../dataio/values";
import { assertCents, type Cents } from "../money";
import { validateIban } from "../tax-id";
import { coverPeriod, type ParsedStatement, type StatementIssue, type StatementMovement } from "./statement";

export const BANK_CSV_ROLES = [
  "booked_on",
  "value_on",
  "concept",
  "extra",
  "counterparty",
  "amount",
  "debit",
  "credit",
  "direction",
  "balance",
  "reference",
] as const;
export type BankCsvRole = (typeof BANK_CSV_ROLES)[number];

export type BankCsvMapping = {
  /** Índice (desde 0) de la fila de cabecera entre las filas con datos del fichero. */
  headerRow: number;
  /** Columna de cada papel. */
  columns: Partial<Record<BankCsvRole, number>>;
  decimal: DecimalSeparator;
  dateOrder: DateOrder;
};

/** Títulos habituales de cada columna (en forma de clave: minúsculas, sin acentos ni signos). */
const SYNONYMS: Record<BankCsvRole, readonly string[]> = {
  booked_on: [
    "fecha", "fecha operacion", "f operacion", "fecha de operacion", "fecha contable", "fecha movimiento", "fecha mov",
    "data", "data operacio", "data d operacio", "data de l operacio", "data moviment", "date", "booking date",
    "transaction date", "posted date",
  ],
  value_on: ["fecha valor", "f valor", "fec valor", "data valor", "value date", "valor"],
  concept: [
    "concepto", "concepte", "descripcion", "descripcio", "description", "detalle", "detall", "movimiento",
    "moviment", "concepto movimiento", "details", "texto", "operacion", "operacio",
  ],
  extra: [
    "observaciones", "observacions", "mas datos", "mes dades", "informacion adicional", "informacio addicional",
    "concepto ampliado", "concepte ampliat", "concepto 2", "detalles", "remarks", "comentario", "comentaris", "notas",
  ],
  counterparty: [
    "beneficiario", "ordenante", "beneficiario ordenante", "ordenante beneficiario", "beneficiari", "ordenant",
    "contrapartida", "nombre", "nom", "payee", "counterparty", "comercio", "emisor", "remitente",
  ],
  amount: ["importe", "import", "amount", "cantidad", "importe eur", "import eur", "importe euros", "importe en euros"],
  debit: ["cargo", "cargos", "debe", "debito", "debit", "salida", "salidas", "carrec", "carrecs", "deure", "reintegros"],
  credit: ["abono", "abonos", "haber", "credito", "credit", "entrada", "entradas", "abonament", "abonaments", "haver", "ingresos"],
  direction: ["d h", "signo", "debe haber", "cargo abono", "sign", "tipo movimiento"],
  balance: ["saldo", "balance", "saldo disponible", "saldo contable", "saldo eur", "saldo euros", "saldo tras movimiento"],
  reference: ["referencia", "ref", "reference", "n documento", "num documento", "numero documento", "referencia 1", "n referencia"],
};

/** Papel de un título de columna, o null si no se reconoce. */
export function roleOfHeader(header: string): BankCsvRole | null {
  const key = normalizeKey(header);
  if (!key) return null;
  for (const role of BANK_CSV_ROLES) if (SYNONYMS[role].includes(key)) return role;
  // "Importe (EUR)", "Fecha operación dd/mm/aaaa": el título empieza por un sinónimo largo.
  for (const role of BANK_CSV_ROLES) {
    if (SYNONYMS[role].some((s) => s.length >= 5 && (key.startsWith(`${s} `) || key === s))) return role;
  }
  return null;
}

/** Mapeo automático de una cabecera: cada papel, a la primera columna que lo tiene. */
export function autoMapBankColumns(headers: readonly string[]): Partial<Record<BankCsvRole, number>> {
  const columns: Partial<Record<BankCsvRole, number>> = {};
  headers.forEach((header, index) => {
    const role = roleOfHeader(header);
    if (role && columns[role] === undefined) columns[role] = index;
  });
  return columns;
}

function hasAmounts(columns: Partial<Record<BankCsvRole, number>>): boolean {
  return columns.amount !== undefined || columns.debit !== undefined || columns.credit !== undefined;
}

/** ¿Tiene el mapeo lo mínimo para leer movimientos? Fecha, importe (o cargo/abono) y concepto. */
export function isUsableMapping(columns: Partial<Record<BankCsvRole, number>>): boolean {
  return columns.booked_on !== undefined && hasAmounts(columns) && (columns.concept !== undefined || columns.counterparty !== undefined);
}

export type BankCsvTable = {
  delimiter: CsvDelimiter;
  /** Todas las filas con datos (la cabecera incluida), como las enseña Excel. */
  records: string[][];
  rowNumbers: number[];
};

const DELIMITERS: readonly CsvDelimiter[] = [";", ",", "\t", "|"];

/**
 * Separador del CSV del banco. El lector general mira la primera fila, y aquí la primera fila suele
 * ser un título ("Movimientos de la cuenta …") de una sola celda: se usa el separador con el que más
 * de las primeras líneas tienen el mismo número de columnas (y más de una).
 */
export function detectBankDelimiter(text: string): CsvDelimiter {
  const hint = /^\uFEFF?sep=(.)/i.exec(text);
  if (hint && (DELIMITERS as readonly string[]).includes(hint[1]!)) return hint[1] as CsvDelimiter;
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/).filter((l) => l.trim() !== "").slice(0, 40);
  let best: { delimiter: CsvDelimiter; rows: number; width: number } | null = null;
  for (const delimiter of DELIMITERS) {
    const counts = new Map<number, number>();
    for (const line of lines) {
      let inQuotes = false;
      let n = 0;
      for (const ch of line) {
        if (ch === '"') inQuotes = !inQuotes;
        else if (ch === delimiter && !inQuotes) n += 1;
      }
      if (n > 0) counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    for (const [width, rows] of counts) {
      if (!best || rows > best.rows || (rows === best.rows && width > best.width)) best = { delimiter, rows, width };
    }
  }
  return best?.delimiter ?? ";";
}

/** Todas las filas del CSV (sin tomar ninguna como cabecera): el banco pone datos de la cuenta encima. */
export function readBankCsvTable(text: string): BankCsvTable {
  const parsed = parseCsv(text, { delimiter: detectBankDelimiter(text) });
  const first = parsed.rowNumbers[0] ?? 2;
  return {
    delimiter: parsed.delimiter,
    records: parsed.headers.length > 0 ? [parsed.headers, ...parsed.rows] : [],
    rowNumbers: parsed.headers.length > 0 ? [first - 1, ...parsed.rowNumbers] : [],
  };
}

/** La fila de cabecera: la de las primeras 25 con más títulos reconocidos que sirvan para leer. */
export function findHeaderRow(records: readonly string[][]): number | null {
  let best: { row: number; score: number } | null = null;
  for (let row = 0; row < Math.min(records.length, 25); row++) {
    const columns = autoMapBankColumns(records[row]!);
    if (!isUsableMapping(columns)) continue;
    const score = Object.keys(columns).length;
    if (!best || score > best.score) best = { row, score };
  }
  return best?.row ?? null;
}

/** IBAN de la cuenta en las filas de encima de la cabecera ("Cuenta: ES91 2100 …"). */
function findAccountIban(records: readonly string[][], headerRow: number): string | null {
  for (let row = 0; row < headerRow; row++) {
    const text = records[row]!.join(" ").toUpperCase().replace(/[^A-Z0-9]/g, "");
    for (const match of text.matchAll(/[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}/g)) {
      for (let length = match[0].length; length >= 15; length--) {
        const candidate = match[0].slice(0, length);
        if (validateIban(candidate)) return candidate;
      }
    }
  }
  return null;
}

/** Mapeo propuesto para un fichero: fila de cabecera, columnas, separador decimal y orden de las fechas. */
export function proposeBankCsvMapping(table: BankCsvTable): BankCsvMapping | null {
  const headerRow = findHeaderRow(table.records);
  if (headerRow === null) return null;
  const columns = autoMapBankColumns(table.records[headerRow]!);
  const body = table.records.slice(headerRow + 1);
  const sample = (role: BankCsvRole) => {
    const index = columns[role];
    return index === undefined ? [] : body.slice(0, 200).map((r) => r[index] ?? "");
  };
  const fallback: DecimalSeparator = table.delimiter === "," ? "." : ",";
  return {
    headerRow,
    columns,
    decimal: inferDecimalSeparator([...sample("amount"), ...sample("debit"), ...sample("credit"), ...sample("balance")], fallback),
    dateOrder: inferDateOrder([...sample("booked_on"), ...sample("value_on")]),
  };
}

const DEBIT_WORDS = new Set(["d", "debe", "cargo", "c", "debit", "dr", "deure", "carrec", "salida", "reintegro"]);
const CREDIT_WORDS = new Set(["h", "haber", "abono", "a", "credit", "cr", "haver", "abonament", "entrada", "ingreso"]);

export type BankCsvResult =
  | { ok: true; statement: ParsedStatement; mapping: BankCsvMapping; headers: string[]; skipped: number }
  | { ok: false; reason: "no_header" | "mapping" | "no_rows" };

/**
 * Lee los movimientos con un mapeo. Una fila sin fecha ni importe (un total, una línea en blanco) se
 * salta; si solo falla uno de los dos, además se avisa. El orden sale cronológico aunque el banco
 * los liste del más reciente al más antiguo, y con la columna de saldo se calculan los saldos
 * inicial y final (y se avisa si no encadenan).
 */
export function parseBankCsv(table: BankCsvTable, mapping: BankCsvMapping): BankCsvResult {
  const header = table.records[mapping.headerRow];
  if (!header) return { ok: false, reason: "no_header" };
  const { columns, decimal, dateOrder } = mapping;
  if (!isUsableMapping(columns)) return { ok: false, reason: "mapping" };
  const cell = (row: string[], role: BankCsvRole) => {
    const index = columns[role];
    return index === undefined ? "" : (row[index] ?? "").trim();
  };

  const issues: StatementIssue[] = [];
  const movements: (StatementMovement & { row: number })[] = [];
  let skipped = 0;
  table.records.slice(mapping.headerRow + 1).forEach((row, offset) => {
    const line = table.rowNumbers[mapping.headerRow + 1 + offset] ?? mapping.headerRow + offset + 2;
    const bookedOn = parseDateLoose(cell(row, "booked_on"), dateOrder);
    let amount: Cents | null = null;
    if (columns.amount !== undefined) {
      amount = parseAmountCents(cell(row, "amount"), decimal);
      const direction = normalizeKey(cell(row, "direction"));
      if (amount !== null && direction) {
        if (DEBIT_WORDS.has(direction) || direction === "-") amount = -Math.abs(amount);
        else if (CREDIT_WORDS.has(direction) || direction === "+") amount = Math.abs(amount);
      }
    } else {
      const debit = cell(row, "debit") ? parseAmountCents(cell(row, "debit"), decimal) : 0;
      const credit = cell(row, "credit") ? parseAmountCents(cell(row, "credit"), decimal) : 0;
      if (debit !== null && credit !== null) amount = assertCents(Math.abs(credit) - Math.abs(debit));
    }
    if (!bookedOn || amount === null || amount === 0) {
      const blank = row.every((c) => c.trim() === "");
      if (!blank) {
        skipped += 1;
        // Un pie de tabla ("Saldo final", totales) no tiene fecha: se salta sin avisar.
        if (bookedOn || amount) issues.push({ code: bookedOn ? "rowAmount" : "rowDate", line });
      }
      return;
    }
    const concept = [cell(row, "concept"), cell(row, "extra")].filter(Boolean).join(" · ");
    const reference = cleanText(cell(row, "reference"), 100);
    const counterparty = cleanText(cell(row, "counterparty"), 200);
    const balance = cell(row, "balance") ? parseAmountCents(cell(row, "balance"), decimal) : null;
    movements.push({
      row: line,
      bookedOn,
      valueOn: parseDateLoose(cell(row, "value_on"), dateOrder),
      amountCents: amount,
      concept: cleanText(concept, 1000) ?? "",
      counterparty,
      counterpartyIban: null,
      reference,
      bankCode: null,
      balanceAfterCents: balance,
    });
  });
  if (movements.length === 0) return { ok: false, reason: "no_rows" };

  // Del más reciente al más antiguo (lo habitual en la banca online): se le da la vuelta.
  const first = movements[0]!.bookedOn;
  const last = movements.at(-1)!.bookedOn;
  if (compareCivil(first, last) > 0 || (first === last && descendingByBalance(movements))) movements.reverse();

  let opening: Cents | null = null;
  let closing: Cents | null = null;
  const withBalance = movements.every((m) => m.balanceAfterCents !== null);
  if (withBalance) {
    const head = movements[0]!;
    opening = assertCents(head.balanceAfterCents! - head.amountCents);
    closing = movements.at(-1)!.balanceAfterCents!;
    const breaks = movements.slice(1).filter((m, i) => movements[i]!.balanceAfterCents! + m.amountCents !== m.balanceAfterCents);
    if (breaks.length > 0) issues.push({ code: "balanceChain", line: breaks[0]!.row, params: { count: breaks.length } });
  }
  const period = coverPeriod({ start: null, end: null }, movements, issues)!;
  return {
    ok: true,
    headers: header.map((h) => h.replace(/\s+/g, " ").trim()),
    mapping,
    skipped,
    statement: {
      format: "csv",
      account: { bank: null, branch: null, number: null, iban: findAccountIban(table.records, mapping.headerRow) },
      holder: null,
      periodStart: period.start,
      periodEnd: period.end,
      openingBalanceCents: opening,
      closingBalanceCents: closing,
      movements: movements.map((m) => ({
        bookedOn: m.bookedOn,
        valueOn: m.valueOn,
        amountCents: m.amountCents,
        concept: m.concept,
        counterparty: m.counterparty,
        counterpartyIban: m.counterpartyIban,
        reference: m.reference,
        bankCode: m.bankCode,
        balanceAfterCents: m.balanceAfterCents,
      })),
      issues,
    },
  };
}

/** Con todos los movimientos del mismo día, el saldo dice el orden: si encadena al revés, van del último al primero. */
function descendingByBalance(movements: readonly StatementMovement[]): boolean {
  if (movements.length < 2 || movements.some((m) => m.balanceAfterCents === null)) return false;
  const chains = (list: readonly StatementMovement[]) =>
    list.slice(1).every((m, i) => list[i]!.balanceAfterCents! + m.amountCents === m.balanceAfterCents);
  return !chains(movements) && chains([...movements].reverse());
}
