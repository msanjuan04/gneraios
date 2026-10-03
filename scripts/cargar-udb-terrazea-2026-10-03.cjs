// UDB Sports: cobra el día 5 con la SL desde octubre. Terrazea: a la SL desde el 2/10. Idempotente.
const { createRequire } = require("node:module");
const req = createRequire("/Users/lago/GNERAI/01_PROYECTOS/03_WEB_Y_PRESENCIA/GNERAIOS/package.json");
const { createClient } = req("@supabase/supabase-js");
const fs = require("node:fs");
const env = {};
for (const line of fs.readFileSync("deploy/.env.production", "utf8").split("\n")) { const m = /^([A-Z_]+)=(.*)$/.exec(line); if (m) env[m[1]] = m[2]; }
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const SL = "42d18419-1237-4c4b-ae6e-bcb6446d9807";
const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data; };
(async () => {
  const { data: org } = await db.from("orgs").select("id").eq("slug", "gnerai").maybeSingle();
  const orgId = org.id;
  const clients = must(await db.from("clients").select("id,display_name").eq("org_id", orgId).in("display_name", ["UDB Sports", "Terrazea"]), "clientes");
  const udb = clients.find((c) => c.display_name === "UDB Sports"), ter = clients.find((c) => c.display_name === "Terrazea");
  const contracts = must(await db.from("contracts").select("id,client_id").eq("org_id", orgId).in("client_id", [udb.id, ter.id]), "contratos");
  const cu = contracts.find((c) => c.client_id === udb.id), ct = contracts.find((c) => c.client_id === ter.id);
  const lines = must(await db.from("contract_lines").select("*").eq("org_id", orgId).eq("contract_id", cu.id), "líneas");
  const lineIds = lines.map((l) => l.id);
  const drafts = must(await db.from("invoices").select("id,lifecycle,number,subtotal_cents,issuer_id").eq("org_id", orgId).eq("client_id", udb.id), "facturas");
  const items = must(await db.from("billable_items").select("*").eq("org_id", orgId).in("contract_line_id", lineIds), "items");
  const issuers = must(await db.from("contract_issuers").select("*").eq("org_id", orgId).in("contract_id", [cu.id, ct.id]), "emisores");
  const clientRow = must(await db.from("clients").select("legal_name").eq("id", udb.id), "cliente");
  fs.writeFileSync(process.env.BACKUP, JSON.stringify({ lines, drafts, items, issuers, clientRow }, null, 1));
  console.log("copia guardada. antes:", { lineas: lines.length, facturas: drafts.map((d) => d.lifecycle), items: items.length, emisores: issuers.length });

  // 1) La factura en borrador de octubre (Marc, IRPF 7 %, día 1): fuera. Solo si sigue siendo borrador.
  for (const d of drafts.filter((x) => x.lifecycle === "draft")) {
    must(await db.from("invoices").delete().eq("org_id", orgId).eq("id", d.id).eq("lifecycle", "draft"), "borrar borrador");
    console.log("borrador borrado:", d.id.slice(0, 8), "base", d.subtotal_cents);
  }
  // 2) Los conceptos pendientes del periodo del 1/10, que ya no existe (el contrato empieza el 5).
  const stale = must(await db.from("billable_items").select("id").eq("org_id", orgId).in("contract_line_id", lineIds).eq("source", "recurring").eq("period_start", "2026-10-01").is("invoice_line_id", null).is("waived_at", null), "stale");
  if (stale.length) must(await db.from("billable_items").delete().eq("org_id", orgId).in("id", stale.map((s) => s.id)), "borrar items");
  console.log("conceptos del 1/10 retirados:", stale.length);
  // 3) Empieza el 5 de octubre y cobra el día 5, sin prorratear.
  must(await db.from("contract_lines").update({ starts_on: "2026-10-05", billing_day: 5, prorate_first: false }).eq("org_id", orgId).eq("contract_id", cu.id), "líneas UDB");
  // 4) A partir del 2/10 factura la SL (UDB y Terrazea). El primer emisor (Marc, 1/10) queda como historia.
  for (const contractId of [cu.id, ct.id]) {
    must(await db.from("contract_issuers").upsert({ org_id: orgId, contract_id: contractId, issuer_id: SL, valid_from: "2026-10-02" }, { onConflict: "contract_id,valid_from" }), "emisor SL");
  }
  // 5) Nombre legal de UDB (el NIF lo dará el usuario).
  if (!clientRow[0]?.legal_name) must(await db.from("clients").update({ legal_name: "UDB Sports S.L." }).eq("org_id", orgId).eq("id", udb.id), "nombre legal");
  console.log("hecho");
})().catch((e) => { console.log("ERR", e.message); process.exit(1); });
