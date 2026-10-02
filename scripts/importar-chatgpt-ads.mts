// Importa la clave OPENAI_ADS_API_KEY del entorno como cuenta de ChatGPT Ads de la agencia (lo mismo
// que el botón «Importar como cuenta de GNERAI» de /ads, pero desde la terminal, con el entorno de
// producción). Comprueba la clave contra la API, la cifra con INTEGRATIONS_ENCRYPTION_KEY y la guarda.
//
//   tsx --env-file=deploy/.env.production scripts/importar-chatgpt-ads.mts <slug-de-la-org>

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { openAiAds } from "../src/server/ads/providers/openai";
import { secretStoreFromEnv } from "../src/server/seo/secret-store";

const slug = process.argv[2];
if (!slug) throw new Error("Falta el slug de la org.");
const key = process.env.OPENAI_ADS_API_KEY?.trim();
if (!key) throw new Error("No hay OPENAI_ADS_API_KEY en el entorno.");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SECRET_KEY.");

const admin = createClient(url, secret, { auth: { persistSession: false } });
const { data: org, error: orgError } = await admin.from("orgs").select("id, slug").eq("slug", slug).maybeSingle();
if (orgError) throw orgError;
if (!org) throw new Error(`No existe la org ${slug}.`);

const { data: existing } = await admin.from("ads_accounts").select("id, label").eq("org_id", org.id).eq("provider", "openai").is("owner_client_id", null).is("archived_at", null).maybeSingle();
if (existing) {
  console.log(`Ya hay una cuenta de ChatGPT Ads de la agencia: ${existing.label} (${existing.id}). Nada que hacer.`);
  process.exit(0);
}

const info = await openAiAds.account({ credential: key, externalAccountId: "" });
const id = randomUUID();
const sealed = await secretStoreFromEnv().seal(key, `ads/${org.id}/${id}`);
const { error } = await admin.from("ads_accounts").insert({
  id,
  org_id: org.id,
  provider: "openai",
  label: "ChatGPT Ads",
  owner_client_id: null,
  external_account_id: info.externalAccountId,
  platform_name: info.name,
  currency: info.currency,
  timezone: info.timezone,
  credential_ciphertext: sealed,
});
if (error) throw error;
console.log(`Cuenta creada: ${id} · ${info.name} · ${info.externalAccountId} · ${info.currency} · ${info.timezone}`);
