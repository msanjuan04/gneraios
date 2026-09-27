/**
 * Finanzas de la org demo: proveedores, suscripciones (software, gestoría, coworking y después
 * oficina, seguro, banco, la compensación entre socios y, con la SL, su retribución), gastos
 * sueltos (freelances con retención, publicidad, equipos, formación, dietas…), dos cuentas de caja
 * con su saldo de cada fin de mes y las participaciones de la SL.
 *
 *   pnpm exec tsx --env-file-if-exists=.env.local scripts/seed-demo-finance.ts
 *
 * Necesita la org `demo` de `pnpm db:seed:demo` (y se vuelve a ejecutar después de recrearla).
 *
 * - Los gastos de las suscripciones NO se insertan a mano: se generan con el motor real
 *   (generateSubscriptionExpenses), por tramos, aplicando en su fecha los cambios de precio y el
 *   traspaso de pagador a la SL (01/09/2026), igual que haría el cron día a día.
 * - Los saldos de caja son coherentes con la demo: saldo inicial + cobros de sus facturas − gastos
 *   pagados − IVA y retenciones de cada trimestre (en su plazo, con la misma estimación que la app)
 *   − lo que la autónoma retira para vivir. Uno por fin de mes y, este mes, uno a mitad.
 *
 * Es determinista (misma semilla y mismo día → mismos datos) y re-ejecutable: borra las finanzas
 * de la demo y los restos de demos anteriores (seed-demo.ts recrea la org con otro id), y las
 * vuelve a crear. Solo contra la base local: se niega a conectarse a cualquier otro host.
 */
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { addDays, addMonthsClamped, compareCivil, maxCivil, minCivil, type CivilDate } from "../src/domain/dates/civil-date";
import { computeExpenseAmounts } from "../src/domain/finance/expense";
import { estimateVatQuarter, estimateWithholdingsQuarter, quartersDueBetween, type TaxAmountRow } from "../src/domain/finance/tax";
import { validateIban, validateSpanishTaxId } from "../src/domain/tax-id";
import { nowInZone } from "../src/lib/clock";
import type { Database } from "../src/lib/supabase/database.types";

const DATABASE_URL = process.env.SEED_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const API_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SECRET = process.env.SUPABASE_SECRET_KEY ?? "";
const LOCAL = ["127.0.0.1", "localhost", "::1"];
for (const target of [DATABASE_URL, API_URL]) {
  const host = target ? new URL(target).hostname : "";
  if (!LOCAL.includes(host)) {
    console.error(`Solo se siembra la base local; «${host || "sin URL"}» no lo es (¿falta .env.local?).`);
    process.exit(1);
  }
}

// PRNG determinista (mulberry32), con otra semilla que la del resto de la demo.
let seed = 20260927;
function rand(): number {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

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

const TODAY: CivilDate = nowInZone("Europe/Madrid").date;
/** La demo factura desde marzo de 2025: los gastos y la caja empiezan con ella. */
const START: CivilDate = "2025-03-01";
/** La SL empieza a pagar el 01/09/2026 (el día de su alta en la demo). */
const SL_FROM: CivilDate = "2026-09-01";

const FINANCE_TABLES = ["expenses", "expense_subscriptions", "cash_balances", "cash_accounts", "shareholdings", "vendors"];

type PaymentMethod = "transfer" | "sepa_debit" | "card" | "cash" | "other";
type Payer = "laia" | "sl";

const CATEGORIES: Record<string, { group: string; fixed: boolean }> = {
  "Software y suscripciones": { group: "operating", fixed: true },
  "Freelances y colaboradores": { group: "cost_of_sales", fixed: false },
  "Compras para clientes": { group: "cost_of_sales", fixed: false },
  "Publicidad propia": { group: "operating", fixed: false },
  "Oficina y coworking": { group: "operating", fixed: true },
  "Gestoría y asesoría": { group: "operating", fixed: true },
  Seguros: { group: "operating", fixed: true },
  Formación: { group: "operating", fixed: false },
  "Equipos y material": { group: "operating", fixed: false },
  "Viajes y dietas": { group: "operating", fixed: false },
  "Bancos y comisiones": { group: "financial", fixed: true },
  "Retribución de socios": { group: "partner_compensation", fixed: true },
  "Cuotas de autónomos": { group: "partner_compensation", fixed: true },
  "Impuestos y tasas": { group: "taxes", fixed: false },
};

/** Proveedores: los de fuera (inversión del sujeto pasivo o no sujetos) sin IVA español. */
const VENDORS: { key: string; name: string; country: string; taxId?: "cif" | "nif"; category: string }[] = [
  { key: "google", name: "Google Cloud EMEA Ltd", country: "IE", category: "Software y suscripciones" },
  { key: "adobe", name: "Adobe Systems Software Ireland", country: "IE", category: "Software y suscripciones" },
  { key: "figma", name: "Figma Inc", country: "US", category: "Software y suscripciones" },
  { key: "notion", name: "Notion Labs Inc", country: "US", category: "Software y suscripciones" },
  { key: "semrush", name: "Semrush Inc", country: "US", category: "Software y suscripciones" },
  { key: "raiola", name: "Raiola Networks SL", country: "ES", taxId: "cif", category: "Software y suscripciones" },
  { key: "gestor", name: "Jordi Batlle Assessor", country: "ES", taxId: "nif", category: "Gestoría y asesoría" },
  { key: "cowork", name: "Espai Cowork Mataró SL", country: "ES", taxId: "cif", category: "Oficina y coworking" },
  { key: "landlord", name: "Montserrat Riera Puig", country: "ES", taxId: "nif", category: "Oficina y coworking" },
  { key: "insurer", name: "Assegurances Costa SL", country: "ES", taxId: "cif", category: "Seguros" },
  { key: "bank", name: "Banc Demo Maresme", country: "ES", taxId: "cif", category: "Bancos y comisiones" },
  { key: "pau", name: "Pau Demo Soler", country: "ES", taxId: "nif", category: "Retribución de socios" },
  { key: "tgss", name: "Tesorería General de la Seguridad Social", country: "ES", category: "Cuotas de autónomos" },
  { key: "oriol", name: "Oriol Pons Dev", country: "ES", taxId: "nif", category: "Freelances y colaboradores" },
  { key: "clara", name: "Clara Font Studio", country: "ES", taxId: "nif", category: "Freelances y colaboradores" },
  { key: "aerial", name: "Aerial Maresme SL", country: "ES", taxId: "cif", category: "Freelances y colaboradores" },
  { key: "meta", name: "Meta Platforms Ireland Ltd", country: "IE", category: "Publicidad propia" },
  { key: "gads", name: "Google Ireland Ltd", country: "IE", category: "Publicidad propia" },
  { key: "envato", name: "Envato Pty Ltd", country: "AU", category: "Compras para clientes" },
  { key: "apple", name: "Apple Retail Spain SL", country: "ES", taxId: "cif", category: "Equipos y material" },
  { key: "pccomp", name: "Componentes Maresme SL", country: "ES", taxId: "cif", category: "Equipos y material" },
  { key: "school", name: "Escola Digital Online SL", country: "ES", taxId: "cif", category: "Formación" },
  { key: "renfe", name: "Viajes y restauración", country: "ES", category: "Viajes y dietas" },
  { key: "council", name: "Ajuntament de Mataró", country: "ES", category: "Impuestos y tasas" },
];

type SubscriptionSeed = {
  key: string;
  vendor: string;
  description: string;
  payer: Payer;
  base: number;
  vatBps: number;
  irpfBps?: number;
  interval?: "monthly" | "yearly";
  startsOn: CivilDate;
  endsOn?: CivilDate;
  billingDay?: number;
  method: PaymentMethod;
  member?: "laia" | "pau";
  category?: string;
};

const SUBSCRIPTIONS: SubscriptionSeed[] = [
  { key: "workspace", vendor: "google", description: "Google Workspace", payer: "laia", base: 2_720, vatBps: 0, startsOn: "2025-03-01", billingDay: 1, method: "card" },
  { key: "adobe", vendor: "adobe", description: "Adobe Creative Cloud", payer: "laia", base: 6_049, vatBps: 0, startsOn: "2025-03-12", billingDay: 12, method: "card" },
  { key: "figma", vendor: "figma", description: "Figma Professional", payer: "laia", base: 1_500, vatBps: 0, startsOn: "2025-05-05", billingDay: 5, method: "card" },
  { key: "notion", vendor: "notion", description: "Notion Plus", payer: "laia", base: 1_000, vatBps: 0, startsOn: "2025-03-20", endsOn: "2026-03-19", billingDay: 20, method: "card" },
  { key: "semrush", vendor: "semrush", description: "Semrush Pro", payer: "laia", base: 11_995, vatBps: 0, startsOn: "2025-06-08", billingDay: 8, method: "card" },
  { key: "hosting", vendor: "raiola", description: "Hosting y dominios de las webs", payer: "laia", base: 24_000, vatBps: 2100, interval: "yearly", startsOn: "2025-03-15", method: "card" },
  { key: "gestoria", vendor: "gestor", description: "Asesoría fiscal y contable", payer: "laia", base: 9_000, vatBps: 2100, irpfBps: 1500, startsOn: "2025-03-01", billingDay: 1, method: "transfer" },
  { key: "cowork", vendor: "cowork", description: "Coworking · dos puestos", payer: "laia", base: 18_000, vatBps: 2100, startsOn: "2025-03-01", endsOn: "2025-12-31", billingDay: 1, method: "card" },
  { key: "office", vendor: "landlord", description: "Alquiler de la oficina", payer: "laia", base: 45_000, vatBps: 2100, irpfBps: 1900, startsOn: "2026-01-01", billingDay: 1, method: "transfer" },
  { key: "insurance", vendor: "insurer", description: "Seguro de responsabilidad civil profesional", payer: "laia", base: 32_000, vatBps: 0, interval: "yearly", startsOn: "2025-04-01", method: "sepa_debit" },
  { key: "bank", vendor: "bank", description: "Comisiones de la cuenta", payer: "laia", base: 800, vatBps: 0, startsOn: "2025-03-28", billingDay: 28, method: "sepa_debit" },
  { key: "bank-sl", vendor: "bank", description: "Comisiones de la cuenta de la SL", payer: "sl", base: 1_500, vatBps: 0, startsOn: "2026-09-28", billingDay: 28, method: "sepa_debit" },
  // Antes de la SL, la autónoma factura y compensa a su socio por su parte del trabajo (él le factura).
  { key: "pau-comp", vendor: "pau", description: "Compensación a Pau por su parte del trabajo", payer: "laia", base: 60_000, vatBps: 2100, irpfBps: 1500, startsOn: "2025-03-28", endsOn: "2026-08-31", billingDay: 28, method: "transfer", member: "pau" },
  // Tarifa plana el primer año de alta (2025); la cuota normal desde enero de 2026 (cambio de precio).
  { key: "cuota-laia", vendor: "tgss", description: "Cuota de autónomos (RETA)", payer: "laia", base: 8_000, vatBps: 0, startsOn: "2025-03-31", billingDay: 31, method: "sepa_debit", member: "laia" },
  // Con la SL, la retribución de las dos socias administradoras (retención del 19 %).
  { key: "sl-laia", vendor: "tgss", description: "Retribución de Laia (administradora)", payer: "sl", base: 100_000, vatBps: 0, irpfBps: 1900, startsOn: "2026-09-30", billingDay: 30, method: "transfer", member: "laia", category: "Retribución de socios" },
  { key: "sl-pau", vendor: "tgss", description: "Retribución de Pau (administrador)", payer: "sl", base: 100_000, vatBps: 0, irpfBps: 1900, startsOn: "2026-09-30", billingDay: 30, method: "transfer", member: "pau", category: "Retribución de socios" },
];

type ExpenseSeed = {
  on: CivilDate;
  vendor: string;
  description: string;
  base: number;
  vatBps: number;
  irpfBps?: number;
  deductible?: boolean;
  payer?: Payer;
  /** Días hasta el vencimiento (0 = el mismo día). */
  dueDays?: number;
  /** Días después del vencimiento en que se pagó; null = sin pagar. */
  paidAfter?: number | null;
  method?: PaymentMethod;
  number?: string;
};

function manualExpenses(): ExpenseSeed[] {
  const list: ExpenseSeed[] = [
    // Freelances (profesionales: les retenemos el 15 %).
    { on: "2025-03-18", vendor: "clara", description: "Diseño de la web de Can Sorra", base: 90_000, vatBps: 2100, irpfBps: 1500, dueDays: 30, paidAfter: -2, number: "CF-2025-011" },
    { on: "2025-04-10", vendor: "oriol", description: "Desarrollo web Can Sorra", base: 120_000, vatBps: 2100, irpfBps: 1500, dueDays: 30, paidAfter: 3, number: "2025/014" },
    { on: "2025-07-22", vendor: "aerial", description: "Grabación con dron · Hotel Llevant", base: 60_000, vatBps: 2100, dueDays: 15, paidAfter: 0, number: "AM-0457" },
    { on: "2025-10-06", vendor: "clara", description: "Piezas para la campaña de Meta Ads", base: 45_000, vatBps: 2100, irpfBps: 1500, dueDays: 30, paidAfter: 5, number: "CF-2025-046" },
    { on: "2025-12-15", vendor: "clara", description: "Diseño de la tienda online", base: 110_000, vatBps: 2100, irpfBps: 1500, dueDays: 30, paidAfter: 1, number: "CF-2025-061" },
    { on: "2026-01-28", vendor: "oriol", description: "Desarrollo Shopify · fase 1", base: 240_000, vatBps: 2100, irpfBps: 1500, dueDays: 30, paidAfter: 4, number: "2026/003" },
    { on: "2026-03-05", vendor: "oriol", description: "Desarrollo Shopify · fase 2", base: 180_000, vatBps: 2100, irpfBps: 1500, dueDays: 30, paidAfter: 2, number: "2026/009" },
    { on: "2026-03-20", vendor: "clara", description: "Web corporativa de Tallers Rius", base: 75_000, vatBps: 2100, irpfBps: 1500, dueDays: 30, paidAfter: 0, number: "CF-2026-012" },
    { on: "2026-06-12", vendor: "oriol", description: "Integración del sistema de reservas", base: 98_000, vatBps: 2100, irpfBps: 1500, dueDays: 30, paidAfter: 6, number: "2026/021" },
    // Uno vencido sin pagar y uno por pagar, para que la lista y la previsión tengan de todo.
    { on: "2026-08-20", vendor: "clara", description: "Rediseño de marca · anticipo", base: 60_000, vatBps: 2100, irpfBps: 1500, dueDays: 31, paidAfter: null, number: "CF-2026-033" },
    { on: "2026-09-10", vendor: "oriol", description: "Landing de captación · Acadèmia Babel", base: 125_000, vatBps: 2100, irpfBps: 1500, payer: "sl", dueDays: 30, paidAfter: null, number: "2026/030" },
    // Equipos, formación, dietas y tasas.
    { on: "2025-10-14", vendor: "apple", description: "MacBook Air 15\"", base: 156_942, vatBps: 2100, method: "card", number: "R-APL-88213" },
    { on: "2026-02-03", vendor: "pccomp", description: "Monitor 27\" 4K", base: 28_843, vatBps: 2100, method: "card", number: "PCM-26-0192" },
    { on: "2026-01-19", vendor: "school", description: "Curso de SEO técnico", base: 29_000, vatBps: 0, method: "card", number: "EDO-3391" },
    { on: "2025-11-13", vendor: "renfe", description: "Dietas · evento de marketing en Barcelona", base: 5_818, vatBps: 1000, deductible: false, method: "card" },
    { on: "2026-05-21", vendor: "renfe", description: "Tren y comida · reunión en Calella", base: 3_500, vatBps: 1000, deductible: false, method: "card" },
    { on: "2025-06-30", vendor: "council", description: "Tasa municipal de actividad", base: 8_500, vatBps: 0, method: "sepa_debit" },
    { on: "2026-06-30", vendor: "council", description: "Tasa municipal de actividad", base: 8_800, vatBps: 0, method: "sepa_debit" },
  ];
  // Publicidad propia (Meta y Google, inversión del sujeto pasivo: sin IVA español), por campañas.
  for (const month of ["2025-04", "2025-05", "2025-09", "2025-10", "2025-11", "2026-02", "2026-03", "2026-04", "2026-09"]) {
    list.push({ on: `${month}-${String(int(24, 28))}`, vendor: "meta", description: "Campaña de captación en Meta Ads", base: int(60, 220) * 100 + int(0, 99), vatBps: 0, method: "card" });
  }
  for (const month of ["2025-06", "2026-05"]) {
    list.push({ on: `${month}-27`, vendor: "gads", description: "Google Ads · búsqueda de marca", base: int(80, 180) * 100, vatBps: 0, method: "card" });
  }
  // Recursos para clientes (fotos y plantillas) de vez en cuando.
  for (const month of ["2025-05", "2025-08", "2025-11", "2026-02", "2026-05", "2026-08"]) {
    list.push({ on: `${month}-${String(int(10, 20))}`, vendor: "envato", description: "Fotos y plantillas para clientes", base: int(29, 59) * 100, vatBps: 0, method: "card" });
  }
  return list.filter((e) => compareCivil(e.on, TODAY) <= 0);
}

/** Lo que la autónoma retira cada mes de la cuenta de su actividad para vivir (no es un gasto). */
const MONTHLY_DRAW = 15_000;
const LAIA_OPENING = { on: "2025-02-28", cents: 900_000 };
const SL_OPENING = { on: SL_FROM, cents: 800_000 };

const sql = postgres(DATABASE_URL, { onnotice: () => {} });
const admin = createClient<Database>(API_URL, SECRET, { auth: { persistSession: false, autoRefreshToken: false } });

async function main() {
  const { generateSubscriptionExpenses } = await import("../src/server/finance/generate");
  const { getFinanceSnapshot } = await import("../src/server/finance/snapshot");
  if (!SECRET) throw new Error("Falta SUPABASE_SECRET_KEY: ejecuta con .env.local.");

  const [org] = await sql`select id from public.orgs where slug = 'demo'`;
  if (!org) throw new Error("No existe la org demo: ejecuta antes pnpm db:seed:demo.");
  const orgId: string = org.id;

  // 0. Fuera las finanzas de la demo y los restos de demos anteriores (sin triggers, como
  //    seed-demo.ts: el trigger que protege lo generado y la auditoría no intervienen).
  const { data: files } = await admin.storage.from("expenses").list(orgId, { limit: 1000 });
  if (files?.length) await admin.storage.from("expenses").remove(files.map((f) => `${orgId}/${f.name}`));
  await sql.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    for (const table of FINANCE_TABLES) {
      await tx.unsafe(`delete from public.${table} where org_id = $1 or org_id not in (select id from public.orgs)`, [orgId]);
    }
    await tx`delete from public.expense_categories where org_id not in (select id from public.orgs)`;
    await tx`delete from public.audit_log where org_id = ${orgId} and table_name = any(${FINANCE_TABLES})`;
  });

  // 1. Emisores, socios y categorías (las que falten, con los valores por defecto).
  const issuers = await sql`select id, kind from public.issuers where org_id = ${orgId}`;
  const payerId: Record<Payer, string> = {
    laia: issuers.find((i) => i.kind === "self_employed")?.id,
    sl: issuers.find((i) => i.kind === "company")?.id,
  };
  if (!payerId.laia || !payerId.sl) throw new Error("La demo no tiene la autónoma y la SL: vuelve a ejecutar pnpm db:seed:demo.");
  const members = await sql`select id, full_name from public.members where org_id = ${orgId}`;
  const memberId = {
    laia: members.find((m) => m.full_name === "Laia Demo")?.id as string | undefined,
    pau: members.find((m) => m.full_name === "Pau Demo")?.id as string | undefined,
  };
  if (!memberId.laia || !memberId.pau) throw new Error("Faltan los socios ficticios de la demo: vuelve a ejecutar pnpm db:seed:demo.");

  const existing = await sql`select id, name from public.expense_categories where org_id = ${orgId} and archived_at is null`;
  const categoryId = new Map<string, string>(existing.map((c) => [c.name as string, c.id as string]));
  for (const [name, def] of Object.entries(CATEGORIES)) {
    if (categoryId.has(name)) continue;
    const [row] = await sql`
      insert into public.expense_categories (org_id, name, expense_group, is_fixed, position)
      values (${orgId}, ${name}, ${def.group}, ${def.fixed}, 100) returning id`;
    categoryId.set(name, row!.id);
  }
  const cat = (name: string) => categoryId.get(name)!;

  // 2. Proveedores.
  const vendorId = new Map<string, string>();
  const vendorCategory = new Map<string, string>();
  for (const v of VENDORS) {
    const taxId = v.taxId === "cif" ? fakeCif() : v.taxId === "nif" ? fakeNif() : null;
    const [row] = await sql`
      insert into public.vendors (org_id, name, tax_id, country_code, default_category_id)
      values (${orgId}, ${v.name}, ${taxId}, ${v.country}, ${cat(v.category)}) returning id`;
    vendorId.set(v.key, row!.id);
    vendorCategory.set(v.key, v.category);
  }

  // 3. Suscripciones, generadas por tramos con el motor real y los cambios en su fecha.
  const subscriptionId = new Map<string, string>();
  for (const s of SUBSCRIPTIONS) {
    const interval = s.interval ?? "monthly";
    const [row] = await sql`
      insert into public.expense_subscriptions (org_id, issuer_id, vendor_id, category_id, member_id, description, base_cents,
                                                vat_bps, irpf_bps, billing_interval, starts_on, ends_on, billing_day, payment_method)
      values (${orgId}, ${payerId[s.payer]}, ${vendorId.get(s.vendor)!}, ${cat(s.category ?? vendorCategory.get(s.vendor)!)},
              ${s.member ? memberId[s.member]! : null}, ${s.description}, ${s.base}, ${s.vatBps}, ${s.irpfBps ?? 0}, ${interval},
              ${s.startsOn}, ${s.endsOn ?? null}, ${interval === "monthly" ? (s.billingDay ?? 1) : null}, ${s.method})
      returning id`;
    subscriptionId.set(s.key, row!.id);
  }
  const generate = async (until: CivilDate) => {
    if (compareCivil(until, TODAY) > 0) until = TODAY;
    return (await generateSubscriptionExpenses(admin, orgId, until)).created;
  };
  let generated = 0;
  generated += await generate("2025-12-31");
  // Enero de 2026: se acaba la tarifa plana de autónomos.
  await sql`update public.expense_subscriptions set base_cents = 29_400 where id = ${subscriptionId.get("cuota-laia")!}`;
  generated += await generate("2026-03-31");
  // Abril de 2026: una tercera cuenta de Google Workspace.
  await sql`update public.expense_subscriptions set base_cents = 4_080 where id = ${subscriptionId.get("workspace")!}`;
  generated += await generate(addDays(SL_FROM, -1));
  // Septiembre de 2026: la SL pasa a pagar el software, la oficina y la gestoría (más cara con la SL).
  await sql`update public.expense_subscriptions set issuer_id = ${payerId.sl}
            where id in ${sql([subscriptionId.get("workspace")!, subscriptionId.get("adobe")!, subscriptionId.get("figma")!, subscriptionId.get("semrush")!, subscriptionId.get("office")!])}`;
  await sql`update public.expense_subscriptions set issuer_id = ${payerId.sl}, base_cents = 18_000 where id = ${subscriptionId.get("gestoria")!}`;
  generated += await generate(TODAY);

  // Las de transferencia nacen pendientes: se pagaron unos días después (las de los últimos días, aún no).
  const pendingGenerated = await sql`
    select id, issued_on from public.expenses
    where org_id = ${orgId} and source = 'subscription' and paid_on is null order by issued_on, id`;
  for (const row of pendingGenerated) {
    const issued = (row.issued_on as Date).toISOString().slice(0, 10);
    const paidOn = addDays(issued, int(1, 5));
    if (compareCivil(paidOn, TODAY) >= 0) continue;
    await sql`update public.expenses set paid_on = ${paidOn} where id = ${row.id}`;
  }

  // 4. Gastos sueltos (con su justificante en papel: aquí sin fichero).
  const manual = manualExpenses();
  for (const e of manual) {
    const amounts = computeExpenseAmounts({ baseCents: e.base, vatBps: e.vatBps, irpfBps: e.irpfBps ?? 0 });
    const payer: Payer = e.payer ?? (compareCivil(e.on, SL_FROM) >= 0 ? "sl" : "laia");
    const dueOn = e.dueDays ? addDays(e.on, e.dueDays) : null;
    // Pagado unos días antes o después del vencimiento (con tarjeta, el mismo día), nunca antes de la factura ni hoy.
    const paidOn = e.paidAfter === null ? null : maxCivil(e.on, minCivil(addDays(dueOn ?? e.on, e.paidAfter ?? 0), addDays(TODAY, -1)));
    await sql`
      insert into public.expenses (org_id, issuer_id, vendor_id, category_id, description, vendor_invoice_number, issued_on, due_on,
                                   base_cents, vat_bps, vat_cents, vat_deductible, irpf_bps, irpf_cents, total_cents, paid_on,
                                   payment_method, source)
      values (${orgId}, ${payerId[payer]}, ${vendorId.get(e.vendor)!}, ${cat(vendorCategory.get(e.vendor)!)}, ${e.description},
              ${e.number ?? null}, ${e.on}, ${dueOn}, ${amounts.baseCents}, ${e.vatBps}, ${amounts.vatCents}, ${e.deductible ?? true},
              ${e.irpfBps ?? 0}, ${amounts.irpfCents}, ${amounts.totalCents}, ${paidOn}, ${e.method ?? "transfer"},
              ${e.method === "card" ? "import" : "manual"})`;
  }

  // 5. Caja: una cuenta de la autónoma (desde el principio) y otra de la SL (desde su alta).
  const [laiaAccount] = await sql`
    insert into public.cash_accounts (org_id, issuer_id, name, iban) values (${orgId}, ${payerId.laia}, 'Cuenta de la actividad · Laia', ${fakeIban()})
    returning id`;
  const [slAccount] = await sql`
    insert into public.cash_accounts (org_id, issuer_id, name, iban) values (${orgId}, ${payerId.sl}, 'Cuenta de GNERAI Demo SL', ${fakeIban()})
    returning id`;

  // Movimientos de cada emisor: cobros de sus facturas, gastos pagados, impuestos en su plazo y retiradas.
  const flows: Record<Payer, { on: CivilDate; cents: number }[]> = { laia: [], sl: [] };
  const payerOf = (issuerId: string): Payer => (issuerId === payerId.sl ? "sl" : "laia");
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  for (const p of await sql`
    select p.paid_on, p.amount_cents, i.issuer_id from public.payments p join public.invoices i on i.id = p.invoice_id where p.org_id = ${orgId}`) {
    flows[payerOf(p.issuer_id)].push({ on: iso(p.paid_on), cents: Number(p.amount_cents) });
  }
  for (const e of await sql`select issuer_id, paid_on, total_cents from public.expenses where org_id = ${orgId} and paid_on is not null`) {
    flows[payerOf(e.issuer_id)].push({ on: iso(e.paid_on), cents: -Number(e.total_cents) });
  }
  const outputVat: TaxAmountRow[] = (
    await sql`select issuer_id, issued_on, vat_cents from public.invoices where org_id = ${orgId} and lifecycle = 'issued'`
  ).map((r) => ({ issuerId: r.issuer_id, on: iso(r.issued_on), cents: Number(r.vat_cents) }));
  const expenseTaxes = await sql`
    select issuer_id, issued_on, vat_cents, vat_deductible, irpf_cents from public.expenses where org_id = ${orgId}`;
  const inputVat: TaxAmountRow[] = expenseTaxes
    .filter((r) => r.vat_deductible)
    .map((r) => ({ issuerId: r.issuer_id, on: iso(r.issued_on), cents: Number(r.vat_cents) }));
  const withheld: TaxAmountRow[] = expenseTaxes.map((r) => ({ issuerId: r.issuer_id, on: iso(r.issued_on), cents: Number(r.irpf_cents) }));
  let taxesPaid = 0;
  for (const q of quartersDueBetween(START, addDays(TODAY, -1))) {
    const vat = estimateVatQuarter(q, outputVat, inputVat);
    const irpf = estimateWithholdingsQuarter(q, withheld);
    for (const issuer of vat.issuers) if (issuer.payableCents > 0) flows[payerOf(issuer.issuerId)].push({ on: vat.dueOn, cents: -issuer.payableCents });
    for (const issuer of irpf.issuers) flows[payerOf(issuer.issuerId)].push({ on: irpf.dueOn, cents: -issuer.withheldCents });
    taxesPaid += vat.payableCents + irpf.totalCents;
  }
  for (let month = START; compareCivil(month, TODAY) <= 0; month = addMonthsClamped(month, 1)) {
    const on = `${month.slice(0, 8)}05`;
    if (compareCivil(on, TODAY) < 0) flows.laia.push({ on, cents: -MONTHLY_DRAW });
  }

  const balanceOn = (payer: Payer, opening: { on: CivilDate; cents: number }, on: CivilDate) =>
    flows[payer].filter((f) => compareCivil(f.on, opening.on) > 0 && compareCivil(f.on, on) <= 0).reduce((sum, f) => sum + f.cents, opening.cents);

  const balances: { account: string; on: CivilDate; cents: number; source: "manual" | "import"; note: string | null }[] = [
    { account: laiaAccount!.id, on: LAIA_OPENING.on, cents: LAIA_OPENING.cents, source: "manual", note: "Saldo inicial" },
  ];
  const lastClosed = addDays(`${TODAY.slice(0, 8)}01`, -1);
  for (let month = START; compareCivil(month, lastClosed) <= 0; month = addMonthsClamped(month, 1)) {
    const end = addDays(addMonthsClamped(month, 1), -1);
    balances.push({ account: laiaAccount!.id, on: end, cents: balanceOn("laia", LAIA_OPENING, end), source: "import", note: "Extracto de fin de mes" });
  }
  if (compareCivil(SL_FROM, TODAY) <= 0) {
    balances.push({ account: slAccount!.id, on: SL_FROM, cents: balanceOn("sl", { on: addDays(SL_FROM, -1), cents: SL_OPENING.cents }, SL_FROM), source: "manual", note: "Capital social y aportación de los socios" });
    const mid = minCivil(addDays(SL_FROM, 14), addDays(TODAY, -1));
    if (compareCivil(mid, SL_FROM) > 0) {
      balances.push({ account: slAccount!.id, on: mid, cents: balanceOn("sl", { on: addDays(SL_FROM, -1), cents: SL_OPENING.cents }, mid), source: "manual", note: null });
    }
  }
  for (const b of balances) {
    await sql`insert into public.cash_balances (org_id, account_id, balance_on, balance_cents, source, note)
              values (${orgId}, ${b.account}, ${b.on}, ${b.cents}, ${b.source}, ${b.note})`;
  }

  // 6. Participaciones de la SL desde su alta: mitad y mitad (el 100 % se comprueba al confirmar).
  await sql.begin(async (tx) => {
    await tx`insert into public.shareholdings (org_id, member_id, percent_bps, valid_from) values
             (${orgId}, ${memberId.laia!}, 5000, ${SL_FROM}), (${orgId}, ${memberId.pau!}, 5000, ${SL_FROM})`;
  });

  // Resumen con la misma foto que pinta /finance.
  const snapshot = await getFinanceSnapshot(admin, orgId, TODAY);
  const [counts] = await sql`
    select (select count(*) from public.expenses where org_id = ${orgId})::int as expenses,
           (select count(*) from public.expenses where org_id = ${orgId} and source = 'subscription')::int as generated,
           (select count(*) from public.expense_subscriptions where org_id = ${orgId})::int as subscriptions,
           (select count(*) from public.vendors where org_id = ${orgId})::int as vendors,
           (select count(*) from public.cash_balances where org_id = ${orgId})::int as balances,
           (select count(*) from public.expenses_overview where org_id = ${orgId} and status = 'overdue')::int as overdue`;
  const eur = (cents: number) => `${(cents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
  const minLaia = balances.filter((b) => b.account === laiaAccount!.id).reduce((min, b) => Math.min(min, b.cents), Number.POSITIVE_INFINITY);
  console.log(
    `Finanzas de la demo listas: ${counts!.expenses} gastos (${counts!.generated} de ${counts!.subscriptions} suscripciones, ${generated} generados ahora), ` +
      `${counts!.vendors} proveedores, ${counts!.balances} saldos en 2 cuentas y ${counts!.overdue} gasto vencido.`,
  );
  console.log(
    `Caja hoy ${eur(snapshot.cash.estimatedCents)} (saldo mínimo de la autónoma ${eur(minLaia)}; impuestos ya ingresados ${eur(taxesPaid)}). ` +
      `Gasto medio ${snapshot.burn ? eur(snapshot.burn.expensesCents) : "—"}/mes, costes fijos ${eur(snapshot.fixedCosts.monthlyCents)}/mes, ` +
      `runway ${snapshot.runwayMonths ?? "—"} meses. Previsión a ${snapshot.forecast.days} días: ${eur(snapshot.forecast.endCents)} ` +
      `(mínimo ${eur(snapshot.forecast.minCents)} el ${snapshot.forecast.minOn}). Ábrelo en /demo/finance.`,
  );
  for (const q of snapshot.taxes.quarters) {
    console.log(`  IVA ${q.key} (plazo ${q.dueOn}): ${eur(q.vat.payableCents)} · retenciones ${eur(q.withholdings.totalCents)} (estimación)`);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
