// Previsión de caja a N días (fase 2: «incluye el IVA y el IRPF que hay que ingresar cada
// trimestre; sin eso, la previsión engaña»). Parte de la caja estimada de hoy y suma, día a día:
//
//   + cobros de las facturas emitidas pendientes (en su vencimiento; las vencidas, hoy)
//   + cobros de lo que se va a facturar con los contratos firmados (billing-cash.ts, con IVA)
//   − gastos registrados sin pagar (en su vencimiento; los vencidos, hoy)
//   − cargos de las suscripciones que aún no se han generado
//   − IVA y retenciones estimados de cada trimestre, en su plazo de ingreso (tax.ts)
//
// Todo lo que cae antes de hoy (vencido) se pone hoy; lo que cae después del horizonte no entra.
// Es una previsión con los datos de hoy: no incluye ventas nuevas ni gastos que aún no existen.

import { addDays, compareCivil, daysBetween, maxCivil, parseCivilDate, type CivilDate } from "../dates/civil-date";
import { assertCents, type Cents } from "../money";

export const CASH_FLOW_KINDS = ["receivable", "billing", "expense", "subscription", "vat", "withholding"] as const;
export type CashFlowKind = (typeof CASH_FLOW_KINDS)[number];

export type CashFlow = {
  on: CivilDate;
  kind: CashFlowKind;
  /** Positivo entra, negativo sale. */
  cents: Cents;
  /** Texto para la interfaz (cliente, proveedor, «IVA 3T 2026»…). */
  label: string;
  refId: string | null;
  issuerId: string | null;
  /** Ya debería haberse cobrado o pagado (su fecha es anterior a hoy). */
  overdue: boolean;
};

export type CashForecastPoint = { on: CivilDate; inflowCents: Cents; outflowCents: Cents; balanceCents: Cents };

export type CashForecast = {
  from: CivilDate;
  until: CivilDate;
  days: number;
  startCents: Cents;
  endCents: Cents;
  /** El saldo más bajo del periodo y el primer día en que se alcanza. */
  minCents: Cents;
  minOn: CivilDate;
  /** Primer día con saldo negativo, o null. */
  negativeOn: CivilDate | null;
  inflowsCents: Cents;
  outflowsCents: Cents;
  /** Neto por tipo (con signo). */
  byKind: Record<CashFlowKind, Cents>;
  /** Un punto por día, de hoy al final del horizonte (hoy incluye lo vencido). */
  points: CashForecastPoint[];
  /** Los flujos del horizonte, por fecha. */
  flows: CashFlow[];
};

export type FlowInput = Omit<CashFlow, "overdue" | "on"> & { on: CivilDate };

/** Pone hoy lo vencido, quita lo que cae fuera del horizonte y ordena. */
export function normalizeFlows(flows: readonly FlowInput[], today: CivilDate, until: CivilDate): CashFlow[] {
  return flows
    .map((flow) => {
      assertCents(flow.cents);
      const overdue = compareCivil(flow.on, today) < 0;
      return { ...flow, on: maxCivil(flow.on, today), overdue };
    })
    .filter((flow) => compareCivil(flow.on, until) <= 0 && flow.cents !== 0)
    .sort((a, b) => compareCivil(a.on, b.on) || CASH_FLOW_KINDS.indexOf(a.kind) - CASH_FLOW_KINDS.indexOf(b.kind) || b.cents - a.cents);
}

/** Saldo día a día desde `today` durante `days` días (hoy + `days`) con los flujos dados. */
export function cashForecast(input: { today: CivilDate; days: number; startCents: Cents; flows: readonly FlowInput[] }): CashForecast {
  const { today, days } = input;
  parseCivilDate(today);
  if (!Number.isSafeInteger(days) || days < 0) throw new Error(`Días de previsión no válidos: ${String(days)}`);
  const until = addDays(today, days);
  const flows = normalizeFlows(input.flows, today, until);

  const byDay = new Map<CivilDate, { inflow: Cents; outflow: Cents }>();
  const byKind = Object.fromEntries(CASH_FLOW_KINDS.map((kind) => [kind, 0])) as Record<CashFlowKind, Cents>;
  let inflowsCents = 0;
  let outflowsCents = 0;
  for (const flow of flows) {
    const day = byDay.get(flow.on) ?? { inflow: 0, outflow: 0 };
    if (flow.cents > 0) {
      day.inflow = assertCents(day.inflow + flow.cents);
      inflowsCents = assertCents(inflowsCents + flow.cents);
    } else {
      day.outflow = assertCents(day.outflow - flow.cents);
      outflowsCents = assertCents(outflowsCents - flow.cents);
    }
    byKind[flow.kind] = assertCents(byKind[flow.kind] + flow.cents);
    byDay.set(flow.on, day);
  }

  const points: CashForecastPoint[] = [];
  let balance = assertCents(input.startCents);
  let minCents = balance;
  let minOn = today;
  let negativeOn: CivilDate | null = balance < 0 ? today : null;
  for (let i = 0; i <= days; i++) {
    const on = addDays(today, i);
    const day = byDay.get(on) ?? { inflow: 0, outflow: 0 };
    balance = assertCents(balance + day.inflow - day.outflow);
    points.push({ on, inflowCents: day.inflow, outflowCents: day.outflow, balanceCents: balance });
    if (balance < minCents) {
      minCents = balance;
      minOn = on;
    }
    if (negativeOn === null && balance < 0) negativeOn = on;
  }

  return {
    from: today,
    until,
    days,
    startCents: input.startCents,
    endCents: balance,
    minCents,
    minOn,
    negativeOn,
    inflowsCents,
    outflowsCents,
    byKind,
    points,
    flows,
  };
}

/** Días que faltan para una fecha (0 si es hoy o ya pasó). */
export function daysUntil(date: CivilDate, today: CivilDate): number {
  return Math.max(0, daysBetween(today, date));
}
