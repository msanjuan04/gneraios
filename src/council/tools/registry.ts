// Registro de las tools: nombre → definición, su esquema JSON para el modelo y un ejecutor que
// valida la entrada y la salida con Zod. Todas son de solo lectura (CouncilData no escribe).

import { z } from "zod";
import { getCapacity } from "./capacity";
import { getCashForecast, getCashPosition, getExpenses, getRunway } from "./cash";
import { getAtRiskClients, getRenewals, getUpsellCandidates } from "./clients";
import { getMonthlyClose } from "./close";
import { getPastRecommendations, getPolicy } from "./council";
import { getConversionBySource, getPipeline, getStalledDeals } from "./pipeline";
import { getClientProfitability } from "./profitability";
import { getConcentration, getReceivables } from "./receivables";
import { getChurn, getMrrHistory, getNrr, getRevenue } from "./revenue";
import { getSeoSummary } from "./seo";
import { simulate } from "./simulate";
import { getTaxProvisions } from "./tax";
import { toolResultSchema, type ToolContext, type ToolDefinition, type ToolResult } from "./types";

/** Orden estable: forma parte del prefijo que se cachea (cambiarlo invalida la caché). */
export const TOOL_NAMES = [
  "get_revenue",
  "get_mrr_history",
  "get_churn",
  "get_nrr",
  "get_receivables",
  "get_concentration",
  "get_pipeline",
  "get_stalled_deals",
  "get_conversion_by_source",
  "get_renewals",
  "get_at_risk_clients",
  "get_upsell_candidates",
  "get_client_profitability",
  "get_capacity",
  "get_seo_summary",
  "get_policy",
  "get_past_recommendations",
  "simulate",
  "get_monthly_close",
  "get_expenses",
  "get_cash_position",
  "get_cash_forecast",
  "get_runway",
  "get_tax_provisions",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export function isToolName(value: unknown): value is ToolName {
  return typeof value === "string" && (TOOL_NAMES as readonly string[]).includes(value);
}

const ALL: ToolDefinition[] = [
  getRevenue,
  getMrrHistory,
  getChurn,
  getNrr,
  getReceivables,
  getConcentration,
  getPipeline,
  getStalledDeals,
  getConversionBySource,
  getRenewals,
  getAtRiskClients,
  getUpsellCandidates,
  getClientProfitability,
  getCapacity,
  getSeoSummary,
  getPolicy,
  getPastRecommendations,
  simulate,
  getMonthlyClose,
  getExpenses,
  getCashPosition,
  getCashForecast,
  getRunway,
  getTaxProvisions,
] as ToolDefinition[];

export const TOOLS: ReadonlyMap<ToolName, ToolDefinition> = new Map(
  TOOL_NAMES.map((name) => {
    const tool = ALL.find((t) => t.name === name);
    if (!tool) throw new Error(`Falta la tool ${name} en el registro`);
    return [name, tool];
  }),
);

/** Definición de una tool para el modelo (proveedor agnóstico): nombre, descripción y esquema JSON de la entrada. */
export type ToolSpec = { name: ToolName; description: string; inputSchema: Record<string, unknown> };

function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

let specs: ToolSpec[] | null = null;

/** Todas las tools en orden estable (el mismo para todos los agentes: comparten la caché del prefijo). */
export function toolSpecs(): ToolSpec[] {
  specs ??= TOOL_NAMES.map((name) => {
    const tool = TOOLS.get(name)!;
    return { name, description: tool.description, inputSchema: jsonSchemaOf(tool.input) };
  });
  return specs;
}

export type ToolOutcome = { ok: true; result: ToolResult } | { ok: false; error: string };

/** Ejecuta una tool con la entrada que pide el modelo: valida entrada y salida y nunca lanza. */
export async function executeTool(name: string, input: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  if (!isToolName(name)) return { ok: false, error: `No existe la tool «${name}».` };
  const tool = TOOLS.get(name)!;
  const parsed = tool.input.safeParse(input ?? {});
  if (!parsed.success) {
    return { ok: false, error: `Entrada no válida para ${name}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`).join("; ")}` };
  }
  try {
    const result = toolResultSchema.parse(await tool.run(ctx, parsed.data));
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
