// Estado del cliente que se ve: el que un socio marca a mano (contacto pendiente, lead, activo, en
// pausa, finalizado, descartado) o, si no ha marcado ninguno, el que se calcula con los contratos.
// Las métricas (MRR, bajas…) siguen usando siempre el calculado.

export const CLIENT_MANUAL_STATUSES = ["pending_contact", "lead", "active", "paused", "finished", "discarded"] as const;
export type ClientManualStatus = (typeof CLIENT_MANUAL_STATUSES)[number];
export type ClientDerivedStatus = "lead" | "active" | "paused" | "former";

/** El calculado, dicho con las mismas palabras que el manual («antiguo» es «finalizado»). */
export function derivedAsManual(derived: ClientDerivedStatus): ClientManualStatus {
  return derived === "former" ? "finished" : derived;
}

/** El que se enseña en la lista y en la ficha. */
export function effectiveClientStatus(derived: ClientDerivedStatus, manual: ClientManualStatus | null | undefined): ClientManualStatus {
  return manual ?? derivedAsManual(derived);
}

/** ¿El marcado a mano dice otra cosa que el calculado? (Se avisa en la ficha, sin cambiar nada.) */
export function manualDiffers(derived: ClientDerivedStatus, manual: ClientManualStatus | null | undefined): boolean {
  return manual != null && manual !== derivedAsManual(derived);
}

export function isClientManualStatus(value: unknown): value is ClientManualStatus {
  return typeof value === "string" && (CLIENT_MANUAL_STATUSES as readonly string[]).includes(value);
}
