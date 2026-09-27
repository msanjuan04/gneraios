"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  type Direction,
  hasDuplicateName,
  nextPosition,
  planMove,
  type PositionChange,
  sortByPosition,
} from "@/app/[org]/settings/pipeline/positions";
import type { ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";
import { dbFailure, type Failure, failure, forbidden, idSchema, invalidInput, ownerContext } from "@/server/action-utils";
import { financeFailure } from "@/server/finance/errors";
import { type CategoryFormInput, categoryFormSchema } from "./schema";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const directionSchema = z.enum(["up", "down"]);

/** Las categorías se ven en Ajustes y en todas las pestañas de Finanzas. */
function revalidateCategories(slug: string) {
  revalidatePath(`/${slug}/settings/expenses`);
  revalidatePath(`/${slug}/finance`, "layout");
}

/** Aplica cambios de posición de uno en uno (solo si la fila sigue donde estaba) y deshace si algo falla. */
async function applyPositions(supabase: Supabase, orgId: string, changes: readonly PositionChange[]): Promise<Failure | null> {
  const applied: PositionChange[] = [];
  for (const change of changes) {
    const { data, error } = await supabase
      .from("expense_categories")
      .update({ position: change.to })
      .eq("id", change.id)
      .eq("org_id", orgId)
      .eq("position", change.from)
      .select("id");
    if (error || data.length === 0) {
      for (const done of [...applied].reverse()) {
        await supabase.from("expense_categories").update({ position: done.from }).eq("id", done.id).eq("org_id", orgId);
      }
      return error ? dbFailure(error, "moveCategory") : failure("finance.settings.listChanged");
    }
    applied.push(change);
  }
  return null;
}

/** Crea (al final de la lista) o edita una categoría de gasto. */
export async function saveCategory(slug: string, categoryId: string | null, input: CategoryFormInput): Promise<ActionResult> {
  const ctx = await ownerContext(slug);
  if (!ctx) return forbidden();
  const parsed = categoryFormSchema.safeParse(input);
  const id = categoryId === null ? null : idSchema.safeParse(categoryId);
  if (!parsed.success || (id && !id.success)) return invalidInput();

  const orgId = ctx.org.id;
  const supabase = await createClient();
  const { data, error } = await supabase.from("expense_categories").select("id, name, position, archived_at").eq("org_id", orgId);
  if (error) return dbFailure(error, "saveCategory.load");
  const active = data.filter((row) => row.archived_at === null);
  if (id && !active.some((row) => row.id === id.data)) return failure("finance.settings.notFound");
  if (hasDuplicateName(active, parsed.data.name, id?.data)) return failure("finance.errors.categoryDuplicate");

  const row = { name: parsed.data.name, expense_group: parsed.data.expense_group, is_fixed: parsed.data.is_fixed };
  if (id) {
    const { data: updated, error: updateError } = await supabase
      .from("expense_categories")
      .update(row)
      .eq("id", id.data)
      .eq("org_id", orgId)
      .is("archived_at", null)
      .select("id");
    if (updateError) return financeFailure(updateError, "saveCategory.update");
    if (updated.length === 0) return forbidden();
  } else {
    const { error: insertError } = await supabase
      .from("expense_categories")
      .insert({ ...row, org_id: orgId, position: nextPosition(data) });
    if (insertError) return financeFailure(insertError, "saveCategory.insert");
  }
  revalidateCategories(ctx.org.slug);
  return { ok: true };
}

/** Sube o baja una categoría un puesto (el orden de los selectores). */
export async function moveCategory(slug: string, categoryId: string, direction: Direction): Promise<ActionResult> {
  const ctx = await ownerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(categoryId);
  const dir = directionSchema.safeParse(direction);
  if (!id.success || !dir.success) return invalidInput();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("expense_categories")
    .select("id, position, created_at")
    .eq("org_id", ctx.org.id)
    .is("archived_at", null);
  if (error) return dbFailure(error, "moveCategory.load");
  const rows = sortByPosition(data);
  if (!rows.some((row) => row.id === id.data)) return failure("finance.settings.notFound");
  const changes = planMove(rows, id.data, dir.data);
  if (changes) {
    const moveFailure = await applyPositions(supabase, ctx.org.id, changes);
    if (moveFailure) return moveFailure;
  }
  revalidateCategories(ctx.org.slug);
  return { ok: true };
}

/**
 * Archiva una categoría: los gastos que la tienen la conservan, pero ya no se elige. No se archiva
 * si alguna suscripción activa la usa (sus cargos nuevos la llevarían), ni la última que queda.
 */
export async function archiveCategory(slug: string, categoryId: string): Promise<ActionResult> {
  const ctx = await ownerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(categoryId);
  if (!id.success) return invalidInput();
  const orgId = ctx.org.id;
  const supabase = await createClient();
  const [active, subscriptions] = await Promise.all([
    supabase.from("expense_categories").select("id").eq("org_id", orgId).is("archived_at", null),
    supabase
      .from("expense_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("category_id", id.data)
      .eq("is_active", true),
  ]);
  if (active.error) return dbFailure(active.error, "archiveCategory.load");
  if (subscriptions.error) return dbFailure(subscriptions.error, "archiveCategory.subscriptions");
  if (!active.data.some((row) => row.id === id.data)) return failure("finance.settings.notFound");
  if (active.data.length <= 1) return failure("finance.settings.lastOne");
  if ((subscriptions.count ?? 0) > 0) return failure("finance.settings.inUse", { count: subscriptions.count ?? 0 });

  const { data, error } = await supabase
    .from("expense_categories")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id.data)
    .eq("org_id", orgId)
    .is("archived_at", null)
    .select("id");
  if (error) return dbFailure(error, "archiveCategory");
  if (data.length === 0) return failure("finance.settings.notFound");
  revalidateCategories(ctx.org.slug);
  return { ok: true };
}

/** Recupera una categoría archivada (vuelve al final de la lista). */
export async function restoreCategory(slug: string, categoryId: string): Promise<ActionResult> {
  const ctx = await ownerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(categoryId);
  if (!id.success) return invalidInput();
  const supabase = await createClient();
  const { data: all, error: loadError } = await supabase
    .from("expense_categories")
    .select("id, name, position, archived_at")
    .eq("org_id", ctx.org.id);
  if (loadError) return dbFailure(loadError, "restoreCategory.load");
  const category = all.find((row) => row.id === id.data && row.archived_at !== null);
  if (!category) return failure("finance.settings.notFound");
  if (hasDuplicateName(all.filter((row) => row.archived_at === null), category.name)) return failure("finance.errors.categoryDuplicate");
  const { error } = await supabase
    .from("expense_categories")
    .update({ archived_at: null, position: nextPosition(all) })
    .eq("id", id.data)
    .eq("org_id", ctx.org.id);
  if (error) return financeFailure(error, "restoreCategory");
  revalidateCategories(ctx.org.slug);
  return { ok: true };
}
