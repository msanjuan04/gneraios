// Traductor del calendario fuera de una petición con sesión (el enlace ICS lo lee Google, no el
// navegador del socio): el idioma es el del miembro y el catálogo, el mismo que la app. El
// español es el completo; lo que falte en ca/en se ve en español (como en i18n/request.ts).

import { createTranslator } from "next-intl";
import type { Translate } from "@/domain/calendar";
import type { Locale } from "@/i18n/config";
import ca from "@/i18n/messages/ca";
import en from "@/i18n/messages/en";
import es from "@/i18n/messages/es";
import { deepMerge, type Messages } from "@/i18n/messages/merge";

const CATALOGS: Record<Locale, Messages> = { es, ca: deepMerge(es, ca), en: deepMerge(es, en) };

/**
 * `t` del espacio `calendar` en el idioma dado. Con `strict`, una clave que falte lanza (así la
 * cazan los tests); si no, se registra y se enseña la clave, sin tumbar el enlace.
 */
export function calendarTranslator(locale: Locale, options: { strict?: boolean } = {}): Translate {
  const t = createTranslator({
    locale,
    messages: CATALOGS[locale],
    namespace: "calendar",
    onError: (error) => {
      if (options.strict) throw error;
      console.error("[calendar] i18n", error.message);
    },
  });
  return (key, values) => t(key as never, values as never);
}
