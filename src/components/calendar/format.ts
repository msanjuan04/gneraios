// Formato de fechas civiles con Intl, igual en servidor y en cliente (sin "use client": lo usa
// también la tarjeta del dashboard, que es un Server Component).

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Una fecha civil con Intl: al mediodía UTC, el mismo día en cualquier zona horaria. */
export function formatDay(date: string, locale: string, options: Intl.DateTimeFormatOptions): string {
  const key = `${locale}:${JSON.stringify(options)}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" });
    formatters.set(key, formatter);
  }
  return formatter.format(new Date(`${date.slice(0, 10)}T12:00:00Z`));
}

/** Rango de dos fechas civiles ("5–11 oct 2026"), con el formato de rangos de Intl. */
export function formatDayRange(from: string, to: string, locale: string, options: Intl.DateTimeFormatOptions): string {
  const formatter = new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" });
  return formatter.formatRange(new Date(`${from.slice(0, 10)}T12:00:00Z`), new Date(`${to.slice(0, 10)}T12:00:00Z`));
}
