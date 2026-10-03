/**
 * Deja constancia de que un presupuesto se envió: guarda el canal, el destinatario y una copia
 * exacta del PDF que vio el cliente (lo mismo que hace «Marcar como enviado» en la app, pero para
 * los presupuestos cargados desde los scripts, que nacieron ya enviados sin pasar por la pantalla).
 *
 *   node_modules/.bin/tsx scripts/registrar-envios-presupuestos.ts
 *
 * Idempotente: el presupuesto que ya tiene evidencia guardada se salta.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { createClient } from "@supabase/supabase-js";
import { loadQuoteDocument } from "../src/server/quotes/document";

// tsx ejecuta los scripts como CommonJS y react-pdf solo se publica como ESM (igual que en
// scripts/seed-demo.ts): la subruta que no está exportada para require() se resuelve con "import".
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if ((error as { code?: string }).code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw error;
      return nextResolve(specifier, { ...context, conditions: [...context.conditions, "import"] });
    }
  },
});

const ORG_SLUG = "gnerai";

/** Qué se envió de cada presupuesto, según el correo. */
const SENDS: { number: string; method: "email" | "whatsapp" | "linkedin" | "other"; recipient: string; note: string; pdf?: string }[] = [
  {
    number: "P2026-0001",
    method: "email",
    recipient: "karina2692@gmail.com",
    note: "Enviada el 23/09 con el resumen de la llamada: presupuesto resumido y propuesta completa, en PDF y en web (littleforest.gnerai.com).",
  },
  {
    number: "P2026-0002",
    method: "email",
    recipient: "jaume@metrickal.com",
    note: "Propuesta conjunta BAKoffice + Metrickal publicada en bakmet.gnerai.com y enviada por correo el 1/10.",
  },
  {
    number: "P2026-0003",
    method: "email",
    recipient: "jaume@metrickal.com",
    note: "Propuesta conjunta BAKoffice + Metrickal publicada en bakmet.gnerai.com y enviada por correo el 1/10.",
  },
  {
    number: "P2026-0004",
    method: "email",
    recipient: "oscar@maherhomes.es",
    note: "Enviada el 2/10 a las 15:03 en PDF adjunto, para revisarla con el equipo y cerrar detalles la semana siguiente.",
  },
  {
    number: "P2026-0005",
    method: "email",
    recipient: "nadiapedraza@outlook.es",
    note: "Opción A del PDF enviado el 3/10 a las 12:13 (las dos opciones iban en el mismo documento).",
    pdf: "/Users/lago/Downloads/Propuesta_GNERAI_Nadia_Medicion_GoogleAds.pdf",
  },
  {
    number: "P2026-0006",
    method: "email",
    recipient: "nadiapedraza@outlook.es",
    note: "Opción B del PDF enviado el 3/10 a las 12:13 (las dos opciones iban en el mismo documento).",
    pdf: "/Users/lago/Downloads/Propuesta_GNERAI_Nadia_Medicion_GoogleAds.pdf",
  },
];

function readEnv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line);
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

async function main() {
  const env = readEnv("deploy/.env.production");
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SECRET_KEY en deploy/.env.production");
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: org, error: orgError } = await admin.from("orgs").select("id").eq("slug", ORG_SLUG).maybeSingle();
  if (orgError) throw orgError;
  if (!org) throw new Error(`No existe la org ${ORG_SLUG}`);

  for (const send of SENDS) {
    const { data: quote, error } = await admin.from("quotes").select("id, number").eq("org_id", org.id).eq("number", send.number).maybeSingle();
    if (error) throw error;
    if (!quote) {
      console.log(`· ${send.number}: no existe, se salta`);
      continue;
    }
    const { count } = await admin.from("quote_sent_versions").select("id", { count: "exact", head: true }).eq("quote_id", quote.id);
    if ((count ?? 0) > 0) {
      console.log(`· ${send.number}: ya tenía evidencia guardada`);
      continue;
    }
    const loaded = await loadQuoteDocument(admin, quote.id);
    if (!loaded) throw new Error(`No se pudo cargar el documento de ${send.number}`);
    // El PDF real que recibió el cliente si lo tenemos; si no, el que genera la app con los mismos datos.
    let pdf: Buffer;
    if (send.pdf) {
      pdf = readFileSync(send.pdf);
    } else {
      // El motor del PDF se carga tarde, ya con los hooks puestos.
      const { renderQuotePdf } = await import("../src/pdf");
      pdf = Buffer.from(await renderQuotePdf(loaded.document));
    }
    const { error: insertError } = await admin.from("quote_sent_versions").insert({
      org_id: org.id,
      quote_id: quote.id,
      method: send.method,
      recipient: send.recipient,
      note: send.note,
      document_snapshot: JSON.parse(JSON.stringify(loaded.document)),
      pdf_snapshot: `\\x${pdf.toString("hex")}`,
      pdf_sha256: createHash("sha256").update(pdf).digest("hex"),
    });
    if (insertError) throw insertError;
    console.log(`✓ ${send.number}: ${send.method} a ${send.recipient} · PDF ${send.pdf ? "real del correo" : "generado"} (${Math.round(pdf.length / 1024)} KB)`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
