"use server";

import type { FinanceConfig } from "@/components/finance/types";
import type { ActionResult } from "@/lib/action-result";
import { nowInZone } from "@/lib/clock";
import { failure, forbidden, partnerContext } from "@/server/action-utils";
import { getFinanceConfig } from "@/server/finance/queries";

/**
 * Lo que necesita el panel de un gasto (emisores, categorías, proveedores, clientes, IVA…) para
 * abrirlo desde la ficha de un cliente. Se pide al pulsar «Registrar gasto», no con cada ficha.
 */
export async function loadExpenseSheetContext(slug: string): Promise<ActionResult<{ config: FinanceConfig; today: string }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  try {
    return { ok: true, config: await getFinanceConfig(ctx.org.id), today: nowInZone(ctx.org.timezone).date };
  } catch (error) {
    console.error("[clients] loadExpenseSheetContext", error);
    return failure("common.errorGeneric");
  }
}
