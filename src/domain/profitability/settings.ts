// Umbrales de la rentabilidad. Viven en orgs.settings.profitability (los lee y les da valor por
// defecto readOrgSettings, en src/app/[org]/settings/schema.ts): aquí solo se reciben.

import type { Bps, Cents } from "../money";

export type ProfitabilitySettings = {
  /** Coste por hora de quien no tiene uno propio vigente ese día (member_costs). */
  defaultHourlyCostCents: Cents;
  /** Aviso por debajo de este margen sobre ingresos (3000 = 30 %). */
  minMarginBps: Bps;
  /** Aviso por debajo de este €/hora efectivo (céntimos por hora). */
  minHourlyRateCents: Cents;
};
