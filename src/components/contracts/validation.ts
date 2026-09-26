import { useTranslations } from "next-intl";

/**
 * Traduce el mensaje de un error de Zod de los formularios de contratos: primero
 * `contracts.validation.*` (importes, fechas, hitos…), luego los comunes de `validation.*`.
 */
export function useContractValidationMessage() {
  const t = useTranslations("contracts.validation");
  const tCommon = useTranslations("validation");
  return (message: string | undefined): string | undefined => {
    if (!message) return undefined;
    if (t.has(message)) return t(message);
    return tCommon.has(message) ? tCommon(message) : tCommon("invalid");
  };
}
