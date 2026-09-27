// Proveedores: quién nos factura. Una empresa (SaaS, gestoría, hosting, otra agencia…) o un
// freelance, una persona que trabaja para nosotros (a menudo para un cliente concreto).

/** Mismos valores que el enum `vendor_kind` (supabase/migrations/20260927150000_proveedores.sql). */
export const VENDOR_KINDS = ["company", "freelancer"] as const;
export type VendorKind = (typeof VENDOR_KINDS)[number];

/** El filtro de tipo del listado: todos, empresas o freelancers. */
export const VENDOR_KIND_FILTERS = ["all", ...VENDOR_KINDS] as const;
export type VendorKindFilter = (typeof VENDOR_KIND_FILTERS)[number];

export function isVendorKind(value: unknown): value is VendorKind {
  return VENDOR_KINDS.some((kind) => kind === value);
}

/** El filtro que llega en la URL (?kind=freelancer); cualquier otra cosa es «todos». */
export function readVendorKindFilter(value: string | null | undefined): VendorKindFilter {
  return VENDOR_KIND_FILTERS.find((filter) => filter === value) ?? "all";
}
