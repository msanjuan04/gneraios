// Sin "server-only": estos módulos los usa también el seed de la demo (scripts/seed-demo.ts),
// que ejecuta el motor real. Solo se importan desde código de servidor.
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { TaxRateRef } from "@/domain/invoicing/draft-line";
import type { Database, Tables } from "@/lib/supabase/database.types";

export type Db = SupabaseClient<Database>;

/** Regla de negocio incumplida: `key` es la clave de i18n del mensaje. */
export class BillingRuleError extends Error {
  constructor(readonly key: string) {
    super(key);
    this.name = "BillingRuleError";
  }
}

export class DbError extends Error {
  constructor(
    readonly error: PostgrestError,
    readonly where: string,
  ) {
    super(`${where}: ${error.message}`);
    this.name = "DbError";
  }
}

/** Lanza si PostgREST devuelve error; devuelve los datos si no. */
export function must<T>(result: { data: T; error: PostgrestError | null }, where: string): NonNullable<T> {
  if (result.error) throw new DbError(result.error, where);
  if (result.data === null || result.data === undefined) {
    throw new DbError({ message: "not found", details: "", hint: "", code: "PGRST116", name: "PostgrestError" } as PostgrestError, where);
  }
  return result.data as NonNullable<T>;
}

/**
 * Lee todas las filas de una consulta paginando (PostgREST devuelve como mucho 1.000 por
 * petición). `build` recibe el rango y devuelve la consulta ya filtrada y ordenada.
 */
export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>,
  where: string,
  pageSize = 1000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw new DbError(error, where);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
}

export type OrgSettings = {
  paymentTermsDays: number;
  billingDay: number;
  dunningDays: number[];
  renewalAlertDays: number[];
};

function numberList(value: unknown, fallback: number[]): number[] {
  return Array.isArray(value) && value.every((v) => Number.isInteger(v)) ? (value as number[]) : fallback;
}

/** Umbrales de negocio de la org (viven en orgs.settings, no en el código). */
export function orgSettings(org: Pick<Tables<"orgs">, "settings">): OrgSettings {
  const s = (org.settings ?? {}) as Record<string, unknown>;
  return {
    paymentTermsDays: typeof s.payment_terms_days === "number" ? s.payment_terms_days : 30,
    billingDay: typeof s.billing_day === "number" ? s.billing_day : 1,
    dunningDays: numberList(s.dunning_days, [7, 15]),
    renewalAlertDays: numberList(s.renewal_alert_days, [60, 30, 7]),
  };
}

export function taxRateRef(row: Pick<Tables<"tax_rates">, "id" | "rate_bps" | "regime" | "legal_note">): TaxRateRef {
  return { id: row.id, rateBps: row.rate_bps, regime: row.regime ?? "general", legalNote: row.legal_note };
}

/** Tipos de IVA de la org por id. */
export async function loadVatRates(db: Db, orgId: string): Promise<Map<string, TaxRateRef>> {
  const rows = must(
    await db.from("tax_rates").select("id, rate_bps, regime, legal_note").eq("org_id", orgId).eq("kind", "vat"),
    "loadVatRates",
  );
  return new Map(rows.map((r) => [r.id, taxRateRef(r)]));
}
