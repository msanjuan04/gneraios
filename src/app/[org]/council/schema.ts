// Entradas de las acciones del consejo (validadas en el servidor; la base de datos lo vuelve a
// comprobar con sus triggers y su RLS).

import { z } from "zod";

const civilDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const decisionSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("aceptada") }),
  z.object({
    status: z.literal("descartada"),
    note: z
      .string()
      .trim()
      .min(3, "council.errors.discardReason")
      .max(300)
      .refine((v) => !/[\n\r]/.test(v), "council.errors.discardReason"),
  }),
  z.object({ status: z.literal("pospuesta"), postponedUntil: civilDate }),
  z.object({ status: z.literal("hecha") }),
  z.object({ status: z.literal("nueva") }),
]);
export type DecisionInput = z.infer<typeof decisionSchema>;

const cents = z.number().int().min(0).max(1_000_000_000_000);

export const closeDecisionSchema = z.object({
  buckets: z.object({ taxes: cents, cushion: cents, reinvestment: cents, partners: cents }).strict(),
  note: z.string().trim().max(300).optional(),
});
export type CloseDecisionInput = z.infer<typeof closeDecisionSchema>;

export const FEED_TABS = ["new", "postponed", "accepted", "history"] as const;

export function readFeedTab(value: unknown): (typeof FEED_TABS)[number] {
  const first = Array.isArray(value) ? value[0] : value;
  return FEED_TABS.find((t) => t === first) ?? "new";
}
