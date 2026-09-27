/**
 * Coste interno por hora de los miembros de la org demo, para que Finanzas → Rentabilidad enseñe
 * cifras con sentido: clientes muy rentables, alguno por debajo del margen mínimo, horas sin facturar
 * y un cambio de coste a mitad de periodo (el historial).
 *
 *   pnpm exec tsx --env-file-if-exists=.env.local scripts/seed-demo-costs.ts
 *
 * Necesita la org `demo` de `pnpm db:seed:demo` y sus horas (scripts/seed-demo-projects.ts). No está
 * en `db:seed:demo`: se ejecuta a mano cuando se quiera. Solo toca member_costs de la demo.
 *
 * - Los socios ficticios (Laia y Pau): Laia a 28 €/h y, desde hace un mes y medio, a 32 €/h; Pau a 26 €/h.
 * - Los owners reales que ven la demo, del que más horas tiene al que menos: el primero a 38 €/h; el
 *   segundo sin coste propio (sus horas se valoran con el de la org: así se ve el aviso); el tercero,
 *   35 €/h desde hoy (un coste programado, sin efecto en lo ya trabajado).
 *
 * Es determinista y re-ejecutable: borra los costes de la demo y los vuelve a crear. Solo contra la
 * base local: se niega a conectarse a cualquier otro host. Al acabar, enseña la rentabilidad de los
 * últimos 12 meses (el periodo por defecto) con la misma lectura que la app
 * (src/server/profitability/load.ts). En la demo las horas son solo de los últimos 3 meses (y se
 * calibraron con todo lo facturado por cada contrato), así que es en 12 meses donde se ve de verdad.
 */
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { addDays, addMonthsClamped, type CivilDate } from "../src/domain/dates/civil-date";
import { rollingPeriod } from "../src/domain/profitability/period";
import { nowInZone } from "../src/lib/clock";
import type { Database } from "../src/lib/supabase/database.types";
import { loadProfitability } from "../src/server/profitability/load";

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

/** Desde cuándo valen los primeros costes: antes de la primera factura de la demo (marzo de 2025). */
const HISTORY_FROM: CivilDate = "2025-01-01";

type CostSeed = { validFrom: CivilDate; euros: number };

const sql = postgres(DATABASE_URL, { onnotice: () => {} });

const euros = (cents: number) => `${(cents / 100).toLocaleString("es-ES", { maximumFractionDigits: 0 })} €`;

async function main() {
  const [org] = await sql`select id, slug, timezone, settings from public.orgs where slug = 'demo'`;
  if (!org) throw new Error("No existe la org demo: ejecuta antes `pnpm db:seed:demo`.");
  const orgId: string = org.id;
  const today = nowInZone(org.timezone).date;

  // Con sus horas en la demo: los owners reales cambian de una máquina a otra, las horas no.
  const members = await sql`
    select m.id, m.full_name, m.role, coalesce(sum(t.minutes), 0)::int as minutes
    from public.members m
    left join public.time_entries t on t.member_id = m.id and t.org_id = m.org_id
    where m.org_id = ${orgId} and m.is_active
    group by m.id
    order by (m.role = 'partner') desc, case when m.role = 'partner' then m.full_name end, minutes desc, m.created_at, m.id`;
  const partners = members.filter((m) => m.role === "partner");
  const owners = members.filter((m) => m.role === "owner");
  if (members.length === 0) throw new Error("La org demo no tiene miembros activos.");

  // Laia sube de coste a mitad de los últimos 3 meses: el historial se nota en el periodo.
  const raiseOn = addDays(addMonthsClamped(today, -2), 15);
  const PARTNER_COSTS: CostSeed[][] = [
    [
      { validFrom: HISTORY_FROM, euros: 28 },
      { validFrom: raiseOn, euros: 32 },
    ],
    [{ validFrom: HISTORY_FROM, euros: 26 }],
  ];
  const OWNER_COSTS: CostSeed[][] = [[{ validFrom: HISTORY_FROM, euros: 38 }], [], [{ validFrom: today, euros: 35 }]];

  const rows: { member_id: string; valid_from: string; hourly_cost_cents: number }[] = [];
  partners.forEach((m, i) => {
    for (const cost of PARTNER_COSTS[i % PARTNER_COSTS.length]!) rows.push({ member_id: m.id, valid_from: cost.validFrom, hourly_cost_cents: cost.euros * 100 });
  });
  owners.forEach((m, i) => {
    for (const cost of OWNER_COSTS[i % OWNER_COSTS.length]!) rows.push({ member_id: m.id, valid_from: cost.validFrom, hourly_cost_cents: cost.euros * 100 });
  });

  await sql.begin(async (tx) => {
    await tx`delete from public.member_costs where org_id = ${orgId}`;
    for (const row of rows) {
      await tx`
        insert into public.member_costs (org_id, member_id, valid_from, hourly_cost_cents)
        values (${orgId}, ${row.member_id}, ${row.valid_from}, ${row.hourly_cost_cents})`;
    }
  });

  const names = new Map(members.map((m) => [m.id as string, m.full_name as string]));
  console.log(`Costes por hora de la demo (${rows.length}):`);
  for (const row of rows) console.log(`  ${names.get(row.member_id)}: ${euros(row.hourly_cost_cents)}/h desde el ${row.valid_from}`);
  const without = members.filter((m) => !rows.some((r) => r.member_id === m.id)).map((m) => m.full_name);
  if (without.length > 0) console.log(`  Sin coste propio (coste de la org): ${without.join(", ")}`);

  // La rentabilidad de los últimos 12 meses, leída como la lee la app (con el cliente de servidor).
  if (!SECRET) return;
  const admin = createClient<Database>(API_URL, SECRET, { auth: { persistSession: false, autoRefreshToken: false } });
  const { report } = await loadProfitability(admin, { id: orgId, settings: org.settings }, rollingPeriod(today, 12));
  const pct = (bps: number | null) => (bps === null ? "—" : `${(bps / 100).toFixed(1)} %`);
  console.log(`\nRentabilidad de los últimos 12 meses:`);
  for (const c of report.clients) {
    console.log(
      `  ${(c.name ?? c.clientId).padEnd(30)} ${euros(c.revenueCents).padStart(9)} ingresos · ${String(Math.round(c.minutes / 60)).padStart(4)} h · margen ${euros(c.marginCents).padStart(9)} (${pct(c.marginBps)})${c.flags.length ? ` · ${c.flags.join(", ")}` : ""}`,
    );
  }
  const totals = report.totals;
  console.log(`  ${"Total".padEnd(30)} ${euros(totals.revenueCents).padStart(9)} ingresos · ${String(Math.round(totals.minutes / 60)).padStart(4)} h · margen ${euros(totals.marginCents).padStart(9)} (${pct(totals.marginBps)})`);
  if (report.internal.minutes > 0) console.log(`  Interno: ${Math.round(report.internal.minutes / 60)} h · ${euros(report.internal.costCents)}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
