/**
 * Carga en GNERAI OS el expediente de la sociedad GNERAI PARTNERS, S.L. a partir de la carpeta
 * 03_ADMINISTRACION_Y_LEGAL/01_SOCIEDAD_Y_LEGAL: el emisor de tipo empresa (pendiente de NIF e
 * inscripción), sus series, el reparto 50/50 previsto en el DUE, las aportaciones de capital como
 * movimientos propuestos y cada documento con su estado. Idempotente: lo que ya está no se repite.
 *
 *   node_modules/.bin/tsx scripts/subir-expediente-sociedad.ts
 *
 * Lee NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SECRET_KEY de deploy/.env.production. No imprime claves.
 */

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const LEGAL = "/Users/lago/GNERAI/03_ADMINISTRACION_Y_LEGAL/01_SOCIEDAD_Y_LEGAL";
const CONST = `${LEGAL}/Constitucion_GNERAI_PARTNERS_SL_2026`;
const ORG_SLUG = "gnerai";
const BUCKET = "org-documents";

function readEnv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
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

const TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".md": "text/markdown",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
};

type Doc = {
  file: string;
  title: string;
  category: "constitution" | "statutes" | "registry" | "tax" | "social_security" | "partner_agreement" | "bank" | "other";
  status: "draft" | "pending_signature" | "signed" | "filed" | "registered" | "superseded";
  effectiveOn: string | null;
  member?: string;
  description: string;
};

const DOCUMENTS: Doc[] = [
  {
    file: `${CONST}/Certificado_denominacion_social_original.pdf`,
    title: "Certificado de denominación social · GNERAI PARTNERS, S.L.",
    category: "registry",
    status: "signed",
    effectiveOn: "2026-09-30",
    description: "Reserva de la denominación emitida por el Registro Mercantil Central. Tiene caducidad: si la escritura se retrasa, hay que renovarla.",
  },
  {
    file: `${CONST}/DUE Gnerai Partners, SL.pdf`,
    title: "DUE · Documento Único Electrónico (ejemplar para el interesado)",
    category: "constitution",
    status: "pending_signature",
    effectiveOn: "2026-10-01",
    description:
      "Sociedad de responsabilidad limitada · alta. Capital social 3.000 € en 3.000 participaciones de 1 €. Socios: Marc Sanjuan Sardañés (1.500, aportación no dineraria: ordenador, 1.500 €) y Hugo Lago Pujol (1.500, aportación no dineraria: ordenador, 1.500 €); ambos socios trabajadores y administradores, cargo gratuito. Domicilio social, fiscal y de notificaciones: Avinguda del Pare Jaume Català, 30, pta. 9, Cabrera de Mar. Inicio de operaciones previsto: 02/10/2026; ejercicio cerrado a 31/12. Lo tramita la gestoría (PAE) y se firma en la plataforma.",
  },
  {
    file: `${CONST}/Formulari_DUE_GNERAI_PARTNERS_esborrany.docx`,
    title: "Formulario DUE · borrador",
    category: "constitution",
    status: "draft",
    effectiveOn: "2026-09-30",
    description: "Borrador del formulario DUE rellenado antes de enviarlo a la gestoría.",
  },
  {
    file: `${CONST}/Formulari_DUE_original.docx`,
    title: "Formulario DUE · plantilla original",
    category: "constitution",
    status: "draft",
    effectiveOn: null,
    description: "Plantilla en blanco facilitada por la gestoría (PAE).",
  },
  {
    file: `${CONST}/ANNEX_2_DUE_Hugo_Lago_Pujol_esborrany.docx`,
    title: "Anexo 2 del DUE · Hugo Lago Pujol (borrador)",
    category: "constitution",
    status: "draft",
    effectiveOn: "2026-09-30",
    member: "Hugo Lago",
    description: "Anexo por socio del DUE (uno por cada socio). Falta el de Marc Sanjuan.",
  },
  {
    file: `${CONST}/ANNEX_2_DUE_original.docx`,
    title: "Anexo 2 del DUE · plantilla original",
    category: "constitution",
    status: "draft",
    effectiveOn: null,
    description: "Plantilla en blanco del anexo por socio.",
  },
  {
    file: `${CONST}/Mandato Domiciliació Seguretat Social_Hugo Lago.pdf`,
    title: "Mandato de domiciliación de cuotas de la Seguridad Social · Hugo Lago",
    category: "social_security",
    status: "pending_signature",
    effectiveOn: null,
    member: "Hugo Lago",
    description: "Orden de domiciliación SEPA (RETA) para las cuotas de autónomo como socio administrador. Contiene el IBAN: no compartir fuera de la gestoría.",
  },
  {
    file: `${CONST}/Lista_documentacion_PAE.jpeg`,
    title: "Documentación que pide la gestoría (PAE) para el alta",
    category: "other",
    status: "signed",
    effectiveOn: "2026-10-01",
    description:
      "Lista de la gestoría: certificado del nombre; documento descriptivo de la aportación de bienes; formularios y un anexo por socio; DNI de los socios; justificante del número de cuenta de los socios administradores/trabajadores (vida laboral o cabecera de nómina); titularidad de la cuenta de domiciliación de autónomos; identificador de la cartera virtual con 110 € para el Registro Mercantil (sede.registradores.org).",
  },
  {
    file: `${LEGAL}/Opcion_compra_e_incorporacion_Marc_Cortada_GNERAI.docx`,
    title: "Contrato de opción de compra de participaciones e incorporación futura · Marc Cortada",
    category: "partner_agreement",
    status: "pending_signature",
    effectiveOn: "2026-10-02",
    member: "Marc Cortada",
    description:
      "Opción irrevocable sobre 1.000 participaciones (500 de Hugo, nº 1.001–1.500; 500 de Marc Sanjuan, nº 2.501–3.000). Precio de ejercicio 1.000 € (500 € a cada concedente); prima 150 € a cada uno, no imputable. Ejercitable cuando termine la restricción de la ayuda de autoocupación y hasta el 31/12/2029. Hasta entonces Marc Cortada no es socio ni titular real. Revoca el compromiso del 01/10/2026. Pendiente de revisión jurídica y legitimación notarial de firmas.",
  },
  {
    file: `${LEGAL}/Compromiso_futura_incorporacion_Marc_Cortada_GNERAI.pdf`,
    title: "Compromiso de igualdad interna y futura incorporación · Marc Cortada",
    category: "partner_agreement",
    status: "superseded",
    effectiveOn: "2026-10-01",
    member: "Marc Cortada",
    description: "Documento breve del 01/10/2026. Revocado y sin valor entre las partes por el contrato de opción del 02/10/2026.",
  },
  {
    file: `${LEGAL}/BORRADOR_ACUERDO_ENTRADA_MARC_CORTADA_2026.md`,
    title: "Borrador del acuerdo de opción de compra y futura incorporación (30/09)",
    category: "partner_agreement",
    status: "superseded",
    effectiveOn: "2026-09-30",
    member: "Marc Cortada",
    description: "Primer borrador con los extremos entre corchetes y las comprobaciones jurídicas. Sustituido por el contrato del 02/10/2026.",
  },
];

async function main() {
  const { data: org, error: orgError } = await admin.from("orgs").select("id").eq("slug", ORG_SLUG).single();
  if (orgError || !org) throw orgError ?? new Error("org no encontrada");
  const { data: members, error: membersError } = await admin.from("members").select("id, full_name").eq("org_id", org.id);
  if (membersError) throw membersError;
  const memberId = (name: string) => {
    const found = members?.find((m) => m.full_name.toLowerCase().startsWith(name.toLowerCase()));
    if (!found) throw new Error(`Socio no encontrado: ${name}`);
    return found.id;
  };

  // 1. La sociedad como emisor (pendiente de constitución), con sus series.
  const { data: company } = await admin.from("issuers").select("id").eq("org_id", org.id).eq("kind", "company").is("archived_at", null).maybeSingle();
  let issuerId = company?.id ?? null;
  if (!issuerId) {
    const { data, error } = await admin
      .from("issuers")
      .insert({
        org_id: org.id,
        kind: "company",
        legal_name: "GNERAI PARTNERS, S.L.",
        trade_name: "GNERAI",
        address_line: "Avinguda del Pare Jaume Català, 30, pta. 9",
        postal_code: "08349",
        city: "Cabrera de Mar",
        province: "Barcelona",
        country_code: "ES",
        default_irpf_bps: 0,
        is_primary: false,
        active_from: null,
        registry_info:
          "Pendiente de NIF, escritura e inscripción. DUE presentado a la gestoría (PAE) el 01/10/2026. Capital social 3.000 € en 3.000 participaciones de 1 €: Hugo Lago Pujol 1.500 (nº 1–1.500) y Marc Sanjuan Sardañés 1.500 (nº 1.501–3.000), aportaciones no dinerarias (un ordenador cada uno). Socios administradores, cargo gratuito. Inicio de operaciones previsto: 02/10/2026.",
      } as never)
      .select("id")
      .single();
    if (error) throw error;
    issuerId = data.id;
    const { error: seriesError } = await admin.from("invoice_series").insert([
      { org_id: org.id, issuer_id: issuerId, code: "F", name: "Facturas", kind: "ordinary", format: "{yyyy}-{n:4}", reset_yearly: true, is_default: true },
      { org_id: org.id, issuer_id: issuerId, code: "R", name: "Rectificativas", kind: "rectifying", format: "R{yyyy}-{n:4}", reset_yearly: true, is_default: true },
    ] as never);
    if (seriesError) throw seriesError;
    console.log("  ✓ Emisor GNERAI PARTNERS, S.L. creado (pendiente de constitución) con series F y R");
  } else console.log("  · Emisor de la sociedad ya existía");

  // 2. Reparto previsto en el DUE: 50/50 desde el 02/10/2026.
  const { count: shares } = await admin.from("shareholdings").select("id", { count: "exact", head: true }).eq("org_id", org.id);
  if (!shares) {
    const { error } = await admin.from("shareholdings").insert([
      { org_id: org.id, member_id: memberId("Hugo Lago"), percent_bps: 5000, valid_from: "2026-10-02" },
      { org_id: org.id, member_id: memberId("Marc Sanjuan"), percent_bps: 5000, valid_from: "2026-10-02" },
    ]);
    if (error) throw error;
    console.log("  ✓ Participaciones 50/50 (Hugo Lago, Marc Sanjuan) desde el 02/10/2026, según el DUE");
  } else console.log("  · Participaciones ya registradas");

  // 3. Aportaciones de capital como movimientos propuestos (hasta la escritura).
  const { count: movements } = await admin.from("partner_movements").select("id", { count: "exact", head: true }).eq("org_id", org.id).eq("kind", "capital_contribution");
  if (!movements) {
    const { error } = await admin.from("partner_movements").insert(
      ["Hugo Lago", "Marc Sanjuan"].map((name) => ({
        org_id: org.id,
        member_id: memberId(name),
        kind: "capital_contribution",
        status: "proposed",
        amount_cents: 150_000,
        effective_on: "2026-10-02",
        reference: "Aportación no dineraria: ordenador (DUE 01/10/2026)",
        notes: "Pendiente de la escritura de constitución; se marcará aprobada/pagada cuando conste en escritura.",
      })),
    );
    if (error) throw error;
    console.log("  ✓ Dos aportaciones de capital de 1.500 € como propuestas");
  } else console.log("  · Aportaciones de capital ya registradas");

  // 4. Documentos del expediente.
  const { data: existing } = await admin.from("org_documents").select("sha256").eq("org_id", org.id);
  const known = new Set((existing ?? []).map((d) => d.sha256));
  let uploaded = 0;
  for (const doc of DOCUMENTS) {
    const bytes = readFileSync(doc.file);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (known.has(sha256)) {
      console.log(`  · ya estaba: ${doc.title}`);
      continue;
    }
    const ext = path.extname(doc.file).toLowerCase();
    const contentType = TYPES[ext];
    if (!contentType) throw new Error(`Tipo no admitido: ${doc.file}`);
    const id = crypto.randomUUID();
    const storagePath = `${org.id}/${id}/${sha256}.${ext.replace(".", "").replace("jpeg", "jpg")}`;
    const { error: uploadError } = await admin.storage.from(BUCKET).upload(storagePath, bytes, { contentType, upsert: false });
    if (uploadError && !/already exists|duplicate/i.test(uploadError.message)) throw uploadError;
    const { error } = await admin.from("org_documents").insert({
      id,
      org_id: org.id,
      category: doc.category,
      status: doc.status,
      title: doc.title,
      description: doc.description,
      effective_on: doc.effectiveOn,
      member_id: doc.member ? memberId(doc.member) : null,
      storage_path: storagePath,
      file_name: path.basename(doc.file),
      content_type: contentType,
      size_bytes: statSync(doc.file).size,
      sha256,
    });
    if (error) {
      await admin.storage.from(BUCKET).remove([storagePath]);
      throw error;
    }
    uploaded += 1;
    console.log(`  ✓ ${doc.title} (${doc.status})`);
  }
  console.log(`\n  Expediente: ${uploaded} documento(s) nuevo(s), ${DOCUMENTS.length - uploaded} ya estaban.`);
}

main().catch((error) => {
  console.error(`  ✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
