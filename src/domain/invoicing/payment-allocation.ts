// Un cobro que paga varias facturas a la vez (una transferencia que cubre dos meses, por
// ejemplo): lo recibido se reparte entre las facturas pendientes del cliente, de la más antigua a
// la más nueva, como lo haría la gestoría. Cada factura se lleva lo que le falta hasta que se
// acaba el importe; lo que sobra no se inventa como cobro de nadie.

export type PayableInvoice = {
  id: string;
  /** Lo que falta por cobrar, con IVA. Las que no tienen nada pendiente (≤ 0) no reciben nada. */
  outstandingCents: number;
};

export type PaymentAllocation = { invoiceId: string; amountCents: number };

export type AllocationResult = {
  allocations: PaymentAllocation[];
  /** Lo recibido que no cabe en ninguna factura pendiente. */
  unallocatedCents: number;
};

/**
 * Reparte `receivedCents` entre `invoices` en el orden en que llegan (la más antigua primero): la
 * última que toca puede quedar a medias. Un importe que no es un entero positivo no reparte nada.
 */
export function allocateReceived(receivedCents: number, invoices: readonly PayableInvoice[]): AllocationResult {
  if (!Number.isSafeInteger(receivedCents) || receivedCents <= 0) return { allocations: [], unallocatedCents: 0 };
  let left = receivedCents;
  const allocations: PaymentAllocation[] = [];
  for (const invoice of invoices) {
    if (left === 0) break;
    if (invoice.outstandingCents <= 0) continue;
    const amountCents = Math.min(left, invoice.outstandingCents);
    allocations.push({ invoiceId: invoice.id, amountCents });
    left -= amountCents;
  }
  return { allocations, unallocatedCents: left };
}

/** Suma de lo repartido. */
export function allocationTotal(allocations: readonly { amountCents: number }[]): number {
  return allocations.reduce((sum, a) => sum + a.amountCents, 0);
}

/**
 * La fecha de cobro es el día en que entró el dinero y no tiene por qué coincidir con la de la
 * factura. Que sea anterior no es un error (un anticipo), pero conviene avisar por si es un despiste.
 * Fechas civiles YYYY-MM-DD: se comparan como texto.
 */
export function paidBeforeIssue(paidOn: string, issuedOn: string | null): boolean {
  return issuedOn !== null && paidOn < issuedOn;
}
