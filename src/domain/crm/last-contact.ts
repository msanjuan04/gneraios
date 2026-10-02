/** Último contacto de un deal tal y como lo deriva `deals_board` (días y sentido del último correo). */
export type LastContact = {
  /** Días desde el último correo, llamada o reunión; null si no hay ninguno registrado. */
  lastContactDaysAgo: number | null;
  /** Sentido de ese contacto si fue un correo: `outgoing` = esperamos respuesta, `incoming` = nos toca. */
  lastContactDirection: "incoming" | "outgoing" | "internal" | null;
};

type Translate = (key: string, values?: Record<string, number>) => string;

/**
 * «Esperando respuesta · 3 días», «Nos toca contestar · 1 día», «Último contacto hace 5 días» o
 * «Sin contacto registrado». Las claves viven en `pipeline.card.*`; vale en servidor y en cliente.
 */
export function lastContactLabel(t: Translate, deal: LastContact): string {
  if (deal.lastContactDaysAgo === null) return t("card.noContact");
  const count = deal.lastContactDaysAgo;
  if (deal.lastContactDirection === "outgoing") return t("card.waitingReply", { count });
  if (deal.lastContactDirection === "incoming") return t("card.ourTurn", { count });
  return t("card.lastContact", { count });
}
