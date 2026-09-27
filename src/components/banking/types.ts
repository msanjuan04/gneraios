// Datos del Banco tal como los pinta la UI (serializables: pasan de servidor a cliente). Los carga
// src/server/banking/queries.ts con la sesión del usuario (RLS). Las propuestas son las del dominio
// (src/domain/banking/matcher.ts): se calculan en cada carga y no se guardan.

import type { Confidence, Suggestion } from "@/domain/banking/matcher";
import type { MonthProgress, PendingTotals } from "@/domain/banking/digest";
import type { ReconciliationStatus } from "@/domain/banking/status";
import type { Enums } from "@/lib/supabase/database.types";

export type { Confidence, Suggestion, ReconciliationStatus };

export type IgnoreReason = Enums<"bank_ignore_reason">;
export const IGNORE_REASONS: readonly IgnoreReason[] = [
  "internal_transfer",
  "partner_movement",
  "financing",
  "tax_settlement",
  "personal",
  "other",
];

export type BankAccountOption = {
  id: string;
  name: string;
  iban: string | null;
  issuerId: string;
  issuerName: string;
  /** Último saldo de caja (el del último extracto o el apuntado a mano). */
  balanceCents: number | null;
  balanceOn: string | null;
  pendingCount: number;
  /** Hasta qué día llega el último extracto importado. */
  lastStatementEnd: string | null;
};

export type BankMatchItem = {
  id: string;
  amountCents: number;
  kind: "payment" | "expense" | "remittance";
  invoiceId: string | null;
  invoiceNumber: string | null;
  clientId: string | null;
  clientName: string | null;
  expenseId: string | null;
  expenseDescription: string | null;
  vendorName: string | null;
  categoryName: string | null;
  remittanceId: string | null;
  remittanceCollectionOn: string | null;
  createdPayment: boolean;
  createdExpense: boolean;
  markedPaid: boolean;
  settledRemittance: boolean;
  createdAt: string;
  createdByName: string | null;
};

export type BankTransactionItem = {
  id: string;
  bookedOn: string;
  valueOn: string | null;
  amountCents: number;
  concept: string;
  counterparty: string | null;
  reference: string | null;
  bankCode: string | null;
  balanceAfterCents: number | null;
  status: ReconciliationStatus;
  matchedCents: number;
  remainingCents: number;
  ignoredReason: IgnoreReason | null;
  ignoredNote: string | null;
  matches: BankMatchItem[];
  /** Solo las de los pendientes, de la mejor a la peor. */
  suggestions: Suggestion[];
};

export type BankStatementItem = {
  id: string;
  fileName: string;
  format: "n43" | "csv";
  periodStart: string;
  periodEnd: string;
  movementsInFile: number;
  newCount: number;
  importedAt: string;
  importedByName: string | null;
  openingBalanceCents: number | null;
  closingBalanceCents: number | null;
  /** Saldo final − saldo inicial − movimientos del periodo (0 = cuadra). */
  balanceGapCents: number | null;
};

export type BankRuleItem = {
  id: string;
  direction: "credit" | "debit";
  field: "counterparty" | "concept";
  pattern: string;
  vendorName: string | null;
  categoryName: string | null;
  clientName: string | null;
};

export type BankStatusFilter = "pending" | "reconciled" | "ignored" | "all";
export const BANK_STATUS_FILTERS: readonly BankStatusFilter[] = ["pending", "reconciled", "ignored", "all"];

export type BankFilters = {
  account: string;
  status: BankStatusFilter;
  /** YYYY-MM o vacío. */
  month: string;
  q: string;
};

export type BankKpis = {
  pending: PendingTotals;
  /** El mes en curso (YYYY-MM) y cuántos de sus movimientos están explicados. */
  month: MonthProgress & { month: string };
  /** Efecto en el saldo de lo que el banco ha movido y GNERAI OS aún no explica. */
  unexplainedNetCents: number;
  /** Cuántos pendientes tienen una propuesta de confianza alta (se confirman de una vez). */
  highCount: number;
};

export type BankPageData = {
  accounts: BankAccountOption[];
  account: BankAccountOption | null;
  transactions: BankTransactionItem[];
  truncated: boolean;
  statements: BankStatementItem[];
  kpis: BankKpis;
  rules: BankRuleItem[];
  /** Meses (YYYY-MM) con movimientos, del más reciente al más antiguo. */
  months: string[];
};

/** Para buscar a mano qué explica un movimiento. */
export type BankTargetOption =
  | { kind: "invoice"; id: string; number: string | null; clientName: string; issuedOn: string; dueOn: string | null; availableCents: number }
  | { kind: "payment"; id: string; invoiceNumber: string | null; clientName: string; paidOn: string; availableCents: number }
  | { kind: "expense"; id: string; vendorName: string | null; description: string; issuedOn: string; paidOn: string | null; availableCents: number }
  | { kind: "remittance"; id: string; collectionOn: string; status: string; itemsCount: number; availableCents: number };
