// A quién sirve un gasto (o una suscripción): a la empresa, a un cliente concreto o a las webs que
// alojamos (se reparte entre los clientes según sus webs del módulo Webs). Un gasto de un cliente
// se le puede repercutir, con un margen opcional (src/domain/finance/rebill.ts).
//
// Son los mismos invariantes que comprueba la base de datos en `expenses` y
// `expense_subscriptions` (supabase/migrations/20260927100000_gastos_clientes.sql):
//   (allocation = 'client') = (client_id is not null)
//   not rebill or allocation = 'client'
//   rebill_markup_bps between 0 and 100000

import { assertBps, type Bps } from "../money";

/** Mismos valores que el enum `cost_allocation`. */
export const COST_ALLOCATIONS = ["company", "client", "hosted_sites"] as const;
export type CostAllocation = (typeof COST_ALLOCATIONS)[number];

/** El margen de una repercusión va del 0 % al 1.000 %. */
export const MAX_REBILL_MARKUP_BPS = 100_000;

export type CostAssignment = {
  allocation: CostAllocation;
  clientId: string | null;
  /** Se le factura al cliente (solo con allocation = 'client'). */
  rebill: boolean;
  /** Margen sobre la base al repercutir (puntos básicos: 1000 = 10 %). */
  rebillMarkupBps: Bps;
};

export type CostAssignmentIssue = "clientRequired" | "clientNotAllowed" | "rebillClientOnly" | "markupRange";

/** Qué invariantes incumple (vacío si ninguno), en el orden en que se enseñan. */
export function costAssignmentIssues(assignment: CostAssignment): CostAssignmentIssue[] {
  const issues: CostAssignmentIssue[] = [];
  const forClient = assignment.allocation === "client";
  if (forClient && !assignment.clientId) issues.push("clientRequired");
  if (!forClient && assignment.clientId) issues.push("clientNotAllowed");
  if (assignment.rebill && !forClient) issues.push("rebillClientOnly");
  const markup = assignment.rebillMarkupBps;
  if (!Number.isSafeInteger(markup) || markup < 0 || markup > MAX_REBILL_MARKUP_BPS) issues.push("markupRange");
  return issues;
}

/** La asignación que se guarda: sin cliente si no es de un cliente, y sin margen si no se repercute. */
export function normalizeCostAssignment(assignment: CostAssignment): CostAssignment {
  const forClient = assignment.allocation === "client";
  const rebill = forClient && assignment.rebill;
  return {
    allocation: assignment.allocation,
    clientId: forClient ? assignment.clientId : null,
    rebill,
    rebillMarkupBps: rebill ? assertBps(assignment.rebillMarkupBps) : 0,
  };
}

/** Lo que tiene un gasto que no se ha asignado a nadie: de la empresa, sin repercutir. */
export const COMPANY_ASSIGNMENT: CostAssignment = { allocation: "company", clientId: null, rebill: false, rebillMarkupBps: 0 };
