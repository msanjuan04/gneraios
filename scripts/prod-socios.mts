/**
 * Primer acceso de los socios en un entorno nuevo (producción): crea su cuenta si no existe y le
 * genera su código de acceso de 8 cifras. Los códigos salen UNA vez en esta terminal y solo se
 * guarda su hash: apúntalos y dáselos a cada socio en persona.
 *
 *   pnpm prod:socios --socio "Marc Sanjuan <marc@…>" --socio "Hugo Lago <hugo@…>" --socio "Marc Cortada <marc.c@…>"
 *
 * Lee NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SECRET_KEY de deploy/.env.production.
 *
 * Después, el primero que entre crea la org en el onboarding e invita a los otros dos desde
 * Ajustes → Equipo; ellos entran con su código y aceptan la invitación solos. Volver a lanzarlo
 * con un socio le da un código nuevo (el anterior deja de valer). No toca nada más.
 */

import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { SPAIN_TAX_DEFAULTS } from "../src/domain/tax/spain-defaults";
import { generateAccessCode, hashAccessCode, verifyAccessCode } from "../src/server/auth/code-crypto";

type Partner = { name: string; email: string };

function parsePartner(value: string): Partner {
  const m = /^(.+?)\s*<([^>]+@[^>]+)>$/.exec(value.trim());
  if (!m) throw new Error(`Socio mal escrito: «${value}». Formato: "Nombre Apellido <email@dominio>"`);
  return { name: m[1]!.trim(), email: m[2]!.trim().toLowerCase() };
}

const { values } = parseArgs({
  options: {
    socio: { type: "string", multiple: true },
    yes: { type: "boolean", default: false },
    // Guarda los códigos en este fichero (permisos 600) en vez de enseñarlos en la terminal.
    out: { type: "string" },
    // Invita a cada socio a esta org (por su slug) si aún no es miembro: entra con el código y la
    // invitación se acepta sola. Rol: owner (los socios van a partes iguales) salvo --role.
    org: { type: "string" },
    role: { type: "string", default: "owner" },
    // Si la org de --org no existe, la crea con este nombre: el primer --socio queda de owner, con
    // los impuestos de España por defecto, y los demás, invitados (los datos fiscales, en Ajustes).
    "create-org": { type: "string" },
  },
  allowPositionals: false,
});
const partners = (values.socio ?? []).map(parsePartner);
if (partners.length === 0) {
  console.error('Falta al menos un --socio "Nombre <email>".');
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SECRET_KEY en deploy/.env.production.");
  process.exit(1);
}
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

console.log(`\nProyecto: ${new URL(url).host}`);
for (const p of partners) console.log(`  · ${p.name} <${p.email}>`);
if (!values.yes) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("\n¿Crear las cuentas que falten y generar un código nuevo a cada uno? (s/N) ");
  rl.close();
  if (!/^s(í|i)?$/i.test(answer.trim())) process.exit(0);
}

/** El usuario de Auth con ese email (lo crea, ya confirmado y sin contraseña, si no existe). */
async function ensureUser(p: Partner): Promise<string> {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const found = data.users.find((u) => u.email?.toLowerCase() === p.email);
    if (found) return found.id;
    if (data.users.length < 200) break;
  }
  const { data, error } = await admin.auth.admin.createUser({ email: p.email, email_confirm: true, user_metadata: { full_name: p.name } });
  if (error || !data.user) throw error ?? new Error("sin usuario");
  return data.user.id;
}

const role = values.role === "partner" || values.role === "viewer" ? values.role : "owner";
let orgId: string | null = null;

/**
 * Crea la org como el primer socio (create_organization pide un usuario con sesión): se le abre
 * una sesión solo para esto con un enlace mágico generado y verificado aquí, y se cierra al acabar.
 */
async function createOrgAs(first: Partner, others: Partner[], name: string, slug: string): Promise<string> {
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!publishable) throw new Error("Falta NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY para crear la org.");
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email: first.email });
  if (linkError || !link.properties?.hashed_token) throw linkError ?? new Error("sin enlace");
  const asUser = createClient(url!, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: verifyError } = await asUser.auth.verifyOtp({ type: "email", token_hash: link.properties.hashed_token });
  if (verifyError) throw verifyError;
  const { data: id, error } = await asUser.rpc("create_organization", {
    p: {
      org: { name, slug },
      owner: { full_name: first.name, locale: "es" },
      issuers: [],
      tax_rates: SPAIN_TAX_DEFAULTS.map((t, position) => ({ ...t, position })),
      invitations: others.map((p) => ({ email: p.email, role, full_name: p.name })),
    },
  });
  await asUser.auth.signOut();
  if (error || !id) throw error ?? new Error("sin org");
  return id as string;
}

/** Invitación a la org (se acepta sola al entrar con el código), salvo que ya sea miembro. */
async function ensureInvited(userId: string, p: Partner): Promise<string> {
  if (!orgId) return "";
  const { data: member } = await admin.from("members").select("is_active").eq("org_id", orgId).eq("user_id", userId).maybeSingle();
  if (member) return member.is_active ? "ya es miembro" : "tenía el acceso quitado: reactívalo en Ajustes → Equipo";
  const { error } = await admin.from("member_invitations").upsert(
    {
      org_id: orgId,
      email: p.email,
      role,
      full_name: p.name,
      accepted_at: null,
      accepted_by: null,
      expires_at: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
    },
    { onConflict: "org_id,email" },
  );
  if (error) throw error;
  return "invitado (entra con el código)";
}

if (values.org) {
  const { data: org, error } = await admin.from("orgs").select("id, name").eq("slug", values.org).maybeSingle();
  if (error) throw error;
  if (org) {
    orgId = org.id;
    console.log(`Org: ${org.name} (${values.org}), rol ${role}`);
  } else if (values["create-org"]) {
    const [first, ...others] = partners;
    await ensureUser(first!);
    orgId = await createOrgAs(first!, others, values["create-org"], values.org);
    console.log(`Org creada: ${values["create-org"]} (${values.org}); owner ${first!.name}, invitados los demás como ${role}`);
  } else {
    console.error(`No existe la org «${values.org}» en ${new URL(url).host} (añade --create-org "Nombre" para crearla).`);
    process.exit(1);
  }
}

const { data: existing, error: codesError } = await admin.from("access_codes").select("user_id, code_hash");
if (codesError) throw codesError;
const hashes = new Map((existing ?? []).map((row) => [row.user_id, row.code_hash]));

const issued: { partner: Partner; code: string; note: string }[] = [];
for (const partner of partners) {
  const userId = await ensureUser(partner);
  const note = await ensureInvited(userId, partner);
  const others = [...hashes].filter(([id]) => id !== userId).map(([, hash]) => hash);
  let code = generateAccessCode();
  // Cada código abre una sola cuenta: ni repetido con otro socio ni con los de esta tanda.
  while (
    issued.some((i) => i.code === code) ||
    (await Promise.all(others.map((hash) => verifyAccessCode(code, hash)))).some(Boolean)
  ) {
    code = generateAccessCode();
  }
  const codeHash = await hashAccessCode(code);
  const { error } = await admin
    .from("access_codes")
    .upsert({ user_id: userId, code_hash: codeHash, created_at: new Date().toISOString(), created_by: null, last_used_at: null });
  if (error) throw error;
  hashes.set(userId, codeHash);
  issued.push({ partner, code, note });
}

const lines = [
  "Códigos de acceso a GNERAI OS (solo existen aquí: apúntalos, dáselos en persona y borra este texto).",
  "",
  ...issued.map(({ partner, code }) => `  ${partner.name.padEnd(24)} ${code.slice(0, 4)} ${code.slice(4)}   ${partner.email}`),
  "",
  "Se entra en la pantalla de acceso escribiendo el código (sin email ni contraseña).",
];
for (const { partner, note } of issued) if (note) console.log(`  · ${partner.name}: ${note}`);
if (values.out) {
  writeFileSync(values.out, `${lines.join("\n")}\n`, { mode: 0o600 });
  console.log(`\n${issued.length} códigos guardados en ${values.out} (solo tu usuario puede leerlo). Bórralo cuando los tengáis.\n`);
} else {
  console.log(`\n${lines.join("\n")}\n`);
}
