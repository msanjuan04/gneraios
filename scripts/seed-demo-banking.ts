/**
 * Banco de la org demo: los extractos de sus dos cuentas (dos Norma 43 que se solapan para la de la
 * autónoma y un CSV de la banca online para la de la SL) con los movimientos que ya explican la
 * demo, casi todos conciliados, y unos cuantos pendientes que enseñan el matcher:
 *
 *   - una transferencia que paga una factura vencida, con su número en el concepto;
 *   - un pago parcial de otra;
 *   - un cargo de Google Ads con tarjeta (hay una regla aprendida);
 *   - los pagos trimestrales a la AEAT (modelos 303 y 111);
 *   - un traspaso de la cuenta de la autónoma a la de la SL (los dos lados);
 *   - y un cargo que nadie sabe qué es.
 *
 *   pnpm exec tsx --env-file-if-exists=.env.local scripts/seed-demo-banking.ts
 *
 * Necesita la org `demo` con sus finanzas (pnpm db:seed:demo, que encadena seed-demo-finance.ts).
 * Los movimientos salen de los mismos flujos de caja que usa seed-demo-finance.ts para sus saldos
 * de fin de mes (cobros, gastos pagados, IVA y retenciones en su plazo, lo que retira la autónoma),
 * así que los saldos de los extractos cuadran con los suyos; los pendientes van después del último
 * saldo que apuntó. Se importan con el mismo código que la pantalla (src/server/banking/import.ts,
 * como una socia de la demo, con RLS) y se concilian como lo haría ella.
 *
 * Es determinista (misma semilla y mismo día → mismos datos) y re-ejecutable: borra el banco de la
 * demo (y los saldos que apuntaron sus extractos) y lo vuelve a crear. Solo contra la base local: se
 * niega a conectarse a cualquier otro host.
 */
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { toCsv } from "../src/domain/dataio/csv";
import { addDays, addMonthsClamped, compareCivil, maxCivil, minCivil, type CivilDate } from "../src/domain/dates/civil-date";
import { estimateVatQuarter, estimateWithholdingsQuarter, quartersDueBetween, type TaxAmountRow } from "../src/domain/finance/tax";
import { learnRule, methodOf, suggestAll, type Suggestion } from "../src/domain/banking/matcher";
import { type Norma43WriteAccount, writeNorma43 } from "../src/domain/banking/norma43";
import { fingerprints } from "../src/domain/banking/statement";
import { nowInZone } from "../src/lib/clock";
import type { Database } from "../src/lib/supabase/database.types";

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

// PRNG determinista (mulberry32), con otra semilla que la del resto de la demo.
let seed = 20260930;
function rand(): number {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const chance = (p: number) => rand() < p;

const TODAY: CivilDate = nowInZone("Europe/Madrid").date;
/** Como en seed-demo-finance.ts: la demo factura desde marzo de 2025, la SL existe desde el 01/09/2026. */
const START: CivilDate = "2025-03-01";
const SL_FROM: CivilDate = "2026-09-01";
const SL_OPENING_CENTS = 800_000;
const MONTHLY_DRAW = 15_000;
/** Unos 60-90 días de extractos: desde el primer día del mes de hace 60 días (así entra el último pago trimestral a la AEAT). */
const WINDOW_START: CivilDate = `${addDays(TODAY, -60).slice(0, 8)}01`;
const CARD = "5402XXXXXXXX3107";
const NOTE_PREFIX = "Extracto demo-";
const BANKING_TABLES = ["bank_matches", "bank_ignores", "bank_rules", "bank_transactions", "bank_statements"];

const sql = postgres(DATABASE_URL, { onnotice: () => {} });
const admin = createClient<Database>(API_URL, SECRET, { auth: { persistSession: false, autoRefreshToken: false } });
const iso = (d: Date | string) => (typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10));

async function partnerSession(email: string) {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  const db = createClient<Database>(API_URL, PUBLISHABLE, { auth: { persistSession: false, autoRefreshToken: false } });
  const verified = await db.auth.verifyOtp({ type: "email", token_hash: data.properties.hashed_token });
  if (verified.error) throw verified.error;
  return db;
}

/** Lo que explica un movimiento de la demo (para conciliarlo como lo haría la socia). */
type Target =
  | { kind: "payment"; id: string; clientId: string }
  | { kind: "expense"; id: string; vendorId: string | null; categoryId: string }
  | { kind: "draw" }
  | { kind: "pending"; label: string };

type Movement = {
  on: CivilDate;
  cents: number;
  concept: string;
  /** Norma 43: concepto común y propio. */
  code: string;
  own?: string;
  reference?: string;
  target: Target;
};

/** Trozos de 38 caracteres para los registros 23, sin partir palabras. */
function chunks(text: string): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if ((line ? `${line} ${word}` : word).length > 38) {
      if (line) out.push(line);
      line = word.slice(0, 38);
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out.slice(0, 10);
}

/** Cómo sale cada proveedor en un cargo con tarjeta (el descriptor del comercio). */
const MERCHANTS: Record<string, string> = {
  "Google Cloud EMEA Ltd": "GOOGLE *GSUITE_GNERAI",
  "Adobe Systems Software Ireland": "ADOBE *CREATIVE CLD 800-833-6687",
  "Figma Inc": "FIGMA MONTHLY FIGMA.COM",
  "Notion Labs Inc": "NOTION LABS INC",
  "Semrush Inc": "SEMRUSH PRO SEMRUSH.COM",
  "Raiola Networks SL": "RAIOLA NETWORKS",
  "Espai Cowork Mataró SL": "ESPAI COWORK MATARO",
  "Meta Platforms Ireland Ltd": "FACEBK *ADS META",
  "Google Ireland Ltd": "GOOGLE *ADS8246910 G.CO/HELPPAY#",
  "Envato Pty Ltd": "ENVATO MARKET",
  "Apple Retail Spain SL": "APPLE STORE LA MAQUINISTA",
  "Componentes Maresme SL": "COMPONENTES MARESME",
  "Escola Digital Online SL": "ESCOLA DIGITAL ONLINE",
  "Viajes y restauración": "RENFE VIAJEROS",
};

function expenseMovement(e: {
  id: string;
  vendor_id: string | null;
  vendor_name: string | null;
  category_id: string;
  description: string;
  vendor_invoice_number: string | null;
  paid_on: Date;
  total_cents: number;
  payment_method: string | null;
}): Movement {
  const vendor = e.vendor_name ?? e.description;
  const upper = vendor.toUpperCase();
  const target: Target = { kind: "expense", id: e.id, vendorId: e.vendor_id, categoryId: e.category_id };
  const on = iso(e.paid_on);
  const cents = -Number(e.total_cents);
  if (e.payment_method === "card") return { on, cents, code: "12", own: "018", concept: `COMPRA TARJ. ${CARD} ${MERCHANTS[vendor] ?? upper}`, target };
  if (e.payment_method === "sepa_debit") {
    if (/banc demo/i.test(vendor)) return { on, cents, code: "17", concept: "COMISION MANTENIMIENTO CUENTA", target };
    if (/seguridad social/i.test(vendor)) return { on, cents, code: "03", own: "001", concept: `RECIBO TGSS REGIMEN ESPECIAL AUTONOMOS ${on.slice(5, 7)}/${on.slice(0, 4)}`, target };
    return { on, cents, code: "03", own: "001", concept: `RECIBO ${upper} ${e.description.toUpperCase()}`, target };
  }
  return {
    on,
    cents,
    code: "04",
    concept: `TRANSFERENCIA A FAVOR DE ${upper} CONCEPTO ${e.vendor_invoice_number ? `FACTURA ${e.vendor_invoice_number}` : e.description.toUpperCase()}`,
    target,
  };
}

async function main() {
  const { commitStatementImport } = await import("../src/server/banking/import");
  const { loadMatchContext, loadPendingTransactions, windowOf } = await import("../src/server/banking/sources");
  const { applyAllocations, ignoreMovement, unwrap } = await import("../src/server/banking/service");
  if (!SECRET || !PUBLISHABLE) throw new Error("Faltan las claves de Supabase: ejecuta con .env.local.");

  const [org] = await sql`select id from public.orgs where slug = 'demo'`;
  if (!org) throw new Error("No existe la org demo: ejecuta antes pnpm db:seed:demo.");
  const orgId: string = org.id;

  // 0. Fuera el banco de la demo, los restos de demos anteriores y los saldos que apuntaron sus
  //    extractos (sin triggers, como los otros seeds: la auditoría no interviene).
  await sql.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    for (const table of BANKING_TABLES) {
      await tx.unsafe(`delete from public.${table} where org_id = $1 or org_id not in (select id from public.orgs)`, [orgId]);
    }
    await tx`delete from public.bank_transactions where account_id not in (select id from public.cash_accounts)`;
    await tx`delete from public.bank_statements where account_id not in (select id from public.cash_accounts)`;
    await tx`delete from public.cash_balances where org_id = ${orgId} and note like ${`${NOTE_PREFIX}%`}`;
    await tx`delete from public.audit_log where org_id = ${orgId} and table_name = any(${BANKING_TABLES})`;
  });

  // 1. Cuentas, emisores y la socia que concilia.
  const issuers = await sql`select id, kind, legal_name from public.issuers where org_id = ${orgId}`;
  const laiaIssuer = issuers.find((i) => i.kind === "self_employed");
  const slIssuer = issuers.find((i) => i.kind === "company");
  const accounts = await sql`select id, issuer_id, name, iban from public.cash_accounts where org_id = ${orgId} and is_active`;
  const laiaAccount = accounts.find((a) => a.issuer_id === laiaIssuer?.id);
  const slAccount = accounts.find((a) => a.issuer_id === slIssuer?.id);
  if (!laiaIssuer || !slIssuer || !laiaAccount?.iban || !slAccount?.iban) {
    throw new Error("La demo no tiene sus cuentas de caja con IBAN: ejecuta antes scripts/seed-demo-finance.ts.");
  }
  const [laiaUser] = await sql`
    select u.email from public.members m join auth.users u on u.id = m.user_id
    where m.org_id = ${orgId} and m.full_name = 'Laia Demo' and m.role in ('partner', 'owner')`;
  if (!laiaUser) throw new Error("Falta la socia ficticia Laia Demo: vuelve a ejecutar pnpm db:seed:demo.");
  const partner = await partnerSession(laiaUser.email);

  // 2. Los flujos de caja de cada cuenta, como los calcula seed-demo-finance.ts para sus saldos.
  const payerOf = (issuerId: string) => (issuerId === slIssuer.id ? "sl" : "laia");
  const movements: Record<"laia" | "sl", Movement[]> = { laia: [], sl: [] };
  const clients = await sql`select id, display_name, legal_name from public.clients where org_id = ${orgId}`;
  const clientById = new Map(clients.map((c) => [c.id as string, c]));
  for (const p of await sql`
    select p.id, p.paid_on, p.amount_cents, p.method, i.issuer_id, i.client_id, i.number
    from public.payments p join public.invoices i on i.id = p.invoice_id
    where p.org_id = ${orgId} and p.paid_on >= ${addDays(WINDOW_START, -1)}
    order by p.paid_on, p.id`) {
    const client = clientById.get(p.client_id);
    const name = String(client?.legal_name ?? client?.display_name ?? "").toUpperCase();
    const numbered = chance(0.65);
    movements[payerOf(p.issuer_id)].push({
      on: iso(p.paid_on),
      cents: Number(p.amount_cents),
      code: p.method === "sepa_debit" ? "02" : "04",
      concept: p.method === "sepa_debit" ? `ABONO ADEUDO DOMICILIADO ${name}` : `TRANSFERENCIA DE ${name}${numbered ? ` CONCEPTO FRA ${p.number}` : ""}`,
      target: { kind: "payment", id: p.id, clientId: p.client_id },
    });
  }
  for (const e of await sql`
    select e.id, e.issuer_id, e.vendor_id, v.name as vendor_name, e.category_id, e.description, e.vendor_invoice_number, e.paid_on,
           e.total_cents, e.payment_method
    from public.expenses e left join public.vendors v on v.id = e.vendor_id
    where e.org_id = ${orgId} and e.paid_on is not null and e.paid_on >= ${addDays(WINDOW_START, -1)}
    order by e.paid_on, e.id`) {
    movements[payerOf(e.issuer_id)].push(expenseMovement(e as never));
  }
  // IVA y retenciones de cada trimestre, en su plazo (la misma estimación que la app).
  const outputVat: TaxAmountRow[] = (
    await sql`select issuer_id, issued_on, vat_cents from public.invoices where org_id = ${orgId} and lifecycle = 'issued'`
  ).map((r) => ({ issuerId: r.issuer_id, on: iso(r.issued_on), cents: Number(r.vat_cents) }));
  const expenseTaxes = await sql`select issuer_id, issued_on, vat_cents, vat_deductible, irpf_cents from public.expenses where org_id = ${orgId}`;
  const inputVat: TaxAmountRow[] = expenseTaxes
    .filter((r) => r.vat_deductible)
    .map((r) => ({ issuerId: r.issuer_id, on: iso(r.issued_on), cents: Number(r.vat_cents) }));
  const withheld: TaxAmountRow[] = expenseTaxes.map((r) => ({ issuerId: r.issuer_id, on: iso(r.issued_on), cents: Number(r.irpf_cents) }));
  for (const q of quartersDueBetween(START, addDays(TODAY, -1))) {
    const vat = estimateVatQuarter(q, outputVat, inputVat);
    const irpf = estimateWithholdingsQuarter(q, withheld);
    const label = `${q.quarter}T ${q.year}`;
    for (const issuer of vat.issuers) {
      if (issuer.payableCents <= 0 || compareCivil(vat.dueOn, WINDOW_START) < 0) continue;
      movements[payerOf(issuer.issuerId)].push({
        on: vat.dueOn,
        cents: -issuer.payableCents,
        code: "03",
        own: "009",
        concept: `PAGO IMPUESTOS AEAT MODELO 303 ${label} NRC 303${q.year}${int(1_000_000, 9_999_999)}`,
        target: { kind: "pending", label: "AEAT 303" },
      });
    }
    for (const issuer of irpf.issuers) {
      if (compareCivil(irpf.dueOn, WINDOW_START) < 0) continue;
      movements[payerOf(issuer.issuerId)].push({
        on: irpf.dueOn,
        cents: -issuer.withheldCents,
        code: "03",
        own: "009",
        concept: `PAGO IMPUESTOS AEAT MODELO 111 ${label} NRC 111${q.year}${int(1_000_000, 9_999_999)}`,
        target: { kind: "pending", label: "AEAT 111" },
      });
    }
  }
  for (let month = START; compareCivil(month, TODAY) <= 0; month = addMonthsClamped(month, 1)) {
    const on = `${month.slice(0, 8)}05`;
    if (compareCivil(on, TODAY) < 0 && compareCivil(on, WINDOW_START) >= 0) {
      movements.laia.push({ on, cents: -MONTHLY_DRAW, code: "04", concept: `TRANSFERENCIA A FAVOR DE ${String(laiaIssuer.legal_name).toUpperCase()} CUENTA PERSONAL`, target: { kind: "draw" } });
    }
  }

  // 3. Saldos que ya apuntó seed-demo-finance.ts: el de partida y los que hay que respetar.
  const balances = await sql`select account_id, balance_on, balance_cents from public.cash_balances where org_id = ${orgId} order by balance_on`;
  const balanceOf = (account: string, on: CivilDate) => balances.find((b) => b.account_id === account && iso(b.balance_on) === on);
  const lastBalance = (account: string) => balances.filter((b) => b.account_id === account).map((b) => iso(b.balance_on)).at(-1) ?? WINDOW_START;
  const laiaOpening = balanceOf(laiaAccount.id, addDays(WINDOW_START, -1));
  if (!laiaOpening) throw new Error(`Falta el saldo de fin de mes del ${addDays(WINDOW_START, -1)}: ejecuta antes scripts/seed-demo-finance.ts.`);

  // 4. Los pendientes que enseñan el matcher, después del último saldo apuntado (así no lo descuadran).
  const extraDay = (account: string, daysAgo: number) => minCivil(TODAY, maxCivil(addDays(lastBalance(account), 1), addDays(TODAY, -daysAgo)));
  const overdue = await sql`
    select io.id, io.number, io.outstanding_cents, io.client_id, io.client_name from public.invoices_overview io
    where io.org_id = ${orgId} and io.issuer_id = ${laiaIssuer.id} and io.status = 'overdue' and io.outstanding_cents > 0
    order by io.due_on, io.number`;
  if (overdue[0]) {
    const inv = overdue[0];
    const client = clientById.get(inv.client_id);
    movements.laia.push({
      on: extraDay(laiaAccount.id, 4),
      cents: Number(inv.outstanding_cents),
      code: "04",
      concept: `TRANSFERENCIA DE ${String(client?.legal_name ?? inv.client_name).toUpperCase()} CONCEPTO PAGO FRA ${inv.number}`,
      target: { kind: "pending", label: `factura vencida ${inv.number}` },
    });
  }
  if (overdue[1]) {
    const inv = overdue[1];
    const partial = Math.floor((Number(inv.outstanding_cents) * 0.4) / 100) * 100;
    movements.laia.push({
      on: extraDay(laiaAccount.id, 3),
      cents: partial,
      code: "04",
      concept: `TRANSF. DE ${String(clientById.get(inv.client_id)?.legal_name ?? inv.client_name).toUpperCase()} PAGO A CUENTA FRA ${inv.number}`,
      target: { kind: "pending", label: `pago parcial de ${inv.number}` },
    });
  }
  movements.laia.push({
    on: extraDay(laiaAccount.id, 6),
    cents: -8_640,
    code: "12",
    own: "018",
    concept: `COMPRA TARJ. ${CARD} GOOGLE *ADS8246910 G.CO/HELPPAY#`,
    target: { kind: "pending", label: "Google Ads" },
  });
  movements.laia.push({
    on: extraDay(laiaAccount.id, 2),
    cents: -4_599,
    code: "12",
    own: "018",
    concept: `COMPRA TARJ. ${CARD} AMZN MKTP ES*2K4RT5 AMAZON.ES`,
    target: { kind: "pending", label: "desconocido" },
  });
  const transferOn = maxCivil(extraDay(laiaAccount.id, 4), extraDay(slAccount.id, 4));
  const slIban = String(slAccount.iban);
  movements.laia.push({
    on: transferOn,
    cents: -200_000,
    code: "04",
    concept: `TRASPASO A CUENTA PROPIA GNERAI DEMO SL ${slIban.replace(/(.{4})/g, "$1 ").trim()}`,
    target: { kind: "pending", label: "traspaso a la SL" },
  });
  movements.sl.push({
    on: transferOn,
    cents: 200_000,
    code: "04",
    concept: `TRASPASO DE ${String(laiaIssuer.legal_name).toUpperCase()} CUENTA PROPIA`,
    target: { kind: "pending", label: "traspaso de la autónoma" },
  });

  // 5. En orden (dentro del día: primero lo que entra), con su saldo.
  const order = (list: Movement[]) => list.sort((a, b) => compareCivil(a.on, b.on) || b.cents - a.cents || a.concept.localeCompare(b.concept));
  const laia = order(movements.laia.filter((m) => compareCivil(m.on, WINDOW_START) >= 0));
  const sl = order(movements.sl.filter((m) => compareCivil(m.on, SL_FROM) >= 0));
  const lastOn = (list: Movement[]) => maxCivil(addDays(TODAY, -1), ...list.map((m) => m.on));
  const laiaEnd = lastOn(laia);

  const running = (opening: number, list: Movement[]) => {
    let balance = opening;
    return list.map((m) => (balance += m.cents));
  };
  const laiaBalances = running(Number(laiaOpening.balance_cents), laia);
  const slBalances = running(SL_OPENING_CENTS, sl);
  // Los extractos cuadran con los saldos que ya había (los de fin de mes y el de mitad de mes de la SL).
  const mismatches: string[] = [];
  for (const b of balances) {
    const on = iso(b.balance_on);
    const [list, values, opening, from] =
      b.account_id === laiaAccount.id ? [laia, laiaBalances, Number(laiaOpening.balance_cents), WINDOW_START] : [sl, slBalances, SL_OPENING_CENTS, SL_FROM];
    if (b.account_id !== laiaAccount.id && b.account_id !== slAccount.id) continue;
    if (compareCivil(on, from) < 0) continue;
    const index = list.findLastIndex((m) => compareCivil(m.on, on) <= 0);
    const expected = index === -1 ? opening : values[index]!;
    if (expected !== Number(b.balance_cents)) mismatches.push(`${b.account_id === laiaAccount.id ? "autónoma" : "SL"} ${on}: ${expected} ≠ ${b.balance_cents}`);
  }

  // 6. Los ficheros: dos Norma 43 de la autónoma que se solapan (hasta mediados del segundo mes y
  //    desde el principio de ese mes) y el CSV de la banca online de la SL (lo más reciente arriba).
  const laiaIban = String(laiaAccount.iban);
  const n43Account = (periodStart: CivilDate, periodEnd: CivilDate, opening: number, list: Movement[]): Norma43WriteAccount => ({
    bank: laiaIban.slice(4, 8),
    branch: laiaIban.slice(8, 12),
    number: laiaIban.slice(14, 24),
    holder: String(laiaIssuer.legal_name),
    periodStart,
    periodEnd,
    openingBalanceCents: opening,
    movements: list.map((m) => ({
      bookedOn: m.on,
      amountCents: m.cents,
      commonConcept: m.code,
      ownConcept: m.own,
      reference2: m.reference,
      concept: chunks(m.concept),
    })),
  });
  const secondMonth = addMonthsClamped(WINDOW_START, 1);
  const firstEnd = minCivil(addDays(secondMonth, 14), laiaEnd);
  const inFirst = laia.filter((m) => compareCivil(m.on, firstEnd) <= 0);
  const inSecond = laia.filter((m) => compareCivil(m.on, secondMonth) >= 0);
  const openingSecond = (() => {
    const index = laia.findLastIndex((m) => compareCivil(m.on, secondMonth) < 0);
    return index === -1 ? Number(laiaOpening.balance_cents) : laiaBalances[index]!;
  })();
  const fileA = `demo-laia-${WINDOW_START}.n43`;
  const fileB = `demo-laia-${secondMonth}.n43`;
  const textA = writeNorma43([n43Account(WINDOW_START, firstEnd, Number(laiaOpening.balance_cents), inFirst)]);
  const textB = writeNorma43([n43Account(secondMonth, laiaEnd, openingSecond, inSecond)]);
  const euros = (cents: number) =>
    (cents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true }).replace(/ /g, "");
  const esDate = (d: CivilDate) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
  const csvRows = sl.map((m, i) => [esDate(m.on), esDate(m.on), m.concept, euros(m.cents), euros(slBalances[i]!)]).reverse();
  const fileC = `demo-sl-${SL_FROM}.csv`;
  const textC = toCsv(
    [
      ["Movimientos de la cuenta"],
      ["Cuenta:", slIban.replace(/(.{4})/g, "$1 ").trim()],
      ["Titular:", "GNERAI DEMO SL"],
      [],
      ["Fecha", "Fecha valor", "Concepto", "Importe", "Saldo"],
      ...csvRows,
    ],
    { bom: true },
  );

  // 7. Importar con el mismo código que la pantalla (como la socia: RPC y RLS).
  const importFile = async (accountId: string, fileName: string, text: string) =>
    commitStatementImport(partner, orgId, {
      accountId,
      fileName,
      bytes: new TextEncoder().encode(text),
      mapping: null,
      today: TODAY,
      balanceNote: `Extracto ${fileName}`,
    });
  const imports: string[] = [];
  for (const [accountId, fileName, text] of [
    [laiaAccount.id, fileA, textA],
    [laiaAccount.id, fileB, textB],
    [slAccount.id, fileC, textC],
  ] as const) {
    const result = await importFile(accountId, fileName, text);
    if (!result.ok) throw new Error(`No se ha podido importar ${fileName}: ${result.reason}`);
    imports.push(`${fileName}: ${result.inserted} nuevos, ${result.duplicates} repetidos`);
  }

  // 8. Una regla aprendida de meses anteriores: los cargos de Google Ads son publicidad propia.
  const [gads] = await sql`select id from public.vendors where org_id = ${orgId} and name = 'Google Ireland Ltd'`;
  const [ads] = await sql`select id from public.expense_categories where org_id = ${orgId} and name = 'Publicidad propia' and archived_at is null`;
  if (gads && ads) {
    const { error } = await partner
      .from("bank_rules")
      .insert({ org_id: orgId, direction: "debit", field: "concept", pattern: "GOOGLE ADS", vendor_id: gads.id, category_id: ads.id });
    if (error) throw error;
  }

  // 9. Conciliar lo que ya explica la demo, como lo haría la socia (y ver si el matcher acierta).
  const targets = new Map<string, Target>();
  for (const [accountId, list] of [
    [laiaAccount.id, laia],
    [slAccount.id, sl],
  ] as const) {
    fingerprints(list.map((m) => ({ bookedOn: m.on, amountCents: m.cents }))).forEach((f, i) => targets.set(`${accountId}:${f}`, list[i]!.target));
  }
  const imported = await sql`select id, account_id, fingerprint from public.bank_transactions where org_id = ${orgId}`;
  const targetOf = new Map(imported.map((t) => [t.id as string, targets.get(`${t.account_id}:${t.fingerprint}`)]));
  const pending = await loadPendingTransactions(partner, orgId);
  const window = windowOf(pending);
  const suggestions = window ? suggestAll(pending, await loadMatchContext(partner, orgId, window)) : new Map<string, Suggestion[]>();
  let hits = 0;
  let high = 0;
  let linked = 0;
  let ignored = 0;
  for (const tx of [...pending].sort((a, b) => a.bookedOn.localeCompare(b.bookedOn))) {
    const target = targetOf.get(tx.id);
    if (!target || target.kind === "pending") continue;
    const best = suggestions.get(tx.id)?.[0];
    if (target.kind === "draw") {
      if (best?.kind === "ignore" && best.ignoreReason === "partner_movement") hits += 1;
      unwrap(await ignoreMovement(partner, tx.id, "partner_movement", null), "seed.ignore");
      ignored += 1;
      continue;
    }
    if (best?.allocations.some((a) => a.kind === target.kind && a.id === target.id)) {
      hits += 1;
      if (best.confidence === "alta") high += 1;
    }
    const rule =
      target.kind === "payment" ? learnRule(tx, { clientId: target.clientId }) : learnRule(tx, { vendorId: target.vendorId, categoryId: target.categoryId });
    unwrap(
      await applyAllocations(partner, {
        transactionId: tx.id,
        allocations: [{ kind: target.kind, id: target.id, amountCents: tx.remainingCents }],
        method: methodOf(tx),
        rule,
      }),
      "seed.apply",
    );
    linked += 1;
  }

  // 10. Resumen: los pendientes con lo que propone el matcher.
  const left = await loadPendingTransactions(partner, orgId);
  const leftWindow = windowOf(left);
  const leftSuggestions = leftWindow ? suggestAll(left, await loadMatchContext(partner, orgId, leftWindow)) : new Map<string, Suggestion[]>();
  const [counts] = await sql`
    select count(*)::int as total,
           count(*) filter (where status = 'reconciled')::int as reconciled,
           count(*) filter (where status = 'ignored')::int as ignored,
           count(*) filter (where status in ('unmatched', 'partial'))::int as pending,
           (select count(*)::int from public.bank_rules where org_id = ${orgId}) as rules
    from public.bank_transactions_overview where org_id = ${orgId}`;
  const eur = (cents: number) => `${(cents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
  console.log(`Banco de la demo listo: ${counts!.total} movimientos (${counts!.reconciled} conciliados, ${counts!.ignored} ignorados, ${counts!.pending} por conciliar) y ${counts!.rules} reglas.`);
  for (const line of imports) console.log(`  ${line}`);
  console.log(
    `  Conciliados como lo haría la socia: ${linked} enlaces y ${ignored} ignorados. El matcher proponía lo mismo en ${hits} de ${linked + ignored} (${high} con confianza alta).`,
  );
  if (mismatches.length > 0) console.warn(`  Ojo: saldos que no cuadran con los de Finanzas: ${mismatches.join("; ")}`);
  console.log("  Pendientes y lo que propone GNERAI OS:");
  for (const tx of left.sort((a, b) => a.bookedOn.localeCompare(b.bookedOn))) {
    const best = leftSuggestions.get(tx.id)?.[0];
    const what = targetOf.get(tx.id);
    const label = what?.kind === "pending" ? what.label : "";
    console.log(
      `    ${tx.bookedOn} ${eur(tx.amountCents).padStart(12)} ${label.padEnd(26)} → ${best ? `${best.kind} (${best.confidence}): ${best.reasons.map((r) => r.code).join(", ")}` : "sin propuesta"}`,
    );
  }
  console.log("  Ábrelo en /demo/finance/bank.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
