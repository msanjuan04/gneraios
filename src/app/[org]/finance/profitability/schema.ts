import { z } from "zod";
import { bpsToInput, centsToInput, parsePercentInput } from "@/app/[org]/invoices/schema";
import { parseMoneyInput } from "@/domain/money";

/**
 * Formularios de la rentabilidad (coste por hora de un miembro y umbrales), compartidos por los
 * paneles (cliente) y las acciones (servidor). Los importes se escriben a la española ("35",
 * "37,50") y viajan como texto; el servidor los pasa a céntimos y puntos básicos. Los mensajes son
 * claves de `profitability.validation.*`.
 */

/** 1.000 €/h: el tope de la base de datos (member_costs) y de orgs.settings. */
export const MAX_HOURLY_CENTS = 100_000;

const hourlyMoney = z
  .string()
  .trim()
  .min(1, "required")
  .refine((value) => {
    const cents = parseMoneyInput(value);
    return cents !== null && cents >= 0 && cents <= MAX_HOURLY_CENTS;
  }, "hourly");

const percent = z
  .string()
  .trim()
  .min(1, "required")
  .refine((value) => parsePercentInput(value) !== null, "percent");

export const memberCostFormSchema = z.object({
  member_id: z.guid("required"),
  valid_from: z.iso.date("date").refine((value) => value >= "2000-01-01", "date"),
  hourly_cost: hourlyMoney,
});
export type MemberCostFormInput = z.input<typeof memberCostFormSchema>;

export const profitabilitySettingsFormSchema = z.object({
  default_hourly_cost: hourlyMoney,
  min_margin_percent: percent,
  min_hourly_rate: hourlyMoney,
});
export type ProfitabilitySettingsFormInput = z.input<typeof profitabilitySettingsFormSchema>;

/** Importe ya validado → céntimos. */
export const hourlyToCents = (value: string): number => parseMoneyInput(value.trim()) ?? 0;
/** Porcentaje ya validado → puntos básicos. */
export const percentToBps = (value: string): number => parsePercentInput(value.trim()) ?? 0;

/** Céntimos → texto editable, sin decimales si es redondo: 3500 → "35", 3750 → "37,50". */
export function hourlyToInput(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : centsToInput(cents);
}

export { bpsToInput };
