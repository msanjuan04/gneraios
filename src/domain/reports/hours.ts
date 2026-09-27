// Horas dedicadas en el mes (solo si el socio lo pide al generar el informe). Salen de los
// registros de horas de los proyectos del cliente; los proyectos que el cliente no ve en su portal
// no se nombran: sus horas cuentan en el total y en una línea aparte.

import type { Month } from "../metrics/months";
import { inMonth } from "./month";
import type { ReportHours, ReportHoursProject, ReportTimeFact } from "./types";

export function reportHours(entries: readonly ReportTimeFact[], projects: readonly ReportHoursProject[], month: Month): ReportHours {
  const byId = new Map(projects.map((project) => [project.id, project]));
  const named = new Map<string, { name: string; minutes: number }>();
  let hidden = 0;
  let totalMinutes = 0;
  for (const entry of entries) {
    const project = byId.get(entry.projectId);
    if (!project || entry.minutes <= 0 || !inMonth(entry.workedOn, month)) continue;
    totalMinutes += entry.minutes;
    if (!project.visible) {
      hidden += entry.minutes;
      continue;
    }
    const row = named.get(project.id) ?? { name: project.name.trim(), minutes: 0 };
    row.minutes += entry.minutes;
    named.set(project.id, row);
  }
  const rows: ReportHours["projects"] = [...named.values()].sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name, "es"));
  if (hidden > 0) rows.push({ name: null, minutes: hidden });
  return { totalMinutes, projects: rows };
}
