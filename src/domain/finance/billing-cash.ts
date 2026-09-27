// Cobros previstos de lo que aún no se ha facturado, con fecha y con IVA: la parte de la
// previsión de caja que sale de los contratos firmados.
//
// Es la misma previsión que src/domain/billing/forecast.ts (forecastBilling, base sin IVA por
// mes), con las mismas reglas y los mismos bloques (periodsDue, periodAmountCents,
// splitByMilestones), pero evento a evento y en dinero que entra en el banco:
// - Cuándo se factura: el día que toca (billableOn) o hoy si ya tocaba y aún no se ha emitido.
// - Cuándo se cobra: esa fecha + el plazo de pago (contrato → cliente → org).
// - Cuánto: base + IVA de la línea − IRPF (el del emisor vigente en la fecha del periodo, solo si
//   el cliente es una empresa española y la línea está sujeta), redondeado por línea como al
//   facturar. Un test de paridad comprueba que las bases por mes son las de forecastBilling.
// El uso no se puede prever (como en forecastBilling); el ya registrado y aún sin facturar sí
// cuenta, igual que los hitos ya preparados (pendingItemEvents).

import { issuerOn, type IssuerAssignment } from "../billing/issuer";
import { splitByMilestones, validateMilestones } from "../billing/milestones";
import { periodAmountCents, periodsDue, type Pause } from "../billing/schedule";
import { addDays, compareCivil, maxCivil, type CivilDate } from "../dates/civil-date";
import { defaultIrpfBps } from "../invoicing/draft-line";
import { lineBaseCents } from "../metrics/mrr";
import { assertCents, type Bps, type Cents } from "../money";
import { computeLine } from "../tax/totals";

export type CashBillingLine = {
  id: string;
  billingType: "one_off" | "monthly" | "yearly" | "usage";
  quantity: string | number;
  unitPriceCents: Cents;
  discountBps: Bps;
  startsOn: CivilDate | null;
  endsOn: CivilDate | null;
  billingDay: number | null;
  prorateFirst: boolean;
  pauses: Pause[];
  /** Tipo de IVA de la línea (su tax_rate). */
  vatBps: Bps;
  irpfApplies: boolean;
};

export type CashBillingClient = { isBusiness: boolean; taxIdKind: "es" | "eu_vat" | "foreign"; countryCode: string };

export type CashBillingContract = {
  id: string;
  signedOn: CivilDate | null;
  /** Días de pago ya resueltos: los del contrato, si no los del cliente, si no los de la org. */
  paymentTermsDays: number;
  issuers: IssuerAssignment[];
  client: CashBillingClient;
  lines: CashBillingLine[];
  milestones: { id: string; position: number; percentBps: Bps; plannedOn: CivilDate | null }[];
  /** Hitos que ya tienen su concepto (pendiente, en borrador, facturado o condonado): no se prevén. */
  billedMilestoneIds: ReadonlySet<string>;
  /** Periodos recurrentes ya facturados (emitidos) o condonados, por línea: tampoco. */
  billedStarts: ReadonlyMap<string, ReadonlySet<CivilDate>>;
};

/** Un concepto ya creado y aún sin factura emitida (un uso registrado o un hito preparado). */
export type PendingBillableItem = {
  id: string;
  contractId: string;
  lineId: string;
  source: "usage" | "milestone";
  periodStart: CivilDate | null;
  billableOn: CivilDate;
  /** Base imponible ya calculada. */
  amountCents: Cents;
};

export type BillingCashEvent = {
  contractId: string;
  kind: "recurring" | "milestone" | "pending";
  lineId: string | null;
  milestoneId: string | null;
  itemId: string | null;
  /** El día que toca facturarlo según el calendario. */
  billableOn: CivilDate;
  /** Cuándo se emitirá la factura (manda en el trimestre del IVA): billableOn, o hoy si ya pasó. */
  invoicedOn: CivilDate;
  /** Cuándo se cobra: invoicedOn + plazo de pago. */
  collectedOn: CivilDate;
  issuerId: string | null;
  baseCents: Cents;
  vatCents: Cents;
  irpfCents: Cents;
  /** Lo que entra en el banco: base + IVA − IRPF. */
  totalCents: Cents;
};

type IrpfContext = { issuerIrpfBps: ReadonlyMap<string, Bps>; client: CashBillingClient };

function irpfFor(ctx: IrpfContext, issuerId: string | null, applies: boolean): Bps {
  if (!applies || issuerId === null) return 0;
  return defaultIrpfBps({ defaultIrpfBps: ctx.issuerIrpfBps.get(issuerId) ?? 0 }, ctx.client);
}

function amounts(base: { quantity: string | number; unitPriceCents: Cents; discountBps: Bps }, vatBps: Bps, irpfBps: Bps) {
  return computeLine({ ...base, vatBps, irpfBps, irpfApplies: irpfBps > 0 });
}

function dated(billableOn: CivilDate, today: CivilDate, terms: number) {
  const invoicedOn = maxCivil(billableOn, today);
  return { billableOn, invoicedOn, collectedOn: addDays(invoicedOn, terms) };
}

/**
 * Eventos de cobro de los periodos recurrentes y de los hitos con fecha aún sin facturar, con
 * fecha de calendario hasta `until` (incluido). Solo contratos firmados. `issuerIrpfBps`: el IRPF
 * por defecto de cada emisor.
 */
export function billingCashEvents(
  contracts: readonly CashBillingContract[],
  issuerIrpfBps: ReadonlyMap<string, Bps>,
  today: CivilDate,
  until: CivilDate,
): BillingCashEvent[] {
  const events: BillingCashEvent[] = [];
  for (const contract of contracts) {
    if (!contract.signedOn) continue;
    const ctx: IrpfContext = { issuerIrpfBps, client: contract.client };

    for (const line of contract.lines) {
      if ((line.billingType !== "monthly" && line.billingType !== "yearly") || !line.startsOn) continue;
      const periods = periodsDue(
        { billingType: line.billingType, startsOn: line.startsOn, endsOn: line.endsOn, billingDay: line.billingDay ?? 1, prorateFirst: line.prorateFirst },
        line.pauses,
        contract.billedStarts.get(line.id) ?? new Set(),
        until,
      );
      for (const period of periods) {
        const unit = period.activeDays === period.cycleDays ? line.unitPriceCents : periodAmountCents(line.unitPriceCents, period);
        const issuerId = issuerOn(contract.issuers, period.start);
        const a = amounts(
          { quantity: line.quantity, unitPriceCents: unit, discountBps: line.discountBps },
          line.vatBps,
          irpfFor(ctx, issuerId, line.irpfApplies),
        );
        events.push({
          contractId: contract.id,
          kind: "recurring",
          lineId: line.id,
          milestoneId: null,
          itemId: null,
          ...dated(period.billableOn, today, contract.paymentTermsDays),
          issuerId,
          baseCents: a.baseCents,
          vatCents: a.vatCents,
          irpfCents: a.irpfCents,
          totalCents: a.totalCents,
        });
      }
    }

    const oneOff = contract.lines.filter((l) => l.billingType === "one_off");
    const milestones = [...contract.milestones].sort((a, b) => a.position - b.position);
    if (oneOff.length === 0 || milestones.length === 0 || validateMilestones(milestones.map((m) => m.percentBps)) !== null) continue;
    const shares = splitByMilestones(
      oneOff.map((l) => ({ id: l.id, baseCents: lineBaseCents(l) })),
      milestones.map((m) => ({ id: m.id, percentBps: m.percentBps })),
    );
    for (const milestone of milestones) {
      if (contract.billedMilestoneIds.has(milestone.id) || !milestone.plannedOn) continue;
      if (compareCivil(milestone.plannedOn, until) > 0) continue;
      const issuerId = issuerOn(contract.issuers, milestone.plannedOn);
      let base = 0;
      let vat = 0;
      let irpf = 0;
      // Cada línea puntual es su propia línea de factura: IVA e IRPF redondeados por línea.
      for (const line of oneOff) {
        const share = shares[milestone.id]?.[line.id] ?? 0;
        const a = amounts({ quantity: 1, unitPriceCents: share, discountBps: 0 }, line.vatBps, irpfFor(ctx, issuerId, line.irpfApplies));
        base = assertCents(base + a.baseCents);
        vat = assertCents(vat + a.vatCents);
        irpf = assertCents(irpf + a.irpfCents);
      }
      events.push({
        contractId: contract.id,
        kind: "milestone",
        lineId: null,
        milestoneId: milestone.id,
        itemId: null,
        ...dated(milestone.plannedOn, today, contract.paymentTermsDays),
        issuerId,
        baseCents: base,
        vatCents: vat,
        irpfCents: irpf,
        totalCents: assertCents(base + vat - irpf),
      });
    }
  }
  return events.sort(byDate);
}

/** Por fecha de cobro y, a igualdad, por fecha de calendario y por contrato y concepto (orden estable). */
function byDate(a: BillingCashEvent, b: BillingCashEvent): number {
  return (
    compareCivil(a.collectedOn, b.collectedOn) ||
    compareCivil(a.billableOn, b.billableOn) ||
    a.contractId.localeCompare(b.contractId) ||
    (a.lineId ?? a.milestoneId ?? a.itemId ?? "").localeCompare(b.lineId ?? b.milestoneId ?? b.itemId ?? "")
  );
}

/** Eventos de cobro de los conceptos ya creados y aún sin factura emitida (usos e hitos preparados). */
export function pendingItemEvents(
  items: readonly PendingBillableItem[],
  contracts: readonly CashBillingContract[],
  issuerIrpfBps: ReadonlyMap<string, Bps>,
  today: CivilDate,
): BillingCashEvent[] {
  const byId = new Map(contracts.map((c) => [c.id, c]));
  const events: BillingCashEvent[] = [];
  for (const item of items) {
    const contract = byId.get(item.contractId);
    const line = contract?.lines.find((l) => l.id === item.lineId);
    if (!contract || !line) continue;
    const issuerId = issuerOn(contract.issuers, item.periodStart ?? item.billableOn);
    const a = amounts(
      { quantity: 1, unitPriceCents: item.amountCents, discountBps: 0 },
      line.vatBps,
      irpfFor({ issuerIrpfBps, client: contract.client }, issuerId, line.irpfApplies),
    );
    events.push({
      contractId: contract.id,
      kind: "pending",
      lineId: line.id,
      milestoneId: null,
      itemId: item.id,
      ...dated(item.billableOn, today, contract.paymentTermsDays),
      issuerId,
      baseCents: a.baseCents,
      vatCents: a.vatCents,
      irpfCents: a.irpfCents,
      totalCents: a.totalCents,
    });
  }
  return events.sort(byDate);
}
