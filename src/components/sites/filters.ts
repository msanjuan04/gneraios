/** Filtros del listado de Webs (?filter=…). Sin "use client": lo lee también la página (servidor). */
export const SITES_FILTERS = ["all", "problems", "hosted"] as const;
export type SitesFilter = (typeof SITES_FILTERS)[number];

export function readSitesFilter(value: string | null | undefined): SitesFilter {
  return SITES_FILTERS.find((f) => f === value) ?? "all";
}
