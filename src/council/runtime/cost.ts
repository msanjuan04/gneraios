// Coste estimado de una ejecución con la tabla de precios de agents.config.ts. 1 USD por millón de
// tokens = 1 millonésima de dólar por token, así que el coste en millonésimas es Σ tokens × precio.

import { isCouncilModel, MODEL_PRICES_USD_PER_MTOK } from "../agents.config";
import type { Usage } from "../store/types";

/** Coste en millonésimas de dólar (redondeado). Un modelo sin precio conocido cuesta 0 y se avisa en el log. */
export function estimateCostUsdMicros(model: string, usage: Usage): number {
  const price = isCouncilModel(model) ? MODEL_PRICES_USD_PER_MTOK[model] : null;
  if (!price) return 0;
  return Math.round(
    usage.inputTokens * price.input + usage.outputTokens * price.output + usage.cacheWriteTokens * price.cacheWrite + usage.cacheReadTokens * price.cacheRead,
  );
}

/** Millonésimas de dólar → céntimos de dólar (para compararlo con el presupuesto). */
export const microsToUsdCents = (micros: number) => micros / 10_000;
