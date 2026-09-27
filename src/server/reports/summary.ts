import "server-only";
import type { ClientReportSummary } from "@/components/reports/types";
import type { Month } from "@/domain/metrics/months";
import { reportCounts, reportMonthParam } from "@/domain/reports";
import { type Db, must } from "@/server/billing/context";
import { billingRecipients } from "@/server/email/send";
import { loadClientMonthReport } from "./load";

/**
 * Lo que saldrá en el informe de un mes, contado (la tarjeta de la ficha del cliente), y cómo va su
 * email: si hay uno por revisar y si ya se envió. Monta el mismo informe que el PDF: no hay otra
 * regla para contar. null si el cliente no se ve o el mes aún no ha empezado.
 */
export async function getClientReportSummary(
  db: Db,
  orgId: string,
  clientId: string,
  month: Month,
  opts: { includeHours: boolean },
): Promise<ClientReportSummary | null> {
  const [report, recipients, emails] = await Promise.all([
    loadClientMonthReport(db, orgId, clientId, month, { includeHours: opts.includeHours }),
    billingRecipients(db, clientId),
    db
      .from("outbound_emails")
      .select("id, status, sent_at, created_at")
      .eq("org_id", orgId)
      .eq("client_id", clientId)
      .eq("template", "client_report")
      .eq("report_month", month)
      .in("status", ["pending_approval", "sent"])
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  if (!report) return null;
  const rows = must(emails, "reports.summary.emails");
  const lastSent = rows
    .filter((e) => e.status === "sent" && e.sent_at)
    .map((e) => e.sent_at!)
    .sort()
    .at(-1);
  return {
    month: reportMonthParam(month),
    locale: report.locale,
    inProgress: report.inProgress,
    counts: reportCounts(report),
    recipients,
    email: {
      pendingId: rows.find((e) => e.status === "pending_approval")?.id ?? null,
      lastSentAt: lastSent ?? null,
    },
  };
}
