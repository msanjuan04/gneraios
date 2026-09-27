"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ImportBillingType } from "@/domain/dataio/classify";
import { missingRequired, sanitizeMapping } from "@/domain/dataio/fields";
import type { ActionResult } from "@/lib/action-result";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { dbFailure, failure, forbidden, idSchema, invalidInput, partnerContext } from "@/server/action-utils";
import { DbError } from "@/server/billing/context";
import { commitClientPlan, commitInvoicePlan } from "@/server/dataio/commit";
import { loadImportJob, saveRowResults } from "@/server/dataio/jobs";
import { simulateJob, simulationRowResults, simulationSummary } from "@/server/dataio/simulate";
import { BILLING_TYPES, type MappingInput, mappingInputSchema, readStoredMapping, type StoredMapping } from "./schema";

/** Clientes dados de alta por confirmaciones anteriores de la misma importación. */
function previousNewClients(job: { status: string; summary: unknown }): number {
  if (job.status !== "committed") return 0;
  const n = (job.summary as { newClients?: unknown } | null)?.newClients;
  return typeof n === "number" ? n : 0;
}

function revalidateJob(slug: string, jobId: string) {
  revalidatePath(`/${slug}/settings/data/imports/${jobId}`);
  revalidatePath(`/${slug}/settings/data`);
}

async function load(slug: string, jobId: string) {
  const ctx = await partnerContext(slug);
  const id = idSchema.safeParse(jobId);
  if (!ctx || !id.success) return null;
  const db = await createClient();
  const loaded = await loadImportJob(db, ctx.org.id, id.data);
  return loaded ? { ctx, db, loaded } : null;
}

/**
 * Guarda el mapeo y las opciones y vuelve a simular: cada fila queda con lo que se haría con ella
 * (crear, completar, saltar o error) y el motivo. Nada se escribe fuera de la importación.
 */
export async function saveImportMapping(slug: string, jobId: string, input: MappingInput): Promise<ActionResult> {
  const parsed = mappingInputSchema.safeParse(input);
  if (!parsed.success) return invalidInput();
  const found = await load(slug, jobId);
  if (!found) return forbidden();
  const { ctx, db, loaded } = found;
  if (loaded.job.status === "committed") return failure("dataio.errors.committed");

  const mapping: StoredMapping = {
    columns: sanitizeMapping(loaded.job.kind, parsed.data.columns, loaded.table.headers.length),
    options: parsed.data.options,
    lineTypes: loaded.mapping.lineTypes,
  };
  try {
    const update: { mapping: Json; status?: "draft" | "simulated"; summary?: Json | null; simulated_at?: string } = {
      mapping: mapping as unknown as Json,
    };
    if (missingRequired(loaded.job.kind, mapping.columns).length === 0) {
      const next = { ...loaded, mapping };
      const sim = await simulateJob(db, ctx.org, ctx.member.id, next);
      await saveRowResults(db, next, simulationRowResults(sim));
      Object.assign(update, { status: "simulated", summary: simulationSummary(sim), simulated_at: new Date().toISOString() });
    } else {
      // Sin lo imprescindible no hay simulación: la anterior ya no vale.
      Object.assign(update, { status: "draft", summary: null });
    }
    const { error } = await db.from("import_jobs").update(update).eq("id", loaded.job.id).eq("org_id", ctx.org.id);
    if (error) return dbFailure(error, "saveImportMapping");
  } catch (err) {
    if (err instanceof DbError) return dbFailure(err.error, err.where);
    throw err;
  }
  revalidateJob(ctx.org.slug, loaded.job.id);
  return { ok: true };
}

const lineTypeSchema = z.object({
  rowNumber: z.number().int().min(2).max(1_000_000),
  type: z.enum(BILLING_TYPES).nullable(),
});

/** Cambia a mano el tipo de una línea (recurrente, puntual o uso) o vuelve a la regla automática. */
export async function setImportLineType(
  slug: string,
  jobId: string,
  rowNumber: number,
  type: ImportBillingType | null,
): Promise<ActionResult> {
  const parsed = lineTypeSchema.safeParse({ rowNumber, type });
  if (!parsed.success) return invalidInput();
  const found = await load(slug, jobId);
  if (!found) return forbidden();
  const { ctx, db, loaded } = found;
  if (loaded.job.status === "committed") return failure("dataio.errors.committed");
  if (loaded.job.kind !== "invoices") return invalidInput();

  const lineTypes = { ...loaded.mapping.lineTypes };
  if (parsed.data.type) lineTypes[String(parsed.data.rowNumber)] = parsed.data.type;
  else delete lineTypes[String(parsed.data.rowNumber)];
  const mapping = readStoredMapping(loaded.job.kind, { ...loaded.mapping, lineTypes }, loaded.table.headers.length);
  const { error } = await db
    .from("import_jobs")
    .update({ mapping: mapping as unknown as Json })
    .eq("id", loaded.job.id)
    .eq("org_id", ctx.org.id);
  if (error) return dbFailure(error, "setImportLineType");
  revalidateJob(ctx.org.slug, loaded.job.id);
  return { ok: true };
}

/**
 * Confirma: vuelve a simular con el estado de ahora (nada se da por supuesto) y aplica el plan.
 * Es idempotente: lo que ya se importó se salta, así que reintentar (o reimportar el mismo
 * fichero) no duplica nada.
 */
export async function commitImport(
  slug: string,
  jobId: string,
): Promise<ActionResult<{ created: number; updated: number; skipped: number; errors: number }>> {
  const found = await load(slug, jobId);
  if (!found) return forbidden();
  const { ctx, db, loaded } = found;
  if (missingRequired(loaded.job.kind, loaded.mapping.columns).length > 0) return failure("dataio.errors.mappingIncomplete");

  try {
    const sim = await simulateJob(db, ctx.org, ctx.member.id, loaded);
    const outcome =
      sim.kind === "clients"
        ? await commitClientPlan(db, ctx.org.id, sim.plan)
        : await commitInvoicePlan(db, ctx.org.id, ctx.member.id, sim.plan);
    // Lo que ha hecho esta confirmación (para el aviso), antes de mezclarlo con la anterior.
    const done = { ...outcome.counts };
    // Al reintentar una ya confirmada, lo que se creó la primera vez sale ahora como «saltar»: se
    // conserva el resultado original (qué se creó y dónde) y solo se actualiza lo demás.
    if (loaded.job.status === "committed") {
      for (const row of loaded.rows) {
        const next = outcome.results.get(row.row_number);
        if (next?.action === "skip" && (row.action === "create" || row.action === "update")) {
          outcome.results.set(row.row_number, { action: row.action, message: row.message, issues: row.issues, entity_id: row.entity_id });
          outcome.counts.skip -= 1;
          outcome.counts[row.action] += 1;
        }
      }
    }
    await saveRowResults(db, loaded, outcome.results);
    const { error } = await db
      .from("import_jobs")
      .update({
        status: "committed",
        // Un reintento conserva cuándo y quién la confirmó la primera vez.
        committed_at: loaded.job.committed_at ?? new Date().toISOString(),
        committed_by: loaded.job.committed_by ?? ctx.user.id,
        error: null,
        summary: {
          counts: outcome.counts,
          newClients: previousNewClients(loaded.job) + outcome.newClients,
          ...(outcome.invoices ? { invoices: outcome.invoices } : {}),
          ...(sim.kind === "invoices" ? { totals: sim.plan.totals, byCategory: sim.plan.byCategory } : {}),
        } as unknown as Json,
      })
      .eq("id", loaded.job.id)
      .eq("org_id", ctx.org.id);
    if (error) return dbFailure(error, "commitImport.job");
    revalidateJob(ctx.org.slug, loaded.job.id);
    revalidatePath(`/${ctx.org.slug}/clients`);
    revalidatePath(`/${ctx.org.slug}/invoices`);
    return { ok: true, created: done.create, updated: done.update, skipped: done.skip, errors: done.error };
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 500) : String(err);
    console.error("[dataio] commitImport", err);
    if (loaded.job.status !== "committed") {
      await db.from("import_jobs").update({ status: "failed", error: message }).eq("id", loaded.job.id).eq("org_id", ctx.org.id);
    }
    revalidateJob(ctx.org.slug, loaded.job.id);
    return failure("dataio.errors.commitFailed");
  }
}

/** Descarta una importación sin confirmar (con sus filas). Las confirmadas se quedan como historial. */
export async function deleteImportJob(slug: string, jobId: string): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  const id = idSchema.safeParse(jobId);
  if (!ctx || !id.success) return forbidden();
  const db = await createClient();
  const { data, error } = await db
    .from("import_jobs")
    .delete()
    .eq("id", id.data)
    .eq("org_id", ctx.org.id)
    .neq("status", "committed")
    .select("id");
  if (error) return dbFailure(error, "deleteImportJob");
  if (data.length === 0) return failure("dataio.errors.cannotDelete");
  revalidatePath(`/${ctx.org.slug}/settings/data`);
  return { ok: true };
}
