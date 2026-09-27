// Texto de un aviso (notifications: kind + params). Lo usan la bandeja de la app y las
// notificaciones push, así que los dos dicen exactamente lo mismo: la clave i18n y los valores
// salen de aquí y cada uno los traduce con su `t` (inbox.kinds.<clave>).

import { formatDuration } from "@/domain/projects/duration";

export type NotificationParams = Record<string, string | number | null | undefined>;

export type NotificationFormatters = {
  /** Fecha civil "YYYY-MM-DD" → texto en el idioma de quien lo lee. */
  date: (civil: string) => string;
  money: (cents: number) => string;
};

const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * La clave de inbox.kinds. Un aviso de Verifactu a 0 días ya no es un aviso, es una obligación; un
 * rechazo con motivo lo cita; un certificado o un dominio con días negativos ya ha caducado.
 */
export function notificationMessageKey(kind: string, params: NotificationParams): string {
  if (kind === "verifactu_deadline" && Number(params.days ?? 0) === 0) return "verifactu_required";
  if (kind === "quote_rejected" && typeof params.reason === "string" && params.reason.trim() !== "") return "quote_rejected_reason";
  if (kind === "ssl_expiring" && Number(params.days ?? 0) < 0) return "ssl_expired";
  if (kind === "domain_expiring" && Number(params.days ?? 0) < 0) return "domain_expired";
  return kind;
}

/**
 * Valores para el mensaje ICU: fecha e importe formateados, `days` siempre numérico y, si hay
 * `minutes` (lo que estuvo caída una web), `duration` ("1 h 30 min", igual en los tres idiomas).
 */
export function notificationValues(params: NotificationParams, fmt: NotificationFormatters): Record<string, string | number> {
  const values: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) values[key] = value;
  }
  const date = params.date;
  values.date = typeof date === "string" && CIVIL_DATE.test(date) ? fmt.date(date) : String(date ?? "");
  values.amount = typeof params.amount_cents === "number" ? fmt.money(params.amount_cents) : "";
  values.days = typeof params.days === "number" ? params.days : 0;
  if (typeof params.minutes === "number" && Number.isFinite(params.minutes)) values.duration = formatDuration(Math.round(params.minutes));
  return values;
}
