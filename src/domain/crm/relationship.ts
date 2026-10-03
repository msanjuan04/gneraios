// Cuándo una ficha es un cliente y cuándo todavía es un lead. Puro: lo usan la lista de clientes,
// la de leads y las dos fichas.

/** Estado derivado de los contratos (nunca se guarda): lo calcula `clients_overview`. */
export type ClientStatus = "lead" | "active" | "paused" | "former";

/** Estado que un socio puede fijar a mano (orgs: `client_manual_status`). */
export type ClientManualStatus = "pending_contact" | "lead" | "active" | "paused" | "finished" | "discarded";

/** Los estados a mano que siguen siendo «aún no es cliente». */
const STILL_A_LEAD = new Set<ClientManualStatus>(["pending_contact", "lead", "discarded"]);

/**
 * Una ficha es cliente cuando hay una relación de verdad: un contrato o una factura (lo dice el
 * estado derivado) o alguien lo ha marcado a mano como activo, en pausa o finalizado. Mientras solo
 * hay conversaciones y propuestas, es un lead: vive en Leads, no en Clientes.
 */
export function isClient(row: { status: ClientStatus | null; manualStatus: ClientManualStatus | null }): boolean {
  if (row.manualStatus !== null) {
    if (STILL_A_LEAD.has(row.manualStatus)) return false;
    return true;
  }
  return row.status !== null && row.status !== "lead";
}

export const isLead = (row: { status: ClientStatus | null; manualStatus: ClientManualStatus | null }): boolean => !isClient(row);
