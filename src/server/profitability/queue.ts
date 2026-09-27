// Sin "server-only", como load.ts. Solo se importa desde código de servidor (la cola «Por hacer»).
import type { CivilDate } from "@/domain/dates/civil-date";
import { needsAttention, rollingPeriod } from "@/domain/profitability";
import type { Db } from "@/server/billing/context";
import { loadProfitability } from "./load";

/**
 * Cuántos clientes están por debajo de los umbrales en los últimos 3 meses (margen o €/hora bajos,
 * u horas sin facturar), para «Por hacer». 0 si quien pregunta no ve ningún coste por hora: o la
 * org aún no los tiene (la rentabilidad enseña cómo configurarlos) o es un viewer (la RLS se los
 * oculta, y valorarlo todo con el coste por defecto daría una cuenta engañosa).
 */
export async function countClientsBelowThresholds(db: Db, org: { id: string; settings: unknown }, today: CivilDate): Promise<number> {
  const { count, error } = await db.from("member_costs").select("id", { count: "exact", head: true }).eq("org_id", org.id);
  if (error) throw error;
  if (!count) return 0;
  const { report } = await loadProfitability(db, org, rollingPeriod(today, 3));
  return report.clients.filter(needsAttention).length;
}
