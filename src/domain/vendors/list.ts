// El listado de proveedores: búsqueda sin acentos ni mayúsculas (también por NIF con o sin
// guiones), el filtro de tipo, los archivados y el orden por columnas.

import type { CivilDate } from "../dates/civil-date";
import type { Cents } from "../money";
import { VENDOR_KIND_FILTERS, type VendorKind, type VendorKindFilter } from "./kinds";

/** Lo que el listado necesita de cada proveedor para buscar, filtrar y ordenar. */
export type VendorListRow = {
  name: string;
  kind: VendorKind;
  taxId: string | null;
  contactName: string | null;
  email: string | null;
  archived: boolean;
  yearCostCents: Cents;
  costCents: Cents;
  pendingCents: Cents;
  clientsCount: number;
  lastExpenseOn: CivilDate | null;
};

export type VendorListFilter = { query: string; kind: VendorKindFilter; showArchived: boolean };

/** Minúsculas y sin acentos: "Mataró" y "mataro" son lo mismo al buscar. */
export function foldText(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Solo letras y números: "B-76.024.157" y "b76024157" son el mismo NIF. */
const compact = (value: string) => foldText(value).replace(/[^\p{L}\p{N}]/gu, "");

/** Cada palabra de la búsqueda está en el nombre, el NIF, el contacto o el email. */
export function matchesVendorQuery(vendor: Pick<VendorListRow, "name" | "taxId" | "contactName" | "email">, query: string): boolean {
  const terms = foldText(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = foldText([vendor.name, vendor.taxId, vendor.contactName, vendor.email].filter(Boolean).join(" "));
  const taxId = vendor.taxId ? compact(vendor.taxId) : "";
  return terms.every((term) => haystack.includes(term) || (taxId !== "" && compact(term) !== "" && taxId.includes(compact(term))));
}

/** Los que se ven con el filtro: del tipo elegido, archivados solo si se piden y que casen con la búsqueda. */
export function filterVendors<T extends VendorListRow>(vendors: readonly T[], filter: VendorListFilter): T[] {
  return vendors.filter(
    (v) => (filter.showArchived || !v.archived) && (filter.kind === "all" || v.kind === filter.kind) && matchesVendorQuery(v, filter.query),
  );
}

/** Cuántos hay de cada tipo (con los archivados o sin ellos): los contadores del filtro. */
export function countVendorKinds(vendors: readonly Pick<VendorListRow, "kind" | "archived">[], showArchived: boolean): Record<VendorKindFilter, number> {
  const counts = Object.fromEntries(VENDOR_KIND_FILTERS.map((f) => [f, 0])) as Record<VendorKindFilter, number>;
  for (const v of vendors) {
    if (v.archived && !showArchived) continue;
    counts.all += 1;
    counts[v.kind] += 1;
  }
  return counts;
}

/** Columnas por las que se ordena el listado. */
export const VENDOR_SORT_KEYS = ["name", "yearCost", "cost", "pending", "clients", "lastExpense"] as const;
export type VendorSortKey = (typeof VENDOR_SORT_KEYS)[number];
export type SortDirection = "asc" | "desc";
export type VendorSort = { key: VendorSortKey; direction: SortDirection };

/** Lo que más cuesta este año arriba: el orden de entrada. */
export const DEFAULT_VENDOR_SORT: VendorSort = { key: "yearCost", direction: "desc" };

/** Al pulsar una columna: el nombre empieza de la A a la Z; las cifras, de mayor a menor. */
export function nextVendorSort(current: VendorSort, key: VendorSortKey): VendorSort {
  if (current.key === key) return { key, direction: current.direction === "asc" ? "desc" : "asc" };
  return { key, direction: key === "name" ? "asc" : "desc" };
}

const byName = (a: VendorListRow, b: VendorListRow) => a.name.localeCompare(b.name, "es", { sensitivity: "base" });

function compareBy(key: VendorSortKey, a: VendorListRow, b: VendorListRow): number {
  switch (key) {
    case "name":
      return byName(a, b);
    case "yearCost":
      return a.yearCostCents - b.yearCostCents;
    case "cost":
      return a.costCents - b.costCents;
    case "pending":
      return a.pendingCents - b.pendingCents;
    case "clients":
      return a.clientsCount - b.clientsCount;
    case "lastExpense":
      // Sin gastos, siempre al final.
      return (a.lastExpenseOn ?? "").localeCompare(b.lastExpenseOn ?? "");
  }
}

/**
 * Ordena por la columna elegida; a igualdad, por lo de siempre (de mayor a menor) y por nombre.
 * Los archivados van después de los activos. No toca la lista de entrada.
 */
export function sortVendors<T extends VendorListRow>(vendors: readonly T[], sort: VendorSort = DEFAULT_VENDOR_SORT): T[] {
  const sign = sort.direction === "asc" ? 1 : -1;
  return [...vendors].sort((a, b) => {
    if (a.archived !== b.archived) return a.archived ? 1 : -1;
    if (sort.key === "lastExpense" && (a.lastExpenseOn === null) !== (b.lastExpenseOn === null)) return a.lastExpenseOn === null ? 1 : -1;
    return sign * compareBy(sort.key, a, b) || b.costCents - a.costCents || byName(a, b);
  });
}

/** Totales de lo que se ve: el coste del año, el de siempre y lo pendiente de pagar. */
export function vendorListTotals(vendors: readonly Pick<VendorListRow, "yearCostCents" | "costCents" | "pendingCents">[]): {
  yearCostCents: Cents;
  costCents: Cents;
  pendingCents: Cents;
} {
  return vendors.reduce(
    (sum, v) => ({ yearCostCents: sum.yearCostCents + v.yearCostCents, costCents: sum.costCents + v.costCents, pendingCents: sum.pendingCents + v.pendingCents }),
    { yearCostCents: 0, costCents: 0, pendingCents: 0 },
  );
}
