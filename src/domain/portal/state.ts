import type { CivilDate } from "@/domain/dates/civil-date";

/** Idiomas del portal: los de la app (el del presupuesto o el preferido del cliente). */
export const PORTAL_LOCALES = ["es", "ca", "en"] as const;
export type PortalLocale = (typeof PORTAL_LOCALES)[number];

export function isPortalLocale(value: unknown): value is PortalLocale {
  return typeof value === "string" && (PORTAL_LOCALES as readonly string[]).includes(value);
}

/**
 * Idioma para quien llega con un enlace que no lleva a nada (no sabemos de quién es): el primero
 * del navegador que hablemos. "ca-ES,ca;q=0.9,es;q=0.8" → "ca".
 */
export function negotiatePortalLocale(acceptLanguage: string | null | undefined, fallback: PortalLocale = "es"): PortalLocale {
  if (!acceptLanguage) return fallback;
  const ranked = acceptLanguage
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const weight = q ? Number(q.slice(2)) : 1;
      return { lang: (tag ?? "").trim().toLowerCase().split("-")[0] ?? "", weight: Number.isFinite(weight) ? weight : 0, index };
    })
    .filter((entry) => entry.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  return ranked.map((entry) => entry.lang).find(isPortalLocale) ?? fallback;
}

/** Estado de un enlace para quien lo abre. */
export type LinkState = "active" | "expired" | "revoked";

export function publicLinkState(link: { revokedAt: string | null; expiresAt: string }, now: Date): LinkState {
  if (link.revokedAt) return "revoked";
  return new Date(link.expiresAt).getTime() <= now.getTime() ? "expired" : "active";
}

/**
 * Lo que puede hacer el cliente con un presupuesto: abierto (aceptar o rechazar), caducado
 * (validez pasada), aceptado, rechazado o cerrado (un borrador, que nunca se enseña). Es la misma
 * regla que quotes_overview: «caducado» es un enviado con la validez vencida en la zona de la org.
 */
export type PublicQuoteState = "open" | "expired" | "accepted" | "rejected" | "closed";

export function publicQuoteState(
  quote: { status: "draft" | "sent" | "accepted" | "rejected"; validUntil: CivilDate | null },
  today: CivilDate,
): PublicQuoteState {
  switch (quote.status) {
    case "accepted":
      return "accepted";
    case "rejected":
      return "rejected";
    case "sent":
      return quote.validUntil !== null && quote.validUntil < today ? "expired" : "open";
    default:
      return "closed";
  }
}

const INTL: Record<PortalLocale, string> = { es: "es-ES", ca: "ca-ES", en: "en-IE" };

/** Locale de Intl del portal (el inglés, en formato europeo, como los PDF). */
export function portalIntlLocale(locale: PortalLocale): string {
  return INTL[locale];
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

/** "2026-10-01" → "1 de octubre de 2026" (long) o "01/10/2026" (short), sin zonas horarias. */
export function formatPortalDate(date: CivilDate, locale: PortalLocale, style: "long" | "medium" | "short" = "long"): string {
  const key = `${locale}:${style}`;
  let formatter = dateFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(portalIntlLocale(locale), {
      timeZone: "UTC",
      ...(style === "short" ? { day: "2-digit", month: "2-digit", year: "numeric" } : { dateStyle: style }),
    });
    dateFormatters.set(key, formatter);
  }
  return formatter.format(new Date(`${date}T12:00:00Z`));
}
