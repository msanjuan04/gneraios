export const locales = ["es", "ca", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "es";
export const LOCALE_COOKIE = "locale";

export const localeNames: Record<Locale, string> = {
  es: "Español",
  ca: "Català",
  en: "English",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}
