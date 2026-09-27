// Rentabilidad de un proyecto: lo facturado entre las horas dedicadas (tarifa efectiva), frente al
// objetivo de la org (orgs.settings.target_hourly_rate_cents). Lo facturado de cada contrato sale
// de una sola definición en SQL (vista project_contract_revenue); aquí solo se reparte y se divide.

import { type Cents, divRoundHalfAwayFromZero } from "../money";

/** Objetivo por defecto si la org no tiene uno: 60 €/h. */
export const DEFAULT_TARGET_HOURLY_RATE_CENTS = 6000;

/** Ámbar desde el 80 % del objetivo; por debajo, rojo. */
export const RATE_WARNING_FLOOR_BPS = 8000;

/** Aviso de consumo del presupuesto de horas desde el 80 %. */
export const BURN_WARNING_BPS = 8000;

const MINUTES_PER_HOUR = BigInt(60);

/** value × numerator / denominator, redondeado (la mitad se aleja de cero). */
export function scaleCents(value: Cents, numerator: number, denominator: number): Cents {
  return Number(divRoundHalfAwayFromZero(BigInt(value) * BigInt(numerator), BigInt(denominator)));
}

/** Céntimos por hora: facturado × 60 / minutos. null sin horas (no hay nada que dividir). */
export function effectiveRateCents(revenueCents: Cents, minutes: number): Cents | null {
  if (!Number.isSafeInteger(minutes) || minutes <= 0) return null;
  return Number(divRoundHalfAwayFromZero(BigInt(revenueCents) * MINUTES_PER_HOUR, BigInt(minutes)));
}

export type RateStanding = "good" | "warning" | "bad" | "none";

/** Verde en el objetivo o por encima, ámbar cerca, rojo por debajo. "none" si no hay tarifa. */
export function rateStanding(rateCents: Cents | null, targetCents: Cents, warningFloorBps = RATE_WARNING_FLOOR_BPS): RateStanding {
  if (rateCents === null || targetCents <= 0) return "none";
  if (rateCents >= targetCents) return "good";
  return rateCents * 10_000 >= targetCents * warningFloorBps ? "warning" : "bad";
}

/** La tarifa como fracción del objetivo, en puntos básicos: 7.200 frente a 6.000 → 12.000 (120 %). */
export function rateVsTargetBps(rateCents: Cents | null, targetCents: Cents): number | null {
  if (rateCents === null || targetCents <= 0) return null;
  return scaleCents(rateCents, 10_000, targetCents);
}

export type BurnState = "none" | "ok" | "warning" | "over";
export type Burn = {
  /** Horas registradas / presupuesto (puede pasar de 1). null sin presupuesto. */
  ratio: number | null;
  /** Lo que queda (negativo si se ha pasado). */
  remainingMinutes: number | null;
  state: BurnState;
};

/** Consumo del presupuesto de horas: aviso desde el 80 %, pasado por encima del 100 %. */
export function budgetBurn(loggedMinutes: number, budgetMinutes: number | null, warningBps = BURN_WARNING_BPS): Burn {
  if (budgetMinutes === null || budgetMinutes <= 0) return { ratio: null, remainingMinutes: null, state: "none" };
  const state: BurnState =
    loggedMinutes > budgetMinutes ? "over" : loggedMinutes * 10_000 >= budgetMinutes * warningBps ? "warning" : "ok";
  return { ratio: loggedMinutes / budgetMinutes, remainingMinutes: budgetMinutes - loggedMinutes, state };
}

export type ContractShare = {
  /** Lo facturado del contrato: base sin IVA de lo emitido, con las rectificativas restadas. */
  contractRevenueCents: Cents;
  /** Minutos registrados en este proyecto. */
  projectMinutes: number;
  /** Minutos de todos los proyectos del contrato, este incluido. */
  contractMinutes: number;
  /** Proyectos del contrato, este incluido. */
  contractProjects: number;
};

/**
 * Lo facturado que le toca a un proyecto. Con el contrato para él solo, todo. Si lo comparte con
 * otros proyectos, se reparte por horas (a partes iguales mientras nadie las ha registrado): así lo
 * facturado no se cuenta dos veces y todos los proyectos del contrato tienen la misma tarifa.
 */
export function attributedRevenueCents(share: ContractShare): Cents {
  if (share.contractProjects <= 1) return share.contractRevenueCents;
  if (share.contractMinutes > 0) return scaleCents(share.contractRevenueCents, share.projectMinutes, share.contractMinutes);
  return scaleCents(share.contractRevenueCents, 1, share.contractProjects);
}

export type ProjectEconomics = {
  /** null sin contrato (interno, o sin contrato con el cliente): no hay facturado que medir. */
  revenueCents: Cents | null;
  rateCents: Cents | null;
  standing: RateStanding;
  /** Comparte contrato con otros proyectos: lo facturado se reparte. */
  shared: boolean;
};

export function projectEconomics(input: ContractShare & { contractId: string | null }, targetCents: Cents): ProjectEconomics {
  if (input.contractId === null) return { revenueCents: null, rateCents: null, standing: "none", shared: false };
  const shared = input.contractProjects > 1;
  const revenueCents = attributedRevenueCents(input);
  // Compartido: la tarifa es la del contrato entero (la misma para todos sus proyectos, sin redondeos de más).
  const rateCents =
    input.projectMinutes <= 0
      ? null
      : shared
        ? effectiveRateCents(input.contractRevenueCents, input.contractMinutes)
        : effectiveRateCents(revenueCents, input.projectMinutes);
  return { revenueCents, rateCents, standing: rateStanding(rateCents, targetCents), shared };
}

export type AggregateEconomics = {
  revenueCents: Cents;
  minutes: number;
  rateCents: Cents | null;
  standing: RateStanding;
};

/**
 * Rentabilidad de un conjunto de proyectos (los de un cliente): lo facturado de cada contrato una
 * sola vez, entre todas las horas, también las de los proyectos sin contrato (trabajo sin facturar).
 */
export function aggregateEconomics(
  projects: readonly { contractId: string | null; contractRevenueCents: Cents; loggedMinutes: number }[],
  targetCents: Cents,
): AggregateEconomics {
  const byContract = new Map<string, Cents>();
  let minutes = 0;
  for (const p of projects) {
    minutes += p.loggedMinutes;
    if (p.contractId !== null) byContract.set(p.contractId, p.contractRevenueCents);
  }
  const revenueCents = [...byContract.values()].reduce((sum, cents) => sum + cents, 0);
  const rateCents = effectiveRateCents(revenueCents, minutes);
  return { revenueCents, minutes, rateCents, standing: rateStanding(rateCents, targetCents) };
}
