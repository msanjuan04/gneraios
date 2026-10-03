// Cuotas de autónomos (90/90/300), cobros anteriores de Sees y Nitid (sin IVA) y reparto a tres.
const { createRequire } = require("node:module");
const req = createRequire("/Users/lago/GNERAI/01_PROYECTOS/03_WEB_Y_PRESENCIA/GNERAIOS/package.json");
const { createClient } = req("@supabase/supabase-js");
const fs = require("node:fs");
const env = {};
for (const line of fs.readFileSync("deploy/.env.production", "utf8").split("\n")) { const m = /^([A-Z_]+)=(.*)$/.exec(line); if (m) env[m[1]] = m[2]; }
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data; };
const SL = "42d18419-1237-4c4b-ae6e-bcb6446d9807";
(async () => {
  const { data: org } = await db.from("orgs").select("id").eq("slug", "gnerai").maybeSingle(); const o = org.id;
  const members = must(await db.from("members").select("id,full_name").eq("org_id", o), "socios");
  const m = (name) => members.find((x) => x.full_name === name)?.id;
  const cat = must(await db.from("expense_categories").select("id").eq("org_id", o).eq("name", "Cuotas de autónomos"), "categoría")[0];
  const clients = must(await db.from("clients").select("id,display_name").eq("org_id", o).in("display_name", ["Sees", "Nitid Media"]), "clientes");
  fs.writeFileSync(process.env.BACKUP, JSON.stringify({ subs: must(await db.from("expense_subscriptions").select("*").eq("org_id", o), "subs"), receipts: must(await db.from("client_receipts").select("*").eq("org_id", o), "recibos"), shares: must(await db.from("shareholdings").select("*").eq("org_id", o), "participaciones") }, null, 1));

  // 1) Cuotas de autónomos: mensuales, domiciliadas, el último día del mes, desde octubre.
  const fees = [["Marc Sanjuan", 9000], ["Hugo Lago", 9000], ["Marc Cortada", 30000]];
  const have = must(await db.from("expense_subscriptions").select("description").eq("org_id", o), "existentes").map((s) => s.description);
  for (const [name, cents] of fees) {
    const description = `Cuota de autónomos · ${name}`;
    if (have.includes(description)) { console.log("ya estaba:", description); continue; }
    must(await db.from("expense_subscriptions").insert({ org_id: o, issuer_id: SL, category_id: cat.id, member_id: m(name), description, base_cents: cents, vat_bps: 0, vat_deductible: false, irpf_bps: 0, billing_interval: "monthly", starts_on: "2026-10-31", billing_day: 31, payment_method: "sepa_debit", is_active: true, notes: "Cargo del último día de cada mes. Cambiar el día si no es ese." }), "alta " + name);
    console.log("cuota:", description, cents / 100, "€/mes");
  }
  // 2) Cobros anteriores a GNERAI OS, sin IVA (facturados fuera de la app).
  const receipts = [["Sees", 60000, "2025-10-01"], ["Nitid Media", 90000, "2026-04-15"]];
  const haveR = must(await db.from("client_receipts").select("client_id,amount_cents,received_on").eq("org_id", o), "recibos");
  for (const [name, cents, on] of receipts) {
    const c = clients.find((x) => x.display_name === name);
    if (haveR.some((r) => r.client_id === c.id && r.amount_cents === cents)) { console.log("ya estaba el cobro de", name); continue; }
    must(await db.from("client_receipts").insert({ org_id: o, client_id: c.id, received_on: on, amount_cents: cents, method: "transfer", concept: "Cobro anterior a GNERAI OS (sin IVA)", notes: "Facturado fuera de la app, sin IVA. La fecha es aproximada." }), "cobro " + name);
    console.log("cobro:", name, cents / 100, "€", on);
  }
  console.log("socios:", JSON.stringify({ marcS: m("Marc Sanjuan")?.slice(0, 4), hugo: m("Hugo Lago")?.slice(0, 4), cortada: m("Marc Cortada")?.slice(0, 4) }));
})().catch((e) => { console.log("ERR", e.message); process.exit(1); });
