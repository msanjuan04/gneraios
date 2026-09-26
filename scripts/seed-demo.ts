/**
 * Organización demo con datos ficticios para ver GNERAI OS lleno sin tocar los datos reales:
 * clientes, contactos, deals con historial de etapas y actividades, contratos de todos los
 * tipos y 18 meses de facturación.
 *
 * La facturación NO se inserta a mano: se simula mes a mes con el motor real (el mismo cron,
 * la misma emisión con PDF y numeración sin huecos), así que los datos son exactamente los
 * que habría producido el sistema y el propio seed sirve de prueba integral (ARCHITECTURE §8).
 *
 *   pnpm db:seed:demo                    # añade como owners a los owners de otras orgs
 *   pnpm db:seed:demo --email qa@x.test  # y además a quien le digas
 *
 * Es determinista (misma semilla → mismos datos) y re-ejecutable: borra y recrea la org
 * `demo`. Solo contra la base local: se niega a conectarse a cualquier otro host.
 */
import { registerHooks } from "node:module";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { addDays, addMonthsClamped, type CivilDate } from "../src/domain/dates/civil-date";
import { SPAIN_TAX_DEFAULTS } from "../src/domain/tax";
import { validateIban, validateSpanishTaxId } from "../src/domain/tax-id";
import { nowInZone } from "../src/lib/clock";
import type { Database } from "../src/lib/supabase/database.types";

// tsx ejecuta los scripts como CommonJS y react-pdf solo se publica como ESM: si una subruta
// no está exportada para require(), se vuelve a resolver con la condición "import" (igual que
// scripts/render-sample-invoice.tsx). El motor se importa después, de forma dinámica.
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

const DATABASE_URL = process.env.SEED_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const API_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SECRET = process.env.SUPABASE_SECRET_KEY ?? "";
const PUBLISHABLE = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const LOCAL = ["127.0.0.1", "localhost", "::1"];
for (const target of [DATABASE_URL, API_URL]) {
  const host = target ? new URL(target).hostname : "";
  if (!LOCAL.includes(host)) {
    console.error(`Solo se siembra la base local; «${host || "sin URL"}» no lo es (¿falta .env.local?).`);
    process.exit(1);
  }
}

// PRNG determinista (mulberry32).
let seed = 20260926;
function rand(): number {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const pick = <T>(list: readonly T[]): T => list[int(0, list.length - 1)]!;
const chance = (p: number) => rand() < p;

const DAY = 86_400_000;
const now = Date.now();
const TODAY: CivilDate = nowInZone("Europe/Madrid").date;
const daysAgo = (d: number) => new Date(now - d * DAY - int(0, 8) * 3_600_000);
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

function fakeCif(): string {
  for (;;) {
    const digits = String(int(1_000_000, 9_999_999));
    for (let c = 0; c <= 9; c++) {
      const candidate = `B${digits}${c}`;
      if (validateSpanishTaxId(candidate).valid) return candidate;
    }
  }
}
function fakeNif(): string {
  const n = int(10_000_000, 99_999_999);
  return `${n}${"TRWAGMYFPDXBNJZSQVHLCKE"[n % 23]}`;
}
function fakeIban(): string {
  const bban = Array.from({ length: 20 }, () => int(0, 9)).join("");
  for (let check = 2; check <= 98; check++) {
    const candidate = `ES${String(check).padStart(2, "0")}${bban}`;
    if (validateIban(candidate)) return candidate;
  }
  throw new Error("IBAN");
}

const CLIENTS = [
  { name: "Restaurant Can Sorra", city: "Arenys de Mar", cp: "08350", sector: "Restauración", lang: "ca" },
  { name: "Clínica Dental Mar Blau", city: "Mataró", cp: "08301", sector: "Salud", lang: "es" },
  { name: "Immobiliària Costa Nord", city: "Premià de Mar", cp: "08330", sector: "Inmobiliaria", lang: "ca" },
  { name: "Celler Turó d'Alella", city: "Alella", cp: "08328", sector: "Vinos", lang: "ca" },
  { name: "Maresme Fit Gym", city: "Vilassar de Mar", cp: "08340", sector: "Deporte", lang: "es" },
  { name: "Hotel Llevant Calella", city: "Calella", cp: "08370", sector: "Turismo", lang: "es" },
  { name: "Tallers Rius", city: "El Masnou", cp: "08320", sector: "Automoción", lang: "es" },
  { name: "Acadèmia Babel", city: "Badalona", cp: "08911", sector: "Educación", lang: "ca" },
  { name: "Floristeria Pètal", city: "Canet de Mar", cp: "08360", sector: "Comercio", lang: "ca" },
  { name: "Construccions Riera", city: "Cabrils", cp: "08348", sector: "Construcción", lang: "es" },
] as const;
const STREETS = ["Carrer de la Riera", "Rambla Catalunya", "Carrer Major", "Passeig Marítim", "Camí Ral", "Carrer de Sant Pere"];

const PEOPLE = ["Núria Puig", "Jordi Soler", "Marta Vidal", "Albert Roca", "Laura Serra", "Oriol Pons", "Clara Font", "Pere Mas"];
const DEAL_TITLES = [
  "Web corporativa + SEO local",
  "Rebranding completo",
  "Campañas Meta Ads",
  "Tienda online",
  "App de reservas",
  "Vídeo corporativo con dron",
  "SEO local 6 meses",
  "Mantenimiento web",
  "Landing + Google Ads",
  "Identidad visual y papelería",
];
const ACTIVITIES = [
  { kind: "call", title: "Llamada de seguimiento" },
  { kind: "meeting", title: "Reunión de briefing" },
  { kind: "email", title: "Enviada propuesta por email" },
  { kind: "note", title: "Nota: prefieren empezar después de verano" },
  { kind: "meeting", title: "Presentación de la propuesta" },
  { kind: "call", title: "Llamada para resolver dudas del presupuesto" },
] as const;

type LineSeed = {
  description: string;
  billing_type: "one_off" | "monthly" | "yearly" | "usage";
  unit_price_cents: number;
  starts_on?: CivilDate;
  ends_on?: CivilDate;
  billing_day?: number;
  prorate_first?: boolean;
  /** Usos registrados (fechas) para las líneas por uso. */
  usages?: CivilDate[];
};
type ContractSeed = {
  client: number;
  title: string;
  signed_on: CivilDate;
  lines: LineSeed[];
  milestones?: { label: string; percent_bps: number; planned_on: CivilDate }[];
};

/** Fechas de uso: una cada `every` meses desde `from`, el día `day`, hasta hoy. */
function monthlyUsages(from: CivilDate, day: number, every = 1, until: CivilDate = TODAY): CivilDate[] {
  const out: CivilDate[] = [];
  for (let d = `${from.slice(0, 8)}${String(day).padStart(2, "0")}`; d <= until; d = addMonthsClamped(d, every)) out.push(d);
  return out;
}

const CONTRACTS: ContractSeed[] = [
  {
    client: 0,
    title: "Web + mantenimiento",
    signed_on: "2025-02-20",
    lines: [
      { description: "Diseño y desarrollo de la web", billing_type: "one_off", unit_price_cents: 240_000 },
      { description: "Mantenimiento web", billing_type: "monthly", unit_price_cents: 9_000, starts_on: "2025-05-01", billing_day: 1 },
    ],
    milestones: [
      { label: "A la firma", percent_bps: 5000, planned_on: "2025-02-20" },
      { label: "A la entrega", percent_bps: 5000, planned_on: "2025-04-15" },
    ],
  },
  {
    client: 1,
    title: "SEO local y campañas",
    signed_on: "2025-04-10",
    lines: [
      { description: "SEO local", billing_type: "monthly", unit_price_cents: 45_000, starts_on: "2025-04-15", billing_day: 1, prorate_first: true },
      { description: "Gestión de Google Ads", billing_type: "monthly", unit_price_cents: 30_000, starts_on: "2025-06-01", billing_day: 1 },
      { description: "Campaña Meta Ads", billing_type: "usage", unit_price_cents: 37_500, usages: monthlyUsages("2025-05-01", 18, 2) },
    ],
  },
  {
    client: 2,
    title: "Redes sociales y hosting",
    signed_on: "2025-09-05",
    lines: [
      { description: "Hosting y dominio", billing_type: "yearly", unit_price_cents: 24_000, starts_on: TODAY_MINUS_YEAR_PLUS(5) },
      { description: "Gestión de redes sociales", billing_type: "monthly", unit_price_cents: 60_000, starts_on: "2025-10-01", billing_day: 1 },
    ],
  },
  {
    client: 3,
    title: "Tienda online",
    signed_on: "2025-12-01",
    lines: [
      { description: "Tienda online (Shopify)", billing_type: "one_off", unit_price_cents: 650_000 },
      { description: "Mantenimiento de la tienda", billing_type: "monthly", unit_price_cents: 15_000, starts_on: "2026-03-01", billing_day: 1 },
    ],
    milestones: [
      { label: "A la firma", percent_bps: 4000, planned_on: "2025-12-01" },
      { label: "Diseño aprobado", percent_bps: 3000, planned_on: "2026-01-20" },
      { label: "Lanzamiento", percent_bps: 3000, planned_on: "2026-03-01" },
    ],
  },
  {
    client: 4,
    title: "Captación con Meta Ads",
    signed_on: "2025-06-15",
    lines: [
      { description: "Gestión de Meta Ads", billing_type: "monthly", unit_price_cents: 25_000, starts_on: "2025-07-01", billing_day: 1, ends_on: "2026-06-30" },
      { description: "Campaña Meta Ads", billing_type: "usage", unit_price_cents: 37_500, usages: monthlyUsages("2025-07-01", 10, 1, "2026-06-10") },
    ],
  },
  {
    client: 5,
    title: "SEO y analítica",
    signed_on: "2025-07-20",
    lines: [
      { description: "SEO para hoteles", billing_type: "monthly", unit_price_cents: 70_000, starts_on: "2025-08-01", billing_day: 1 },
      { description: "Licencia de analítica", billing_type: "yearly", unit_price_cents: 120_000, starts_on: "2025-08-01" },
    ],
  },
  {
    client: 6,
    title: "Web y mantenimiento",
    signed_on: "2026-03-10",
    lines: [
      { description: "Web corporativa", billing_type: "one_off", unit_price_cents: 180_000 },
      { description: "Mantenimiento web", billing_type: "monthly", unit_price_cents: 6_000, starts_on: "2026-04-01", billing_day: 1 },
    ],
    milestones: [{ label: "A la firma", percent_bps: 10000, planned_on: "2026-03-10" }],
  },
  {
    client: 7,
    title: "Marketing para la academia",
    signed_on: "2026-09-12",
    lines: [
      { description: "Gestión de redes y SEO", billing_type: "monthly", unit_price_cents: 40_000, starts_on: "2026-09-15", billing_day: 1, prorate_first: true },
    ],
  },
];

/** Aniversario cercano para que salga el aviso de renovación: hoy − 1 año + n días. */
function TODAY_MINUS_YEAR_PLUS(days: number): CivilDate {
  return addDays(addMonthsClamped(nowInZone("Europe/Madrid").date, -12), days);
}

const sql = postgres(DATABASE_URL, { onnotice: () => {} });
const admin = createClient<Database>(API_URL, SECRET, { auth: { persistSession: false, autoRefreshToken: false } });

async function removeDemoPdfs(orgId: string) {
  const { data } = await admin.storage.from("invoices").list(orgId, { limit: 1000 });
  if (data?.length) await admin.storage.from("invoices").remove(data.map((f) => `${orgId}/${f.name}`));
}

/** Sesión real de un socio de la demo: la emisión pasa por RLS y por su rol, como en la app. */
async function partnerSession(email: string) {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  const db = createClient<Database>(API_URL, PUBLISHABLE, { auth: { persistSession: false, autoRefreshToken: false } });
  const verified = await db.auth.verifyOtp({ type: "email", token_hash: data.properties.hashed_token });
  if (verified.error) throw verified.error;
  return db;
}

async function main() {
  const { runBillingForOrg } = await import("../src/server/billing/engine");
  const { issueInvoiceCore } = await import("../src/server/invoicing/issue-core");
  const { saveMonthSnapshot } = await import("../src/server/metrics/snapshot");
  const { previousMonth } = await import("../src/domain/metrics/months");
  if (!SECRET || !PUBLISHABLE) throw new Error("Faltan las claves de Supabase: ejecuta con .env.local (pnpm db:seed:demo).");
  const emailArgs = process.argv.flatMap((a, i, all) => (a === "--email" && all[i + 1] ? [all[i + 1]!.toLowerCase()] : []));

  // 0. Borrar la demo anterior: sus PDFs, sus datos (sin triggers: incluye los que protegen
  //    las facturas emitidas, cosa que solo se permite aquí, en local) y sus socios ficticios.
  const [old] = await sql`select id from public.orgs where slug = 'demo'`;
  if (old) {
    await removeDemoPdfs(old.id);
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      for (const table of [
        // SEO y métricas (módulos que se siembran aparte) y presupuestos, antes que lo que referencian.
        "seo_query_daily", "seo_daily_metrics", "web_analytics_daily", "seo_sync_state", "seo_properties", "integrations",
        "metrics_snapshots",
        "notifications", "outbound_emails", "job_runs", "payments", "billable_items", "invoice_lines", "invoices",
        "quote_lines", "quotes",
        "contract_milestones", "contract_line_pauses", "contract_lines", "contract_issuers", "issuer_transfers", "contracts",
        "activities", "deal_stage_history", "deals", "contacts", "clients", "loss_reasons", "acquisition_sources",
        "pipeline_stages", "tax_rates", "invoice_series", "issuers", "member_invitations", "members", "audit_log",
      ]) {
        await tx.unsafe(`delete from public.${table} where org_id = $1`, [old.id]);
      }
      await tx`delete from private.invoice_series_counters where series_id not in (select id from public.invoice_series)`;
      await tx`delete from private.quote_counters where org_id = ${old.id}`;
      await tx`delete from public.orgs where id = ${old.id}`;
    });
  }
  await sql`delete from auth.users where email like 'demo-socio-%@gnerai.test'`;

  // Socios ficticios como usuarios de verdad de Auth (uno de ellos emite en la simulación).
  const demoPartners: { id: string; email: string; name: string; initials: string }[] = [];
  for (const [i, [name, initials]] of [["Laia Demo", "LD"], ["Pau Demo", "PD"]].entries()) {
    const email = `demo-socio-${i + 2}@gnerai.test`;
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (error) throw error;
    demoPartners.push({ id: data.user.id, email, name: name!, initials: initials! });
  }

  const ids = await sql.begin(async (tx) => {
    // 1. Org (el trigger siembra etapas, fuentes y motivos) y socios.
    const [org] = await tx`insert into public.orgs (name, slug) values ('GNERAI Demo', 'demo') returning id`;
    const orgId: string = org!.id;

    const owners = await tx`
      select distinct on (u.id) u.id, u.email, m.full_name, m.initials
      from auth.users u
      left join public.members m on m.user_id = u.id and m.role = 'owner' and m.org_id <> ${orgId}
      where m.id is not null or lower(u.email) = any(${emailArgs})
      order by u.id, m.created_at`;
    if (owners.length === 0) throw new Error("No hay a quién añadir a la demo: entra una vez en la app o pasa --email.");

    const memberIds: string[] = [];
    for (const u of owners) {
      const name: string = u.full_name ?? String(u.email).split("@")[0]!;
      const [m] = await tx`
        insert into public.members (org_id, user_id, role, full_name, initials)
        values (${orgId}, ${u.id}, 'owner', ${name}, ${u.initials ?? name.slice(0, 2).toUpperCase()}) returning id`;
      memberIds.push(m!.id);
    }
    const partnerMemberIds: string[] = [];
    for (const p of demoPartners) {
      const [m] = await tx`
        insert into public.members (org_id, user_id, role, full_name, initials)
        values (${orgId}, ${p.id}, 'partner', ${p.name}, ${p.initials}) returning id`;
      memberIds.push(m!.id);
      partnerMemberIds.push(m!.id);
    }

    // 2. Emisores: una socia autónoma (factura desde 2025) y la SL, constituida el 01/09/2026.
    const [freelancer] = await tx`
      insert into public.issuers (org_id, kind, legal_name, tax_id, address_line, postal_code, city, province, email, iban,
                                  default_irpf_bps, member_id, active_from)
      values (${orgId}, 'self_employed', 'Laia Demo Ferrer', ${fakeNif()}, 'Carrer de la Riera, 48', '08301', 'Mataró',
              'Barcelona', 'laia.facturas@example.com', ${fakeIban()}, 1500, ${partnerMemberIds[0]!}, '2025-01-01')
      returning id`;
    const [sl] = await tx`
      insert into public.issuers (org_id, kind, legal_name, trade_name, tax_id, address_line, postal_code, city, province,
                                  email, iban, is_primary, active_from, registry_info)
      values (${orgId}, 'company', 'GNERAI Demo SL', 'GNERAI Demo', ${fakeCif()}, 'Camí Ral, 120', '08301', 'Mataró',
              'Barcelona', 'facturacion@example.com', ${fakeIban()}, true, '2026-09-01',
              'Inscrita en el Registro Mercantil de Barcelona, tomo 00000, folio 00, hoja B-000000 (datos de demostración)')
      returning id`;
    await tx`insert into public.invoice_series (org_id, issuer_id, code, name, kind, format, is_default) values
      (${orgId}, ${freelancer!.id}, 'F', 'Facturas', 'ordinary', '{yyyy}-{n:4}', true),
      (${orgId}, ${freelancer!.id}, 'R', 'Rectificativas', 'rectifying', 'R{yyyy}-{n:4}', true),
      (${orgId}, ${sl!.id}, 'F', 'Facturas', 'ordinary', 'GS{yyyy}-{n:4}', true),
      (${orgId}, ${sl!.id}, 'R', 'Rectificativas', 'rectifying', 'GSR{yyyy}-{n:4}', true)`;
    for (const [position, t] of SPAIN_TAX_DEFAULTS.entries()) {
      await tx`insert into public.tax_rates (org_id, kind, name, rate_bps, regime, legal_note, is_default, position)
               values (${orgId}, ${t.kind}, ${t.name}, ${t.rate_bps}, ${t.regime}, ${t.legal_note || null}, ${t.is_default}, ${position})`;
    }
    const [vat21] = await tx`select id from public.tax_rates where org_id = ${orgId} and kind = 'vat' and is_default`;

    const stages = Object.fromEntries(
      (await tx`select id, name from public.pipeline_stages where org_id = ${orgId}`).map((s) => [s.name, s.id as string]),
    );
    const sources = (await tx`select id from public.acquisition_sources where org_id = ${orgId}`).map((s) => s.id as string);
    const reasons = (await tx`select id from public.loss_reasons where org_id = ${orgId}`).map((r) => r.id as string);

    // 3. Clientes (con datos fiscales completos: se les factura) y contactos.
    const clientIds: string[] = [];
    for (const c of CLIENTS) {
      const since = daysAgo(int(420, 600));
      const [row] = await tx`
        insert into public.clients (org_id, display_name, legal_name, tax_id, address_line, postal_code, city, province,
                                    sector, owner_member_id, preferred_language, created_at)
        values (${orgId}, ${c.name}, ${`${c.name} SL`}, ${fakeCif()}, ${`${pick(STREETS)}, ${int(1, 140)}`}, ${c.cp}, ${c.city},
                'Barcelona', ${c.sector}, ${pick(memberIds)}, ${c.lang}, ${since})
        returning id`;
      clientIds.push(row!.id);
      const contactsCount = int(1, 2);
      for (let k = 0; k < contactsCount; k++) {
        const person = pick(PEOPLE);
        await tx`
          insert into public.contacts (org_id, client_id, full_name, role, email, phone, is_primary, is_billing)
          values (${orgId}, ${row!.id}, ${person}, ${k === 0 ? "Gerencia" : "Administración"},
                  ${`${person.split(" ")[0]!.toLowerCase()}.${k}@example.com`}, ${`6${int(10_000_000, 99_999_999)}`},
                  ${k === 0}, ${k === contactsCount - 1})`;
      }
    }

    // 4. Deals con su recorrido real por el pipeline (el trigger escribe el historial fechado).
    //    Los ganados son de los clientes con contrato: el cron los pasa a Activo cuando empiezan.
    const OPEN_PATH = ["Lead", "Reunión", "Propuesta enviada", "Negociación"];
    const outcomes = [
      ...CONTRACTS.map((c) => ({ outcome: "won", client: c.client, signed: c.signed_on, title: c.title })),
      ...Array.from({ length: 6 }, () => ({ outcome: "lost" })),
      ...["Lead", "Lead", "Lead", "Reunión", "Reunión", "Reunión", "Propuesta enviada", "Propuesta enviada", "Negociación", "Negociación", "Negociación"].map(
        (outcome) => ({ outcome }),
      ),
    ] as { outcome: string; client?: number; signed?: CivilDate; title?: string }[];

    const dealByClient = new Map<number, string>();
    for (const o of outcomes) {
      const closed = o.outcome === "won" || o.outcome === "lost";
      const created = o.signed
        ? new Date(new Date(`${o.signed}T10:00:00Z`).getTime() - int(20, 50) * DAY)
        : daysAgo(o.outcome === "Lead" ? int(3, 20) : closed ? int(40, 240) : int(15, 90));
      let at = created.getTime();
      const hasMrr = chance(0.6);
      const clientIdx = o.client ?? int(0, clientIds.length - 1);
      await tx`select set_config('app.stage_changed_at', ${new Date(at).toISOString()}, true)`;
      const [deal] = await tx`
        insert into public.deals (org_id, client_id, title, stage_id, est_one_off_cents, est_mrr_cents, source_id,
                                  brought_by_member_id, owner_member_id, created_at)
        values (${orgId}, ${clientIds[clientIdx]!}, ${o.title ?? pick(DEAL_TITLES)}, ${stages["Lead"]!}, ${int(15, 150) * 10_000},
                ${hasMrr ? int(15, 90) * 1_000 : 0}, ${pick(sources)}, ${pick(memberIds)}, ${pick(memberIds)}, ${new Date(at)})
        returning id`;
      const dealId: string = deal!.id;
      const limit = o.signed ? new Date(`${o.signed}T09:00:00Z`).getTime() : now - DAY;
      const move = async (stage: string, extra: { lossReason?: string } = {}) => {
        at = Math.min(at + int(2, 12) * DAY, limit);
        await tx`select set_config('app.stage_changed_at', ${new Date(at).toISOString()}, true)`;
        await tx`update public.deals set stage_id = ${stages[stage]!}, loss_reason_id = ${extra.lossReason ?? null} where id = ${dealId}`;
      };
      if (o.outcome === "won") {
        for (const stage of OPEN_PATH.slice(1)) if (stage !== "Reunión" || chance(0.8)) await move(stage);
        await move("Ganado");
        dealByClient.set(clientIdx, dealId);
      } else if (o.outcome === "lost") {
        for (const stage of OPEN_PATH.slice(1, int(0, 3) + 1)) await move(stage);
        await move("Perdido", { lossReason: pick(reasons) });
      } else {
        for (const stage of OPEN_PATH.slice(1, OPEN_PATH.indexOf(o.outcome) + 1)) await move(stage);
        const due = chance(0.35) ? -int(1, 6) : int(1, 12);
        await tx`update public.deals set next_action = ${pick(["Llamar para cerrar reunión", "Enviar propuesta revisada", "Pedir feedback de la propuesta", "Confirmar fecha de inicio"])},
                 next_action_on = ${isoDate(new Date(now + due * DAY))} where id = ${dealId}`;
      }
    }
    await tx`select set_config('app.stage_changed_at', '', true)`;

    // 5. Actividades (el timeline 360 las mezcla con etapas, contratos, facturas y cobros).
    for (const clientId of clientIds) {
      for (let k = int(2, 4); k > 0; k--) {
        const a = pick(ACTIVITIES);
        await tx`
          insert into public.activities (org_id, client_id, kind, title, occurred_at, member_id)
          values (${orgId}, ${clientId}, ${a.kind}, ${a.title}, ${daysAgo(int(1, 200))}, ${pick(memberIds)})`;
      }
    }

    // 6. Contratos (factura la autónoma; los que se traspasan a la SL, desde el 01/09/2026).
    const lineIds = new Map<string, string>();
    const contractIds: string[] = [];
    for (const c of CONTRACTS) {
      const [contract] = await tx`
        insert into public.contracts (org_id, client_id, deal_id, title, signed_on, payment_method)
        values (${orgId}, ${clientIds[c.client]!}, ${dealByClient.get(c.client) ?? null}, ${c.title}, ${c.signed_on},
                ${chance(0.3) ? "sepa_debit" : "transfer"})
        returning id`;
      contractIds.push(contract!.id);
      await tx`insert into public.contract_issuers (org_id, contract_id, issuer_id, valid_from)
               values (${orgId}, ${contract!.id}, ${freelancer!.id}, ${c.signed_on})`;
      for (const [position, l] of c.lines.entries()) {
        const [line] = await tx`
          insert into public.contract_lines (org_id, contract_id, position, description, billing_type, unit_price_cents,
                                             tax_rate_id, starts_on, ends_on, billing_day, prorate_first)
          values (${orgId}, ${contract!.id}, ${position}, ${l.description}, ${l.billing_type}, ${l.unit_price_cents}, ${vat21!.id},
                  ${l.starts_on ?? null}, null, ${l.billing_type === "monthly" ? (l.billing_day ?? 1) : null}, ${l.prorate_first ?? true})
          returning id`;
        lineIds.set(`${c.client}:${l.description}`, line!.id);
      }
      for (const [i, m] of (c.milestones ?? []).entries()) {
        await tx`insert into public.contract_milestones (org_id, contract_id, position, label, percent_bps, planned_on, auto)
                 values (${orgId}, ${contract!.id}, ${i + 1}, ${m.label}, ${m.percent_bps}, ${m.planned_on}, true)`;
      }
    }
    return { orgId, freelancerId: freelancer!.id as string, slId: sl!.id as string, clientIds, contractIds, lineIds, memberIds };
  });

  // 7. 18 meses de facturación con el motor real: cron el día 1, emisión el día 2 y cobros.
  const { orgId, lineIds, contractIds } = ids;
  const partner = await partnerSession(demoPartners[0]!.email);
  const unpaidClients = new Set([4]); // Maresme Fit: deja de pagar al final (vencidas y recordatorios).
  let issued = 0;
  let rectified = false;

  for (let month = "2025-03-01"; month <= TODAY; month = addMonthsClamped(month, 1)) {
    // Eventos del negocio, en su momento.
    if (month === "2026-01-01") {
      // Subida de precio del SEO de la clínica: versión nueva de la línea (el histórico no cambia).
      await sql`select public.new_line_version(${lineIds.get("1:SEO local")!}, '2026-01-01', '{"unit_price_cents": 49000}'::jsonb)`;
    }
    if (month === "2026-07-01") {
      // Pausa de verano de las redes de la inmobiliaria.
      await sql`insert into public.contract_line_pauses (org_id, line_id, starts_on, ends_on, reason)
                values (${orgId}, ${lineIds.get("2:Gestión de redes sociales")!}, '2026-07-01', '2026-08-31', 'Pausa de verano')`;
    }
    if (month === "2026-06-01") {
      // Baja del gimnasio a fin de junio.
      // Baja del contrato entero: todas sus líneas terminan (el cliente pasa a ex-cliente).
      await sql`update public.contract_lines set ends_on = '2026-06-30', cancelled_on = '2026-06-10', cancel_reason = 'Cierre temporal del gimnasio'
                where id in (${lineIds.get("4:Gestión de Meta Ads")!}, ${lineIds.get("4:Campaña Meta Ads")!})`;
    }
    if (month === "2026-09-01") {
      // La SL ya existe: traspaso de dos contratos desde el 01/09/2026.
      const [transfer] = await sql`
        insert into public.issuer_transfers (org_id, from_issuer_id, to_issuer_id, effective_on, notes)
        values (${orgId}, ${ids.freelancerId}, ${ids.slId}, '2026-09-01', 'Traspaso a GNERAI Demo SL') returning id`;
      for (const clientIdx of [3, 5]) {
        const contractId = contractIds[CONTRACTS.findIndex((c) => c.client === clientIdx)]!;
        await sql`insert into public.contract_issuers (org_id, contract_id, issuer_id, valid_from, transfer_id)
                  values (${orgId}, ${contractId}, ${ids.slId}, '2026-09-01', ${transfer!.id})`;
      }
    }

    // Usos del mes anterior (campañas): pendientes que el cron añade al borrador.
    for (const [clientIdx, c] of CONTRACTS.map((c) => [c.client, c] as const)) {
      for (const l of c.lines.filter((x) => x.usages)) {
        for (const used of l.usages!.filter((u) => u < month && u >= addMonthsClamped(month, -1))) {
          await sql`insert into public.billable_items (org_id, contract_line_id, source, description, quantity, unit_price_cents, amount_cents, billable_on)
                    values (${orgId}, ${lineIds.get(`${clientIdx}:${l.description}`)!}, 'usage', ${`${l.description} · ${used.slice(5, 7)}/${used.slice(0, 4)}`}, 1,
                            ${l.unit_price_cents}, ${l.unit_price_cents}, ${used})`;
        }
      }
    }

    await runBillingForOrg(admin, orgId, { today: month });
    const issueOn = addDays(month, 1);
    if (issueOn > TODAY) break;
    const drafts = await sql`select id, client_id from public.invoices where org_id = ${orgId} and lifecycle = 'draft' order by created_at`;
    for (const d of drafts) {
      await issueInvoiceCore(partner, admin, d.id, issueOn);
      issued += 1;
    }

    // Cobros: casi todos en plazo (± unos días); el gimnasio deja de pagar sus dos últimas.
    const toPay = await sql`
      select i.id, i.client_id, i.total_cents, i.due_on from public.invoices i
      where i.org_id = ${orgId} and i.lifecycle = 'issued' and i.kind = 'ordinary' and i.issued_on = ${issueOn}`;
    for (const inv of toPay) {
      const clientIdx = ids.clientIds.indexOf(inv.client_id);
      if (unpaidClients.has(clientIdx) && month >= "2026-05-01") continue;
      const paidOn = addDays(isoDate(new Date(inv.due_on)), int(-12, 9));
      if (paidOn >= TODAY) continue;
      // El hotel paga agosto a medias.
      const amount = clientIdx === 5 && month === "2026-08-01" ? Math.round(Number(inv.total_cents) / 2) : Number(inv.total_cents);
      await sql`insert into public.payments (org_id, invoice_id, amount_cents, paid_on, method, reference, created_by)
                values (${orgId}, ${inv.id}, ${amount}, ${paidOn}, ${chance(0.25) ? "sepa_debit" : "transfer"}, 'Transferencia recibida', ${demoPartners[0]!.id})`;
    }

    // Foto del mes anterior, tomada el día 1 como haría el cron (la del primer mes no: no hay datos).
    if (month > "2025-03-01") await saveMonthSnapshot(admin, orgId, previousMonth(month), { today: month });

    // Una factura anulada con rectificativa y sus periodos refacturados (febrero de 2026).
    if (month === "2026-02-01" && !rectified) {
      const [target] = await sql`
        select i.id from public.invoices i where i.org_id = ${orgId} and i.issued_on = ${issueOn} and i.client_id = ${ids.clientIds[1]!} limit 1`;
      if (target) {
        await sql`delete from public.payments where invoice_id = ${target.id}`;
        const { data: rectId, error } = await partner.rpc("create_rectification", {
          p_invoice_id: target.id,
          p_reason: "Importe de la campaña duplicado",
          p_full: true,
        });
        if (error) throw error;
        await issueInvoiceCore(partner, admin, rectId, addDays(issueOn, 2));
        const released = await partner.rpc("release_invoice_items", { p_invoice_id: target.id, p_waive: false });
        if (released.error) throw released.error;
        rectified = true;
      }
    }
  }

  // 8. Hoy: los avisos y recordatorios de ahora (los de meses pasados ya no interesan) y los
  //    borradores del mes en curso sin emitir, para probar la emisión en bloque.
  const monthStart = `${TODAY.slice(0, 8)}01`;
  for (const [clientIdx, c] of CONTRACTS.map((c) => [c.client, c] as const)) {
    for (const l of c.lines.filter((x) => x.usages)) {
      for (const used of l.usages!.filter((u) => u >= monthStart && u <= TODAY)) {
        await sql`insert into public.billable_items (org_id, contract_line_id, source, description, quantity, unit_price_cents, amount_cents, billable_on)
                  values (${orgId}, ${lineIds.get(`${clientIdx}:${l.description}`)!}, 'usage', ${`${l.description} · ${used.slice(5, 7)}/${used.slice(0, 4)}`}, 1,
                          ${l.unit_price_cents}, ${l.unit_price_cents}, ${used})`;
      }
    }
  }
  await sql`delete from public.notifications where org_id = ${orgId}`;
  await sql`delete from public.outbound_emails where org_id = ${orgId}`;
  const final = await runBillingForOrg(admin, orgId, { today: TODAY });

  const [counts] = await sql`
    select (select count(*) from public.clients where org_id = ${orgId})::int as clients,
           (select count(*) from public.deals where org_id = ${orgId})::int as deals,
           (select count(*) from public.contracts where org_id = ${orgId})::int as contracts,
           (select count(*) from public.invoices where org_id = ${orgId} and lifecycle = 'issued')::int as issued,
           (select count(*) from public.invoices where org_id = ${orgId} and lifecycle = 'draft')::int as drafts,
           (select count(*) from public.payments where org_id = ${orgId})::int as payments,
           (select count(*) from public.invoices_overview where org_id = ${orgId} and status = 'overdue')::int as overdue`;
  console.log(
    `Demo lista: ${counts!.clients} clientes, ${counts!.deals} deals, ${counts!.contracts} contratos, ` +
      `${counts!.issued} facturas emitidas (${issued} en la simulación), ${counts!.drafts} borradores, ` +
      `${counts!.payments} cobros y ${counts!.overdue} vencidas. Hoy: ${final.notifications} avisos y ${final.emails} recordatorios por aprobar.`,
  );
  console.log(`Miembros: owners de las demás orgs${emailArgs.length ? ` + ${emailArgs.join(", ")}` : ""} + 2 socios ficticios. Ábrela en /demo.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
