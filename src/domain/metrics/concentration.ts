// Concentración de la facturación: cuánto depende el negocio de sus clientes más grandes.
// Sobre la facturación neta (base sin IVA, rectificativas restadas) de un periodo. Un cliente
// con neto 0 o negativo en el periodo no cuenta ni en el ranking ni en el total.

import { divRoundHalfAwayFromZero, type Cents } from "../money";

export type ClientBilling = { clientId: string; cents: Cents };

export type ClientShare = ClientBilling & {
  /** Parte del total, en puntos básicos (2500 = 25 %). */
  shareBps: number;
};

export type Concentration = {
  totalCents: Cents;
  /** Todos los clientes con neto positivo, de mayor a menor. */
  clients: ClientShare[];
  /** Parte del cliente más grande y de los tres más grandes, en puntos básicos. */
  top1ShareBps: number;
  top3ShareBps: number;
  /** El cliente más grande supera el umbral de la org. */
  alert: boolean;
};

const share = (cents: Cents, total: Cents) =>
  total > 0 ? Number(divRoundHalfAwayFromZero(BigInt(cents) * BigInt(10_000), BigInt(total))) : 0;

/** Ranking y concentración. `thresholdBps` es el umbral de aviso (orgs.settings). */
export function concentration(rows: readonly ClientBilling[], opts: { thresholdBps: number }): Concentration {
  const byClient = new Map<string, Cents>();
  for (const row of rows) byClient.set(row.clientId, (byClient.get(row.clientId) ?? 0) + row.cents);
  const positive = [...byClient]
    .filter(([, cents]) => cents > 0)
    .map(([clientId, cents]) => ({ clientId, cents }))
    .sort((a, b) => b.cents - a.cents || a.clientId.localeCompare(b.clientId));
  const totalCents = positive.reduce((sum, c) => sum + c.cents, 0);
  const clients = positive.map((c) => ({ ...c, shareBps: share(c.cents, totalCents) }));
  const top = (n: number) => share(positive.slice(0, n).reduce((sum, c) => sum + c.cents, 0), totalCents);
  const top1ShareBps = top(1);
  return {
    totalCents,
    clients,
    top1ShareBps,
    top3ShareBps: top(3),
    alert: clients.length > 0 && top1ShareBps >= opts.thresholdBps,
  };
}
