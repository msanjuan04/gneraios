"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { issuerOn } from "@/domain/billing/issuer";
import { addDays, compareCivil } from "@/domain/dates/civil-date";
import type { ActionResult } from "@/lib/action-result";
import { nowInZone } from "@/lib/clock";
import type { TablesUpdate } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { emptyToNull } from "@/lib/validation/fiscal";
import { type Failure, failure, forbidden, idSchema, invalidInput, partnerContext } from "@/server/action-utils";
import { DbError } from "@/server/billing/context";
import { billingFailure } from "@/server/billing/errors";
import { BillingRuleError, billMilestone, registerUsage } from "@/server/billing/manual";
import { saveContractMilestones } from "@/server/contracts/rpc";
import {
  type CancelFormInput,
  cancelFormSchema,
  type ContractFormInput,
  contractFormSchema,
  type IssuerChangeInput,
  issuerChangeSchema,
  isRecurring,
  type LineFormInput,
  lineSheetSchema,
  lineVersionSheetSchema,
  type MilestonesSheetInput,
  milestonesSheetSchema,
  parseQuantity,
  type PauseFormInput,
  pauseFormSchema,
  type SignFormInput,
  signFormSchema,
  type TermsFormInput,
  termsFormSchema,
  toCreateContractPayload,
  toLinePayload,
  toMilestonesPayload,
  toVersionPayload,
  type UsageFormInput,
  usageFormSchema,
  type WaiveFormInput,
  waiveFormSchema,
} from "./schema";
import { resumePlan } from "./summary";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type OrgCtx = NonNullable<Awaited<ReturnType<typeof partnerContext>>>;

/** Algo que no existe en la org (o que la RLS no deja ver): un "no encontrado" amable. */
const notFoundKey = (error: PostgrestError) => (error.code === "PGRST116" ? "contracts.errors.notFound" : undefined);

/** Una FK que impide borrar algo que ya tiene facturación. */
const hasBillingKey = (error: PostgrestError) => (error.code === "23503" ? "billing.errors.lineHasBilling" : undefined);

function today(ctx: OrgCtx): string {
  return nowInZone(ctx.org.timezone).date;
}

/**
 * Vuelve a pintar el listado, la ficha del contrato, la del cliente (su tarjeta de contratos)
 * y el dashboard (MRR). Con `invoices`, también el listado de facturas (borradores nuevos).
 */
function revalidateContract(slug: string, contractId: string, clientId: string | null, { invoices = false } = {}) {
  revalidatePath(`/${slug}`);
  revalidatePath(`/${slug}/contracts`);
  revalidatePath(`/${slug}/contracts/${contractId}`);
  if (clientId) revalidatePath(`/${slug}/clients/${clientId}`);
  if (invoices) revalidatePath(`/${slug}/invoices`);
}

/** Errores de las reglas de facturación manual (src/server/billing/manual.ts). */
async function manualFailure(error: unknown): Promise<Failure> {
  if (error instanceof BillingRuleError) return failure(error.key);
  if (error instanceof DbError) return billingFailure(error.error, error.where, notFoundKey);
  throw error;
}

type ContractRef = { id: string; client_id: string; signed_on: string | null };

/** El contrato, si es de la org y se puede tocar (no archivado); si no, el error para el toast. */
async function writableContract(
  supabase: Supabase,
  orgId: string,
  contractId: string,
): Promise<{ contract: ContractRef; failure?: undefined } | { contract?: undefined; failure: Failure }> {
  const { data, error } = await supabase
    .from("contracts")
    .select("id, client_id, signed_on, archived_at")
    .eq("id", contractId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) return { failure: await billingFailure(error, "contracts.load") };
  if (!data) return { failure: await failure("contracts.errors.notFound") };
  if (data.archived_at) return { failure: await failure("contracts.errors.archived") };
  return { contract: data };
}

const LINE_REF_COLUMNS =
  "id, contract_id, billing_type, starts_on, ends_on, cancelled_on, replaces_line_id, billed_items_count, billed_until";

/** Una línea de la org con su contrato (que tiene que poderse tocar). */
async function writableLine(supabase: Supabase, orgId: string, lineId: string, contractId?: string) {
  let query = supabase.from("contract_lines_overview").select(LINE_REF_COLUMNS).eq("id", lineId).eq("org_id", orgId);
  if (contractId) query = query.eq("contract_id", contractId);
  const { data, error } = await query.maybeSingle();
  if (error) return { failure: await billingFailure(error, "contracts.line") };
  if (!data?.id || !data.contract_id || !data.billing_type) return { failure: await failure("billing.errors.lineNotFound") };
  const loaded = await writableContract(supabase, orgId, data.contract_id);
  if (loaded.failure) return { failure: loaded.failure };
  return {
    line: { ...data, id: data.id, contract_id: data.contract_id, billing_type: data.billing_type },
    contract: loaded.contract,
  };
}

// ---------------------------------------------------------------------------
// Contrato
// ---------------------------------------------------------------------------

/**
 * Alta de un contrato con su emisor, sus líneas y sus hitos (create_contract, en una sola
 * transacción). Sin cliente elegido, lo crea a la vez, como el pipeline.
 */
export async function createContract(slug: string, input: ContractFormInput): Promise<ActionResult<{ id: string }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const parsed = contractFormSchema.safeParse(input);
  if (!parsed.success) return invalidInput();
  const v = parsed.data;
  if (v.signed_on && compareCivil(v.signed_on, today(ctx)) > 0) return failure("contracts.errors.signedInFuture");

  const orgId = ctx.org.id;
  const supabase = await createClient();
  let clientId = v.client_id;
  let createdClient = false;
  if (clientId) {
    const { data, error } = await supabase
      .from("clients")
      .select("id, archived_at")
      .eq("id", clientId)
      .eq("org_id", orgId)
      .maybeSingle();
    if (error) return billingFailure(error, "createContract.client");
    if (!data || data.archived_at) return failure("contracts.errors.clientNotFound");
  } else {
    const { data, error } = await supabase
      .from("clients")
      .insert({ org_id: orgId, display_name: v.new_client_name.trim(), owner_member_id: ctx.member.id })
      .select("id")
      .single();
    if (error) return billingFailure(error, "createContract.newClient");
    clientId = data.id;
    createdClient = true;
  }

  const { data, error } = await supabase.rpc("create_contract", { p: toCreateContractPayload(v, clientId) });
  if (error || !data) {
    // Si el cliente se creó solo para este contrato, no se deja huérfano.
    if (createdClient) {
      await supabase.from("clients").update({ archived_at: new Date().toISOString() }).eq("id", clientId).eq("org_id", orgId);
    }
    return error ? billingFailure(error, "createContract") : failure("common.errorGeneric");
  }

  revalidateContract(ctx.org.slug, data, clientId);
  if (createdClient) revalidatePath(`/${ctx.org.slug}/clients`);
  return { ok: true, id: data };
}

/** Condiciones del contrato: título, cobro, agrupación y notas. Si ya estaba firmado, también su fecha. */
export async function updateContractTerms(slug: string, contractId: string, input: TermsFormInput): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(contractId);
  const parsed = termsFormSchema.safeParse(input);
  if (!id.success || !parsed.success) return invalidInput();
  const v = parsed.data;

  const supabase = await createClient();
  const loaded = await writableContract(supabase, ctx.org.id, id.data);
  if (loaded.failure) return loaded.failure;

  const update: TablesUpdate<"contracts"> = {
    title: v.title,
    payment_terms_days: v.payment_terms_days.trim() === "" ? null : Number(v.payment_terms_days),
    payment_method: v.payment_method,
    invoice_grouping: v.invoice_grouping,
    notes: emptyToNull(v.notes),
  };
  // Firmar va por su propia acción; aquí solo se corrige la fecha o se quita la firma.
  if (loaded.contract.signed_on !== null) {
    const signedOn = emptyToNull(v.signed_on);
    if (signedOn && compareCivil(signedOn, today(ctx)) > 0) return failure("contracts.errors.signedInFuture");
    update.signed_on = signedOn;
  }

  const { error } = await supabase.from("contracts").update(update).eq("id", id.data).eq("org_id", ctx.org.id);
  if (error) return billingFailure(error, "updateContractTerms");
  revalidateContract(ctx.org.slug, id.data, loaded.contract.client_id);
  return { ok: true };
}

/** Firma el contrato: desde ese momento factura. */
export async function signContract(slug: string, contractId: string, input: SignFormInput): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(contractId);
  const parsed = signFormSchema.safeParse(input);
  if (!id.success || !parsed.success) return invalidInput();
  if (compareCivil(parsed.data.signed_on, today(ctx)) > 0) return failure("contracts.errors.signedInFuture");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contracts")
    .update({ signed_on: parsed.data.signed_on })
    .eq("id", id.data)
    .eq("org_id", ctx.org.id)
    .is("signed_on", null)
    .is("archived_at", null)
    .select("id, client_id")
    .maybeSingle();
  if (error) return billingFailure(error, "signContract");
  if (!data) return failure("contracts.errors.alreadySigned");
  revalidateContract(ctx.org.slug, data.id, data.client_id);
  return { ok: true };
}

/**
 * «Cambiar emisor desde…»: el contrato pasa a facturarlo otro emisor a partir de una fecha
 * (una fila más en contract_issuers). Lo ya emitido no cambia. Los traspasos en bloque a la
 * SL son otro asistente, de owner.
 */
export async function changeContractIssuer(slug: string, contractId: string, input: IssuerChangeInput): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(contractId);
  const parsed = issuerChangeSchema.safeParse(input);
  if (!id.success || !parsed.success) return invalidInput();
  const { issuer_id: issuerId, valid_from: validFrom } = parsed.data;

  const orgId = ctx.org.id;
  const supabase = await createClient();
  const loaded = await writableContract(supabase, orgId, id.data);
  if (loaded.failure) return loaded.failure;

  const [issuer, assignments] = await Promise.all([
    supabase.from("issuers").select("id").eq("id", issuerId).eq("org_id", orgId).is("archived_at", null).maybeSingle(),
    supabase.from("contract_issuers").select("issuer_id, valid_from").eq("contract_id", id.data).eq("org_id", orgId),
  ]);
  if (issuer.error) return billingFailure(issuer.error, "changeContractIssuer.issuer");
  if (assignments.error) return billingFailure(assignments.error, "changeContractIssuer.assignments");
  if (!issuer.data) return failure("contracts.errors.issuerNotFound");
  const current = issuerOn(
    (assignments.data ?? []).map((a) => ({ issuerId: a.issuer_id, validFrom: a.valid_from })),
    validFrom,
  );
  if (current === issuerId) return failure("contracts.errors.sameIssuer");

  // Si ya había un cambio ese mismo día, se sustituye.
  const { error } = await supabase
    .from("contract_issuers")
    .upsert({ org_id: orgId, contract_id: id.data, issuer_id: issuerId, valid_from: validFrom }, { onConflict: "contract_id,valid_from" });
  if (error) return billingFailure(error, "changeContractIssuer");
  revalidateContract(ctx.org.slug, id.data, loaded.contract.client_id);
  return { ok: true };
}

/** Quita un cambio de emisor programado (que aún no ha empezado). El primero nunca se quita. */
export async function removeContractIssuer(slug: string, contractId: string, assignmentId: string): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(contractId);
  const assignment = idSchema.safeParse(assignmentId);
  if (!id.success || !assignment.success) return invalidInput();

  const orgId = ctx.org.id;
  const supabase = await createClient();
  const loaded = await writableContract(supabase, orgId, id.data);
  if (loaded.failure) return loaded.failure;

  const { data: rows, error: rowsError } = await supabase
    .from("contract_issuers")
    .select("id, valid_from")
    .eq("contract_id", id.data)
    .eq("org_id", orgId)
    .order("valid_from");
  if (rowsError) return billingFailure(rowsError, "removeContractIssuer.load");
  const row = rows.find((r) => r.id === assignment.data);
  if (!row || rows[0]?.id === row.id || compareCivil(row.valid_from, today(ctx)) <= 0) {
    return failure("contracts.errors.issuerChangeLocked");
  }

  const { error } = await supabase.from("contract_issuers").delete().eq("id", row.id).eq("org_id", orgId);
  if (error) return billingFailure(error, "removeContractIssuer");
  revalidateContract(ctx.org.slug, id.data, loaded.contract.client_id);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Líneas
// ---------------------------------------------------------------------------

/**
 * Crea o edita una línea. Con algo ya facturado, sus condiciones económicas no se tocan
 * (el trigger lo impediría): solo cambian la descripción y la fecha de fin. Quitar la fecha
 * de fin deshace también la baja.
 */
export async function saveContractLine(
  slug: string,
  contractId: string,
  lineId: string | null,
  input: LineFormInput,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const contract = idSchema.safeParse(contractId);
  const line = lineId === null ? null : idSchema.safeParse(lineId);
  const parsed = lineSheetSchema.safeParse({ from: "", lines: [input] });
  if (!contract.success || (line && !line.success) || !parsed.success) return invalidInput();
  const row = toLinePayload(parsed.data.lines[0]!, 0);

  const orgId = ctx.org.id;
  const supabase = await createClient();

  if (!line) {
    const loaded = await writableContract(supabase, orgId, contract.data);
    if (loaded.failure) return loaded.failure;
    const { data: last, error: lastError } = await supabase
      .from("contract_lines")
      .select("position")
      .eq("contract_id", contract.data)
      .eq("org_id", orgId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastError) return billingFailure(lastError, "saveContractLine.position");
    const { data, error } = await supabase
      .from("contract_lines")
      .insert({ ...row, org_id: orgId, contract_id: contract.data, position: (last?.position ?? -1) + 1, quantity: Number(row.quantity) })
      .select("id")
      .single();
    if (error) return billingFailure(error, "saveContractLine.insert");
    revalidateContract(ctx.org.slug, contract.data, loaded.contract.client_id);
    return { ok: true, id: data.id };
  }

  const loaded = await writableLine(supabase, orgId, line.data, contract.data);
  if (loaded.failure) return loaded.failure;
  const stored = loaded.line;
  const billed = (stored.billed_items_count ?? 0) > 0;
  // Un one-off ya facturado conserva su fin (no tiene fechas); el resto toma el del formulario.
  const endsOn = billed && stored.billing_type === "one_off" ? stored.ends_on : row.ends_on;
  const update: TablesUpdate<"contract_lines"> = {
    description: row.description,
    ends_on: endsOn,
    // Sin fin ya no hay baja.
    ...(endsOn === null && { cancelled_on: null, cancel_reason: null }),
    ...(!billed && {
      billing_type: row.billing_type,
      quantity: Number(row.quantity),
      unit_price_cents: row.unit_price_cents,
      discount_bps: row.discount_bps,
      tax_rate_id: row.tax_rate_id,
      irpf_applies: row.irpf_applies,
      starts_on: row.starts_on,
      billing_day: row.billing_day,
      prorate_first: row.prorate_first,
    }),
  };
  // Con condiciones congeladas, el fin se compara con el inicio guardado.
  const startsOn = billed ? stored.starts_on : row.starts_on;
  if (endsOn && startsOn && compareCivil(endsOn, startsOn) < 0) return failure("contracts.validation.endsBeforeStart");

  // El trigger solo lo vigila al insertar: convertir una línea en puntual cuando los hitos ya
  // han empezado a facturarse dejaría su parte de los hitos anteriores sin facturar.
  if (!billed && row.billing_type === "one_off" && stored.billing_type !== "one_off") {
    const { count, error: startedError } = await supabase
      .from("billable_items_overview")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("contract_id", stored.contract_id)
      .eq("source", "milestone");
    if (startedError) return billingFailure(startedError, "saveContractLine.milestones");
    if ((count ?? 0) > 0) return failure("billing.errors.milestonesStarted");
  }

  const { error } = await supabase.from("contract_lines").update(update).eq("id", stored.id).eq("org_id", orgId);
  if (error) return billingFailure(error, "saveContractLine.update");
  revalidateContract(ctx.org.slug, stored.contract_id, loaded.contract.client_id);
  return { ok: true, id: stored.id };
}

/**
 * «Nueva versión desde…»: cierra la línea el día antes y abre otra con las condiciones
 * nuevas (new_line_version). Así lo facturado no se reescribe y el MRR histórico cuadra.
 */
export async function createLineVersion(
  slug: string,
  lineId: string,
  input: { from: string; line: LineFormInput },
): Promise<ActionResult<{ id: string }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(lineId);
  const parsed = lineVersionSheetSchema.safeParse({ from: input?.from, lines: [input?.line] });
  if (!id.success || !parsed.success) return invalidInput();

  const supabase = await createClient();
  const loaded = await writableLine(supabase, ctx.org.id, id.data);
  if (loaded.failure) return loaded.failure;
  if (loaded.line.billing_type === "one_off") return failure("billing.errors.versionNotRecurring");

  const { data, error } = await supabase.rpc("new_line_version", {
    p_line_id: id.data,
    p_from: parsed.data.from,
    p: toVersionPayload(parsed.data.lines[0]!),
  });
  if (error) return billingFailure(error, "createLineVersion");
  revalidateContract(ctx.org.slug, loaded.line.contract_id, loaded.contract.client_id);
  return { ok: true, id: data };
}

/** Pausa una línea mensual o anual (una fila en contract_line_pauses). Sin fin: hasta reanudarla. */
export async function pauseLine(slug: string, lineId: string, input: PauseFormInput): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(lineId);
  const parsed = pauseFormSchema.safeParse(input);
  if (!id.success || !parsed.success) return invalidInput();

  const orgId = ctx.org.id;
  const supabase = await createClient();
  const loaded = await writableLine(supabase, orgId, id.data);
  if (loaded.failure) return loaded.failure;
  if (!isRecurring(loaded.line.billing_type)) return failure("billing.errors.pauseRecurringOnly");

  const { error } = await supabase.from("contract_line_pauses").insert({
    org_id: orgId,
    line_id: id.data,
    starts_on: parsed.data.starts_on,
    ends_on: emptyToNull(parsed.data.ends_on),
    reason: emptyToNull(parsed.data.reason),
  });
  if (error) return billingFailure(error, "pauseLine");
  revalidateContract(ctx.org.slug, loaded.line.contract_id, loaded.contract.client_id);
  return { ok: true };
}

/**
 * Reanuda (la pausa termina ayer) o cancela una pausa que aún no ha empezado (se borra).
 * Devuelve qué ha hecho, para el toast.
 */
export async function resumeLine(slug: string, pauseId: string): Promise<ActionResult<{ result: "resumed" | "cancelled" }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(pauseId);
  if (!id.success) return invalidInput();

  const orgId = ctx.org.id;
  const supabase = await createClient();
  const { data: pause, error: pauseError } = await supabase
    .from("contract_line_pauses")
    .select("id, line_id, starts_on, ends_on")
    .eq("id", id.data)
    .eq("org_id", orgId)
    .maybeSingle();
  if (pauseError) return billingFailure(pauseError, "resumeLine.pause");
  if (!pause) return failure("contracts.errors.pauseNotFound");
  const loaded = await writableLine(supabase, orgId, pause.line_id);
  if (loaded.failure) return loaded.failure;

  const now = today(ctx);
  if (pause.ends_on !== null && compareCivil(pause.ends_on, now) < 0) return failure("contracts.errors.pauseEnded");
  const plan = resumePlan({ startsOn: pause.starts_on, endsOn: pause.ends_on }, now);
  const { error } =
    plan.kind === "delete"
      ? await supabase.from("contract_line_pauses").delete().eq("id", pause.id).eq("org_id", orgId)
      : await supabase.from("contract_line_pauses").update({ ends_on: plan.endsOn }).eq("id", pause.id).eq("org_id", orgId);
  if (error) return billingFailure(error, "resumeLine");
  revalidateContract(ctx.org.slug, loaded.line.contract_id, loaded.contract.client_id);
  return { ok: true, result: plan.kind === "delete" ? "cancelled" : "resumed" };
}

/** «Dar de baja»: fija el fin (se recomienda a fin de periodo) y apunta cuándo y por qué se decidió. */
export async function cancelLine(slug: string, lineId: string, input: CancelFormInput): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(lineId);
  const parsed = cancelFormSchema.safeParse(input);
  if (!id.success || !parsed.success) return invalidInput();

  const orgId = ctx.org.id;
  const supabase = await createClient();
  const loaded = await writableLine(supabase, orgId, id.data);
  if (loaded.failure) return loaded.failure;
  const { line } = loaded;
  if (line.billing_type === "one_off") return failure("contracts.errors.cancelOneOff");
  if (line.starts_on && compareCivil(parsed.data.ends_on, line.starts_on) < 0) {
    return failure("contracts.validation.endsBeforeStart");
  }

  const { error } = await supabase
    .from("contract_lines")
    .update({ ends_on: parsed.data.ends_on, cancelled_on: today(ctx), cancel_reason: emptyToNull(parsed.data.reason) })
    .eq("id", line.id)
    .eq("org_id", orgId);
  if (error) return billingFailure(error, "cancelLine");
  revalidateContract(ctx.org.slug, line.contract_id, loaded.contract.client_id);
  return { ok: true };
}

/**
 * Borra una línea sin nada facturado (antes, sus usos pendientes). Si era la versión nueva
 * de otra, la anterior recupera su vigencia.
 */
export async function deleteLine(slug: string, lineId: string): Promise<ActionResult<{ restoredPrevious: boolean }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(lineId);
  if (!id.success) return invalidInput();

  const orgId = ctx.org.id;
  const supabase = await createClient();
  const loaded = await writableLine(supabase, orgId, id.data);
  if (loaded.failure) return loaded.failure;
  const { line } = loaded;
  if ((line.billed_items_count ?? 0) > 0) return failure("billing.errors.lineHasBilling");

  const pending = await supabase
    .from("billable_items")
    .delete()
    .eq("contract_line_id", line.id)
    .eq("org_id", orgId)
    .is("invoice_line_id", null);
  if (pending.error) return billingFailure(pending.error, "deleteLine.items", hasBillingKey);
  const { data, error } = await supabase.from("contract_lines").delete().eq("id", line.id).eq("org_id", orgId).select("id");
  if (error) return billingFailure(error, "deleteLine", hasBillingKey);
  if (data.length === 0) return failure("billing.errors.lineNotFound");

  let restoredPrevious = false;
  if (line.replaces_line_id && line.starts_on) {
    const { data: previous } = await supabase
      .from("contract_lines")
      .select("id, ends_on, cancelled_on")
      .eq("id", line.replaces_line_id)
      .eq("org_id", orgId)
      .maybeSingle();
    // Solo si la cerró esta versión (el día antes de que empezara).
    if (previous && previous.ends_on === addDays(line.starts_on, -1)) {
      const { error: restoreError } = await supabase
        .from("contract_lines")
        .update({
          ends_on: line.ends_on,
          ...(line.ends_on === null && previous.cancelled_on !== null && { cancelled_on: null, cancel_reason: null }),
        })
        .eq("id", previous.id)
        .eq("org_id", orgId);
      if (restoreError) console.error("[contracts] deleteLine.restorePrevious", restoreError);
      restoredPrevious = !restoreError;
    }
  }

  revalidateContract(ctx.org.slug, line.contract_id, loaded.contract.client_id);
  return { ok: true, restoredPrevious };
}

/** «Registrar uso» de una línea por uso (375 €/campaña…): un pendiente de facturar más. */
export async function registerLineUsage(slug: string, lineId: string, input: UsageFormInput): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(lineId);
  const parsed = usageFormSchema.safeParse(input);
  if (!id.success || !parsed.success) return invalidInput();
  const { billable_on: billableOn, description } = parsed.data;

  const orgId = ctx.org.id;
  const supabase = await createClient();
  const loaded = await writableLine(supabase, orgId, id.data);
  if (loaded.failure) return loaded.failure;
  const { line } = loaded;
  if (line.billing_type !== "usage") return failure("billing.errors.lineNotFound");
  if (compareCivil(billableOn, today(ctx)) > 0) return failure("contracts.errors.usageInFuture");
  if ((line.starts_on && compareCivil(billableOn, line.starts_on) < 0) || (line.ends_on && compareCivil(billableOn, line.ends_on) > 0)) {
    return failure("contracts.errors.usageOutOfRange");
  }

  try {
    await registerUsage(supabase, orgId, {
      contractLineId: line.id,
      quantity: parseQuantity(parsed.data.quantity) ?? "1",
      billableOn,
      description: description || undefined,
    });
  } catch (error) {
    return manualFailure(error);
  }
  revalidateContract(ctx.org.slug, line.contract_id, loaded.contract.client_id);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Hitos y pendiente de facturar
// ---------------------------------------------------------------------------

/**
 * Guarda todos los hitos a la vez (save_contract_milestones: el 100 % se comprueba al
 * confirmar). Los ya facturados se quedan como están: mismo porcentaje y misma posición.
 */
export async function saveMilestones(slug: string, contractId: string, input: MilestonesSheetInput): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(contractId);
  if (!id.success) return invalidInput();

  const orgId = ctx.org.id;
  const supabase = await createClient();
  const loaded = await writableContract(supabase, orgId, id.data);
  if (loaded.failure) return loaded.failure;

  const [oneOff, existing] = await Promise.all([
    supabase
      .from("contract_lines")
      .select("id", { count: "exact", head: true })
      .eq("contract_id", id.data)
      .eq("org_id", orgId)
      .eq("billing_type", "one_off"),
    supabase.from("contract_milestones").select("id, position, percent_bps").eq("contract_id", id.data).eq("org_id", orgId),
  ]);
  if (oneOff.error) return billingFailure(oneOff.error, "saveMilestones.lines");
  if (existing.error) return billingFailure(existing.error, "saveMilestones.milestones");

  const parsed = milestonesSheetSchema((oneOff.count ?? 0) > 0).safeParse(input);
  if (!parsed.success) return invalidInput();

  const existingById = new Map(existing.data.map((m) => [m.id, m]));
  const billed =
    existing.data.length === 0
      ? { data: [] as { milestone_id: string | null }[], error: null }
      : await supabase
          .from("billable_items")
          .select("milestone_id")
          .eq("org_id", orgId)
          .in(
            "milestone_id",
            existing.data.map((m) => m.id),
          );
  if (billed.error) return billingFailure(billed.error, "saveMilestones.billed");
  const billedIds = new Set(billed.data.flatMap((b) => (b.milestone_id ? [b.milestone_id] : [])));

  // Un id que no es de este contrato se trata como un hito nuevo.
  const milestones = parsed.data.milestones.map((m) => (m.id && existingById.has(m.id) ? m : { ...m, id: "" }));
  const locked = new Map<string, number>();
  for (const billedId of billedIds) {
    const stored = existingById.get(billedId);
    const sent = milestones.find((m) => m.id === billedId);
    if (!stored || !sent) return failure("billing.errors.milestoneBilled");
    locked.set(billedId, stored.position);
  }

  const payload = toMilestonesPayload(milestones, locked);
  if (payload.some((m) => m.id && billedIds.has(m.id) && m.percent_bps !== existingById.get(m.id)?.percent_bps)) {
    return failure("billing.errors.milestoneBilled");
  }

  const { error } = await saveContractMilestones(supabase, id.data, payload);
  if (error) return billingFailure(error, "saveMilestones");
  revalidateContract(ctx.org.slug, id.data, loaded.contract.client_id);
  return { ok: true };
}

/** «Facturar hito»: el pendiente del hito y un borrador con él, listo para revisar y emitir. */
export async function billContractMilestone(slug: string, milestoneId: string): Promise<ActionResult<{ invoiceId: string }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(milestoneId);
  if (!id.success) return invalidInput();

  const orgId = ctx.org.id;
  const supabase = await createClient();
  const { data: milestone, error } = await supabase
    .from("contract_milestones")
    .select("id, contract_id")
    .eq("id", id.data)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) return billingFailure(error, "billContractMilestone.load");
  if (!milestone) return failure("contracts.errors.milestoneNotFound");
  const loaded = await writableContract(supabase, orgId, milestone.contract_id);
  if (loaded.failure) return loaded.failure;

  try {
    const { invoiceId } = await billMilestone(supabase, orgId, milestone.id, today(ctx));
    revalidateContract(ctx.org.slug, milestone.contract_id, loaded.contract.client_id, { invoices: true });
    return { ok: true, invoiceId };
  } catch (e) {
    return manualFailure(e);
  }
}

/** Pendiente de facturar de un contrato de la org, con su estado. */
async function billableItem(supabase: Supabase, orgId: string, itemId: string) {
  const { data, error } = await supabase
    .from("billable_items_overview")
    .select("id, contract_id, client_id, state")
    .eq("id", itemId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) return { failure: await billingFailure(error, "contracts.item") };
  if (!data?.id || !data.contract_id) return { failure: await failure("contracts.errors.itemNotFound") };
  return { item: { ...data, id: data.id, contract_id: data.contract_id } };
}

/** «Condonar»: el concepto no se factura y el cron no lo vuelve a crear. Solo lo pendiente. */
export async function waiveBillableItem(slug: string, itemId: string, input: WaiveFormInput): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(itemId);
  const parsed = waiveFormSchema.safeParse(input);
  if (!id.success || !parsed.success) return invalidInput();

  const orgId = ctx.org.id;
  const supabase = await createClient();
  const loaded = await billableItem(supabase, orgId, id.data);
  if (loaded.failure) return loaded.failure;
  if (loaded.item.state !== "pending") return failure("contracts.errors.itemNotPending");

  // La RLS solo deja a un socio tocar waived_at y waive_reason.
  const { data, error } = await supabase
    .from("billable_items")
    .update({ waived_at: new Date().toISOString(), waive_reason: emptyToNull(parsed.data.reason) })
    .eq("id", id.data)
    .eq("org_id", orgId)
    .is("invoice_line_id", null)
    .is("waived_at", null)
    .select("id");
  if (error) return billingFailure(error, "waiveBillableItem");
  if (data.length === 0) return failure("contracts.errors.itemNotPending");
  revalidateContract(ctx.org.slug, loaded.item.contract_id, loaded.item.client_id);
  return { ok: true };
}

/** Deshace una condonación: el concepto vuelve a estar pendiente de facturar. */
export async function restoreBillableItem(slug: string, itemId: string): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(itemId);
  if (!id.success) return invalidInput();

  const orgId = ctx.org.id;
  const supabase = await createClient();
  const loaded = await billableItem(supabase, orgId, id.data);
  if (loaded.failure) return loaded.failure;

  const { data, error } = await supabase
    .from("billable_items")
    .update({ waived_at: null })
    .eq("id", id.data)
    .eq("org_id", orgId)
    .is("invoice_line_id", null)
    .not("waived_at", "is", null)
    .select("id");
  if (error) return billingFailure(error, "restoreBillableItem");
  if (data.length === 0) return failure("contracts.errors.itemNotFound");
  revalidateContract(ctx.org.slug, loaded.item.contract_id, loaded.item.client_id);
  return { ok: true };
}
