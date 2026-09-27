// Norma 43 (AEB, Cuaderno 43): el fichero de movimientos que da cualquier banco español para la
// contabilidad. Registros de 80 caracteres, uno por línea:
//
//   11  Cabecera de cuenta: entidad, oficina, cuenta, fechas inicial y final (AAMMDD), saldo inicial
//       (clave 1 = deudor / 2 = acreedor + 14 cifras con 2 decimales), divisa (978 = EUR), modalidad
//       y nombre abreviado del titular.
//   22  Movimiento: oficina de origen, fecha de operación, fecha valor, concepto común (2 cifras),
//       concepto propio (3), clave debe (1, cargo) / haber (2, abono), importe (14), nº de documento
//       (10), referencia 1 (12) y referencia 2 (16).
//   23  Concepto complementario del movimiento anterior (hasta 5, con código 01-05): 2 × 38 caracteres.
//   24  Equivalencia de divisa (se ignora: solo trabajamos en euros).
//   33  Final de cuenta: nº y total de cargos, nº y total de abonos, saldo final y divisa.
//   88  Fin de fichero: 18 nueves y el nº de registros.
//
// Un fichero puede traer varias cuentas (varios 11…33). El lector es tolerante con los ficheros
// reales (líneas sin los espacios del final, líneas vacías, CRLF o LF) y avisa de lo que no cuadra.

import { formatCivil, type CivilDate } from "../dates/civil-date";
import { assertCents, type Cents } from "../money";
import { cleanText } from "../dataio/text";
import { coverPeriod, type ParsedStatement, type StatementIssue, type StatementMovement } from "./statement";

export const N43_RECORD_LENGTH = 80;
const EUR = "978";

export type Norma43Result =
  | { ok: true; accounts: ParsedStatement[]; issues: StatementIssue[] }
  | { ok: false; reason: "empty" | "not_n43" | "malformed" | "currency"; line?: number };

type Line = { text: string; number: number };

/** ¿Parece un Norma 43? La primera línea con datos es una cabecera de cuenta (11) de 80 caracteres. */
export function looksLikeNorma43(text: string): boolean {
  const first = text
    .replace(/^﻿/, "")
    .split(/\r\n|\n|\r/)
    .find((l) => l.trim() !== "");
  if (!first) return false;
  return /^11[0-9]{18}[0-9]{12}[12][0-9]{14}/.test(first) && first.trimEnd().length <= N43_RECORD_LENGTH;
}

/** AAMMDD → fecha civil (siglo XXI), o null si no es una fecha real. */
export function n43Date(value: string): CivilDate | null {
  if (!/^[0-9]{6}$/.test(value)) return null;
  try {
    return formatCivil({ year: 2000 + Number(value.slice(0, 2)), month: Number(value.slice(2, 4)), day: Number(value.slice(4, 6)) });
  } catch {
    return null;
  }
}

/** Clave debe/haber + 14 cifras (12 enteras y 2 decimales) → céntimos con signo (debe es negativo). */
export function n43Amount(sign: string, digits: string): Cents | null {
  if ((sign !== "1" && sign !== "2") || !/^[0-9]{14}$/.test(digits)) return null;
  const cents = Number(digits);
  if (!Number.isSafeInteger(cents)) return null;
  return assertCents(sign === "1" ? -cents : cents);
}

function field(line: string, from: number, to: number): string {
  return line.slice(from, to);
}

/** Texto de un campo: sin los espacios de relleno; null si está vacío o es solo ceros. */
function textField(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "" || /^0+$/.test(trimmed)) return null;
  return trimmed;
}

type OpenAccount = {
  statement: ParsedStatement;
  startLine: number;
  declared: { start: CivilDate | null; end: CivilDate | null };
  complementary: string[] | null;
  /** Los 23 de un movimiento que no se ha guardado (importe 0) se saltan. */
  skipComplementary: boolean;
  totals: { debitCount: number; debitCents: number; creditCount: number; creditCents: number };
};

function flushComplementary(account: OpenAccount) {
  const movement = account.statement.movements.at(-1);
  if (!movement || !account.complementary) return;
  const text = account.complementary.join(" ");
  movement.concept = cleanText(text, 1000) ?? "";
  account.complementary = null;
}

/**
 * Lee un fichero Norma 43 ya decodificado. Los movimientos salen en el orden del fichero (el del
 * banco: cronológico) y con el concepto formado por sus registros 23.
 */
export function parseNorma43(input: string): Norma43Result {
  const text = input.replace(/^﻿/, "");
  const lines: Line[] = text
    .split(/\r\n|\n|\r/)
    .map((raw, i) => ({ text: raw.replace(/\s+$/, "").padEnd(N43_RECORD_LENGTH, " "), number: i + 1, blank: raw.trim() === "" }))
    .filter((l) => !l.blank)
    .map(({ text: t, number }) => ({ text: t, number }));
  if (lines.length === 0) return { ok: false, reason: "empty" };
  if (!looksLikeNorma43(text)) return { ok: false, reason: "not_n43" };

  const accounts: ParsedStatement[] = [];
  const issues: StatementIssue[] = [];
  let open: OpenAccount | null = null;
  let records = 0;
  let endRecord: { count: number; line: number } | null = null;

  for (const { text: line, number } of lines) {
    if (line.length > N43_RECORD_LENGTH) return { ok: false, reason: "malformed", line: number };
    const type = line.slice(0, 2);
    if (endRecord) return { ok: false, reason: "malformed", line: number };
    if (type !== "88") records += 1;

    if (type === "11") {
      if (open) return { ok: false, reason: "malformed", line: number };
      const start = n43Date(field(line, 20, 26));
      const end = n43Date(field(line, 26, 32));
      const opening = n43Amount(line[32]!, field(line, 33, 47));
      if (!start || !end || opening === null) return { ok: false, reason: "malformed", line: number };
      if (field(line, 47, 50) !== EUR) return { ok: false, reason: "currency", line: number };
      open = {
        startLine: number,
        declared: { start, end },
        complementary: null,
        skipComplementary: false,
        totals: { debitCount: 0, debitCents: 0, creditCount: 0, creditCents: 0 },
        statement: {
          format: "n43",
          account: { bank: field(line, 2, 6), branch: field(line, 6, 10), number: field(line, 10, 20), iban: null },
          holder: textField(field(line, 51, 77)),
          periodStart: start,
          periodEnd: end,
          openingBalanceCents: opening,
          closingBalanceCents: null,
          movements: [],
          issues: [],
        },
      };
      continue;
    }

    if (type === "88") {
      if (open) return { ok: false, reason: "malformed", line: number };
      endRecord = { count: Number(field(line, 20, 26)), line: number };
      continue;
    }

    if (!open) return { ok: false, reason: "malformed", line: number };

    if (type === "22") {
      flushComplementary(open);
      const bookedOn = n43Date(field(line, 10, 16));
      const valueOn = n43Date(field(line, 16, 22));
      const amount = n43Amount(line[27]!, field(line, 28, 42));
      if (!bookedOn || amount === null) return { ok: false, reason: "malformed", line: number };
      open.skipComplementary = amount === 0;
      if (amount === 0) {
        open.statement.issues.push({ code: "zeroAmount", line: number });
        continue;
      }
      const common = field(line, 22, 24);
      const own = field(line, 24, 27).trim();
      const bankCode = /^[0-9]{2}$/.test(common) ? (own && /^[0-9A-Z]{1,3}$/.test(own) && !/^0+$/.test(own) ? `${common}-${own}` : common) : null;
      const references = [field(line, 42, 52), field(line, 52, 64), field(line, 64, 80)].map(textField).filter((r): r is string => r !== null);
      const movement: StatementMovement = {
        bookedOn,
        valueOn,
        amountCents: amount,
        concept: "",
        counterparty: null,
        counterpartyIban: null,
        reference: references.length > 0 ? references.join(" · ").slice(0, 100) : null,
        bankCode,
        balanceAfterCents: null,
      };
      open.statement.movements.push(movement);
      if (amount < 0) {
        open.totals.debitCount += 1;
        open.totals.debitCents += -amount;
      } else {
        open.totals.creditCount += 1;
        open.totals.creditCents += amount;
      }
      open.complementary = null;
      continue;
    }

    if (type === "23") {
      if (open.skipComplementary) continue;
      if (open.statement.movements.length === 0) return { ok: false, reason: "malformed", line: number };
      const parts = [field(line, 4, 42), field(line, 42, 80)].map((p) => p.trim()).filter(Boolean);
      open.complementary = [...(open.complementary ?? []), ...parts];
      continue;
    }

    if (type === "24") continue;

    if (type === "33") {
      flushComplementary(open);
      const closing = n43Amount(line[58]!, field(line, 59, 73));
      if (closing === null) return { ok: false, reason: "malformed", line: number };
      const statement = open.statement;
      statement.closingBalanceCents = closing;
      const declared = {
        debitCount: Number(field(line, 20, 25)),
        debitCents: Number(field(line, 25, 39)),
        creditCount: Number(field(line, 39, 44)),
        creditCents: Number(field(line, 44, 58)),
      };
      const t = open.totals;
      if (
        declared.debitCount !== t.debitCount ||
        declared.debitCents !== t.debitCents ||
        declared.creditCount !== t.creditCount ||
        declared.creditCents !== t.creditCents
      ) {
        statement.issues.push({ code: "totalsMismatch", line: number });
      }
      if (statement.openingBalanceCents !== null && statement.openingBalanceCents - t.debitCents + t.creditCents !== closing) {
        statement.issues.push({ code: "balanceMismatch", line: number });
      }
      const period = coverPeriod(open.declared, statement.movements, statement.issues);
      if (period) {
        statement.periodStart = period.start;
        statement.periodEnd = period.end;
      }
      accounts.push(statement);
      open = null;
      continue;
    }

    return { ok: false, reason: "malformed", line: number };
  }

  if (open) {
    // Sin registro 33: se aceptan los movimientos, pero sin saldo final.
    flushComplementary(open);
    open.statement.issues.push({ code: "missingFooter", line: open.startLine });
    const period = coverPeriod(open.declared, open.statement.movements, open.statement.issues);
    if (period) {
      open.statement.periodStart = period.start;
      open.statement.periodEnd = period.end;
    }
    accounts.push(open.statement);
  }
  if (accounts.length === 0) return { ok: false, reason: "malformed" };
  if (!endRecord) issues.push({ code: "missingEnd" });
  else if (endRecord.count !== records) issues.push({ code: "recordCount", line: endRecord.line, params: { declared: endRecord.count, found: records } });
  return { ok: true, accounts, issues };
}

/**
 * ¿Es este bloque del fichero de la cuenta con este IBAN? En España el IBAN es ES + 2 cifras de
 * control + entidad (4) + oficina (4) + 2 dígitos de control + cuenta (10), y el registro 11 trae la
 * entidad, la oficina y la cuenta.
 */
export function n43MatchesIban(account: { bank: string | null; branch: string | null; number: string | null }, iban: string): boolean {
  const normalized = iban.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (!/^ES[0-9]{22}$/.test(normalized) || !account.bank || !account.branch || !account.number) return false;
  return (
    normalized.slice(4, 8) === account.bank && normalized.slice(8, 12) === account.branch && normalized.slice(14, 24) === account.number
  );
}

// ---------------------------------------------------------------------------
// Escritura (para la demo y los tests: un N43 como el del banco)
// ---------------------------------------------------------------------------

function yymmdd(date: CivilDate): string {
  return `${date.slice(2, 4)}${date.slice(5, 7)}${date.slice(8, 10)}`;
}

function amount14(cents: Cents): string {
  return String(Math.abs(assertCents(cents))).padStart(14, "0");
}

function pad(value: string, length: number): string {
  const ascii = value
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\x20-\x7e]/g, " ")
    .toUpperCase();
  return ascii.slice(0, length).padEnd(length, " ");
}

export type Norma43WriteAccount = {
  bank: string;
  branch: string;
  number: string;
  holder: string;
  periodStart: CivilDate;
  periodEnd: CivilDate;
  openingBalanceCents: Cents;
  movements: {
    bookedOn: CivilDate;
    valueOn?: CivilDate;
    amountCents: Cents;
    commonConcept: string;
    ownConcept?: string;
    document?: string;
    reference1?: string;
    reference2?: string;
    /** Hasta 10 trozos de 38 caracteres (5 registros 23). */
    concept?: string[];
  }[];
};

/** Un fichero Norma 43 con sus registros 11, 22, 23, 33 y 88 (CRLF, en ASCII). */
export function writeNorma43(accounts: readonly Norma43WriteAccount[]): string {
  const out: string[] = [];
  for (const a of accounts) {
    const opening = a.openingBalanceCents;
    out.push(
      `11${a.bank}${a.branch}${a.number}${yymmdd(a.periodStart)}${yymmdd(a.periodEnd)}${opening < 0 ? "1" : "2"}${amount14(opening)}${EUR}3${pad(a.holder, 26)}   `,
    );
    let debits = 0;
    let credits = 0;
    let debitCount = 0;
    let creditCount = 0;
    for (const m of a.movements) {
      if (m.amountCents < 0) {
        debits += -m.amountCents;
        debitCount += 1;
      } else {
        credits += m.amountCents;
        creditCount += 1;
      }
      out.push(
        `22    ${a.branch}${yymmdd(m.bookedOn)}${yymmdd(m.valueOn ?? m.bookedOn)}${m.commonConcept.padStart(2, "0").slice(0, 2)}${(m.ownConcept ?? "000").padStart(3, "0").slice(0, 3)}${m.amountCents < 0 ? "1" : "2"}${amount14(m.amountCents)}${(m.document ?? "").padStart(10, "0").slice(0, 10)}${pad(m.reference1 ?? "", 12)}${pad(m.reference2 ?? "", 16)}`,
      );
      const chunks = m.concept ?? [];
      for (let i = 0; i < chunks.length && i < 10; i += 2) {
        out.push(`23${String(i / 2 + 1).padStart(2, "0")}${pad(chunks[i]!, 38)}${pad(chunks[i + 1] ?? "", 38)}`);
      }
    }
    const closing = opening - debits + credits;
    out.push(
      `33${a.bank}${a.branch}${a.number}${String(debitCount).padStart(5, "0")}${amount14(debits)}${String(creditCount).padStart(5, "0")}${amount14(credits)}${closing < 0 ? "1" : "2"}${amount14(closing)}${EUR}    `,
    );
  }
  out.push(`88${"9".repeat(18)}${String(out.length).padStart(6, "0")}${" ".repeat(54)}`);
  return `${out.join("\r\n")}\r\n`;
}
