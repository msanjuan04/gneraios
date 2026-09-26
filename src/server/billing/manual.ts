import "server-only";
import { randomUUID } from "node:crypto";
import { issuerOn } from "@/domain/billing/issuer";
import { splitByMilestones } from "@/domain/billing/milestones";
import type { CivilDate } from "@/domain/dates/civil-date";
import { buildDraftLine, defaultIrpfBps, resolvePaymentTermsDays } from "@/domain/invoicing/draft-line";
import { formatBps } from "@/domain/money";
import { lineBaseCents } from "@/domain/metrics/mrr";
import { BillingRuleError, type Db, DbError, loadVatRates, must, orgSettings } from "./context";

/** Resultado de las operaciones de facturación manual: id creado o clave de error de i18n. */
export type ManualResult<T> = { ok: true } & T;
export { BillingRuleError };

/**
 * «Facturar hito»: crea el pendiente del hito para cada línea puntual del contrato y un
 * borrador con él, listo para revisar y emitir. Los hitos se facturan en orden; el último
 * factura el resto, para que cada línea cuadre al céntimo.
 */
export async function billMilestone(
  db: Db,
  orgId: string,
  milestoneId: string,
  today: CivilDate,
): Promise<ManualResult<{ invoiceId: string }>> {
  const milestone = must(
    await db.from("contract_milestones").select("id, contract_id, position, label, percent_bps").eq("id", milestoneId).eq("org_id", orgId).maybeSingle(),
    "billMilestone.milestone",
  );
  const contract = must(
    await db
      .from("contracts")
      .select(
        "id, client_id, signed_on, payment_terms_days, payment_method, invoice_grouping, contract_issuers(issuer_id, valid_from), contract_lines(id, position, description, billing_type, quantity, unit_price_cents, discount_bps, tax_rate_id, irpf_applies), contract_milestones(id, position, label, percent_bps)",
      )
      .eq("id", milestone.contract_id)
      .maybeSingle(),
    "billMilestone.contract",
  );
  if (!contract.signed_on) throw new BillingRuleError("billing.errors.contractNotSigned");

  const oneOffLines = contract.contract_lines
    .filter((l) => l.billing_type === "one_off")
    .sort((a, b) => a.position - b.position);
  if (oneOffLines.length === 0) throw new BillingRuleError("billing.errors.noOneOffLines");

  const milestones = [...contract.contract_milestones].sort((a, b) => a.position - b.position);
  const billed = must(
    await db.from("billable_items").select("milestone_id").in("milestone_id", milestones.map((m) => m.id)),
    "billMilestone.billed",
  );
  const billedIds = new Set(billed.map((b) => b.milestone_id));
  if (billedIds.has(milestone.id)) throw new BillingRuleError("billing.errors.milestoneAlreadyBilled");
  const index = milestones.findIndex((m) => m.id === milestone.id);
  if (milestones.slice(0, index).some((m) => !billedIds.has(m.id))) throw new BillingRuleError("billing.errors.milestoneOrder");

  const shares = splitByMilestones(
    oneOffLines.map((l) => ({ id: l.id, baseCents: lineBaseCents({ quantity: l.quantity, unitPriceCents: l.unit_price_cents, discountBps: l.discount_bps }) })),
    milestones.map((m) => ({ id: m.id, percentBps: m.percent_bps })),
  )[milestone.id]!;

  const issuerId = issuerOn(
    contract.contract_issuers.map((ci) => ({ issuerId: ci.issuer_id, validFrom: ci.valid_from })),
    today,
  );
  if (!issuerId) throw new BillingRuleError("billing.errors.noIssuer");

  const [issuer, client, org, vatRates] = await Promise.all([
    db.from("issuers").select("id, default_irpf_bps").eq("id", issuerId).single(),
    db.from("clients").select("id, is_business, tax_id_kind, country_code, preferred_language, payment_terms_days").eq("id", contract.client_id).single(),
    db.from("orgs").select("settings").eq("id", orgId).single(),
    loadVatRates(db, orgId),
  ]);
  if (issuer.error) throw new DbError(issuer.error, "billMilestone.issuer");
  if (client.error) throw new DbError(client.error, "billMilestone.client");
  if (org.error) throw new DbError(org.error, "billMilestone.org");

  const irpfBps = defaultIrpfBps(
    { defaultIrpfBps: issuer.data.default_irpf_bps },
    { isBusiness: client.data.is_business, taxIdKind: client.data.tax_id_kind, countryCode: client.data.country_code },
  );
  const percent = formatBps(milestone.percent_bps);

  const items = oneOffLines
    .filter((l) => (shares[l.id] ?? 0) > 0)
    .map((l) => ({
      id: randomUUID(),
      contract_line_id: l.id,
      source: "milestone" as const,
      milestone_id: milestone.id,
      description: `${l.description} · ${milestone.label} (${percent})`,
      quantity: "1",
      unit_price_cents: shares[l.id]!,
      discount_bps: 0,
      amount_cents: shares[l.id]!,
      billable_on: today,
      line: l,
    }));

  const lines = items.map((item, position) => {
    const rate = vatRates.get(item.line.tax_rate_id);
    if (!rate) throw new BillingRuleError("billing.errors.vatRateRequired");
    return buildDraftLine(
      {
        id: randomUUID(),
        position,
        description: item.description,
        quantity: item.quantity,
        unitPriceCents: item.unit_price_cents,
        discountBps: 0,
        taxRate: rate,
        irpfApplies: item.line.irpf_applies,
        billingType: "one_off",
        contractLineId: item.line.id,
        billableItemId: item.id,
      },
      irpfBps,
    );
  });

  const { data, error } = await db.rpc("save_invoice_draft", {
    p: {
      header: {
        issuer_id: issuerId,
        client_id: contract.client_id,
        contract_id: contract.invoice_grouping === "contract" ? contract.id : null,
        language: client.data.preferred_language,
        irpf_bps: irpfBps,
        payment_method: contract.payment_method,
        payment_terms_days: resolvePaymentTermsDays(
          contract.payment_terms_days,
          client.data.payment_terms_days,
          orgSettings(org.data).paymentTermsDays,
        ),
      },
      new_items: items.map((item) => {
        const { line, ...payload } = item;
        void line;
        return payload;
      }),
      lines,
    },
  });
  if (error) throw new DbError(error, "billMilestone.save");
  return { ok: true, invoiceId: data };
}

/**
 * «Registrar uso» (375 €/campaña…): cada uso es un pendiente de facturar que el cron añade al
 * siguiente borrador del cliente.
 */
export async function registerUsage(
  db: Db,
  orgId: string,
  input: { contractLineId: string; quantity: string; billableOn: CivilDate; description?: string; unitPriceCents?: number },
): Promise<ManualResult<{ itemId: string }>> {
  const line = must(
    await db
      .from("contract_lines")
      .select("id, billing_type, description, unit_price_cents, discount_bps, contracts!inner(signed_on)")
      .eq("id", input.contractLineId)
      .eq("org_id", orgId)
      .maybeSingle(),
    "registerUsage.line",
  );
  if (line.billing_type !== "usage") throw new BillingRuleError("billing.errors.lineNotFound");
  if (!line.contracts.signed_on) throw new BillingRuleError("billing.errors.contractNotSigned");

  const unitPriceCents = input.unitPriceCents ?? line.unit_price_cents;
  const amount = lineBaseCents({ quantity: input.quantity, unitPriceCents, discountBps: line.discount_bps });
  const id = randomUUID();
  const { error } = await db.from("billable_items").insert({
    id,
    org_id: orgId,
    contract_line_id: line.id,
    source: "usage",
    description: input.description?.trim() || line.description,
    quantity: Number(input.quantity),
    unit_price_cents: unitPriceCents,
    discount_bps: line.discount_bps,
    amount_cents: amount,
    billable_on: input.billableOn,
  });
  if (error) throw new DbError(error, "registerUsage.insert");
  return { ok: true, itemId: id };
}
