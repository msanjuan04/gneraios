// Sin "server-only": lo usa también el seed de la demo (scripts/seed-demo-banking.ts), que importa los
// extractos con el mismo código que la pantalla. Solo se importa desde código de servidor.
//
// Importar un extracto: leer el fichero (Norma 43 o CSV), quedarse con el bloque de la cuenta
// elegida, calcular la huella de cada movimiento y, en la vista previa, contar cuáles ya estaban (por
// otro extracto que se solapa). Al confirmar, la RPC bank_import_statement lo guarda todo de una vez.

import { createHash } from "node:crypto";
import type { BankCsvMapping } from "@/domain/banking/csv";
import { n43MatchesIban } from "@/domain/banking/norma43";
import { type CsvPreview, readBankStatement, type ReadStatementResult } from "@/domain/banking/read";
import {
  type BalanceCheck,
  checkBalances,
  fingerprints,
  openingBalanceDate,
  type ParsedStatement,
  type StatementIssue,
  summarizeMovements,
  type StatementSummary,
} from "@/domain/banking/statement";
import type { CivilDate } from "@/domain/dates/civil-date";
import type { Json } from "@/lib/supabase/database.types";
import { type Db, DbError, must } from "@/server/billing/context";

/** Tamaño máximo del extracto (un año de movimientos cabe de sobra). */
export const MAX_STATEMENT_BYTES = 5 * 1024 * 1024;
const PREVIEW_MOVEMENTS = 60;
const FINGERPRINT_CHUNK = 150;

export type ImportFailureReason =
  | Exclude<ReadStatementResult, { ok: true }>["reason"]
  | "too_large"
  | "account_not_found"
  | "account_mismatch"
  | "n43_multiple_accounts"
  | "future_movements"
  | "already_imported";

export type ImportFailure = {
  ok: false;
  reason: ImportFailureReason;
  line?: number;
  /** El CSV que no se entiende solo, para mapearlo a mano. */
  csv?: CsvPreview;
  /** Otra cuenta de la org a la que sí corresponde el fichero (por su IBAN). */
  suggestedAccountId?: string | null;
  /** Los últimos dígitos de la cuenta del fichero. */
  fileAccount?: string | null;
  importedAt?: string;
};

export type PreviewMovement = { bookedOn: CivilDate; amountCents: number; concept: string; bankCode: string | null; duplicate: boolean };

export type StatementPreview = {
  ok: true;
  format: "n43" | "csv";
  fileName: string;
  periodStart: CivilDate;
  periodEnd: CivilDate;
  openingBalanceCents: number | null;
  closingBalanceCents: number | null;
  balanceCheck: BalanceCheck;
  summary: StatementSummary;
  newCount: number;
  duplicateCount: number;
  movements: PreviewMovement[];
  issues: StatementIssue[];
  /** El saldo que ya había apuntado la víspera del periodo (si no coincide con el inicial del fichero, se avisa). */
  recordedOpeningCents: number | null;
  csv: CsvPreview | null;
};

export type CommitResult = {
  ok: true;
  statementId: string;
  inserted: number;
  duplicates: number;
  periodEnd: CivilDate;
  closingBalanceCents: number | null;
  /** El saldo que había ese día y que el del banco sustituye (si era distinto). */
  closingPreviousCents: number | null;
  openingRecordedCents: number | null;
};

type Account = { id: string; org_id: string; name: string; iban: string | null; is_active: boolean };

type Prepared = {
  statement: ParsedStatement;
  fingerprints: string[];
  hash: string;
  csv: CsvPreview | null;
  issues: StatementIssue[];
};

function lastDigits(value: string | null): string | null {
  return value ? value.slice(-4) : null;
}

async function loadAccounts(db: Db, orgId: string): Promise<Account[]> {
  return must(await db.from("cash_accounts").select("id, org_id, name, iban, is_active").eq("org_id", orgId), "banking.import.accounts");
}

/** Lee el fichero y se queda con lo que corresponde a esta cuenta (o dice por qué no se puede). */
async function prepare(
  db: Db,
  orgId: string,
  accountId: string,
  bytes: Uint8Array,
  mapping: BankCsvMapping | null,
  today: CivilDate,
): Promise<{ account: Account; prepared: Prepared } | ImportFailure> {
  if (bytes.length > MAX_STATEMENT_BYTES) return { ok: false, reason: "too_large" };
  const accounts = await loadAccounts(db, orgId);
  const account = accounts.find((a) => a.id === accountId && a.is_active);
  if (!account) return { ok: false, reason: "account_not_found" };

  const read = readBankStatement(bytes, { mapping });
  if (!read.ok) return { ok: false, reason: read.reason, line: read.line, csv: read.csv };

  let statement: ParsedStatement;
  if (read.format === "n43") {
    const matching = account.iban ? read.statements.filter((s) => n43MatchesIban(s.account, account.iban!)) : [];
    if (matching.length > 0) statement = matching[0]!;
    else if (!account.iban && read.statements.length === 1) statement = read.statements[0]!;
    else if (!account.iban) return { ok: false, reason: "n43_multiple_accounts" };
    else {
      const other = accounts.find((a) => a.id !== account.id && a.is_active && a.iban && read.statements.some((s) => n43MatchesIban(s.account, a.iban!)));
      return {
        ok: false,
        reason: "account_mismatch",
        suggestedAccountId: other?.id ?? null,
        fileAccount: lastDigits(read.statements[0]?.account.number ?? null),
      };
    }
  } else {
    statement = read.statements[0];
    const fileIban = statement.account.iban;
    if (fileIban && account.iban && fileIban !== account.iban) {
      const other = accounts.find((a) => a.id !== account.id && a.is_active && a.iban === fileIban);
      return { ok: false, reason: "account_mismatch", suggestedAccountId: other?.id ?? null, fileAccount: lastDigits(fileIban) };
    }
  }
  if (statement.periodEnd > today) return { ok: false, reason: "future_movements" };

  return {
    account,
    prepared: {
      statement,
      fingerprints: fingerprints(statement.movements),
      hash: createHash("sha256").update(bytes).digest("hex"),
      csv: read.format === "csv" ? read.csv : null,
      issues: [...read.issues, ...statement.issues],
    },
  };
}

/** Las huellas que ya están guardadas en la cuenta (de otros extractos). */
async function existingFingerprints(db: Db, accountId: string, list: readonly string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < list.length; i += FINGERPRINT_CHUNK) {
    const chunk = list.slice(i, i + FINGERPRINT_CHUNK);
    const rows = must(
      await db.from("bank_transactions").select("fingerprint").eq("account_id", accountId).in("fingerprint", chunk),
      "banking.import.fingerprints",
    );
    for (const row of rows) found.add(row.fingerprint);
  }
  return found;
}

/** Vista previa: qué trae el fichero, cuántos movimientos son nuevos y si los saldos cuadran. Nada se guarda. */
export async function previewStatementImport(
  db: Db,
  orgId: string,
  input: { accountId: string; fileName: string; bytes: Uint8Array; mapping: BankCsvMapping | null; today: CivilDate },
): Promise<StatementPreview | ImportFailure> {
  const result = await prepare(db, orgId, input.accountId, input.bytes, input.mapping, input.today);
  if ("ok" in result) return result;
  const { account, prepared } = result;
  const { statement } = prepared;

  const [duplicate, existing, opening] = await Promise.all([
    db.from("bank_statements").select("created_at").eq("account_id", account.id).eq("file_hash", prepared.hash).maybeSingle(),
    existingFingerprints(db, account.id, prepared.fingerprints),
    db
      .from("cash_balances")
      .select("balance_cents")
      .eq("account_id", account.id)
      .eq("balance_on", openingBalanceDate(statement.periodStart))
      .maybeSingle(),
  ]);
  if (duplicate.error) throw new DbError(duplicate.error, "banking.import.duplicate");
  if (duplicate.data) return { ok: false, reason: "already_imported", importedAt: duplicate.data.created_at };
  if (opening.error) throw new DbError(opening.error, "banking.import.opening");

  const flags = prepared.fingerprints.map((f) => existing.has(f));
  const newCount = flags.filter((f) => !f).length;
  return {
    ok: true,
    format: statement.format,
    fileName: input.fileName,
    periodStart: statement.periodStart,
    periodEnd: statement.periodEnd,
    openingBalanceCents: statement.openingBalanceCents,
    closingBalanceCents: statement.closingBalanceCents,
    balanceCheck: checkBalances(statement),
    summary: summarizeMovements(statement.movements),
    newCount,
    duplicateCount: flags.length - newCount,
    // Lo más reciente primero, como en la lista de movimientos.
    movements: statement.movements
      .map((m, i) => ({ bookedOn: m.bookedOn, amountCents: m.amountCents, concept: m.concept, bankCode: m.bankCode, duplicate: flags[i]! }))
      .reverse()
      .slice(0, PREVIEW_MOVEMENTS),
    issues: prepared.issues,
    recordedOpeningCents: opening.data?.balance_cents ?? null,
    csv: prepared.csv,
  };
}

/**
 * Guarda el extracto: sus movimientos nuevos (los repetidos se saltan por su huella) y sus saldos en
 * la caja de la cuenta, en una sola transacción (bank_import_statement).
 */
export async function commitStatementImport(
  db: Db,
  orgId: string,
  input: { accountId: string; fileName: string; bytes: Uint8Array; mapping: BankCsvMapping | null; today: CivilDate; balanceNote: string },
): Promise<CommitResult | ImportFailure> {
  const result = await prepare(db, orgId, input.accountId, input.bytes, input.mapping, input.today);
  if ("ok" in result) return result;
  const { account, prepared } = result;
  const { statement } = prepared;
  const payload = {
    account_id: account.id,
    file_name: input.fileName.slice(0, 255) || "extracto",
    file_hash: prepared.hash,
    format: statement.format,
    period_start: statement.periodStart,
    period_end: statement.periodEnd,
    opening_balance_cents: statement.openingBalanceCents,
    closing_balance_cents: statement.closingBalanceCents,
    balance_note: input.balanceNote,
    transactions: statement.movements.map((m, position) => ({
      position,
      booked_on: m.bookedOn,
      value_on: m.valueOn,
      amount_cents: m.amountCents,
      concept: m.concept,
      counterparty: m.counterparty,
      counterparty_iban: m.counterpartyIban,
      reference: m.reference,
      bank_code: m.bankCode,
      balance_after_cents: m.balanceAfterCents,
      fingerprint: prepared.fingerprints[position]!,
    })),
  };
  const { data, error } = await db.rpc("bank_import_statement", { p: payload as unknown as Json });
  if (error) throw new DbError(error, "banking.import.commit");
  const r = data as { statement_id: string; inserted: number; duplicates: number; opening_recorded_cents: number | null; closing_previous_cents: number | null };
  return {
    ok: true,
    statementId: r.statement_id,
    inserted: r.inserted,
    duplicates: r.duplicates,
    periodEnd: statement.periodEnd,
    closingBalanceCents: statement.closingBalanceCents,
    closingPreviousCents: r.closing_previous_cents !== statement.closingBalanceCents ? r.closing_previous_cents : null,
    openingRecordedCents: r.opening_recorded_cents,
  };
}
