/**
 * SEO de la org demo: 16 meses de Search Console y GA4 ficticios (source 'demo') para la web propia
 * (tipo gnerai.com) y para las webs de tres clientes de la demo, vinculadas a su ficha.
 *
 *   pnpm exec tsx --env-file-if-exists=.env.local scripts/seed-demo-seo.ts
 *
 * Necesita la org `demo` de `pnpm db:seed:demo` (y se vuelve a ejecutar después de recrearla).
 * Es determinista (misma semilla y mismo día → mismos datos) y re-ejecutable: borra el SEO de la
 * demo y los restos de demos anteriores, y lo vuelve a crear. Los datos salen del generador puro de
 * src/domain/seo/demo.ts. Solo contra la base local: se niega a conectarse a cualquier otro host.
 */
import postgres from "postgres";
import { addDays } from "../src/domain/dates/civil-date";
import { type DemoSiteProfile, generateDemoSite, historyStart } from "../src/domain/seo";
import { nowInZone } from "../src/lib/clock";

const DATABASE_URL = process.env.SEED_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const API_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const LOCAL = ["127.0.0.1", "localhost", "::1"];
for (const target of [DATABASE_URL, API_URL]) {
  const host = target ? new URL(target).hostname : "";
  if (!LOCAL.includes(host)) {
    console.error(`Solo se siembra la base local; «${host || "sin URL"}» no lo es (¿falta .env.local?).`);
    process.exit(1);
  }
}

// Demanda por mes (enero … diciembre) y por día de la semana (domingo … sábado).
const B2B_SEASON = [0.95, 1, 1.05, 1, 1.05, 0.95, 0.85, 0.6, 1.05, 1.1, 1.05, 0.75];
const B2B_WEEK = [0.55, 1.12, 1.15, 1.12, 1.08, 0.95, 0.6];

type SiteSeed = {
  profile: DemoSiteProfile;
  label: string;
  gscSiteUrl: string;
  ga4PropertyId: string;
  /** Cliente de la demo por su nombre comercial; sin él, la web propia de la org. */
  client?: string;
};

const SITES: SiteSeed[] = [
  {
    label: "gnerai.com",
    gscSiteUrl: "sc-domain:gnerai.com",
    ga4PropertyId: "400100200",
    profile: {
      seed: "demo-seo-gnerai",
      origin: "https://gnerai.com",
      pages: [
        "/",
        "/diseno-web/",
        "/seo/",
        "/meta-ads/",
        "/branding/",
        "/apps/",
        "/video-dron/",
        "/contacto/",
        "/blog/cuanto-cuesta-una-pagina-web/",
        "/blog/seo-local-para-negocios/",
        "/blog/meta-ads-vs-google-ads/",
        "/agencia-marketing-digital-mataro/",
      ],
      queries: [
        { text: "gnerai", page: 0, volume: 520, from: 1.1, to: 1, brand: true },
        { text: "gnerai agencia", page: 0, volume: 90, from: 1.3, to: 1.1, brand: true },
        { text: "gnerai mataró", page: 7, volume: 60, from: 1.2, to: 1.1, brand: true },
        { text: "agencia marketing digital mataró", page: 11, altPage: 0, volume: 900, from: 9, to: 3.2 },
        { text: "agencia marketing digital maresme", page: 11, altPage: 0, volume: 650, from: 12, to: 4.1 },
        { text: "agencia de publicidad mataró", page: 0, volume: 450, from: 7.5, to: 4.4 },
        { text: "diseño web mataró", page: 1, volume: 1200, from: 14, to: 5.5 },
        { text: "diseño páginas web maresme", page: 1, volume: 500, from: 18, to: 7.8 },
        { text: "empresa diseño web barcelona", page: 1, volume: 2600, from: 34, to: 21 },
        { text: "agencia seo mataró", page: 2, volume: 700, from: 16, to: 6.4 },
        { text: "posicionamiento seo maresme", page: 2, volume: 420, from: 22, to: 8.9 },
        { text: "seo local", page: 9, volume: 3000, from: 45, to: 26 },
        { text: "cuánto cuesta una página web", page: 8, volume: 4500, from: 28, to: 11.5, since: 0.25 },
        { text: "precio página web autónomo", page: 8, volume: 900, from: 20, to: 9.8, since: 0.25 },
        { text: "seo local para negocios", page: 9, volume: 1400, from: 30, to: 7.2, since: 0.45 },
        { text: "meta ads vs google ads", page: 10, volume: 2100, from: 26, to: 8.4, since: 0.6 },
        { text: "agencia meta ads barcelona", page: 3, volume: 1300, from: 25, to: 13 },
        { text: "gestión redes sociales mataró", page: 0, volume: 380, from: 11, to: 5.1 },
        { text: "vídeo con dron mataró", page: 6, volume: 240, from: 8, to: 2.4 },
        { text: "branding empresa maresme", page: 4, volume: 200, from: 13, to: 6 },
        { text: "desarrollo apps barcelona", page: 5, volume: 1800, from: 38, to: 24 },
      ],
      longTail: {
        heads: ["diseño web", "agencia seo", "marketing digital", "página web"],
        tails: ["precio", "barato", "para restaurantes", "para clínicas", "premià de mar", "vilassar de mar", "arenys de mar", "badalona", "calella"],
        page: 1,
        volume: [10, 70],
        position: [9, 32],
      },
      seasonality: B2B_SEASON,
      weekday: B2B_WEEK,
      growth: 1.25,
      anonymizedShare: 0.22,
      // Una actualización de Google que baja las posiciones un par de semanas.
      events: [{ from: 0.55, to: 0.61, positionShift: 2.2 }],
      web: { organicShare: [0.38, 0.52], sessionsPerClick: 1.07, engagementRate: 0.58, organicConversionRate: 0.018, otherConversionRate: 0.012 },
    },
  },
  {
    client: "Clínica Dental Mar Blau",
    label: "clinicamarblau.example",
    gscSiteUrl: "sc-domain:clinicamarblau.example",
    ga4PropertyId: "400100201",
    profile: {
      seed: "demo-seo-mar-blau",
      origin: "https://www.clinicamarblau.example",
      pages: ["/", "/clinica/", "/implantes-dentales/", "/ortodoncia-invisible/", "/blanqueamiento-dental/", "/urgencias/", "/contacto/", "/odontopediatria/", "/blog/precio-implante-dental/", "/periodoncia/"],
      queries: [
        { text: "clínica dental mar blau", page: 0, volume: 380, from: 1.1, to: 1, brand: true },
        { text: "mar blau dental", page: 0, volume: 120, from: 1.2, to: 1.1, brand: true },
        { text: "dentista mataró", page: 0, volume: 2900, from: 11, to: 3.4 },
        { text: "clínica dental mataró", page: 0, altPage: 1, volume: 1600, from: 9, to: 2.8 },
        { text: "implantes dentales mataró", page: 2, volume: 900, from: 15, to: 4.2 },
        { text: "precio implante dental", page: 8, volume: 6000, from: 32, to: 14, since: 0.3 },
        { text: "ortodoncia invisible mataró", page: 3, volume: 500, from: 13, to: 3.9 },
        { text: "invisalign mataró", page: 3, volume: 700, from: 17, to: 6.3 },
        { text: "blanqueamiento dental mataró", page: 4, volume: 420, from: 10, to: 3.1 },
        { text: "urgencias dentales mataró", page: 5, volume: 650, from: 8, to: 2.2 },
        { text: "dentista urgencias maresme", page: 5, volume: 300, from: 14, to: 5.2 },
        { text: "dentista abierto sábado mataró", page: 6, volume: 220, from: 12, to: 4.6 },
        { text: "dentista infantil mataró", page: 7, volume: 360, from: 19, to: 7.5, since: 0.4 },
        { text: "periodoncia mataró", page: 9, volume: 150, from: 16, to: 6.8 },
      ],
      longTail: {
        heads: ["dentista", "clínica dental", "implantes dentales"],
        tails: ["argentona", "vilassar de mar", "premià de mar", "cabrera de mar", "opiniones", "precio", "financiación", "cerca de mí"],
        page: 0,
        volume: [12, 80],
        position: [8, 28],
      },
      seasonality: [1.1, 1.05, 1.05, 1, 1, 0.95, 0.8, 0.6, 1.1, 1.1, 1.05, 0.8],
      weekday: [0.7, 1.15, 1.1, 1.05, 1.05, 0.95, 0.8],
      growth: 1.15,
      anonymizedShare: 0.18,
      web: { organicShare: [0.45, 0.6], sessionsPerClick: 1.05, engagementRate: 0.62, organicConversionRate: 0.035, otherConversionRate: 0.02 },
    },
  },
  {
    client: "Hotel Llevant Calella",
    label: "hotelllevantcalella.example",
    gscSiteUrl: "https://www.hotelllevantcalella.example/",
    ga4PropertyId: "400100202",
    profile: {
      seed: "demo-seo-llevant",
      origin: "https://www.hotelllevantcalella.example",
      pages: ["/", "/habitaciones/", "/instalaciones/", "/ofertas/", "/en/", "/familias/", "/blog/que-ver-en-calella/", "/restaurante/"],
      queries: [
        { text: "hotel llevant calella", page: 0, volume: 900, from: 1.1, to: 1, brand: true },
        { text: "llevant calella", page: 0, volume: 200, from: 1.3, to: 1.2, brand: true },
        { text: "hotel calella", page: 0, volume: 5400, from: 13, to: 5.1 },
        { text: "hoteles en calella", page: 0, volume: 3600, from: 15, to: 6.2 },
        { text: "hotel calella playa", page: 0, altPage: 1, volume: 1900, from: 11, to: 3.8 },
        { text: "hotel con piscina calella", page: 2, volume: 900, from: 18, to: 4.9 },
        { text: "hotel calella todo incluido", page: 3, volume: 1300, from: 24, to: 9.5 },
        { text: "calella hotel", page: 4, volume: 2400, from: 16, to: 7.2 },
        { text: "hotel calella spain", page: 4, volume: 1100, from: 19, to: 8.1 },
        { text: "calella beach hotel", page: 4, volume: 800, from: 14, to: 4.4 },
        { text: "hotels in calella", page: 4, volume: 1200, from: 22, to: 10.4 },
        { text: "hotel calella familias", page: 5, volume: 650, from: 21, to: 8.8, since: 0.3 },
        { text: "qué ver en calella", page: 6, volume: 2800, from: 30, to: 7.9, since: 0.35 },
        { text: "hotel calella de mar", page: 0, volume: 1500, from: 17, to: 6.6 },
      ],
      longTail: {
        heads: ["hotel calella", "hoteles calella"],
        tails: ["baratos", "con parking", "adults only", "cerca de la playa", "con spa", "ofertas", "opiniones", "junio", "agosto"],
        page: 0,
        volume: [20, 120],
        position: [10, 34],
      },
      // Turismo: se busca de primavera a agosto.
      seasonality: [0.55, 0.65, 0.85, 1.05, 1.25, 1.5, 1.65, 1.5, 0.95, 0.6, 0.45, 0.5],
      weekday: [1.1, 1.05, 1, 0.98, 0.95, 0.9, 0.95],
      growth: 1.1,
      // El trabajo de SEO empezó en agosto de 2025 (contrato "SEO para hoteles").
      improveFrom: 0.14,
      anonymizedShare: 0.25,
      web: { organicShare: [0.32, 0.5], sessionsPerClick: 1.12, engagementRate: 0.55, organicConversionRate: 0.012, otherConversionRate: 0.009 },
    },
  },
  {
    client: "Restaurant Can Sorra",
    label: "cansorra.example",
    gscSiteUrl: "sc-domain:cansorra.example",
    ga4PropertyId: "400100203",
    profile: {
      seed: "demo-seo-can-sorra",
      origin: "https://www.cansorra.example",
      pages: ["/", "/carta/", "/menu-del-dia/", "/reserves/", "/es/"],
      queries: [
        { text: "can sorra", page: 0, volume: 700, from: 1.1, to: 1, brand: true },
        { text: "restaurant can sorra", page: 0, volume: 300, from: 1.1, to: 1, brand: true },
        { text: "can sorra arenys", page: 0, volume: 150, from: 1.2, to: 1.1, brand: true },
        { text: "restaurant arenys de mar", page: 0, volume: 1600, from: 9, to: 3.3 },
        { text: "restaurante arenys de mar", page: 4, altPage: 0, volume: 1300, from: 10, to: 3.9 },
        { text: "on menjar a arenys de mar", page: 0, volume: 400, from: 12, to: 4.5 },
        { text: "arròs arenys de mar", page: 1, volume: 300, from: 14, to: 5.2 },
        { text: "restaurant de peix maresme", page: 1, volume: 500, from: 20, to: 8.4 },
        { text: "restaurante marisco maresme", page: 1, volume: 700, from: 23, to: 9.9 },
        { text: "menú del dia arenys de mar", page: 2, volume: 350, from: 8, to: 2.9 },
        { text: "restaurant terrassa arenys", page: 0, volume: 260, from: 13, to: 5.8 },
        { text: "reservar restaurant arenys", page: 3, volume: 180, from: 11, to: 4.1 },
      ],
      longTail: {
        heads: ["restaurant", "restaurante"],
        tails: ["arenys de munt", "caldes d'estrac", "canet de mar", "sant vicenç de montalt", "romántico maresme", "grupos maresme", "calçotada maresme"],
        page: 0,
        volume: [10, 60],
        position: [9, 30],
      },
      seasonality: [0.75, 0.8, 0.9, 1, 1.1, 1.3, 1.45, 1.5, 1.1, 0.9, 0.75, 0.95],
      weekday: [1.25, 0.75, 0.8, 0.85, 0.95, 1.2, 1.35],
      growth: 1.2,
      anonymizedShare: 0.2,
      web: { organicShare: [0.4, 0.55], sessionsPerClick: 1.06, engagementRate: 0.5, organicConversionRate: 0.03, otherConversionRate: 0.02 },
    },
  },
];

const SEO_TABLES = ["seo_query_daily", "seo_daily_metrics", "web_analytics_daily", "seo_sync_state", "seo_properties"] as const;
const BATCH = 2000;

const sql = postgres(DATABASE_URL, { onnotice: () => {} });

async function main() {
  const [org] = await sql`select id, timezone from public.orgs where slug = 'demo'`;
  if (!org) throw new Error("No existe la org demo: ejecuta antes `pnpm db:seed:demo`.");
  const orgId: string = org.id;
  const today = nowInZone(org.timezone).date;
  // Como Search Console: 16 meses, hasta hace dos días (lo que ya está consolidado).
  const range = { from: historyStart(today), to: addDays(today, -2) };

  const clients = new Map<string, string>(
    (await sql`select id, display_name from public.clients where org_id = ${orgId}`).map((c) => [c.display_name as string, c.id as string]),
  );
  for (const site of SITES) {
    if (site.client && !clients.has(site.client)) throw new Error(`No existe el cliente «${site.client}» en la demo: ¿cambió scripts/seed-demo.ts?`);
  }

  // 0. Fuera el SEO de la demo y los restos de demos anteriores (`pnpm db:seed:demo` recrea la org
  //    con otro id y deja atrás lo que no conoce). Sin triggers, como seed-demo.ts: no ensucia la auditoría.
  await sql.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    for (const table of SEO_TABLES) {
      await tx.unsafe(`delete from public.${table} where org_id = $1 or org_id not in (select id from public.orgs)`, [orgId]);
    }
    await tx`delete from public.integrations where org_id not in (select id from public.orgs)`;
    await tx`delete from public.audit_log where org_id = ${orgId} and table_name = 'seo_properties'`;
  });

  const totals = { properties: 0, daily: 0, queries: 0, web: 0 };
  for (const site of SITES) {
    const clientId = site.client ? clients.get(site.client)! : null;
    const [property] = await sql`
      insert into public.seo_properties (org_id, label, client_id, gsc_site_url, ga4_property_id, is_primary)
      values (${orgId}, ${site.label}, ${clientId}, ${site.gscSiteUrl}, ${site.ga4PropertyId}, true)
      returning id`;
    const ids = { org_id: orgId, property_id: property!.id as string };
    const data = generateDemoSite(site.profile, range);

    const daily = data.daily.map((d) => ({ ...ids, metric_on: d.metricOn, clicks: d.clicks, impressions: d.impressions, position: d.position, source: "demo" }));
    const queries = data.queries.map((q) => ({
      ...ids,
      metric_on: q.metricOn,
      query: q.query,
      page: q.page,
      clicks: q.clicks,
      impressions: q.impressions,
      position: q.position,
      source: "demo",
    }));
    const web = data.web.map((w) => ({
      ...ids,
      metric_on: w.metricOn,
      channel: w.channel,
      sessions: w.sessions,
      users: w.users,
      engaged_sessions: w.engagedSessions,
      conversions: w.conversions,
      source: "demo",
    }));

    await sql.begin(async (tx) => {
      for (let i = 0; i < daily.length; i += BATCH) {
        await tx`insert into public.seo_daily_metrics ${tx(daily.slice(i, i + BATCH), "org_id", "property_id", "metric_on", "clicks", "impressions", "position", "source")}`;
      }
      for (let i = 0; i < queries.length; i += BATCH) {
        await tx`insert into public.seo_query_daily ${tx(queries.slice(i, i + BATCH), "org_id", "property_id", "metric_on", "query", "page", "clicks", "impressions", "position", "source")}`;
      }
      for (let i = 0; i < web.length; i += BATCH) {
        await tx`insert into public.web_analytics_daily ${tx(web.slice(i, i + BATCH), "org_id", "property_id", "metric_on", "channel", "sessions", "users", "engaged_sessions", "conversions", "source")}`;
      }
    });
    totals.properties += 1;
    totals.daily += daily.length;
    totals.queries += queries.length;
    totals.web += web.length;
    const clicks = data.daily.reduce((sum, d) => sum + d.clicks, 0);
    console.log(`  ${site.label}${site.client ? ` (${site.client})` : ""}: ${data.daily.length} días, ${queries.length} filas de consultas, ${clicks} clics en total`);
  }

  console.log(
    `SEO de la demo listo: ${totals.properties} webs, ${totals.daily} días de Search Console, ${totals.queries} filas de consultas y ` +
      `${totals.web} de GA4, del ${range.from} al ${range.to}. Ábrelo en /demo/seo.`,
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
