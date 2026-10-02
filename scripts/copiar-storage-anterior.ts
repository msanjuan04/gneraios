/**
 * Copia todos los ficheros de Storage del proyecto Supabase anterior al actual, bucket a bucket y
 * con las mismas rutas (los registros de la base ya apuntan a ellas). Idempotente: lo que ya está
 * en el destino con el mismo tamaño se salta.
 *
 *   node_modules/.bin/tsx scripts/copiar-storage-anterior.ts
 *
 * Lee OLD_SUPABASE_URL y OLD_SUPABASE_SECRET_KEY de deploy/.env.anterior y el destino de
 * deploy/.env.production. Nunca imprime claves.
 */

import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function readEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line);
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

const oldEnv = readEnv("deploy/.env.anterior");
const newEnv = readEnv("deploy/.env.production");
const required = (env: Record<string, string>, key: string, file: string) => {
  const value = env[key];
  if (!value) throw new Error(`Falta ${key} en ${file}.`);
  return value;
};

const source = createClient(required(oldEnv, "OLD_SUPABASE_URL", "deploy/.env.anterior"), required(oldEnv, "OLD_SUPABASE_SECRET_KEY", "deploy/.env.anterior"), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const target = createClient(required(newEnv, "NEXT_PUBLIC_SUPABASE_URL", "deploy/.env.production"), required(newEnv, "SUPABASE_SECRET_KEY", "deploy/.env.production"), {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Entry = { path: string; size: number | null; mime: string | null };

/** Todos los ficheros de un bucket (Storage lista por carpeta: se recorre en profundidad). */
async function walk(db: SupabaseClient, bucket: string, prefix = ""): Promise<Entry[]> {
  const entries: Entry[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.storage.from(bucket).list(prefix, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`${bucket}/${prefix}: ${error.message}`);
    for (const item of data ?? []) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      // Una «carpeta» no tiene id; un fichero sí.
      if (item.id === null || item.id === undefined) entries.push(...(await walk(db, bucket, path)));
      else entries.push({ path, size: (item.metadata as { size?: number } | null)?.size ?? null, mime: (item.metadata as { mimetype?: string } | null)?.mimetype ?? null });
    }
    if ((data ?? []).length < 1000) break;
  }
  return entries;
}

async function main() {
  const { data: sourceBuckets, error: sourceError } = await source.storage.listBuckets();
  if (sourceError) throw sourceError;
  const { data: targetBuckets, error: targetError } = await target.storage.listBuckets();
  if (targetError) throw targetError;
  const targetNames = new Set((targetBuckets ?? []).map((b) => b.name));

  let copied = 0;
  let skipped = 0;
  let failed = 0;
  for (const bucket of sourceBuckets ?? []) {
    if (!targetNames.has(bucket.name)) {
      console.log(`  ! El bucket ${bucket.name} no existe en el destino: se salta.`);
      continue;
    }
    const files = await walk(source, bucket.name);
    const existing = new Map((await walk(target, bucket.name)).map((e) => [e.path, e.size]));
    let bucketCopied = 0;
    for (const file of files) {
      if (existing.has(file.path) && existing.get(file.path) === file.size) {
        skipped += 1;
        continue;
      }
      const { data, error } = await source.storage.from(bucket.name).download(file.path);
      if (error || !data) {
        console.log(`  ✗ ${bucket.name}/${file.path}: no se pudo descargar (${error?.message ?? "sin datos"})`);
        failed += 1;
        continue;
      }
      const { error: uploadError } = await target.storage
        .from(bucket.name)
        .upload(file.path, await data.arrayBuffer(), { contentType: file.mime ?? "application/octet-stream", upsert: true });
      if (uploadError) {
        console.log(`  ✗ ${bucket.name}/${file.path}: no se pudo subir (${uploadError.message})`);
        failed += 1;
        continue;
      }
      copied += 1;
      bucketCopied += 1;
    }
    console.log(`  ✓ ${bucket.name}: ${files.length} fichero(s), ${bucketCopied} copiado(s)`);
  }
  console.log(`\n  Copiados ${copied}, ya estaban ${skipped}, fallidos ${failed}.`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(`  ✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
