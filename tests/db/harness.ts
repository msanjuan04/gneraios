import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";

const MIGRATIONS_DIR = join(import.meta.dirname, "../../supabase/migrations");

/**
 * Lo mínimo que Supabase trae de serie y que las migraciones dan por hecho:
 * roles de la API, auth.users y auth.uid() leyendo el JWT de la sesión, y los
 * privilegios por defecto del esquema public. Imita a Supabase, no lo sustituye:
 * el stack completo se prueba con `supabase start` cuando hay Docker.
 */
const SUPABASE_SHIM = `
  create role anon nologin noinherit;
  create role authenticated nologin noinherit;
  create role service_role nologin noinherit bypassrls;

  create schema auth;
  create schema extensions;
  grant usage on schema extensions to anon, authenticated, service_role;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text unique,
    created_at timestamptz not null default now()
  );
  create function auth.uid() returns uuid language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;

  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

export type Db = PGlite;

/** Postgres limpio con el shim de Supabase y todas las migraciones aplicadas. */
export async function createDb(): Promise<Db> {
  const db = new PGlite({ extensions: { unaccent } });
  await db.exec(SUPABASE_SHIM);
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
  return db;
}

/** Crea un usuario de auth y devuelve su id. */
export async function createUser(db: Db, email: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "insert into auth.users (email) values ($1) returning id",
    [email],
  );
  return rows[0]!.id;
}

/**
 * Ejecuta `fn` como lo haría PostgREST para ese usuario: rol `authenticated`
 * (o `anon` si no hay usuario) y el `sub` del JWT en la sesión.
 */
export async function as<T>(db: Db, userId: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${userId ? "authenticated" : "anon"}`);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}

type PayloadIssuer = Record<string, unknown> & { series: Record<string, unknown>[] };

/** Payload de onboarding mínimo y válido, con sobrescrituras opcionales. */
export function onboardingPayload(overrides: Record<string, unknown> = {}) {
  const issuers: PayloadIssuer[] = [
      {
        kind: "company",
        legal_name: "GNERAI SL",
        trade_name: "GNERAI",
        is_primary: true,
        series: [
          { code: "F", name: "Facturas", kind: "ordinary", format: "{yyyy}-{n:4}", is_default: true },
          { code: "R", name: "Rectificativas", kind: "rectifying", format: "R{yyyy}-{n:4}", is_default: true },
        ],
      },
      {
        kind: "self_employed",
        legal_name: "Socio Autónomo Uno",
        tax_id: "12345678-z",
        default_irpf_bps: 1500,
        is_me: true,
        series: [
          {
            code: "F",
            name: "Facturas",
            kind: "ordinary",
            format: "{yyyy}-{n:4}",
            is_default: true,
            last_number: 37,
            last_number_year: 2026,
          },
        ],
      },
  ];
  return {
    org: { name: "GNERAI", slug: "gnerai" },
    owner: { full_name: "Marc Sanjuan", initials: "MS", locale: "es" },
    issuers,
    tax_rates: [
      { kind: "vat", name: "IVA 21 %", rate_bps: 2100, regime: "general", is_default: true },
      { kind: "vat", name: "Exento", rate_bps: 0, regime: "exempt", legal_note: "Operación exenta de IVA" },
      { kind: "irpf", name: "IRPF 15 %", rate_bps: 1500, is_default: true },
    ],
    invitations: [{ email: "socio2@example.com", role: "owner", full_name: "Socio Dos" }],
    ...overrides,
  };
}

/** Crea una org completa como `userId` y devuelve su id. */
export async function createOrg(db: Db, userId: string, payload = onboardingPayload()): Promise<string> {
  return as(db, userId, async () => {
    const { rows } = await db.query<{ id: string }>("select public.create_organization($1::jsonb) as id", [
      JSON.stringify(payload),
    ]);
    return rows[0]!.id;
  });
}
