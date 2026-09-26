import { FiscalError, type FiscalProvider } from "./provider";

/**
 * Proveedor interno (el activo hoy). El número lo asigna el contador sin huecos de la base de
 * datos al empezar la emisión, así que aquí solo se confirma. No hace Verifactu: desde la
 * fecha Verifactu del emisor, la base de datos bloquea la emisión con este proveedor.
 */
export const internalDraftProvider: FiscalProvider = {
  id: "internal",
  capabilities: { assignsNumber: false, verifactu: false, providesPdf: false },
  async issue(doc) {
    if (!doc.number) throw new FiscalError("number_missing", "El proveedor interno necesita el número asignado.");
    return { number: doc.number, issuedOn: doc.issuedOn, totals: doc.totals };
  },
  async getStatus() {
    return { state: "accepted" };
  },
};
