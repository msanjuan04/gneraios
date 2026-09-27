"use server";

import { z } from "zod";
import { FISCAL_MODELS } from "@/domain/calendar/fiscal";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { emptyToNull } from "@/lib/validation/fiscal";
import type { ActionResult } from "@/lib/action-result";
import {
  dbFailure,
  failure,
  forbidden,
  idSchema,
  invalidInput,
  ownerContext,
  revalidateSettings,
} from "@/server/action-utils";
import { type TaxRateFormInput, taxRateFormSchema } from "./schema";

/** Crea o actualiza un tipo de IVA o IRPF. */
export async function saveTaxRate(slug: string, taxRateId: string | null, input: TaxRateFormInput): Promise<ActionResult> {
  const ctx = await ownerContext(slug);
  if (!ctx) return forbidden();
  const parsed = taxRateFormSchema.safeParse(input);
  const id = taxRateId === null ? null : idSchema.safeParse(taxRateId);
  if (!parsed.success || (id && !id.success)) return invalidInput();

  const { kind, name, rate_bps, regime, legal_note, is_default } = parsed.data;
  const orgId = ctx.org.id;
  const supabase = await createClient();

  if (id) {
    const { data, error } = await supabase
      .from("tax_rates")
      .select("id")
      .eq("id", id.data)
      .eq("org_id", orgId)
      .is("archived_at", null)
      .maybeSingle();
    if (error) return dbFailure(error, "saveTaxRate.load");
    if (!data) return failure("settings.taxes.notFound");
  }

  // Un solo tipo por defecto por impuesto (índice único parcial): antes se quita el anterior.
  let previousDefaults: string[] = [];
  if (is_default) {
    let clear = supabase
      .from("tax_rates")
      .update({ is_default: false })
      .eq("org_id", orgId)
      .eq("kind", kind)
      .eq("is_default", true)
      .is("archived_at", null);
    if (id) clear = clear.neq("id", id.data);
    const { data, error } = await clear.select("id");
    if (error) return dbFailure(error, "saveTaxRate.clearDefault");
    previousDefaults = data.map((r) => r.id);
  }
  const restoreDefaults = async () => {
    if (previousDefaults.length === 0) return;
    const { error } = await supabase.from("tax_rates").update({ is_default: true }).in("id", previousDefaults);
    if (error) console.error("[settings] saveTaxRate.restoreDefault", error);
  };

  const row = {
    kind,
    name,
    rate_bps,
    regime: kind === "vat" ? regime : null,
    legal_note: emptyToNull(legal_note),
    is_default,
  };

  if (id) {
    const { data, error } = await supabase
      .from("tax_rates")
      .update(row)
      .eq("id", id.data)
      .eq("org_id", orgId)
      .select("id");
    if (error || data.length === 0) {
      await restoreDefaults();
      return error ? dbFailure(error, "saveTaxRate.update") : forbidden();
    }
  } else {
    // Al final de los de su impuesto.
    const { data: last, error: positionError } = await supabase
      .from("tax_rates")
      .select("position")
      .eq("org_id", orgId)
      .eq("kind", kind)
      .is("archived_at", null)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (positionError) {
      await restoreDefaults();
      return dbFailure(positionError, "saveTaxRate.position");
    }
    const { error } = await supabase
      .from("tax_rates")
      .insert({ ...row, org_id: orgId, position: (last?.position ?? -1) + 1 });
    if (error) {
      await restoreDefaults();
      return dbFailure(error, "saveTaxRate.insert");
    }
  }

  revalidateSettings(ctx.org.slug, "taxes");
  return { ok: true };
}

/** Archiva un tipo: deja de proponerse, pero las facturas que lo usan lo conservan. */
export async function archiveTaxRate(slug: string, taxRateId: string): Promise<ActionResult> {
  const ctx = await ownerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(taxRateId);
  if (!id.success) return invalidInput();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tax_rates")
    .update({ archived_at: new Date().toISOString(), is_default: false })
    .eq("id", id.data)
    .eq("org_id", ctx.org.id)
    .is("archived_at", null)
    .select("id");
  if (error) return dbFailure(error, "archiveTaxRate");
  if (data.length === 0) return failure("settings.taxes.notFound");

  revalidateSettings(ctx.org.slug, "taxes");
  return { ok: true };
}

const fiscalModelSchema = z.enum(FISCAL_MODELS);
const fiscalCalendarSchema = z.object({
  enabled: z.boolean(),
  company: z.array(fiscalModelSchema).max(FISCAL_MODELS.length),
  self_employed: z.array(fiscalModelSchema).max(FISCAL_MODELS.length),
  intra_eu: z.enum(["auto", "always", "never"]),
});

export type FiscalCalendarInput = z.input<typeof fiscalCalendarSchema>;

function isJsonObject(value: Json | undefined): value is { [key: string]: Json | undefined } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Qué plazos fiscales enseña el calendario (`orgs.settings.fiscal_calendar`). Conserva las
 * excepciones por emisor (by_issuer) y el resto de claves de `settings`.
 */
export async function saveFiscalCalendarSettings(slug: string, input: FiscalCalendarInput): Promise<ActionResult> {
  const ctx = await ownerContext(slug);
  if (!ctx) return forbidden();
  const parsed = fiscalCalendarSchema.safeParse(input);
  if (!parsed.success) return invalidInput();

  const settings = isJsonObject(ctx.org.settings) ? ctx.org.settings : {};
  const current = isJsonObject(settings.fiscal_calendar) ? settings.fiscal_calendar : {};
  const unique = (models: string[]) => FISCAL_MODELS.filter((m) => models.includes(m));
  const next: Json = {
    ...settings,
    fiscal_calendar: {
      ...current,
      enabled: parsed.data.enabled,
      models: { company: unique(parsed.data.company), self_employed: unique(parsed.data.self_employed) },
      intra_eu: parsed.data.intra_eu,
    },
  };

  const supabase = await createClient();
  const { data, error } = await supabase.from("orgs").update({ settings: next }).eq("id", ctx.org.id).select("id");
  if (error) return dbFailure(error, "saveFiscalCalendarSettings");
  if (data.length === 0) return forbidden();
  revalidateSettings(ctx.org.slug, "taxes");
  return { ok: true };
}
