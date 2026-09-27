// Finanzas → Infraestructura tal como la pinta la UI (serializable: pasa de servidor a cliente).
// La carga src/server/finance/infrastructure.ts con la sesión del usuario.

import type { CivilDate } from "@/domain/dates/civil-date";
import type { InfrastructureReport } from "@/domain/finance/infrastructure";
import type { RenewalSettings } from "@/domain/finance/renewals";

export type InfrastructureViewData = {
  slug: string;
  /** `/{slug}`: prefijo de las rutas de la org. */
  basePath: string;
  today: CivilDate;
  /** Primer día de «los últimos 12 meses». */
  spentFrom: CivilDate;
  report: InfrastructureReport;
  settings: RenewalSettings;
  /** Owner: cambia los avisos de renovación. */
  canConfigure: boolean;
};
