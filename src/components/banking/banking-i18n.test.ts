import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { BANK_CSV_ROLES } from "@/domain/banking/csv";
import { CONFIDENCES, REASON_CODES } from "@/domain/banking/matcher";
import { STATEMENT_ISSUE_CODES } from "@/domain/banking/statement";
import { RECONCILIATION_STATUSES } from "@/domain/banking/status";
import messages from "@/i18n/messages/es";
import { BANK_STATUS_FILTERS, IGNORE_REASONS } from "./types";

const PARAMS = {
  left: "1,00 €", rest: "2,00 €", number: "2026-0051", name: "Restaurant Can Sorra", taxId: "B12345674", pattern: "GOOGLE ADS",
  date: "01/09/2026", count: 2, days: 3, account: "Cuenta de la SL", authority: "aeat", model: "303", line: 4, declared: 18, found: 17,
};

/** Las de `ImportFailureReason` (src/server/banking/import.ts) y las de la propia ruta. */
const UPLOAD_ERRORS = [
  "empty", "xlsx", "too_many_rows", "n43_malformed", "n43_currency", "csv_no_header", "csv_mapping", "csv_no_rows", "too_large",
  "account_not_found", "account_mismatch", "n43_multiple_accounts", "future_movements", "already_imported", "origin", "permission", "generic",
];

/** Los hints de src/server/banking/errors.ts, en camelCase. */
const DB_ERRORS = [
  "bankAccountInactive", "bankStatementInvalid", "bankStatementPeriod", "bankStatementDuplicate", "bankStatementInUse",
  "bankTransactionNotFound", "bankTransactionIgnored", "bankTransactionMatched", "bankMatchExceedsMovement", "bankMatchExceedsTarget",
  "bankMatchExceedsOutstanding", "bankMatchDirection", "bankMatchFixed", "bankMatchNotFound", "bankAllocationInvalid",
  "bankInvoiceNotPayable", "bankRemittanceNotCollectible", "remittanceNotSent", "settleDateInvalid", "bankNeedsForm",
  "bankSuggestionStale", "ruleNotFound",
];

describe("textos del banco (es)", () => {
  const errors: string[] = [];
  const t = createTranslator({ locale: "es", messages, namespace: "banking", onError: (e) => errors.push(e.message) }) as unknown as ((
    key: string,
    params?: Record<string, string | number>,
  ) => string) & { has: (key: string) => boolean };

  it("cada motivo, aviso, estado, tipo, motivo de ignorar, error y columna tiene su texto, y el ICU se formatea", () => {
    for (const code of REASON_CODES) expect(t(`reasons.${code}`, PARAMS), code).not.toContain("banking.");
    for (const code of STATEMENT_ISSUE_CODES) expect(t(`issues.${code}`, PARAMS), code).not.toContain("banking.");
    for (const status of RECONCILIATION_STATUSES) expect(t.has(`status.${status}`), status).toBe(true);
    for (const level of CONFIDENCES) expect(t.has(`confidence.${level}`), level).toBe(true);
    for (const kind of ["invoice", "invoices", "payment", "remittance", "expense", "new_expense", "ignore"]) expect(t.has(`kinds.${kind}`), kind).toBe(true);
    for (const reason of IGNORE_REASONS) expect(t.has(`ignore.reasons.${reason}`), reason).toBe(true);
    for (const filter of BANK_STATUS_FILTERS) expect(t.has(`filters.${filter}`), filter).toBe(true);
    for (const reason of UPLOAD_ERRORS) expect(t.has(`upload.errors.${reason}`), reason).toBe(true);
    for (const key of DB_ERRORS) expect(t.has(`errors.${key}`), key).toBe(true);
    for (const role of BANK_CSV_ROLES) expect(t.has(`upload.mapping.roles.${role}`), role).toBe(true);
    for (const kind of ["invoice", "payment", "expense", "remittance"]) expect(t.has(`search.kinds.${kind}`), kind).toBe(true);
    expect(t("reasons.nearDate", { days: 1 })).toBe("1 día de diferencia");
    expect(t("reasons.taxAuthority", { authority: "tgss" })).toBe("Pago a la Seguridad Social");
    expect(t("upload.done", { inserted: 12, duplicates: 3 })).toBe("12 movimientos nuevos (3 ya estaban)");
    expect(t("upload.done", { inserted: 1, duplicates: 0 })).toBe("1 movimiento nuevo");
    expect(t("bulk.button", { count: 4 })).toBe("Confirmar 4 de confianza alta");
    expect(errors).toEqual([]);
  });
});
