"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { getTranslations } from "next-intl/server";
import { normalizeIban, validateSpanishTaxId } from "@/domain/tax-id";
import type { TablesUpdate } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { emptyToNull } from "@/lib/validation/fiscal";
import type { ActionResult } from "@/lib/action-result";
import {
  currentYear,
  dbFailure,
  failure,
  forbidden,
  idSchema,
  invalidInput,
  ownerContext,
  revalidateSettings,
} from "@/server/action-utils";
import {
  DEFAULT_SERIES,
  type IssuerFormInput,
  issuerFormSchema,
  type IssuerFormValues,
  type SeriesNumberInput,
  seriesNumberSchema,
} from "./schema";

const knownIssuerErrors = (error: PostgrestError) =>
  error.code === "23505" && error.message.includes("issuers_tax_id_idx") ? "settings.issuers.duplicateTaxId" : undefined;

/** Fila de `issuers` a partir del formulario ya validado (mismas reglas que el onboarding). */
function toIssuerRow(values: IssuerFormValues, isPrimary: boolean) {
  const company = values.kind === "company";
  return {
    kind: values.kind,
    legal_name: values.legal_name,
    trade_name: emptyToNull(values.trade_name),
    tax_id: values.tax_id ? validateSpanishTaxId(values.tax_id).normalized : null,
    address_line: emptyToNull(values.address_line),
    postal_code: emptyToNull(values.postal_code),
    city: emptyToNull(values.city),
    province: emptyToNull(values.province),
    email: emptyToNull(values.email),
    iban: values.iban ? normalizeIban(values.iban) : null,
    default_irpf_bps: company ? 0 : values.default_irpf_bps,
    member_id: company ? null : emptyToNull(values.member_id),
    is_primary: isPrimary,
    active_from: company && values.pending_constitution ? null : emptyToNull(values.active_from),
    registry_info: company ? emptyToNull(values.registry_info) : null,
  } satisfies TablesUpdate<"issuers">;
}

/** Crea o actualiza un emisor. Uno nuevo nace con sus series ordinaria y rectificativa. */
export async function saveIssuer(slug: string, issuerId: string | null, input: IssuerFormInput): Promise<ActionResult> {
  const ctx = await ownerContext(slug);
  if (!ctx) return forbidden();
  const parsed = issuerFormSchema.safeParse(input);
  const id = issuerId === null ? null : idSchema.safeParse(issuerId);
  if (!parsed.success || (id && !id.success)) return invalidInput();

  const orgId = ctx.org.id;
  const supabase = await createClient();

  let existing: { id: string; is_primary: boolean } | null = null;
  if (id) {
    const { data, error } = await supabase
      .from("issuers")
      .select("id, is_primary")
      .eq("id", id.data)
      .eq("org_id", orgId)
      .is("archived_at", null)
      .maybeSingle();
    if (error) return dbFailure(error, "saveIssuer.load");
    if (!data) return failure("settings.issuers.notFound");
    existing = data;
  }

  const { data: primaries, error: primariesError } = await supabase
    .from("issuers")
    .select("id")
    .eq("org_id", orgId)
    .eq("is_primary", true)
    .is("archived_at", null);
  if (primariesError) return dbFailure(primariesError, "saveIssuer.primaries");

  // El principal no se desmarca (se cambia marcando otro) y el primero que se crea lo es.
  const isPrimary = Boolean(existing?.is_primary) || parsed.data.is_primary || (!existing && primaries.length === 0);
  const previousPrimaries = isPrimary ? primaries.map((p) => p.id).filter((pid) => pid !== existing?.id) : [];

  // Solo un principal por org (índice único parcial): antes hay que desmarcar el anterior.
  if (previousPrimaries.length > 0) {
    const { error } = await supabase.from("issuers").update({ is_primary: false }).in("id", previousPrimaries);
    if (error) return dbFailure(error, "saveIssuer.clearPrimary");
  }
  const restorePrimaries = async () => {
    if (previousPrimaries.length === 0) return;
    const { error } = await supabase.from("issuers").update({ is_primary: true }).in("id", previousPrimaries);
    if (error) console.error("[settings] saveIssuer.restorePrimary", error);
  };

  const row = toIssuerRow(parsed.data, isPrimary);

  if (existing) {
    const { data, error } = await supabase
      .from("issuers")
      .update(row)
      .eq("id", existing.id)
      .eq("org_id", orgId)
      .select("id");
    if (error || data.length === 0) {
      await restorePrimaries();
      return error ? dbFailure(error, "saveIssuer.update", knownIssuerErrors) : forbidden();
    }
  } else {
    const { data: created, error } = await supabase
      .from("issuers")
      .insert({ ...row, org_id: orgId })
      .select("id")
      .single();
    if (error) {
      await restorePrimaries();
      return dbFailure(error, "saveIssuer.insert", knownIssuerErrors);
    }

    const t = await getTranslations("settings.issuers");
    const { error: seriesError } = await supabase.from("invoice_series").insert(
      DEFAULT_SERIES.map((s) => ({
        org_id: orgId,
        issuer_id: created.id,
        code: s.code,
        name: t(s.nameKey),
        kind: s.kind,
        format: s.format,
        reset_yearly: true,
        is_default: true,
      })),
    );
    if (seriesError) {
      // Sin series no se puede facturar: se retira el emisor recién creado y se deja todo como estaba.
      await supabase
        .from("issuers")
        .update({ is_primary: false, archived_at: new Date().toISOString() })
        .eq("id", created.id);
      await restorePrimaries();
      return dbFailure(seriesError, "saveIssuer.series");
    }
  }

  revalidateSettings(ctx.org.slug, "issuers");
  return { ok: true };
}

/** Archiva un emisor (nunca se borra). El principal no se puede archivar. */
export async function archiveIssuer(slug: string, issuerId: string): Promise<ActionResult> {
  const ctx = await ownerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(issuerId);
  if (!id.success) return invalidInput();

  const supabase = await createClient();
  const { data: issuer, error } = await supabase
    .from("issuers")
    .select("id, is_primary")
    .eq("id", id.data)
    .eq("org_id", ctx.org.id)
    .is("archived_at", null)
    .maybeSingle();
  if (error) return dbFailure(error, "archiveIssuer.load");
  if (!issuer) return failure("settings.issuers.notFound");
  if (issuer.is_primary) return failure("settings.issuers.archivePrimary");

  const { data, error: updateError } = await supabase
    .from("issuers")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", issuer.id)
    .eq("org_id", ctx.org.id)
    .select("id");
  if (updateError) return dbFailure(updateError, "archiveIssuer");
  if (data.length === 0) return forbidden();

  revalidateSettings(ctx.org.slug, "issuers");
  return { ok: true };
}

/** Fija el último número usado de una serie en el año en curso (año 0 si no se reinicia). */
export async function setSeriesLastNumber(slug: string, input: SeriesNumberInput): Promise<ActionResult> {
  const ctx = await ownerContext(slug);
  if (!ctx) return forbidden();
  const parsed = seriesNumberSchema.safeParse(input);
  if (!parsed.success) return invalidInput();

  const supabase = await createClient();
  const { data: series, error } = await supabase
    .from("invoice_series")
    .select("id")
    .eq("id", parsed.data.series_id)
    .eq("org_id", ctx.org.id)
    .is("archived_at", null)
    .maybeSingle();
  if (error) return dbFailure(error, "setSeriesLastNumber.load");
  if (!series) return failure("settings.issuers.notFound");

  const { error: rpcError } = await supabase.rpc("set_series_last_number", {
    p_series_id: series.id,
    p_year: currentYear(ctx.org.timezone),
    p_last_number: parsed.data.last_number,
  });
  if (rpcError) return dbFailure(rpcError, "setSeriesLastNumber");

  revalidateSettings(ctx.org.slug, "issuers");
  return { ok: true };
}
