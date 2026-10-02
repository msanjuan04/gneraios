import "server-only";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createGzip } from "node:zlib";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { backupStamp, backupsToPrune } from "@/domain/backup/retention";

// Copia nocturna en el disco del servidor (docs/CRON.md): una carpeta por noche con un fichero
// NDJSON comprimido por tabla, los ficheros de Storage tal cual (storage/<bucket>/<ruta>) y un
// manifest.json con recuentos y errores. Se escribe página a página para no cargar ninguna tabla
// entera en memoria.
//
// Se genera en <fecha>.partial y solo se renombra a <fecha> si no ha fallado nada; una copia a
// medias nunca se confunde con una completa ni provoca que se borren copias buenas anteriores
// (auditoría A11). No incluye las cuentas de Auth ni los contadores del esquema privado: para eso,
// las copias de Supabase y el pg_dump de docs/BACKUPS.md.

const PAGE = 1000;
/** Sufijo de una copia que no se completó. */
const PARTIAL = ".partial";

type Summary = {
  dir: string;
  complete: boolean;
  tables: number;
  rows: number;
  storageFiles: number;
  storageBytes: number;
  errors: Record<string, string>;
  pruned: string[];
};

/**
 * Las tablas que se copian: las que PostgREST deja escribir (tablas y vistas simples), leídas de
 * su OpenAPI para que una tabla nueva entre sola en la copia.
 */
async function backupRelations(url: string, key: string): Promise<{ name: string; orderBy: string | null }[]> {
  const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`OpenAPI ${res.status}`);
  const spec = (await res.json()) as {
    paths?: Record<string, Record<string, unknown>>;
    definitions?: Record<string, { properties?: Record<string, unknown> }>;
  };
  return Object.entries(spec.paths ?? {})
    .filter(([p, ops]) => /^\/[a-z0-9_]+$/.test(p) && "post" in ops)
    .map(([p]) => p.slice(1))
    .sort()
    // Las páginas se leen en un orden fijo (por id si lo hay): sin él, una fila podría salir dos veces o ninguna.
    .map((name) => ({ name, orderBy: spec.definitions?.[name]?.properties && "id" in spec.definitions[name]!.properties! ? "id" : null }));
}

type StorageEntry = { path: string; size: number };

/** Todos los ficheros de un bucket (Storage lista por carpeta: se recorre en profundidad). */
async function listBucket(db: SupabaseClient, bucket: string, prefix = ""): Promise<StorageEntry[]> {
  const entries: StorageEntry[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db.storage.from(bucket).list(prefix, { limit: PAGE, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`${bucket}/${prefix}: ${error.message}`);
    for (const item of data ?? []) {
      const itemPath = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null || item.id === undefined) entries.push(...(await listBucket(db, bucket, itemPath)));
      else entries.push({ path: itemPath, size: (item.metadata as { size?: number } | null)?.size ?? 0 });
    }
    if ((data ?? []).length < PAGE) break;
  }
  return entries;
}

/** Nombres de carpeta que no pueden salir del directorio de copias (rutas de Storage). */
function safeRelative(value: string): string {
  const normalized = path.posix.normalize(value).replace(/^(\.\.(\/|$))+/, "");
  return normalized.split("/").filter((p) => p !== "" && p !== "." && p !== "..").join("/");
}

export async function runBackup(options: { dir: string; keepDays: number; now?: Date }): Promise<Summary> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SECRET_KEY");
  // Sin tipos: el nombre de cada tabla llega en tiempo de ejecución.
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const now = options.now ?? new Date();
  const stamp = backupStamp(now);
  const target = path.join(options.dir, stamp);
  const staging = `${target}${PARTIAL}`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true, mode: 0o700 });

  const counts: Record<string, number> = {};
  const errors: Record<string, string> = {};
  for (const { name: table, orderBy } of await backupRelations(url, key)) {
    let rows = 0;
    let failure: string | null = null;
    async function* pages() {
      for (let from = 0; ; from += PAGE) {
        const query = db.from(table).select("*");
        const { data, error } = await (orderBy ? query.order(orderBy, { ascending: true }) : query).range(from, from + PAGE - 1);
        if (error) {
          failure = error.message;
          return;
        }
        rows += data.length;
        if (data.length > 0) yield `${data.map((row) => JSON.stringify(row)).join("\n")}\n`;
        if (data.length < PAGE) return;
      }
    }
    await pipeline(Readable.from(pages()), createGzip(), createWriteStream(path.join(staging, `${table}.ndjson.gz`), { mode: 0o600 }));
    counts[table] = rows;
    if (failure) errors[table] = failure;
  }

  // Ficheros de Storage: PDFs de facturas, justificantes, adjuntos, portal…
  const storage: Record<string, { files: number; bytes: number }> = {};
  let storageFiles = 0;
  let storageBytes = 0;
  try {
    const { data: buckets, error: bucketsError } = await db.storage.listBuckets();
    if (bucketsError) throw bucketsError;
    for (const bucket of buckets ?? []) {
      storage[bucket.name] = { files: 0, bytes: 0 };
      let entries: StorageEntry[];
      try {
        entries = await listBucket(db, bucket.name);
      } catch (error) {
        errors[`storage:${bucket.name}`] = error instanceof Error ? error.message : "list";
        continue;
      }
      for (const entry of entries) {
        const { data, error } = await db.storage.from(bucket.name).download(entry.path);
        if (error || !data) {
          errors[`storage:${bucket.name}/${entry.path}`] = error?.message ?? "download";
          continue;
        }
        const file = path.join(staging, "storage", safeRelative(bucket.name), safeRelative(entry.path));
        await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
        const bytes = new Uint8Array(await data.arrayBuffer());
        await writeFile(file, bytes, { mode: 0o600 });
        storage[bucket.name]!.files += 1;
        storage[bucket.name]!.bytes += bytes.byteLength;
        storageFiles += 1;
        storageBytes += bytes.byteLength;
      }
    }
  } catch (error) {
    errors["storage"] = error instanceof Error ? error.message : "storage";
  }

  const complete = Object.keys(errors).length === 0;
  await writeFile(
    path.join(staging, "manifest.json"),
    `${JSON.stringify({ createdAt: now.toISOString(), project: new URL(url).host, complete, tables: counts, storage, errors }, null, 2)}\n`,
    { mode: 0o600 },
  );

  let pruned: string[] = [];
  let dir = staging;
  if (complete) {
    await rename(staging, target);
    dir = target;
    // Solo con una copia completa nueva se podan las antiguas (y las parciales que quedaron de otras noches).
    const names = await readdir(options.dir);
    pruned = [...backupsToPrune(names, now, options.keepDays), ...names.filter((n) => n.endsWith(PARTIAL))];
    for (const name of pruned) await rm(path.join(options.dir, name), { recursive: true, force: true });
  }

  return {
    dir,
    complete,
    tables: Object.keys(counts).length,
    rows: Object.values(counts).reduce((sum, n) => sum + n, 0),
    storageFiles,
    storageBytes,
    errors,
    pruned,
  };
}
