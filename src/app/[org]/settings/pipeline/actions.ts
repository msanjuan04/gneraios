"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import type { ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";
import {
  dbFailure,
  type Failure,
  failure,
  forbidden,
  idSchema,
  invalidInput,
  ownerContext,
  revalidateSettings,
} from "@/server/action-utils";
import type { OrgContext } from "@/server/session";
import {
  type Direction,
  hasDuplicateName,
  isOnlyOfKind,
  nextPosition,
  planInsertBeforeFirstWon,
  planMove,
  type PositionChange,
  sortByPosition,
} from "./positions";
import { countStageDeals, NAME_LIST_TABLES, type PositionTable, type Supabase } from "./queries";
import {
  directionSchema,
  type NameItemInput,
  nameItemSchema,
  type NameListKind,
  nameListSchema,
  type StageFormInput,
  stageFormSchema,
} from "./schema";

// Los CHECK de las tablas. El formulario ya los valida; esto cubre lo que llegue por otra vía.
const knownConfigErrors = (error: PostgrestError) => {
  if (error.code !== "23514") return undefined;
  if (error.message.includes("_name_check")) return "settings.pipeline.errors.nameInvalid";
  if (error.message.includes("_default_probability_bps_check")) return "settings.pipeline.errors.probabilityInvalid";
  return undefined;
};

/** Devuelve a su sitio las posiciones ya cambiadas, de la última a la primera. */
async function restorePositions(
  supabase: Supabase,
  table: PositionTable,
  orgId: string,
  applied: readonly PositionChange[],
  where: string,
) {
  for (const change of [...applied].reverse()) {
    const { error } = await supabase
      .from(table)
      .update({ position: change.from })
      .eq("id", change.id)
      .eq("org_id", orgId);
    if (error) console.error(`[settings] ${where}.restore`, error);
  }
}

/**
 * Aplica cambios de posición de uno en uno, cada uno solo si la fila sigue donde
 * estaba. Si alguno falla (o alguien ha movido la lista mientras tanto), deshace
 * los ya aplicados y la lista queda como estaba.
 */
async function applyPositions(
  supabase: Supabase,
  table: PositionTable,
  orgId: string,
  changes: readonly PositionChange[],
  where: string,
): Promise<Failure | null> {
  const applied: PositionChange[] = [];
  for (const change of changes) {
    const { data, error } = await supabase
      .from(table)
      .update({ position: change.to })
      .eq("id", change.id)
      .eq("org_id", orgId)
      .eq("position", change.from)
      .select("id");
    if (error || data.length === 0) {
      await restorePositions(supabase, table, orgId, applied, where);
      return error ? dbFailure(error, where) : failure("settings.pipeline.listChanged");
    }
    applied.push(change);
  }
  return null;
}

/** Sube o baja un puesto una fila activa: intercambia su posición con la de la vecina. */
async function moveRow(
  ctx: OrgContext,
  table: PositionTable,
  rowId: string,
  direction: Direction,
  notFoundKey: string,
  where: string,
): Promise<ActionResult> {
  const orgId = ctx.org.id;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from(table)
    .select("id, position, created_at")
    .eq("org_id", orgId)
    .is("archived_at", null);
  if (error) return dbFailure(error, `${where}.load`);
  const rows = sortByPosition(data);
  if (!rows.some((row) => row.id === rowId)) return failure(notFoundKey);

  // Sin cambios si ya estaba en el extremo (se movió desde otra pestaña): basta con repintar.
  const changes = planMove(rows, rowId, direction);
  if (changes) {
    const moveFailure = await applyPositions(supabase, table, orgId, changes, where);
    if (moveFailure) return moveFailure;
  }

  revalidateSettings(ctx.org.slug, "pipeline");
  return { ok: true };
}

/**
 * Crea o edita una etapa. Una nueva se coloca antes de la primera etapa ganada.
 * El tipo solo cambia si la etapa no tiene deals y no es la última de su tipo.
 */
export async function saveStage(slug: string, stageId: string | null, input: StageFormInput): Promise<ActionResult> {
  const ctx = await ownerContext(slug);
  if (!ctx) return forbidden();
  const parsed = stageFormSchema.safeParse(input);
  const id = stageId === null ? null : idSchema.safeParse(stageId);
  if (!parsed.success || (id && !id.success)) return invalidInput();

  const { name, kind, probability } = parsed.data;
  const orgId = ctx.org.id;
  const supabase = await createClient();

  // Todas, archivadas incluidas: una etapa nueva desplaza también a las archivadas que van detrás.
  const { data, error } = await supabase
    .from("pipeline_stages")
    .select("id, name, kind, position, created_at, archived_at")
    .eq("org_id", orgId);
  if (error) return dbFailure(error, "saveStage.load");
  const all = sortByPosition(data);
  const active = all.filter((stage) => stage.archived_at === null);

  if (id) {
    const stage = active.find((s) => s.id === id.data);
    if (!stage) return failure("settings.pipeline.stages.notFound");
    if (hasDuplicateName(active, name, stage.id)) return failure("settings.pipeline.stages.duplicateName");

    if (kind !== stage.kind) {
      // Siempre tiene que quedar al menos una etapa abierta, una ganada y una perdida.
      if (isOnlyOfKind(active, stage.id)) return failure(`settings.pipeline.stages.onlyOfKind.${stage.kind}`);
      // El tipo da sentido a los deals que ya están en ella, también a los archivados.
      const deals = await countStageDeals(supabase, orgId, stage.id, "all");
      if (deals.error) return dbFailure(deals.error, "saveStage.deals");
      if (deals.count > 0) return failure("settings.pipeline.stages.kindLocked");
    }

    const { data: updated, error: updateError } = await supabase
      .from("pipeline_stages")
      .update({ name, kind, default_probability_bps: probability })
      .eq("id", stage.id)
      .eq("org_id", orgId)
      .is("archived_at", null)
      .select("id");
    if (updateError) return dbFailure(updateError, "saveStage.update", knownConfigErrors);
    if (updated.length === 0) return forbidden();
  } else {
    if (hasDuplicateName(active, name)) return failure("settings.pipeline.stages.duplicateName");

    // Se hace hueco antes de la primera ganada; si el alta falla, todo vuelve a su sitio.
    const { position, shift } = planInsertBeforeFirstWon(active, all);
    const shiftFailure = await applyPositions(supabase, "pipeline_stages", orgId, shift, "saveStage.shift");
    if (shiftFailure) return shiftFailure;

    const { error: insertError } = await supabase
      .from("pipeline_stages")
      .insert({ org_id: orgId, name, kind, default_probability_bps: probability, position });
    if (insertError) {
      await restorePositions(supabase, "pipeline_stages", orgId, shift, "saveStage.insert");
      return dbFailure(insertError, "saveStage.insert", knownConfigErrors);
    }
  }

  revalidateSettings(ctx.org.slug, "pipeline");
  return { ok: true };
}

/** Sube o baja una etapa un puesto en el tablero. */
export async function moveStage(slug: string, stageId: string, direction: Direction): Promise<ActionResult> {
  const ctx = await ownerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(stageId);
  const dir = directionSchema.safeParse(direction);
  if (!id.success || !dir.success) return invalidInput();

  return moveRow(ctx, "pipeline_stages", id.data, dir.data, "settings.pipeline.stages.notFound", "moveStage");
}

/**
 * Archiva una etapa: sale del tablero y ya no se puede elegir, pero el historial la
 * conserva. Solo sin deals activos y si no es la última de su tipo.
 */
export async function archiveStage(slug: string, stageId: string): Promise<ActionResult> {
  const ctx = await ownerContext(slug);
  if (!ctx) return forbidden();
  const id = idSchema.safeParse(stageId);
  if (!id.success) return invalidInput();

  const orgId = ctx.org.id;
  const supabase = await createClient();
  const { data: active, error } = await supabase
    .from("pipeline_stages")
    .select("id, kind")
    .eq("org_id", orgId)
    .is("archived_at", null);
  if (error) return dbFailure(error, "archiveStage.load");
  const stage = active.find((s) => s.id === id.data);
  if (!stage) return failure("settings.pipeline.stages.notFound");
  if (isOnlyOfKind(active, stage.id)) return failure(`settings.pipeline.stages.onlyOfKind.${stage.kind}`);

  const deals = await countStageDeals(supabase, orgId, stage.id, "active");
  if (deals.error) return dbFailure(deals.error, "archiveStage.deals");
  if (deals.count > 0) return failure("settings.pipeline.stages.archiveHasDeals", { count: deals.count });

  const { data, error: updateError } = await supabase
    .from("pipeline_stages")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", stage.id)
    .eq("org_id", orgId)
    .is("archived_at", null)
    .select("id");
  if (updateError) return dbFailure(updateError, "archiveStage");
  if (data.length === 0) return failure("settings.pipeline.stages.notFound");

  revalidateSettings(ctx.org.slug, "pipeline");
  return { ok: true };
}

/** Añade al final o renombra una fuente de adquisición o un motivo de pérdida. */
export async function saveNameItem(
  slug: string,
  list: NameListKind,
  itemId: string | null,
  input: NameItemInput,
): Promise<ActionResult> {
  const ctx = await ownerContext(slug);
  if (!ctx) return forbidden();
  const kind = nameListSchema.safeParse(list);
  const parsed = nameItemSchema.safeParse(input);
  const id = itemId === null ? null : idSchema.safeParse(itemId);
  if (!kind.success || !parsed.success || (id && !id.success)) return invalidInput();

  const table = NAME_LIST_TABLES[kind.data];
  const keys = `settings.pipeline.${kind.data}`;
  const { name } = parsed.data;
  const orgId = ctx.org.id;
  const supabase = await createClient();

  // Todas, archivadas incluidas: la nueva va detrás de la última posición usada.
  const { data, error } = await supabase.from(table).select("id, name, position, archived_at").eq("org_id", orgId);
  if (error) return dbFailure(error, "saveNameItem.load");
  const active = data.filter((row) => row.archived_at === null);
  if (id && !active.some((row) => row.id === id.data)) return failure(`${keys}.notFound`);
  if (hasDuplicateName(active, name, id?.data)) return failure(`${keys}.duplicateName`);

  if (id) {
    const { data: updated, error: updateError } = await supabase
      .from(table)
      .update({ name })
      .eq("id", id.data)
      .eq("org_id", orgId)
      .is("archived_at", null)
      .select("id");
    if (updateError) return dbFailure(updateError, "saveNameItem.update", knownConfigErrors);
    if (updated.length === 0) return forbidden();
  } else {
    const { error: insertError } = await supabase
      .from(table)
      .insert({ org_id: orgId, name, position: nextPosition(data) });
    if (insertError) return dbFailure(insertError, "saveNameItem.insert", knownConfigErrors);
  }

  revalidateSettings(ctx.org.slug, "pipeline");
  return { ok: true };
}

/** Sube o baja un puesto una fuente o un motivo. */
export async function moveNameItem(
  slug: string,
  list: NameListKind,
  itemId: string,
  direction: Direction,
): Promise<ActionResult> {
  const ctx = await ownerContext(slug);
  if (!ctx) return forbidden();
  const kind = nameListSchema.safeParse(list);
  const id = idSchema.safeParse(itemId);
  const dir = directionSchema.safeParse(direction);
  if (!kind.success || !id.success || !dir.success) return invalidInput();

  return moveRow(
    ctx,
    NAME_LIST_TABLES[kind.data],
    id.data,
    dir.data,
    `settings.pipeline.${kind.data}.notFound`,
    "moveNameItem",
  );
}

/**
 * Archiva una fuente o un motivo: los deals que ya lo tienen lo conservan, pero no
 * se puede elegir en los nuevos. Siempre queda al menos un motivo de pérdida.
 */
export async function archiveNameItem(slug: string, list: NameListKind, itemId: string): Promise<ActionResult> {
  const ctx = await ownerContext(slug);
  if (!ctx) return forbidden();
  const kind = nameListSchema.safeParse(list);
  const id = idSchema.safeParse(itemId);
  if (!kind.success || !id.success) return invalidInput();

  const table = NAME_LIST_TABLES[kind.data];
  const keys = `settings.pipeline.${kind.data}`;
  const orgId = ctx.org.id;
  const supabase = await createClient();

  const { data: active, error } = await supabase.from(table).select("id").eq("org_id", orgId).is("archived_at", null);
  if (error) return dbFailure(error, "archiveNameItem.load");
  if (!active.some((row) => row.id === id.data)) return failure(`${keys}.notFound`);
  // Perder un deal exige motivo: sin ninguno, el tablero no podría marcar deals como perdidos.
  if (kind.data === "reasons" && active.length <= 1) return failure("settings.pipeline.reasons.lastOne");

  const { data, error: updateError } = await supabase
    .from(table)
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id.data)
    .eq("org_id", orgId)
    .is("archived_at", null)
    .select("id");
  if (updateError) return dbFailure(updateError, "archiveNameItem");
  if (data.length === 0) return failure(`${keys}.notFound`);

  revalidateSettings(ctx.org.slug, "pipeline");
  return { ok: true };
}
