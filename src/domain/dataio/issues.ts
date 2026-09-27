// Motivos que la simulación enseña en cada fila (y que se guardan con el resultado). Son códigos:
// el texto sale de i18n (`dataio.issues.<código>`), con sus parámetros.

import type { ImportField } from "./fields";

export const ISSUE_CODES = [
  // Comunes
  "required",
  "date_invalid",
  "date_future",
  "amount_invalid",
  "rate_invalid",
  "quantity_invalid",
  "tax_id_control",
  "tax_id_format",
  "country_unknown",
  "client_ambiguous",
  "db_error",
  "db_rejected",
  // Clientes
  "email_invalid",
  "email_extra",
  "postal_code_padded",
  "postal_code_invalid",
  "phone_scientific",
  "website_invalid",
  "terms_invalid",
  "language_unknown",
  "source_unknown",
  "owner_unknown",
  "client_exists",
  "client_archived",
  "client_fill",
  "field_kept",
  "name_conflict",
  "contact_new",
  "contact_exists",
  "merged_row",
  // Facturas
  "issuer_missing",
  "issuer_unknown",
  "issuer_inactive",
  "issuer_archived",
  "series_unknown",
  "number_format",
  "group_inconsistent",
  "already_imported",
  "already_imported_differs",
  "number_taken",
  "series_order_conflict",
  "series_external_numbering",
  "totals_mismatch",
  "base_mismatch",
  "vat_mismatch",
  "irpf_mismatch",
  "rounding_adjusted",
  "vat_rate_inferred",
  "vat_rate_default",
  "vat_rate_unknown",
  "vat_regime_guessed",
  "irpf_inferred",
  "line_amount_missing",
  "line_amount_mismatch",
  "description_default",
  "rectified_missing",
  "rectified_unknown",
  "rectifying_negated",
  "negative_total",
  "client_new",
  "date_order_warning",
  "year_mismatch",
  "paid_date_invalid",
  "paid_unknown",
  "paid_before_issue",
] as const;

export type IssueCode = (typeof ISSUE_CODES)[number];
export type IssueSeverity = "error" | "warning" | "info";

export type Issue = {
  code: IssueCode;
  severity: IssueSeverity;
  /** Campo del mapeo al que se refiere (la UI enseña su etiqueta). */
  field?: ImportField;
  /** Varios campos (p. ej. los que se completan de un cliente existente). */
  fields?: ImportField[];
  params?: Record<string, string | number>;
};

export type RowAction = "create" | "update" | "skip" | "error";

export const error = (code: IssueCode, extra: Omit<Issue, "code" | "severity"> = {}): Issue => ({ code, severity: "error", ...extra });
export const warning = (code: IssueCode, extra: Omit<Issue, "code" | "severity"> = {}): Issue => ({ code, severity: "warning", ...extra });
export const info = (code: IssueCode, extra: Omit<Issue, "code" | "severity"> = {}): Issue => ({ code, severity: "info", ...extra });

export function hasErrors(issues: readonly Issue[]): boolean {
  return issues.some((i) => i.severity === "error");
}

/** El motivo que se enseña primero: el primer error, si no el primer aviso, si no la primera nota. */
export function primaryIssue(issues: readonly Issue[]): Issue | null {
  return (
    issues.find((i) => i.severity === "error") ??
    issues.find((i) => i.severity === "warning") ??
    issues[0] ??
    null
  );
}

export type ActionCounts = Record<RowAction, number>;

export function emptyCounts(): ActionCounts {
  return { create: 0, update: 0, skip: 0, error: 0 };
}
