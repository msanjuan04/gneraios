import { type CivilDate, daysBetween, parseCivilDate } from "@/domain/dates/civil-date";
import { dateInZone } from "@/domain/dates/zoned-time";

/** Hasta cuándo vale algo (un certificado, un dominio) y cuánto le queda, en días naturales de la org. */
export type ExpiryInfo = {
  /** El día en que caduca, en la zona de la org. */
  expiresOn: CivilDate;
  /** Días desde hoy (0 = caduca hoy; negativo = ya caducó). */
  daysLeft: number;
  expired: boolean;
};

/** ok = lejos; warning = dentro de los días de aviso de la org; expired = ya caducado. */
export type ExpirySeverity = "ok" | "warning" | "expired";

/**
 * El certificado SSL: caduca en un instante (`tls_expires_at`), pero se cuenta en días de la org.
 * Caduca hoy a las 14:00 → 0 días; a las 14:00:01, caducado. null si no se pudo leer.
 */
export function sslExpiry(tlsExpiresAt: string | null, now: Date, timeZone: string): ExpiryInfo | null {
  if (!tlsExpiresAt) return null;
  const at = new Date(tlsExpiresAt);
  if (Number.isNaN(at.getTime())) return null;
  const expiresOn = dateInZone(at, timeZone);
  return { expiresOn, daysLeft: daysBetween(dateInZone(now, timeZone), expiresOn), expired: at.getTime() <= now.getTime() };
}

/** El dominio: vale hasta el día que se apuntó (incluido). null si no se sabe. */
export function domainExpiry(expiresOn: CivilDate | null, today: CivilDate): ExpiryInfo | null {
  if (!expiresOn) return null;
  try {
    parseCivilDate(expiresOn);
  } catch {
    return null;
  }
  const daysLeft = daysBetween(today, expiresOn);
  return { expiresOn, daysLeft, expired: daysLeft < 0 };
}

/** Gravedad con los días de aviso de la org. null si no se sabe cuándo caduca. */
export function expirySeverity(info: ExpiryInfo | null, warnDays: number): ExpirySeverity | null {
  if (!info) return null;
  if (info.expired) return "expired";
  return info.daysLeft <= warnDays ? "warning" : "ok";
}

const MONTHS: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const CERT_DATE = /^([A-Z][a-z]{2}) +(\d{1,2}) (\d{2}):(\d{2}):(\d{2})(?:\.\d+)? (\d{4}) GMT$/;

/**
 * Fecha de un certificado tal como la da Node (`getPeerCertificate().valid_to`, formato de OpenSSL:
 * "Dec  3 23:59:59 2026 GMT") → ISO 8601. null si no se entiende.
 */
export function parseCertificateDate(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const match = CERT_DATE.exec(value.trim());
  if (!match) return null;
  const month = MONTHS[match[1]!];
  if (month === undefined) return null;
  const [day, hour, minute, second, year] = [match[2], match[3], match[4], match[5], match[6]].map(Number) as [number, number, number, number, number];
  const ms = Date.UTC(year, month, day, hour, minute, second);
  const date = new Date(ms);
  if (date.getUTCDate() !== day || date.getUTCMonth() !== month || hour > 23 || minute > 59 || second > 60) return null;
  return date.toISOString();
}
