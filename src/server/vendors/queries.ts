import "server-only";
import { cache } from "react";
import { readExpenseFilters } from "@/app/[org]/finance/schema";
import type {
  ClientVendorsData,
  VendorCategoryOption,
  VendorDetailData,
  VendorListItem,
  VendorsPageData,
} from "@/components/vendors/types";
import { type AllocationCostRow, clientVendorCosts, isVendorKind, type VendorKind } from "@/domain/vendors";
import { nowInZone } from "@/lib/clock";
import type { Database, Tables } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/server/action-utils";
import { fetchAll, must } from "@/server/billing/context";
import { getFinanceConfig, listExpenses } from "@/server/finance/queries";

/**
 * Cargadores de Finanzas → Proveedores (listado y ficha) y de la tarjeta de proveedores de la
 * ficha del cliente. Con el cliente del usuario: pasan por RLS. Las cifras salen de las vistas
 * vendors_overview y vendor_costs_by_allocation (supabase/migrations/20260927150000_proveedores.sql).
 */

type Org = Pick<Tables<"orgs">, "id" | "timezone">;
type OverviewRow = Database["public"]["Views"]["vendors_overview"]["Row"];
type AllocationRow = Database["public"]["Views"]["vendor_costs_by_allocation"]["Row"];

/** Últimos gastos que enseña la ficha; el resto, en Finanzas → Gastos con el filtro del proveedor. */
export const RECENT_EXPENSES = 10;

const OVERVIEW_COLUMNS =
  "id, name, kind, tax_id, country_code, contact_name, email, phone, iban, website, notes, default_category_id, archived_at, expenses_count, cost_cents, year_expenses_count, year_cost_cents, pending_cents, pending_count, overdue_cents, overdue_count, clients_count, first_expense_on, last_expense_on";

const ALLOCATION_COLUMNS =
  "vendor_id, vendor_name, vendor_kind, vendor_archived_at, allocation, client_id, client_name, expenses_count, cost_cents, year_expenses_count, year_cost_cents, pending_cents, last_expense_on";

const kindOf = (value: string | null | undefined): VendorKind => (isVendorKind(value) ? value : "company");

/** Una fila de la vista, lista para la UI (null si le falta lo imprescindible). */
function toListItem(row: Partial<OverviewRow>): VendorListItem | null {
  if (!row.id || !row.name) return null;
  return {
    id: row.id,
    name: row.name,
    kind: kindOf(row.kind),
    taxId: row.tax_id ?? null,
    countryCode: row.country_code ?? "",
    contactName: row.contact_name ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    iban: row.iban ?? null,
    website: row.website ?? null,
    notes: row.notes ?? null,
    defaultCategoryId: row.default_category_id ?? null,
    archived: Boolean(row.archived_at),
    expensesCount: row.expenses_count ?? 0,
    costCents: row.cost_cents ?? 0,
    yearExpensesCount: row.year_expenses_count ?? 0,
    yearCostCents: row.year_cost_cents ?? 0,
    pendingCents: row.pending_cents ?? 0,
    pendingCount: row.pending_count ?? 0,
    overdueCents: row.overdue_cents ?? 0,
    overdueCount: row.overdue_count ?? 0,
    clientsCount: row.clients_count ?? 0,
    firstExpenseOn: row.first_expense_on ?? null,
    lastExpenseOn: row.last_expense_on ?? null,
  };
}

function toAllocationRow(row: Partial<AllocationRow>): AllocationCostRow | null {
  if (!row.allocation) return null;
  const forClient = row.allocation === "client";
  if (forClient && !row.client_id) return null;
  return {
    allocation: row.allocation,
    clientId: forClient ? (row.client_id ?? null) : null,
    clientName: forClient ? (row.client_name ?? null) : null,
    expensesCount: row.expenses_count ?? 0,
    costCents: row.cost_cents ?? 0,
    yearExpensesCount: row.year_expenses_count ?? 0,
    yearCostCents: row.year_cost_cents ?? 0,
    pendingCents: row.pending_cents ?? 0,
    lastExpenseOn: row.last_expense_on ?? null,
  };
}

const yearOf = (org: Org) => Number(nowInZone(org.timezone).date.slice(0, 4));

/** Las categorías de gasto de la org (las archivadas, para enseñar la que ya tenía un proveedor). */
async function loadCategories(orgId: string): Promise<VendorCategoryOption[]> {
  const supabase = await createClient();
  const rows = must(
    await supabase.from("expense_categories").select("id, name, archived_at").eq("org_id", orgId).order("position").order("created_at"),
    "vendors.categories",
  );
  return rows.map((c) => ({ id: c.id, name: c.name, archived: c.archived_at !== null }));
}

/** Finanzas → Proveedores: todos los proveedores (también los archivados) con sus cifras. */
export async function getVendorsPage(org: Org): Promise<VendorsPageData> {
  const supabase = await createClient();
  const [rows, categories] = await Promise.all([
    fetchAll(
      (from, to) => supabase.from("vendors_overview").select(OVERVIEW_COLUMNS).eq("org_id", org.id).order("name").order("id").range(from, to),
      "vendors.list",
    ),
    loadCategories(org.id),
  ]);
  return {
    vendors: rows.flatMap((row) => {
      const item = toListItem(row);
      return item ? [item] : [];
    }),
    categories,
    year: yearOf(org),
  };
}

/** El nombre de un proveedor (metadatos de su ficha), una vez por petición. */
export const getVendorName = cache(async (orgId: string, vendorId: string): Promise<string | null> => {
  if (!idSchema.safeParse(vendorId).success) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("vendors").select("name").eq("org_id", orgId).eq("id", vendorId).maybeSingle();
  return data?.name ?? null;
});

/**
 * La ficha de un proveedor: sus datos y cifras, para quién ha trabajado, sus últimos gastos y lo
 * que necesita el panel del gasto. null si no existe (o la RLS no deja verlo).
 */
export async function getVendorDetail(org: Org, vendorId: string): Promise<VendorDetailData | null> {
  if (!idSchema.safeParse(vendorId).success) return null;
  const supabase = await createClient();
  const today = nowInZone(org.timezone).date;
  const expenseFilters = readExpenseFilters({ vendor: vendorId });
  // Sin el filtro saldrían los gastos de todos los proveedores: mejor fallar.
  if (expenseFilters.vendor !== vendorId) throw new Error("El listado de gastos no filtra por proveedor");
  const [overview, allocation, recent, financeConfig, categories] = await Promise.all([
    supabase.from("vendors_overview").select(OVERVIEW_COLUMNS).eq("org_id", org.id).eq("id", vendorId).maybeSingle(),
    fetchAll(
      (from, to) =>
        supabase
          .from("vendor_costs_by_allocation")
          .select(ALLOCATION_COLUMNS)
          .eq("org_id", org.id)
          .eq("vendor_id", vendorId)
          .order("allocation")
          .order("client_id")
          .range(from, to),
      "vendors.detail.allocation",
    ),
    // Los mismos gastos (y el mismo panel) que Finanzas → Gastos, con el filtro del proveedor.
    listExpenses(supabase, org.id, expenseFilters, RECENT_EXPENSES),
    getFinanceConfig(org.id),
    loadCategories(org.id),
  ]);
  if (overview.error) throw overview.error;
  const vendor = overview.data ? toListItem(overview.data) : null;
  if (!vendor) return null;
  return {
    vendor,
    allocation: allocation.flatMap((row) => {
      const item = toAllocationRow(row);
      return item ? [item] : [];
    }),
    recentExpenses: recent.rows,
    categories,
    financeConfig,
    today,
    year: Number(today.slice(0, 4)),
  };
}

/**
 * Los proveedores y freelancers que han trabajado para un cliente (los que tienen gastos
 * asignados a él), con lo que han costado este año y en total. Para su tarjeta en la ficha del
 * cliente (src/components/vendors/client-vendors-card.tsx).
 */
export async function getClientVendorCosts(org: Org, clientId: string): Promise<ClientVendorsData> {
  const year = yearOf(org);
  if (!idSchema.safeParse(clientId).success) return { vendors: [], totals: { expensesCount: 0, costCents: 0, yearCostCents: 0 }, year };
  const supabase = await createClient();
  const rows = await fetchAll(
    (from, to) =>
      supabase
        .from("vendor_costs_by_allocation")
        .select(ALLOCATION_COLUMNS)
        .eq("org_id", org.id)
        .eq("client_id", clientId)
        .eq("allocation", "client")
        .order("vendor_id")
        .range(from, to),
    "vendors.client",
  );
  const { vendors, totals } = clientVendorCosts(
    rows.flatMap((row) =>
      row.vendor_id && row.vendor_name
        ? [
            {
              vendorId: row.vendor_id,
              name: row.vendor_name,
              kind: kindOf(row.vendor_kind),
              archived: Boolean(row.vendor_archived_at),
              expensesCount: row.expenses_count ?? 0,
              costCents: row.cost_cents ?? 0,
              yearCostCents: row.year_cost_cents ?? 0,
              lastExpenseOn: row.last_expense_on ?? null,
            },
          ]
        : [],
    ),
  );
  return { vendors, totals, year };
}
