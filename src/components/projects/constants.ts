/** Pestañas de la ficha de un proyecto (?tab=…). Sin "use client": también las lee la página del servidor. */
export const DETAIL_TABS = ["tasks", "deliveries", "time", "summary"] as const;
export type DetailTab = (typeof DETAIL_TABS)[number];

export function readDetailTab(value: unknown): DetailTab {
  return DETAIL_TABS.find((tab) => tab === value) ?? "tasks";
}
