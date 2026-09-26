import { z } from "zod";
import { parseMoneyInput } from "@/domain/money";
import { requiredText, text } from "@/lib/validation/fiscal";

const optionalId = z.union([z.literal(""), z.guid()]);

/** Importe escrito a la española ("1.500", "450,50"). Vacío = 0. */
export function moneyToCents(value: string): number | null {
  return value.trim() === "" ? 0 : parseMoneyInput(value);
}

/** Porcentaje opcional ("" = el de la etapa) a puntos básicos. */
export function percentToBps(value: string): number | null | undefined {
  if (value.trim() === "") return null;
  const n = Number(value.replace(",", "."));
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 100) : undefined;
}

export const dealFormSchema = z
  .object({
    title: requiredText(200),
    // Cliente existente o, si está vacío, uno nuevo con este nombre (así nace un lead).
    client_id: optionalId,
    new_client_name: text(200),
    stage_id: z.guid("required"),
    est_one_off: z.string(),
    est_mrr: z.string(),
    probability: z.string(),
    source_id: optionalId,
    brought_by_member_id: optionalId,
    owner_member_id: optionalId,
    next_action: text(200),
    next_action_on: z.union([z.literal(""), z.iso.date()]),
    loss_reason_id: optionalId,
    loss_note: text(500),
  })
  .superRefine((v, ctx) => {
    if (!v.client_id && !v.new_client_name.trim()) {
      ctx.addIssue({ code: "custom", path: ["client_id"], message: "clientRequired" });
    }
    if (moneyToCents(v.est_one_off) === null) ctx.addIssue({ code: "custom", path: ["est_one_off"], message: "money" });
    if (moneyToCents(v.est_mrr) === null) ctx.addIssue({ code: "custom", path: ["est_mrr"], message: "money" });
    if (percentToBps(v.probability) === undefined) ctx.addIssue({ code: "custom", path: ["probability"], message: "rate" });
  });

export type DealFormInput = z.input<typeof dealFormSchema>;
export type DealFormValues = z.output<typeof dealFormSchema>;

export const moveDealSchema = z.object({
  deal_id: z.guid(),
  stage_id: z.guid(),
  loss_reason_id: optionalId.optional(),
  loss_note: text(500).optional(),
});
export type MoveDealInput = z.input<typeof moveDealSchema>;
