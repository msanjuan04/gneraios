// Impuestos trimestrales que salen de la caja: la liquidación de IVA (estilo modelo 303) y las
// retenciones practicadas (estilo modelos 111 y 115). SON ESTIMACIONES para prever la caja y
// provisionar, no la declaración: hay que validarlas con la gestoría (prorratas, regularizaciones,
// criterio de caja, operaciones intracomunitarias, compensaciones de trimestres anteriores…).
//
// - Cada emisor (la SL o un socio autónomo) declara lo suyo: nada se compensa entre emisores.
// - IVA del trimestre = repercutido (facturas emitidas con fecha en el trimestre, rectificativas
//   incluidas) − soportado deducible (gastos con fecha de factura en el trimestre). Si sale
//   negativo no se paga nada ese trimestre (queda a compensar).
// - Retenciones del trimestre = lo retenido en los gastos con fecha de factura en el trimestre.
// - Plazo de ingreso: 20 de abril, 20 de julio, 20 de octubre y 30 de enero (el cuarto trimestre);
//   si cae en fin de semana, el lunes siguiente. Los festivos no se tienen en cuenta.

import { addDays, compareCivil, formatCivil, parseCivilDate, type CivilDate } from "../dates/civil-date";
import { assertCents, type Cents } from "../money";

export type QuarterNumber = 1 | 2 | 3 | 4;
export type Quarter = { year: number; quarter: QuarterNumber };

/** Un importe con fecha y emisor: IVA de una factura, IVA deducible o retención de un gasto. */
export type TaxAmountRow = {
  issuerId: string;
  /** Fecha que decide el trimestre (la de la factura, o el primer día de su mes si viene agregado). */
  on: CivilDate;
  cents: Cents;
  /** Sale de la previsión (lo que aún no se ha facturado o cargado), no de un documento. */
  forecast?: boolean;
};

export type VatIssuerEstimate = {
  issuerId: string;
  /** IVA repercutido (con la parte prevista). */
  outputVatCents: Cents;
  /** IVA soportado deducible (con la parte prevista). */
  inputVatCents: Cents;
  /** De lo anterior, lo que sale de la previsión. */
  forecastOutputVatCents: Cents;
  forecastInputVatCents: Cents;
  /** Repercutido − soportado: positivo a ingresar, negativo a compensar. */
  resultCents: Cents;
  /** Lo que se paga: el resultado si es positivo; si no, 0. */
  payableCents: Cents;
};

export type VatQuarterEstimate = {
  quarter: Quarter;
  from: CivilDate;
  to: CivilDate;
  dueOn: CivilDate;
  issuers: VatIssuerEstimate[];
  /** Σ de lo que paga cada emisor (los negativos no restan de los demás). */
  payableCents: Cents;
};

export type WithholdingIssuerEstimate = { issuerId: string; withheldCents: Cents; forecastCents: Cents };

export type WithholdingsQuarterEstimate = {
  quarter: Quarter;
  from: CivilDate;
  to: CivilDate;
  dueOn: CivilDate;
  issuers: WithholdingIssuerEstimate[];
  totalCents: Cents;
};

export function quarterOf(date: CivilDate): Quarter {
  const { year, month } = parseCivilDate(date);
  return { year, quarter: (Math.floor((month - 1) / 3) + 1) as QuarterNumber };
}

/** "2026-Q3": clave estable (la interfaz lo escribe como «3T 2026»). */
export function quarterKey(q: Quarter): string {
  return `${q.year}-Q${q.quarter}`;
}

export function quarterStart(q: Quarter): CivilDate {
  return formatCivil({ year: q.year, month: (q.quarter - 1) * 3 + 1, day: 1 });
}

export function addQuarters(q: Quarter, count: number): Quarter {
  if (!Number.isSafeInteger(count)) throw new Error(`Número de trimestres no válido: ${String(count)}`);
  const index = q.year * 4 + (q.quarter - 1) + count;
  const year = Math.floor(index / 4);
  return { year, quarter: (index - year * 4 + 1) as QuarterNumber };
}

export function quarterEnd(q: Quarter): CivilDate {
  return addDays(quarterStart(addQuarters(q, 1)), -1);
}

export function isInQuarter(date: CivilDate, q: Quarter): boolean {
  const { year, quarter } = quarterOf(date);
  return year === q.year && quarter === q.quarter;
}

/** Sábado o domingo → el lunes siguiente. */
function nextWeekday(date: CivilDate): CivilDate {
  const { year, month, day } = parseCivilDate(date);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 6 ? addDays(date, 2) : weekday === 0 ? addDays(date, 1) : date;
}

/** Último día para ingresar lo del trimestre (303, 111, 115). */
export function taxPaymentDueOn(q: Quarter): CivilDate {
  const next = addQuarters(q, 1);
  const deadline =
    q.quarter === 4
      ? formatCivil({ year: next.year, month: 1, day: 30 })
      : formatCivil({ year: next.year, month: (next.quarter - 1) * 3 + 1, day: 20 });
  return nextWeekday(deadline);
}

/** Trimestres cuyo plazo de ingreso cae entre `from` y `until` (ambos incluidos), en orden. */
export function quartersDueBetween(from: CivilDate, until: CivilDate): Quarter[] {
  const quarters: Quarter[] = [];
  // El plazo de un trimestre cae siempre en el siguiente: se empieza por el anterior a `from`.
  for (let q = addQuarters(quarterOf(from), -1); compareCivil(quarterStart(q), until) <= 0; q = addQuarters(q, 1)) {
    const due = taxPaymentDueOn(q);
    if (compareCivil(due, from) >= 0 && compareCivil(due, until) <= 0) quarters.push(q);
  }
  return quarters;
}

/** El primer trimestre cuyo plazo de ingreso no ha pasado en `today` (el que toca pagar ahora). */
export function nextDueQuarter(today: CivilDate): Quarter {
  const previous = addQuarters(quarterOf(today), -1);
  return compareCivil(taxPaymentDueOn(previous), today) >= 0 ? previous : quarterOf(today);
}

function sumByIssuer(rows: readonly TaxAmountRow[], q: Quarter) {
  const byIssuer = new Map<string, { total: Cents; forecast: Cents }>();
  for (const row of rows) {
    if (!isInQuarter(row.on, q)) continue;
    const entry = byIssuer.get(row.issuerId) ?? { total: 0, forecast: 0 };
    entry.total = assertCents(entry.total + assertCents(row.cents));
    if (row.forecast) entry.forecast = assertCents(entry.forecast + row.cents);
    byIssuer.set(row.issuerId, entry);
  }
  return byIssuer;
}

/** Estimación del IVA de un trimestre por emisor: repercutido − soportado deducible. */
export function estimateVatQuarter(
  q: Quarter,
  output: readonly TaxAmountRow[],
  input: readonly TaxAmountRow[],
): VatQuarterEstimate {
  const out = sumByIssuer(output, q);
  const inp = sumByIssuer(input, q);
  const issuerIds = [...new Set([...out.keys(), ...inp.keys()])].sort();
  const issuers = issuerIds.map((issuerId): VatIssuerEstimate => {
    const o = out.get(issuerId) ?? { total: 0, forecast: 0 };
    const i = inp.get(issuerId) ?? { total: 0, forecast: 0 };
    const resultCents = assertCents(o.total - i.total);
    return {
      issuerId,
      outputVatCents: o.total,
      inputVatCents: i.total,
      forecastOutputVatCents: o.forecast,
      forecastInputVatCents: i.forecast,
      resultCents,
      payableCents: Math.max(0, resultCents),
    };
  });
  return {
    quarter: q,
    from: quarterStart(q),
    to: quarterEnd(q),
    dueOn: taxPaymentDueOn(q),
    issuers,
    payableCents: issuers.reduce((sum, issuer) => assertCents(sum + issuer.payableCents), 0),
  };
}

/** Retenciones practicadas en un trimestre por emisor (lo que se ingresa con el 111 y el 115). */
export function estimateWithholdingsQuarter(q: Quarter, rows: readonly TaxAmountRow[]): WithholdingsQuarterEstimate {
  const byIssuer = sumByIssuer(rows, q);
  const issuers = [...byIssuer.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([issuerId, entry]) => ({ issuerId, withheldCents: entry.total, forecastCents: entry.forecast }))
    .filter((issuer) => issuer.withheldCents !== 0);
  return {
    quarter: q,
    from: quarterStart(q),
    to: quarterEnd(q),
    dueOn: taxPaymentDueOn(q),
    issuers,
    totalCents: issuers.reduce((sum, issuer) => assertCents(sum + Math.max(0, issuer.withheldCents)), 0),
  };
}
