// Oportunidades ("quick wins") y consultas que suben o bajan, a partir de las consultas agregadas
// de un periodo (RPC seo_query_stats).
//
// Una oportunidad es una consulta que ya se ve (muchas impresiones) pero se queda en la parte baja
// de la primera página o al principio de la segunda (posición media 4-15): subir unas pocas
// posiciones multiplica los clics. Se ordenan por los clics que faltan para el CTR esperado en la
// posición objetivo (el top 3), una estimación con una curva de CTR orgánico de referencia.

export type QueryStat = {
  key: string;
  clicks: number;
  impressions: number;
  position: number | null;
  compareClicks: number;
  compareImpressions: number;
  comparePosition: number | null;
};

/**
 * CTR orgánico medio por posición (1-10), redondeado a la baja a partir de los estudios públicos
 * de CTR por posición. Es una referencia para priorizar, no una promesa: las consultas de marca y
 * las que muestran mapa o anuncios se alejan mucho de ella.
 */
export const CTR_CURVE: readonly number[] = [0.28, 0.15, 0.1, 0.07, 0.05, 0.04, 0.03, 0.025, 0.02, 0.018];
/** CTR de referencia más allá de la primera página. */
const CTR_BEYOND = 0.008;

export const OPPORTUNITY_RULES = {
  minPosition: 4,
  maxPosition: 15,
  /** Posición a la que se aspira al estimar los clics que faltan. */
  targetPosition: 3,
  /** Impresiones mínimas por día del periodo para que una consulta cuente. */
  minImpressionsPerDay: 1.5,
  /** Suelo de impresiones, para periodos cortos. */
  minImpressionsFloor: 30,
} as const;

/** CTR esperado en una posición media (interpolado entre posiciones enteras). */
export function expectedCtr(position: number): number {
  if (!Number.isFinite(position) || position <= 1) return CTR_CURVE[0]!;
  const last = CTR_CURVE.length;
  if (position >= last + 1) return CTR_BEYOND;
  const lower = Math.floor(position);
  const at = (p: number) => (p <= last ? CTR_CURVE[p - 1]! : CTR_BEYOND);
  const fraction = position - lower;
  return at(lower) + (at(lower + 1) - at(lower)) * fraction;
}

/** Impresiones mínimas de una oportunidad en un periodo de `days` días. */
export function minOpportunityImpressions(days: number): number {
  return Math.max(OPPORTUNITY_RULES.minImpressionsFloor, Math.ceil(days * OPPORTUNITY_RULES.minImpressionsPerDay));
}

export type Opportunity = QueryStat & {
  ctr: number;
  /** Clics adicionales al mes si alcanzara el CTR esperado del top 3 (estimación). */
  potentialPerMonth: number;
};

/** Las mejores oportunidades del periodo, de más a menos clics posibles. */
export function findOpportunities(stats: readonly QueryStat[], days: number, limit = 8): Opportunity[] {
  const minImpressions = minOpportunityImpressions(days);
  const target = expectedCtr(OPPORTUNITY_RULES.targetPosition);
  const perMonth = 30 / Math.max(1, days);
  return stats
    .filter(
      (s) =>
        s.position !== null &&
        s.position >= OPPORTUNITY_RULES.minPosition &&
        s.position <= OPPORTUNITY_RULES.maxPosition &&
        s.impressions >= minImpressions,
    )
    .map((s) => {
      const ctr = s.impressions > 0 ? s.clicks / s.impressions : 0;
      const missing = Math.max(0, target - ctr) * s.impressions;
      return { ...s, ctr, potentialPerMonth: Math.round(missing * perMonth) };
    })
    .filter((o) => o.potentialPerMonth > 0)
    .sort((a, b) => b.potentialPerMonth - a.potentialPerMonth || b.impressions - a.impressions || a.key.localeCompare(b.key))
    .slice(0, Math.max(0, limit));
}

export type Mover = QueryStat & {
  /** Clics ganados (o perdidos, en negativo) frente al periodo de comparación. */
  clicksDelta: number;
  /** Posiciones ganadas: positivo es subir. */
  positionDelta: number | null;
};

export function toMover(stat: QueryStat): Mover {
  return {
    ...stat,
    clicksDelta: stat.clicks - stat.compareClicks,
    positionDelta: stat.position === null || stat.comparePosition === null ? null : stat.comparePosition - stat.position,
  };
}

/**
 * Las que más suben o bajan en clics. Por debajo de `minDelta` clics es ruido. Ya vienen ordenadas
 * de la base de datos; aquí se filtran y se completan.
 */
export function movers(stats: readonly QueryStat[], direction: "up" | "down", limit = 6, minDelta = 2): Mover[] {
  return stats
    .map(toMover)
    .filter((m) => (direction === "up" ? m.clicksDelta >= minDelta : m.clicksDelta <= -minDelta))
    .sort((a, b) => (direction === "up" ? b.clicksDelta - a.clicksDelta : a.clicksDelta - b.clicksDelta) || a.key.localeCompare(b.key))
    .slice(0, Math.max(0, limit));
}
