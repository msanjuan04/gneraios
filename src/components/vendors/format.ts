import { useLocale } from "next-intl";
import { useFinanceFormat } from "@/components/finance/format";
import { formatBps } from "@/domain/money";

/** Los formatos de Finanzas y, para los repartos, porcentajes con un decimal («46,1 %»). */
export function useVendorFormat() {
  const locale = useLocale();
  return {
    ...useFinanceFormat(),
    share: (bps: number) => formatBps(Math.round(bps / 10) * 10, locale),
  };
}

export type VendorFormat = ReturnType<typeof useVendorFormat>;

/** Los colores del reparto (tokens de marca, como las barras del dashboard): el azul, los clientes. */
export const ALLOCATION_FILL = {
  client: "var(--chart-1)",
  company: "color-mix(in oklab, var(--foreground) 34%, var(--card))",
  hosted_sites: "color-mix(in oklab, var(--chart-1) 50%, var(--chart-4))",
} as const;

/** Pista de las barras de reparto: el azul de marca muy rebajado (la del dashboard). */
export { TRACK } from "@/components/dashboard/colors";
