// Servicios activos en el mes: las líneas de los contratos firmados del cliente que han prestado
// servicio algún día del mes. Nunca salen precios, notas ni motivos de baja o de pausa: el informe
// cuenta qué tiene contratado, no cuánto ni por qué.

import { compareCivil, maxCivil, minCivil, type CivilDate } from "../dates/civil-date";
import { isLineActiveOn } from "../billing/schedule";
import { monthEnd, type Month } from "../metrics/months";
import { eachDay } from "../seo/period";
import type { ReportContractFact, ReportLineFact, ReportService } from "./types";

const RECURRING_PAUSABLE = new Set(["monthly", "yearly"]);

/**
 * ¿Presta servicio la línea algún día del mes? La regla de cada día es la de las vistas
 * (isLineActiveOn, la gemela de private.line_status_on), con dos matices:
 * - Una línea sin fecha de inicio (puntual o por uso) empieza con la firma del contrato.
 * - Una puntual con hitos termina cuando el último se ha facturado: si todos lo estaban antes de
 *   empezar el mes, ese mes ya no cuenta. Sin hitos, cuenta mientras dure su vigencia.
 * Las pausas solo cuentan en las mensuales y anuales, como en la base.
 */
function lineInMonth(line: ReportLineFact, start: CivilDate, month: Month): { active: boolean; pausedInMonth: boolean } {
  const last = monthEnd(month);
  if (compareCivil(start, last) > 0) return { active: false, pausedInMonth: false };
  if (line.endsOn !== null && compareCivil(line.endsOn, month) < 0) return { active: false, pausedInMonth: false };

  if (line.billingType === "one_off" && line.milestonesBilledOn.length > 0) {
    const billed = line.milestonesBilledOn.filter((date): date is CivilDate => date !== null);
    const finished = billed.length === line.milestonesBilledOn.length && billed.every((date) => compareCivil(date, month) < 0);
    if (finished) return { active: false, pausedInMonth: false };
  }

  const pauses = RECURRING_PAUSABLE.has(line.billingType) ? line.pauses : [];
  const from = maxCivil(start, month);
  const to = line.endsOn === null ? last : minCivil(line.endsOn, last);
  let activeDays = 0;
  let pausedDays = 0;
  for (const day of eachDay({ from, to })) {
    if (isLineActiveOn({ startsOn: start, endsOn: line.endsOn }, pauses, day)) activeDays += 1;
    else pausedDays += 1;
  }
  return { active: activeDays > 0, pausedInMonth: pausedDays > 0 };
}

/**
 * Los servicios del mes, separados en recurrentes (mensuales, anuales y por uso) y proyectos
 * (puntuales), en el orden de los contratos y de sus líneas. Si una línea sustituye a otra (un
 * cambio de precio) y las dos caen en el mes, sale solo la nueva: es el mismo servicio.
 */
export function activeServices(
  contracts: readonly ReportContractFact[],
  month: Month,
): { recurring: ReportService[]; oneOff: ReportService[] } {
  const last = monthEnd(month);
  const signed = contracts
    .filter((c): c is ReportContractFact & { signedOn: CivilDate } => !c.archived && c.signedOn !== null && compareCivil(c.signedOn, last) <= 0)
    .sort((a, b) => compareCivil(a.signedOn, b.signedOn) || a.title.localeCompare(b.title, "es"));

  const found: ReportService[] = [];
  const replaced = new Set<string>();
  for (const contract of signed) {
    const lines = [...contract.lines].sort((a, b) => a.position - b.position);
    for (const line of lines) {
      const start = line.startsOn ?? contract.signedOn;
      const { active, pausedInMonth } = lineInMonth(line, start, month);
      if (!active) continue;
      if (line.replacesLineId) replaced.add(line.replacesLineId);
      found.push({
        id: line.id,
        description: line.description.trim(),
        billingType: line.billingType,
        contractTitle: contract.title.trim(),
        startsOn: start,
        endsOn: line.endsOn,
        pausedInMonth,
      });
    }
  }

  const services = found.filter((service) => !replaced.has(service.id));
  return {
    recurring: services.filter((service) => service.billingType !== "one_off"),
    oneOff: services.filter((service) => service.billingType === "one_off"),
  };
}
