import "server-only";
import { getTranslations } from "next-intl/server";
import type { CivilDate } from "@/domain/dates/civil-date";
import { FiscalError } from "@/domain/fiscal/provider";
import { createAdminClient } from "@/lib/supabase/admin";
import { BillingRuleError, type Db, DbError } from "@/server/billing/context";
import { billingFailure } from "@/server/billing/errors";
import { issueInvoiceCore } from "./issue-core";

export { invoicePdfPath } from "./issue-core";

export type IssueOutcome =
  | { invoiceId: string; ok: true; number: string; alreadyIssued: boolean }
  | { invoiceId: string; ok: false; error: string };

/** Mensaje traducido para un fallo de emisión. */
async function describe(error: unknown): Promise<string> {
  if (error instanceof DbError) return (await billingFailure(error.error, error.where)).error;
  const t = await getTranslations();
  if (error instanceof BillingRuleError) return t(error.key);
  if (error instanceof FiscalError) {
    return t(error.code === "totals_mismatch" ? "billing.errors.totalsMismatch" : "billing.errors.providerUnavailable");
  }
  console.error("[issue]", error);
  return t("common.errorGeneric");
}

/**
 * Emite una o varias facturas, en orden y de una en una. Las que fallan no bloquean al resto:
 * el resultado va por factura. Una factura que se quedó a medias (en emisión) se completa.
 */
export async function issueInvoices(
  db: Db,
  invoiceIds: string[],
  opts: { issuedOn?: CivilDate } = {},
): Promise<IssueOutcome[]> {
  const outcomes: IssueOutcome[] = [];
  for (const invoiceId of invoiceIds) {
    try {
      const done = await issueInvoiceCore(db, createAdminClient(), invoiceId, opts.issuedOn);
      outcomes.push({ invoiceId, ok: true, number: done.number, alreadyIssued: done.alreadyIssued });
    } catch (error) {
      outcomes.push({ invoiceId, ok: false, error: await describe(error) });
    }
  }
  return outcomes;
}
