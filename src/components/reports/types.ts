import type { ClientMonthReportCounts, ReportLocale } from "@/domain/reports";

/**
 * Lo que la tarjeta del informe enseña de un mes antes de abrir el PDF (GET
 * /api/reports/clients/{clientId}/{YYYY-MM}/summary, src/server/reports/summary.ts).
 */
export type ClientReportSummary = {
  /** "2026-08" */
  month: string;
  /** Idioma en que sale (el del cliente). */
  locale: ReportLocale;
  inProgress: boolean;
  counts: ClientMonthReportCounts;
  /** A quién iría el email (contactos de facturación o el principal). */
  recipients: string[];
  email: {
    /** Uno preparado y pendiente de revisar en Facturas → Por enviar. */
    pendingId: string | null;
    /** Cuándo se envió el de ese mes, si ya se envió. */
    lastSentAt: string | null;
  };
};
