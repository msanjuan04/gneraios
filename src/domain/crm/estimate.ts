// Cuánto podría valer un lead que todavía no tiene presupuesto. Se deriva, no se guarda: la mediana
// de lo que hemos presupuestado antes. Si no hay histórico no se inventa nada.

export type PastQuote = { oneOffCents: number; monthlyCents: number };

export type LeadEstimate = { oneOffCents: number; monthlyCents: number; basedOn: number };

const median = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
};

/**
 * La mediana de los presupuestos enviados o aceptados (los borradores no dicen nada: no se han
 * ofrecido). Se separan el pago único y el recurrente, y cada uno se calcula solo con los
 * presupuestos que lo tienen: un presupuesto sin mensualidad no baja la mediana de las mensualidades.
 */
export function estimateFromHistory(quotes: readonly PastQuote[]): LeadEstimate {
  const oneOff = quotes.map((quote) => quote.oneOffCents).filter((cents) => cents > 0);
  const monthly = quotes.map((quote) => quote.monthlyCents).filter((cents) => cents > 0);
  return { oneOffCents: median(oneOff), monthlyCents: median(monthly), basedOn: quotes.length };
}

/**
 * El importe que cuenta un lead: el real si lo tiene (importe puesto a mano o presupuesto) y, si no,
 * la estimación. `estimated` dice cuál de los dos es, para no mezclarlos al sumar.
 */
export function leadValue(
  lead: { estOneOffCents: number; estMrrCents: number; quotes: number },
  estimate: LeadEstimate,
): { oneOffCents: number; mrrCents: number; estimated: boolean } {
  const hasReal = lead.estOneOffCents > 0 || lead.estMrrCents > 0 || lead.quotes > 0;
  if (hasReal) return { oneOffCents: lead.estOneOffCents, mrrCents: lead.estMrrCents, estimated: false };
  return { oneOffCents: estimate.oneOffCents, mrrCents: estimate.monthlyCents, estimated: estimate.basedOn > 0 };
}
