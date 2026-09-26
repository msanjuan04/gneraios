import { z } from "zod";
import { Constants, type Enums } from "@/lib/supabase/database.types";
import { percentToBps, requiredText } from "@/lib/validation/fiscal";

export type StageKind = Enums<"stage_kind">;
export const STAGE_KINDS = Constants.public.Enums.stage_kind;

/** Mismo límite que la base de datos (`char_length(btrim(name)) between 1 and 60`). */
const NAME_MAX = 60;

/**
 * Etapa como se escribe en el formulario: la probabilidad por defecto en porcentaje
 * ("25", "12,5"), que se guarda en puntos básicos.
 */
export const stageFormSchema = z.object({
  name: requiredText(NAME_MAX),
  kind: z.enum(STAGE_KINDS),
  probability: z
    .string()
    .trim()
    .min(1, "required")
    .transform((value, ctx) => {
      const bps = percentToBps.safeParse(value);
      if (bps.success) return bps.data;
      ctx.addIssue({ code: "custom", message: "rate" });
      return z.NEVER;
    }),
});

export type StageFormInput = z.input<typeof stageFormSchema>;
export type StageFormValues = z.output<typeof stageFormSchema>;

/** Fuentes de adquisición y motivos de pérdida: listas con nombre y orden. */
export const NAME_LISTS = ["sources", "reasons"] as const;
export type NameListKind = (typeof NAME_LISTS)[number];
export const nameListSchema = z.enum(NAME_LISTS);

export const nameItemSchema = z.object({ name: requiredText(NAME_MAX) });
export type NameItemInput = z.input<typeof nameItemSchema>;

export const directionSchema = z.enum(["up", "down"]);

/** Etapa tal como la pinta la tabla, con lo que decide qué acciones se permiten. */
export type StageItem = {
  id: string;
  name: string;
  kind: StageKind;
  default_probability_bps: number;
  /** Deals sin archivar en la etapa: los que se ven en el tablero. */
  activeDeals: number;
  /** Todos los deals en la etapa, archivados incluidos: con alguno, el tipo ya no cambia. */
  totalDeals: number;
  /** Única etapa activa de su tipo: ni se archiva ni cambia de tipo. */
  onlyOfKind: boolean;
};

export type NameItem = { id: string; name: string };

/** 2500 → "25", 1250 → "12,5": lo que escribiría el usuario. */
function bpsToPercentInput(bps: number): string {
  return (bps / 100).toLocaleString("es-ES", { maximumFractionDigits: 2, useGrouping: false });
}

/** Una etapa nueva nace abierta; al editar, los valores guardados. */
export function stageFormDefaults(
  stage?: Pick<StageItem, "name" | "kind" | "default_probability_bps">,
): StageFormInput {
  if (!stage) return { name: "", kind: "open", probability: "" };
  return { name: stage.name, kind: stage.kind, probability: bpsToPercentInput(stage.default_probability_bps) };
}
