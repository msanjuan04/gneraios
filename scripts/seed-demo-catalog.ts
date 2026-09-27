/**
 * Catálogo de servicios de la org demo: los once servicios del catálogo de ejemplo (el mismo que
 * crea «Crear servicios de ejemplo», src/domain/catalog/starter.ts), con el IVA por defecto de la
 * demo y sus textos en castellano, catalán e inglés, y dos packs con descuento: «Pack Lanzamiento»
 * (branding, web, hosting y mantenimiento) y «Pack Crecimiento» (auditoría SEO, SEO mensual y
 * Google Ads).
 *
 *   pnpm exec tsx --env-file-if-exists=.env.local scripts/seed-demo-catalog.ts
 *
 * Necesita la org `demo` de `pnpm db:seed:demo` (y se vuelve a ejecutar después de recrearla). Es
 * determinista y re-ejecutable: borra el catálogo de la demo (y los restos de demos anteriores) y
 * lo vuelve a crear, así que ejecutarlo dos veces deja lo mismo. Solo contra la base local: se
 * niega a conectarse a cualquier otro host.
 */
import postgres from "postgres";
import { STARTER_BUNDLES, STARTER_ITEMS } from "../src/domain/catalog";
import { starterItemRows } from "../src/server/catalog/rows";

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

// En orden de dependencias (los servicios de un pack, antes que el pack y que los servicios).
const CATALOG_TABLES = ["catalog_bundle_items", "catalog_bundles", "catalog_items"];

const sql = postgres(DATABASE_URL, { onnotice: () => {} });

async function main() {
  const [org] = await sql`select id from public.orgs where slug = 'demo'`;
  if (!org) throw new Error("No existe la org demo: ejecuta antes `pnpm db:seed:demo`.");
  const orgId: string = org.id;
  const [vat] = await sql`
    select id, name from public.tax_rates
    where org_id = ${orgId} and kind = 'vat' and archived_at is null
    order by is_default desc, position, name
    limit 1`;
  if (!vat) throw new Error("La demo no tiene ningún tipo de IVA vigente: vuelve a ejecutar `pnpm db:seed:demo`.");

  // 0. Fuera el catálogo de la demo y los restos de demos anteriores. Sin triggers, como seed-demo.ts:
  //    no ensucia la auditoría.
  await sql.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    for (const table of CATALOG_TABLES) {
      await tx.unsafe(`delete from public.${table} where org_id = $1 or org_id not in (select id from public.orgs)`, [orgId]);
    }
    await tx`delete from public.audit_log where org_id = ${orgId} and table_name = any(${CATALOG_TABLES})`;
  });

  // 1. Servicios y packs, en una transacción y con los triggers de siempre (el guardia comprueba
  //    que el IVA sea un tipo de IVA vigente).
  const rows = starterItemRows({ orgId, taxRateId: vat.id as string });
  const summary = await sql.begin(async (tx) => {
    const idByKey = new Map<string, string>();
    for (const [index, row] of rows.entries()) {
      const [item] = await tx`
        insert into public.catalog_items
          (org_id, category, name, description, translations, billing_type, unit_label, unit_price_cents,
           default_quantity, tax_rate_id, irpf_applies, position)
        values
          (${row.org_id}, ${row.category}, ${row.name}, ${row.description}, ${tx.json(row.translations as postgres.JSONValue)},
           ${row.billing_type}, ${row.unit_label}, ${row.unit_price_cents}, ${row.default_quantity}, ${row.tax_rate_id},
           ${row.irpf_applies}, ${row.position})
        returning id`;
      idByKey.set(STARTER_ITEMS[index]!.key, item!.id as string);
    }

    for (const [position, bundle] of STARTER_BUNDLES.entries()) {
      const [row] = await tx`
        insert into public.catalog_bundles (org_id, name, description, translations, discount_bps, position)
        values (${orgId}, ${bundle.name}, ${bundle.description}, ${tx.json(bundle.translations as postgres.JSONValue)},
                ${bundle.discountBps}, ${position})
        returning id`;
      for (const [index, entry] of bundle.items.entries()) {
        const itemId = idByKey.get(entry.key);
        if (!itemId) throw new Error(`El pack «${bundle.name}» lleva «${entry.key}», que no está en el catálogo de ejemplo.`);
        await tx`
          insert into public.catalog_bundle_items (org_id, bundle_id, item_id, quantity, position)
          values (${orgId}, ${row!.id}, ${itemId}, ${entry.quantity}, ${index})`;
      }
    }
    return { items: idByKey.size, bundles: STARTER_BUNDLES.length };
  });

  console.log(
    `Catálogo de la demo listo: ${summary.items} servicios con ${vat.name as string} y ${summary.bundles} packs ` +
      `(${STARTER_BUNDLES.map((b) => b.name).join(", ")}). Ábrelo en /demo/settings/catalog.`,
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
