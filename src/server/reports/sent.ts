// Sin "server-only": una consulta y una regla pura (probada en sent.test.ts). La usará el portal con
// su clave de servidor, así que filtra siempre por la org y el cliente.
import { isMonth, type Month } from "@/domain/metrics/months";
import { isPortalLocale } from "@/domain/portal/state";
import type { ReportLocale } from "@/domain/reports/types";
import { type Db, fetchAll } from "@/server/billing/context";

/** Un informe mensual que ya se envió al cliente. */
export type SentClientReport = {
  month: Month;
  /** El último envío de ese mes (puede haber una corrección). */
  sentAt: string;
  /** Si el que se envió llevaba las horas, para enseñar el mismo. */
  includeHours: boolean;
  language: ReportLocale;
};

type SentRow = { report_month: string | null; sent_at: string | null; report_hours: boolean; language: string };

/** Un informe por mes, el último enviado, del mes más reciente al más antiguo. */
export function latestSentByMonth(rows: readonly SentRow[]): SentClientReport[] {
  const byMonth = new Map<Month, SentClientReport>();
  for (const row of rows) {
    if (!row.report_month || !row.sent_at || !isMonth(row.report_month)) continue;
    const current = byMonth.get(row.report_month);
    if (current && current.sentAt >= row.sent_at) continue;
    byMonth.set(row.report_month, {
      month: row.report_month,
      sentAt: row.sent_at,
      includeHours: row.report_hours,
      language: isPortalLocale(row.language) ? row.language : "es",
    });
  }
  return [...byMonth.values()].sort((a, b) => b.month.localeCompare(a.month));
}

/**
 * Los meses cuyo informe se ha enviado al cliente (outbound_emails 'client_report' enviados), para
 * que su portal pueda listarlos. El informe no se guarda: el portal lo vuelve a generar con
 * loadClientMonthReport (src/server/reports/load.ts) y las mismas opciones.
 */
export async function listClientReportMonths(admin: Db, orgId: string, clientId: string): Promise<SentClientReport[]> {
  const rows = await fetchAll(
    (from, to) =>
      admin
        .from("outbound_emails")
        .select("report_month, sent_at, report_hours, language")
        .eq("org_id", orgId)
        .eq("client_id", clientId)
        .eq("template", "client_report")
        .eq("status", "sent")
        .not("report_month", "is", null)
        .order("report_month", { ascending: false })
        .order("sent_at", { ascending: false })
        .range(from, to),
    "reports.sentMonths",
  );
  return latestSentByMonth(rows);
}
