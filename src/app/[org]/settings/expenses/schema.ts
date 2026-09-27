import { z } from "zod";
import { EXPENSE_GROUPS } from "@/app/[org]/finance/schema";
import { requiredText } from "@/lib/validation/fiscal";

/** Mismo límite que la base de datos (`char_length(btrim(name)) between 1 and 60`). */
const NAME_MAX = 60;

export const categoryFormSchema = z.object({
  name: requiredText(NAME_MAX),
  expense_group: z.enum(EXPENSE_GROUPS),
  is_fixed: z.boolean(),
});

export type CategoryFormInput = z.input<typeof categoryFormSchema>;
