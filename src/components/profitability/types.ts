// Datos de la rentabilidad tal como los pinta la UI (serializables: pasan de servidor a cliente).
// Los cargan src/server/profitability con la sesión del usuario (RLS: los costes, solo socios).

import type { CivilDate } from "@/domain/dates/civil-date";
import type { ClientBreakdown, Figures, MemberCost, Period, ProfitabilityReport, ProfitabilitySettings } from "@/domain/profitability";

export type MemberCostEntry = MemberCost & { id: string };

export type MemberCostsMember = {
  id: string;
  fullName: string;
  initials: string;
  isActive: boolean;
  /** De la fecha más antigua a la más reciente. */
  history: MemberCostEntry[];
};

/** Ajustes → Equipo: el coste por hora de cada miembro y su historial. */
export type MemberCostsData = {
  today: CivilDate;
  settings: ProfitabilitySettings;
  members: MemberCostsMember[];
};

/** Finanzas → Rentabilidad. */
export type ProfitabilityViewData = {
  slug: string;
  /** `/{slug}`: prefijo de las rutas de la org. */
  basePath: string;
  today: CivilDate;
  period: Period;
  report: ProfitabilityReport;
  settings: ProfitabilitySettings;
  /** ¿Hay algún coste por hora guardado? */
  costsConfigured: boolean;
  /** Owner: cambia los umbrales y los costes. */
  canEdit: boolean;
  /** Cliente que se abre al llegar (?client=…), p. ej. desde su ficha. */
  focusClientId: string | null;
};

/**
 * Las cifras de un cliente en una ventana: su coste (costCents) es horas + gastos + infraestructura,
 * con el desglose, y lo cobrado (con IVA) y lo pendiente de lo facturado en ella.
 */
export type ClientProfitabilityWindow = Figures & ClientBreakdown & { from: CivilDate; to: CivilDate };

/** La tarjeta de la ficha del cliente (GET /api/profitability/clients/[clientId]). */
export type ClientProfitabilitySummary = {
  last3m: ClientProfitabilityWindow;
  last12m: ClientProfitabilityWindow;
  /** Desde su primera factura o su primer coste (lo que sea antes) hasta hoy; null si aún no hay ninguno. */
  lifetime: ClientProfitabilityWindow | null;
  costsConfigured: boolean;
  minMarginBps: number;
  minHourlyRateCents: number;
};
