// Emisión sin dependencias de Next (sin "server-only" ni traducciones): la usan la app
// (issue.ts, que traduce los errores) y el seed de la demo. `db` es el cliente del usuario
// (RLS y rol de socio en las RPC); `admin` solo se usa para guardar el PDF en Storage.
import type { CivilDate } from "@/domain/dates/civil-date";
import { internalDraftProvider } from "@/domain/fiscal/internal";
import { runIssueFlow, type IssueFlowDeps } from "@/domain/fiscal/issue-flow";
import { FiscalError, type FiscalProvider, type FiscalProviderId } from "@/domain/fiscal/provider";
import { lineAmountsMatch } from "@/domain/invoicing/draft-line";
import type { Json } from "@/lib/supabase/database.types";
import { renderInvoicePdf } from "@/pdf";
import { BillingRuleError, type Db, DbError } from "@/server/billing/context";
import { type LoadedInvoice, loadInvoice, toFiscalDocument, toPdfData } from "./document";

/** Ruta del PDF legal en Storage: una por factura, dentro de la carpeta de la org. */
export const invoicePdfPath = (orgId: string, invoiceId: string) => `${orgId}/${invoiceId}.pdf`;

function providerFor(id: FiscalProviderId): FiscalProvider {
  if (id === "internal") return internalDraftProvider;
  // Los proveedores certificados llegan en el hito 1.6 (ARCHITECTURE §7.6).
  throw new FiscalError("provider_unavailable", `Proveedor fiscal sin adaptador: ${id}`);
}

/** Antes de emitir, el servidor recalcula cada línea con el dominio: si algo no cuadra, no se emite. */
function assertAmounts(loaded: LoadedInvoice) {
  for (const l of loaded.lines) {
    const ok = lineAmountsMatch(
      {
        id: l.id,
        position: l.position,
        description: l.description,
        quantity: String(l.quantity),
        unit_price_cents: l.unit_price_cents,
        discount_bps: l.discount_bps,
        base_cents: l.base_cents,
        tax_rate_id: l.tax_rate_id,
        vat_bps: l.vat_bps,
        vat_regime: l.vat_regime,
        vat_cents: l.vat_cents,
        irpf_applies: l.irpf_applies,
        irpf_cents: l.irpf_cents,
        legal_note: l.legal_note,
        billing_type: l.billing_type,
        period_start: l.period_start,
        period_end: l.period_end,
        contract_line_id: l.contract_line_id,
        rectifies_line_id: l.rectifies_line_id,
      },
      loaded.invoice.irpf_bps,
    );
    if (!ok) throw new BillingRuleError("billing.errors.totalsMismatch");
  }
}

export async function issueInvoiceCore(db: Db, admin: Db, invoiceId: string, issuedOn: CivilDate | undefined) {
  const pre = await loadInvoice(db, invoiceId);
  if (pre.invoice.lifecycle === "draft") assertAmounts(pre);
  const orgId = pre.invoice.org_id;
  let frozen: LoadedInvoice | null = null;

  const deps: IssueFlowDeps = {
    async begin(id, on) {
      const { data, error } = await db.rpc("issue_invoice_begin", { p_invoice_id: id, p_issued_on: on });
      if (error) throw new DbError(error, "issue.begin");
      const r = data as { lifecycle: "draft" | "issuing" | "issued"; number: string | null; issued_on: string | null; fiscal_provider: FiscalProviderId };
      return { lifecycle: r.lifecycle, number: r.number, issuedOn: r.issued_on, fiscalProvider: r.fiscal_provider };
    },
    async loadDocument(id) {
      frozen = await loadInvoice(db, id);
      const { data: series } = await db
        .from("invoice_series")
        .select("provider_series_ref")
        .eq("id", frozen.invoice.series_id ?? "")
        .maybeSingle();
      return toFiscalDocument(frozen, series?.provider_series_ref ?? null);
    },
    provider: providerFor,
    async renderPdf(id, issued) {
      const loaded = frozen ?? (await loadInvoice(db, id));
      const data = toPdfData({ ...loaded, invoice: { ...loaded.invoice, number: issued.number } });
      return renderInvoicePdf(data);
    },
    async storePdf(id, pdf) {
      const path = invoicePdfPath(orgId, id);
      // Solo se sobrescribe mientras la factura está en emisión (reintento del mismo número).
      const { error } = await admin.storage.from("invoices").upload(path, pdf, { contentType: "application/pdf", upsert: true });
      if (error) throw new BillingRuleError("billing.errors.pdfFailed");
      return path;
    },
    async complete(id, result) {
      const { error } = await db.rpc("issue_invoice_complete", {
        p_invoice_id: id,
        p: {
          number: result.number ?? null,
          pdf_path: result.pdfPath,
          provider_ref: result.providerRef ?? null,
          provider_payload: (result.providerPayload ?? null) as Json,
        },
      });
      if (error) throw new DbError(error, "issue.complete");
    },
  };
  return runIssueFlow(deps, invoiceId, { issuedOn });
}

