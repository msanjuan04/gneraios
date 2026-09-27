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

  // Un solo "ahora" por petición: el servidor y la hidratación en el navegador parten del mismo
  // instante, así que los tiempos relativos ("hace 2 min") no provocan desajustes de hidratación.
  // NextIntlClientProvider (en el layout raíz) lo hereda; useNow() lo actualiza luego en el cliente.
  return { locale, messages, timeZone: "Europe/Madrid", now: new Date() };
});
