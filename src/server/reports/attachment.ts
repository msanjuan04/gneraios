import "server-only";
import { isMonth } from "@/domain/metrics/months";
import { isPortalLocale } from "@/domain/portal";
import { renderClientReportPdf, reportPdfFilename } from "@/pdf";
import type { Db } from "@/server/billing/context";
import { loadClientMonthReport } from "./load";

/** Lo que el envío sabe de un email de informe (su fila de outbound_emails). */
export type ClientReportEmailRow = {
  org_id: string;
  client_id: string | null;
  report_month: string | null;
  report_hours: boolean;
  language: string;
};

/**
 * El PDF adjunto de un email 'client_report', generado en el momento de enviarlo con la sesión de
 * quien lo envía (la RLS decide qué ve) y en el idioma del email. Lanza si no se puede generar:
 * un informe no sale nunca sin su PDF.
 */
export async function clientReportAttachment(db: Db, email: ClientReportEmailRow): Promise<{ filename: string; content: Uint8Array }> {
  if (!email.client_id || !email.report_month || !isMonth(email.report_month)) {
    throw new Error("Email de informe sin cliente o sin mes");
  }
  const report = await loadClientMonthReport(db, email.org_id, email.client_id, email.report_month, {
    includeHours: email.report_hours,
    locale: isPortalLocale(email.language) ? email.language : undefined,
  });
  if (!report) throw new Error("No se ha podido generar el informe: el cliente ya no existe o el mes no está disponible");
  const pdf = await renderClientReportPdf(report);
  return { filename: reportPdfFilename(report), content: new Uint8Array(pdf) };
}
