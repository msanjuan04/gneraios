import "server-only";
import { createHash } from "node:crypto";
import { autoMapColumns, type ImportKind } from "@/domain/dataio/fields";
import { readImportFile, type ImportFileMeta, type ReadImportFile } from "@/domain/dataio/import-file";
import type { ImportTable } from "@/domain/dataio/table";
import type { Json, Tables } from "@/lib/supabase/database.types";
import { DEFAULT_OPTIONS, readStoredMapping, type StoredMapping } from "@/app/[org]/settings/data/schema";
import { type Db, DbError, fetchAll } from "@/server/billing/context";

/** Tamaño máximo del fichero que se sube (un CSV de 5.000 filas cabe de sobra). */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const INSERT_CHUNK = 500;

export type ImportJobRow = Tables<"import_jobs">;
export type ImportJobRowData = Pick<Tables<"import_job_rows">, "id" | "row_number" | "raw" | "action" | "message" | "issues" | "entity_id">;

export type LoadedJob = {
  job: ImportJobRow;
  rows: ImportJobRowData[];
  table: ImportTable;
  mapping: StoredMapping;
  meta: Partial<ImportFileMeta>;
};

export type CreateJobResult = { ok: true; jobId: string } | { ok: false; reason: Exclude<ReadImportFile, { ok: true }>["reason"] | "too_large" };

/**
 * Lee el fichero, propone el mapeo automático y guarda la importación (con todas sus filas tal cual)
 * en borrador. Nada más: la simulación y la confirmación vienen después.
 */
export async function createImportJob(
  db: Db,
  orgId: string,
  input: { kind: ImportKind; fileName: string; bytes: Uint8Array },
): Promise<CreateJobResult> {
  if (input.bytes.length > MAX_IMPORT_BYTES) return { ok: false, reason: "too_large" };
  const read = readImportFile(input.bytes);
  if (!read.ok) return read;

  const hash = createHash("sha256").update(input.bytes).digest("hex");
  const mapping: StoredMapping = {
    columns: autoMapColumns(input.kind, read.table.headers),
    options: DEFAULT_OPTIONS,
    lineTypes: {},
  };
  const { data: job, error } = await db
    .from("import_jobs")
    .insert({
      org_id: orgId,
      kind: input.kind,
      file_name: input.fileName.slice(0, 255) || "fichero.csv",
      file_hash: hash,
      file_meta: read.meta as unknown as Json,
      headers: read.table.headers,
      mapping: mapping as unknown as Json,
    })
    .select("id")
    .single();
  if (error) throw new DbError(error, "dataio.createJob");

  const rows = read.table.rows.map((cells, i) => ({
    org_id: orgId,
    job_id: job.id,
    row_number: read.table.rowNumbers[i] ?? i + 2,
    raw: cells as unknown as Json,
  }));
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const { error: rowsError } = await db.from("import_job_rows").insert(rows.slice(i, i + INSERT_CHUNK));
    if (rowsError) {
      // Sin filas, la importación no sirve: se descarta entera.
      await db.from("import_jobs").delete().eq("id", job.id);
      throw new DbError(rowsError, "dataio.createJob.rows");
    }
  }
  return { ok: true, jobId: job.id };
}

/** Una importación con sus filas (en orden), su tabla y su mapeo ya saneado. null si no existe o no se ve. */
export async function loadImportJob(db: Db, orgId: string, jobId: string): Promise<LoadedJob | null> {
  const { data: job, error } = await db.from("import_jobs").select("*").eq("id", jobId).eq("org_id", orgId).maybeSingle();
  if (error) throw new DbError(error, "dataio.loadJob");
  if (!job) return null;
  const rows = await fetchAll(
    (from, to) =>
      db
        .from("import_job_rows")
        .select("id, row_number, raw, action, message, issues, entity_id")
        .eq("job_id", job.id)
        .order("row_number")
        .range(from, to),
    "dataio.loadJob.rows",
  );
  const width = job.headers.length;
  const table: ImportTable = {
    headers: job.headers,
    rows: rows.map((r) => {
      const cells = Array.isArray(r.raw) ? r.raw.map((c) => (typeof c === "string" ? c : c === null ? "" : String(c))) : [];
      while (cells.length < width) cells.push("");
      return cells.slice(0, width);
    }),
    rowNumbers: rows.map((r) => r.row_number),
  };
  return {
    job,
    rows,
    table,
    mapping: readStoredMapping(job.kind, job.mapping, width),
    meta: (job.file_meta ?? {}) as Partial<ImportFileMeta>,
  };
}

/** Las últimas importaciones de la org, para el listado de la página de Datos. */
export async function listImportJobs(db: Db, orgId: string, limit = 20) {
  const { data, error } = await db
    .from("import_jobs")
    .select("id, kind, file_name, status, file_meta, summary, created_at, committed_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new DbError(error, "dataio.listJobs");
  return data;
}

export type RowResult = {
  id: string;
  action: Tables<"import_job_rows">["action"];
  message: string | null;
  issues: Json;
  entity_id: string | null;
};

/**
 * Guarda lo que la simulación (o la confirmación) dice de cada fila. Se hace por lotes con un
 * upsert por id: la fila ya existe, así que solo cambian su acción, su motivo y su entidad (el
 * trigger impide que cambie lo que venía en el fichero).
 */
export async function saveRowResults(db: Db, loaded: LoadedJob, results: Map<number, Omit<RowResult, "id">>) {
  const updates = loaded.rows.flatMap((row) => {
    const result = results.get(row.row_number);
    if (!result) return [];
    return [
      {
        id: row.id,
        org_id: loaded.job.org_id,
        job_id: loaded.job.id,
        row_number: row.row_number,
        raw: row.raw,
        action: result.action,
        message: result.message,
        issues: result.issues,
        entity_id: result.entity_id,
      },
    ];
  });
  for (let i = 0; i < updates.length; i += INSERT_CHUNK) {
    const { error } = await db.from("import_job_rows").upsert(updates.slice(i, i + INSERT_CHUNK), { onConflict: "id" });
    if (error) throw new DbError(error, "dataio.saveRows");
  }
}

/** Otra importación ya confirmada del mismo fichero (misma huella). */
export async function findCommittedTwin(db: Db, job: ImportJobRow): Promise<string | null> {
  if (!job.file_hash) return null;
  const { data, error } = await db
    .from("import_jobs")
    .select("committed_at")
    .eq("org_id", job.org_id)
    .eq("file_hash", job.file_hash)
    .eq("status", "committed")
    .neq("id", job.id)
    .order("committed_at", { ascending: false })
    .limit(1);
  if (error) throw new DbError(error, "dataio.twin");
  return data[0]?.committed_at ?? null;
}
