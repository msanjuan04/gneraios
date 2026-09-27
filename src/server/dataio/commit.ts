import "server-only";
import type { ClientImportPlan } from "@/domain/dataio/clients-import";
import { type InvoiceImportPlan, toImportPayload } from "@/domain/dataio/invoices-import";
import { type ActionCounts, emptyCounts, type Issue, primaryIssue, type RowAction } from "@/domain/dataio/issues";
import type { Json } from "@/lib/supabase/database.types";
import type { Db } from "@/server/billing/context";
import { issueFromDbError } from "./errors";
import type { RowResult } from "./jobs";

export type CommitOutcome = {
  results: Map<number, Omit<RowResult, "id">>;
  /** Por fila. */
  counts: ActionCounts;
  newClients: number;
  /** Facturas: creadas, saltadas y con error (solo en la importación de facturas). */
  invoices?: ActionCounts;
};

function result(action: RowAction, issues: readonly Issue[], entityId: string | null): Omit<RowResult, "id"> {
  return { action, message: primaryIssue(issues)?.code ?? null, issues: issues as unknown as Json, entity_id: entityId };
}

function countRows(results: Map<number, Omit<RowResult, "id">>): ActionCounts {
  const counts = emptyCounts();
  for (const r of results.values()) if (r.action) counts[r.action] += 1;
  return counts;
}

/**
 * Aplica el plan de clientes: altas (con sus contactos), campos que se completan y contactos
 * nuevos. Cada cliente es independiente: si uno falla, los demás siguen. Volver a confirmar es
 * seguro, porque la simulación que precede reconoce lo que ya se creó.
 */
export async function commitClientPlan(db: Db, orgId: string, plan: ClientImportPlan): Promise<CommitOutcome> {
  const entityIds = new Map<string, string>();
  const failed = new Map<string, Issue>();
  let created = 0;

  for (const entity of plan.entities) {
    if (entity.action === "skip") {
      if (entity.existingId) entityIds.set(entity.key, entity.existingId);
      continue;
    }
    let clientId = entity.existingId;
    if (entity.action === "create" && entity.values) {
      const { data, error } = await db
        .from("clients")
        .insert({ ...entity.values, org_id: orgId })
        .select("id")
        .single();
      if (error) {
        failed.set(entity.key, issueFromDbError(error, "commitClients.insert"));
        continue;
      }
      clientId = data.id;
      created += 1;
    } else if (clientId && Object.keys(entity.fill).length > 0) {
      const { error } = await db.from("clients").update(entity.fill).eq("id", clientId).eq("org_id", orgId);
      if (error) {
        failed.set(entity.key, issueFromDbError(error, "commitClients.update"));
        continue;
      }
    }
    if (!clientId) continue;
    entityIds.set(entity.key, clientId);
    if (entity.contacts.length > 0) {
      const { error } = await db
        .from("contacts")
        .insert(entity.contacts.map((c) => ({ ...c, org_id: orgId, client_id: clientId })));
      if (error) failed.set(entity.key, issueFromDbError(error, "commitClients.contacts"));
    }
  }

  const results = new Map<number, Omit<RowResult, "id">>();
  for (const row of plan.rows) {
    const entityId = row.key ? (entityIds.get(row.key) ?? row.existingId) : null;
    const failure = row.key ? failed.get(row.key) : undefined;
    if (failure && row.action !== "error") results.set(row.rowNumber, result("error", [failure, ...row.issues], entityId ?? null));
    else results.set(row.rowNumber, result(row.action, row.issues, row.action === "error" ? null : (entityId ?? null)));
  }
  return { results, counts: countRows(results), newClients: created };
}

/**
 * Aplica el plan de facturas: primero da de alta los clientes nuevos (con su contacto de
 * facturación si el fichero traía email) y después importa cada factura con
 * import_historical_invoice, en el orden del plan (ordinarias antes que sus rectificativas). Una
 * factura que falla no para a las demás; la RPC es idempotente, así que reintentar es seguro.
 */
export async function commitInvoicePlan(db: Db, orgId: string, ownerMemberId: string | null, plan: InvoiceImportPlan): Promise<CommitOutcome> {
  const newClientIds = new Map<string, string>();
  const clientFailures = new Map<string, Issue>();
  for (const draft of plan.newClients) {
    const { data, error } = await db
      .from("clients")
      .insert({
        org_id: orgId,
        display_name: draft.display_name,
        legal_name: draft.legal_name,
        tax_id: draft.tax_id,
        tax_id_kind: draft.tax_id_kind,
        address_line: draft.address_line,
        postal_code: draft.postal_code,
        city: draft.city,
        province: draft.province,
        country_code: draft.country_code,
        owner_member_id: ownerMemberId,
      })
      .select("id")
      .single();
    if (error) {
      // Si otro lo ha creado entretanto (mismo NIF), se usa ese.
      if (error.code === "23505" && draft.tax_id) {
        const { data: found } = await db.from("clients").select("id").eq("org_id", orgId).eq("tax_id", draft.tax_id).maybeSingle();
        if (found) {
          newClientIds.set(draft.key, found.id);
          continue;
        }
      }
      clientFailures.set(draft.key, issueFromDbError(error, "commitInvoices.client"));
      continue;
    }
    newClientIds.set(draft.key, data.id);
    if (draft.email) {
      const { error: contactError } = await db.from("contacts").insert({
        org_id: orgId,
        client_id: data.id,
        full_name: draft.display_name.slice(0, 120),
        email: draft.email,
        is_primary: true,
        is_billing: true,
      });
      if (contactError) console.error("[dataio] commitInvoices.contact", contactError);
    }
  }

  const invoiceIds = new Map<string, string>();
  const invoiceFailures = new Map<string, Issue>();
  const invoiceCounts = emptyCounts();
  for (const inv of plan.invoices) {
    if (inv.action === "skip") {
      invoiceCounts.skip += 1;
      if (inv.existingId) invoiceIds.set(inv.externalId, inv.existingId);
      continue;
    }
    if (inv.action !== "create" || !inv.client) {
      invoiceCounts.error += 1;
      continue;
    }
    const clientId = inv.client.kind === "existing" ? inv.client.id : newClientIds.get(inv.client.key);
    if (!clientId) {
      invoiceFailures.set(inv.externalId, (inv.client.kind === "new" && clientFailures.get(inv.client.key)) || { code: "db_error", severity: "error" });
      invoiceCounts.error += 1;
      continue;
    }
    const { data, error } = await db.rpc("import_historical_invoice", { p: toImportPayload(inv, clientId) as unknown as Json });
    if (error) {
      invoiceFailures.set(inv.externalId, issueFromDbError(error, "commitInvoices.rpc"));
      invoiceCounts.error += 1;
      continue;
    }
    invoiceIds.set(inv.externalId, data);
    invoiceCounts.create += 1;
  }

  const results = new Map<number, Omit<RowResult, "id">>();
  for (const row of plan.rows) {
    if (!row.externalId || row.action === "error") {
      results.set(row.rowNumber, result("error", row.issues, null));
      continue;
    }
    const failure = invoiceFailures.get(row.externalId);
    if (failure) results.set(row.rowNumber, result("error", [failure, ...row.issues], null));
    else results.set(row.rowNumber, result(row.action, row.issues, invoiceIds.get(row.externalId) ?? null));
  }
  return { results, counts: countRows(results), newClients: newClientIds.size, invoices: invoiceCounts };
}
