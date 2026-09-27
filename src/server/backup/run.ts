import "server-only";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createGzip } from "node:zlib";
import { createClient } from "@supabase/supabase-js";
import { backupStamp, backupsToPrune } from "@/domain/backup/retention";

// Copia nocturna de todos los datos en el disco del servidor (docs/CRON.md): una carpeta por noche
// con un fichero NDJSON comprimido por tabla y un manifest.json con cuántas filas tiene cada una.
// Se escribe página a página para no cargar ninguna tabla entera en memoria.
// No incluye las cuentas de Auth ni los ficheros de Storage: para eso, las copias de Supabase.

const PAGE = 1000;

type Summary = { dir: string; tables: number; rows: number; errors: Record<string, string>; pruned: string[] };

/**
 * Las tablas que se copian: las que PostgREST deja escribir (tablas y vistas simples), leídas de
 * su OpenAPI para que una tabla nueva entre sola en la copia.
 */
async function backupRelations(url: string, key: string): Promise<string[]> {
  const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`OpenAPI ${res.status}`);
  const spec = (await res.json()) as { paths?: Record<string, Record<string, unknown>> };
  return Object.entries(spec.paths ?? {})
    .filter(([p, ops]) => /^\/[a-z0-9_]+$/.test(p) && "post" in ops)
    .map(([p]) => p.slice(1))
    .sort();
}

export async function runBackup(options: { dir: string; keepDays: number; now?: Date }): Promise<Summary> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SECRET_KEY");
  // Sin tipos: el nombre de cada tabla llega en tiempo de ejecución.
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const now = options.now ?? new Date();
  const target = path.join(options.dir, backupStamp(now));
  await mkdir(target, { recursive: true, mode: 0o700 });

  const counts: Record<string, number> = {};
  const errors: Record<string, string> = {};
  for (const table of await backupRelations(url, key)) {
    let rows = 0;
    let failure: string | null = null;
    async function* pages() {
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await db.from(table).select("*").range(from, from + PAGE - 1);
        if (error) {
          failure = error.message;
          return;
        }
        rows += data.length;
        if (data.length > 0) yield `${data.map((row) => JSON.stringify(row)).join("\n")}\n`;
        if (data.length < PAGE) return;
      }
    }
    await pipeline(Readable.from(pages()), createGzip(), createWriteStream(path.join(target, `${table}.ndjson.gz`), { mode: 0o600 }));
    counts[table] = rows;
    if (failure) errors[table] = failure;
  }

  await writeFile(
    path.join(target, "manifest.json"),
    `${JSON.stringify({ createdAt: now.toISOString(), project: new URL(url).host, tables: counts, errors }, null, 2)}\n`,
    { mode: 0o600 },
  );

  const pruned = backupsToPrune(await readdir(options.dir), now, options.keepDays);
  for (const name of pruned) await rm(path.join(options.dir, name), { recursive: true, force: true });

  return {
    dir: target,
    tables: Object.keys(counts).length,
    rows: Object.values(counts).reduce((sum, n) => sum + n, 0),
    errors,
    pruned,
  };
}
