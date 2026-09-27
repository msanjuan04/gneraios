// Sin `import "server-only"`: lo usa también el test de guardado. Solo se importa desde el servidor.
import type { ExistingInvoice } from "@/components/invoice-import/types";
import { type ImportSetup, matchIssuer } from "@/domain/invoice-import/match";
import type { ExtractedInvoice } from "@/domain/invoice-import/types";
import { type Db, DbError } from "@/server/billing/context";

/**
 * ¿Ya está esta factura en la org? Por el mismo PDF (su huella) o por emisor + número, se
 * importara antes o la emitiera GNERAI OS. Con lo que hace falta para decidir: si está cobrada,
 * cuánto queda y si ya tiene su PDF original.
 */
async function describe(db: Db, orgId: string, invoiceId: string, matchedBy: ExistingInvoice["matchedBy"]): Promise<ExistingInvoice | null> {
  const [overview, row, original] = await Promise.all([
    db
      .from("invoices_overview")
      .select("id, number, issuer_id, client_id, client_name, source, status, issued_on, net_total_cents, paid_cents, outstanding_cents")
      .eq("org_id", orgId)
      .eq("id", invoiceId)
      .maybeSingle(),
    db.from("invoices").select("payment_method").eq("org_id", orgId).eq("id", invoiceId).maybeSingle(),
    db.from("invoice_attachments").select("id").eq("org_id", orgId).eq("invoice_id", invoiceId).eq("kind", "original").maybeSingle(),
  ]);
  for (const res of [overview, row, original]) if (res.error) throw new DbError(res.error, "invoiceImport.existing");
  const o = overview.data;
  if (!o?.id || !o.number || !o.issuer_id || !o.client_id || !o.source || !o.status || !row.data) return null;
  return {
    id: o.id,
    number: o.number,
    issuerId: o.issuer_id,
    clientId: o.client_id,
    clientName: o.client_name ?? "",
    source: o.source,
    status: o.status,
    issuedOn: o.issued_on,
    netTotalCents: o.net_total_cents ?? 0,
    paidCents: o.paid_cents ?? 0,
    outstandingCents: o.outstanding_cents ?? 0,
    paymentMethod: row.data.payment_method,
    hasOriginal: original.data !== null,
    matchedBy,
  };
}

export async function findByNumber(db: Db, orgId: string, issuerId: string, number: string): Promise<ExistingInvoice | null> {
  const value = number.trim();
  if (!value) return null;
  const { data, error } = await db
    .from("invoices")
    .select("id")
    .eq("org_id", orgId)
    .eq("issuer_id", issuerId)
    .eq("number", value)
    .neq("lifecycle", "draft")
    .maybeSingle();
  if (error) throw new DbError(error, "invoiceImport.byNumber");
  return data ? describe(db, orgId, data.id, "number") : null;
}

export async function findByFile(db: Db, orgId: string, sha256: string): Promise<ExistingInvoice | null> {
  const { data, error } = await db.from("invoice_attachments").select("invoice_id").eq("org_id", orgId).eq("sha256", sha256).limit(1).maybeSingle();
  if (error) throw new DbError(error, "invoiceImport.byFile");
  return data ? describe(db, orgId, data.invoice_id, "file") : null;
}

/** La factura que ya está: primero por el PDF; si no, por el emisor que se reconoce y el número leído. */
export async function findExisting(
  db: Db,
  orgId: string,
  input: { sha256: string; extraction: ExtractedInvoice; issuers: ImportSetup["issuers"] },
): Promise<ExistingInvoice | null> {
  const byFile = await findByFile(db, orgId, input.sha256);
  if (byFile) return byFile;
  const number = input.extraction.number?.value;
  if (!number) return null;
  const issuer = matchIssuer(input.extraction, { issuers: input.issuers });
  // Solo con el emisor reconocido por su NIF: uno supuesto podría dar un «ya importada» falso.
  if (!issuer.issuerId || issuer.confidence === "low") return null;
  return findByNumber(db, orgId, issuer.issuerId, number);
}
