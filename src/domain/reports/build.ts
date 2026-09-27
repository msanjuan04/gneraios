// Monta el informe mensual de un cliente a partir de los hechos del mes. Puro: el servidor carga
// (src/server/reports/load.ts) y el PDF maqueta (src/pdf/report-document.tsx).

import { compareCivil } from "../dates/civil-date";
import { monthEnd } from "../metrics/months";
import { monthDeliverables } from "./deliverables";
import { reportHours } from "./hours";
import { reportInvoices } from "./invoices";
import { isReportableMonth } from "./month";
import { activeServices } from "./services";
import type { ClientMonthReport, ClientMonthReportCounts, ClientMonthReportInput, ReportWebStatus } from "./types";
import { webReport } from "./web";
import { doneTasks, monthActivities, nextSteps } from "./work";

/** Lanza si el mes aún no ha empezado: de un mes futuro no hay nada que contar. */
export function buildClientMonthReport(input: ClientMonthReportInput): ClientMonthReport {
  const { month, today, timeZone } = input;
  if (!isReportableMonth(month, today)) throw new Error(`El mes ${month} todavía no ha empezado (hoy es ${today}).`);

  const web = input.webGate === "eligible" && input.web ? webReport(input.web, month) : null;
  const webStatus: ReportWebStatus = web ? "included" : input.webGate === "eligible" ? "no_data" : input.webGate;

  return {
    locale: input.locale,
    month,
    generatedOn: today,
    inProgress: compareCivil(monthEnd(month), today) >= 0,
    clientName: input.clientName.trim(),
    senderName: input.senderName.trim(),
    services: activeServices(input.contracts, month),
    workDone: { tasks: doneTasks(input.projects, month, timeZone), activities: monthActivities(input.activities, month, timeZone) },
    nextSteps: nextSteps(input.projects, month),
    deliverables: monthDeliverables(input.files, month, timeZone),
    web,
    webStatus,
    invoices: reportInvoices(input.invoices, month),
    hours: input.hours ? reportHours(input.hours.entries, input.hours.projects, month) : null,
  };
}

/** Lo que cuenta la tarjeta de la ficha antes de abrir el PDF. */
export function reportCounts(report: ClientMonthReport): ClientMonthReportCounts {
  return {
    tasksDone: report.workDone.tasks.length,
    activities: report.workDone.activities.length,
    nextSteps: report.nextSteps.items.length + report.nextSteps.more,
    deliverables: report.deliverables.length,
    services: report.services.recurring.length + report.services.oneOff.length,
    invoices: report.invoices.issued.length + report.invoices.pending.length,
    webStatus: report.webStatus,
    hoursMinutes: report.hours ? report.hours.totalMinutes : null,
  };
}
