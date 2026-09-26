import { useTranslations } from "next-intl";

/**
 * Traduce el mensaje de un error de Zod de los formularios de clientes: primero
 * `clients.validation.*` (NIF-IVA, país…), luego los comunes de `validation.*`.
 */
export function useClientValidationMessage() {
  const t = useTranslations("clients.validation");
  const tCommon = useTranslations("validation");
  return (message: string | undefined): string | undefined => {
    if (!message) return undefined;
    if (t.has(message)) return t(message);
    return tCommon.has(message) ? tCommon(message) : tCommon("invalid");
  };
}
