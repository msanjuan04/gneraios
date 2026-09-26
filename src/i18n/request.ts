import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { defaultLocale, isLocale, LOCALE_COOKIE } from "./config";
import es from "./messages/es";
import { deepMerge, type Messages } from "./messages/merge";

export default getRequestConfig(async () => {
  const store = await cookies();
  const cookieLocale = store.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(cookieLocale) ? cookieLocale : defaultLocale;

  // El español es el catálogo completo; lo que falte en ca/en se ve en español.
  const messages =
    locale === "es"
      ? es
      : deepMerge(es, (await import(`./messages/${locale}/index`)).default as Messages);

  return { locale, messages, timeZone: "Europe/Madrid" };
});
