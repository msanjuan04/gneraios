import { z } from "zod";
import { centsToInput } from "@/app/[org]/invoices/schema";
import { FINANCE_SETTINGS_LIMITS } from "@/app/[org]/settings/schema";
import { parseMoneyInput } from "@/domain/money";

/**
 * Avisos de renovación (orgs.settings.finance), compartido por el panel (cliente) y la acción
 * (servidor). El importe se escribe a la española ("50", "49,90") y viaja como texto; el servidor lo
 * pasa a céntimos. Los mensajes son claves de `infrastructure.validation.*`.
 */

const DAYS = FINANCE_SETTINGS_LIMITS.renewal_warning_days;
const MONTHLY_MIN = FINANCE_SETTINGS_LIMITS.monthly_renewal_min_cents;

export const renewalSettingsFormSchema = z.object({
  renewal_warning_days: z.number("warningDays").int("warningDays").min(DAYS.min, "warningDays").max(DAYS.max, "warningDays"),
  monthly_renewal_min: z
    .string()
    .trim()
    .min(1, "required")
    .refine((value) => {
      const cents = parseMoneyInput(value);
      return cents !== null && cents >= MONTHLY_MIN.min && cents <= MONTHLY_MIN.max;
    }, "amount"),
});

export type RenewalSettingsFormInput = z.input<typeof renewalSettingsFormSchema>;

/** Importe ya validado → céntimos. */
export const amountToCents = (value: string): number => parseMoneyInput(value.trim()) ?? 0;

/** Céntimos → texto editable, sin decimales si es redondo: 5000 → "50", 4990 → "49,90". */
export function centsToAmountInput(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : centsToInput(cents);
}
