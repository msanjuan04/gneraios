/**
 * Sube un documento al expediente de la sociedad (Finanzas → Sociedad) desde la terminal, con la
 * misma ruta por huella que la app. Idempotente: si ya hay un documento con esa huella, no repite.
 *
 *   node_modules/.bin/tsx scripts/subir-documento-sociedad.ts <fichero> <categoría> <estado> "<título>" [fecha YYYY-MM-DD] ["descripción"]
 *
 * Categorías: constitution, statutes, registry, tax, social_security, partner_agreement, bank, other.
 * Estados: draft, pending_signature, signed, filed, registered, superseded.
 * Lee NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SECRET_KEY de deploy/.env.production. No imprime claves.
 */

import { createHash, randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const ORG_SLUG = "gnerai";
const BUCKET = "org-documents";
const CATEGORIES = ["constitution", "statutes", "registry", "tax", "social_security", "partner_agreement", "bank", "other"];
const STATUSES = ["draft", "pending_signature", "signed", "filed", "registered", "superseded"];
const TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
};

const [file, category, status, title, effectiveOn = null, description = null] = process.argv.slice(2);
if (!file || !category || !status || !title) throw new Error("Uso: <fichero> <categoría> <estado> \"<título>\" [fecha] [descripción]");
if (!CATEGORIES.includes(category)) throw new Error(`Categoría no válida: ${category}`);
if (!STATUSES.includes(status)) throw new Error(`Estado no válido: ${status}`);
if (effectiveOn && !/^\d{4}-\d{2}-\d{2}$/.test(effectiveOn)) throw new Error("La fecha va como YYYY-MM-DD");

function readEnv(envFile: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line);
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

const env = readEnv("deploy/.env.production");
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SECRET_KEY en deploy/.env.production");
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: org, error: orgError } = await admin.from("orgs").select("id").eq("slug", ORG_SLUG).maybeSingle();
if (orgError) throw orgError;
if (!org) throw new Error(`No existe la org ${ORG_SLUG}`);

const bytes = readFileSync(file);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const { data: existing } = await admin.from("org_documents").select("id, title").eq("org_id", org.id).eq("sha256", sha256).maybeSingle();
if (existing) {
  console.log(`Ya estaba: ${existing.title} (${existing.id})`);
  process.exit(0);
}
const ext = path.extname(file).toLowerCase();
const contentType = TYPES[ext];
if (!contentType) throw new Error(`Tipo no admitido: ${ext}`);
const id = randomUUID();
const storagePath = `${org.id}/${id}/${sha256}.${ext.replace(".", "").replace("jpeg", "jpg")}`;
const { error: uploadError } = await admin.storage.from(BUCKET).upload(storagePath, bytes, { contentType, upsert: false });
if (uploadError && !/already exists|duplicate/i.test(uploadError.message)) throw uploadError;
const { error } = await admin.from("org_documents").insert({
  id,
  org_id: org.id,
  category,
  status,
  title,
  description,
  effective_on: effectiveOn,
  storage_path: storagePath,
  file_name: path.basename(file),
  content_type: contentType,
  size_bytes: statSync(file).size,
  sha256,
});
if (error) {
  await admin.storage.from(BUCKET).remove([storagePath]);
  throw error;
}
console.log(`✓ ${title} (${category}/${status}) · ${id}`);
