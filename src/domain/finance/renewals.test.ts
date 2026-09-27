import { describe, expect, it } from "vitest";
import { addDays } from "../dates/civil-date";
import {
  daysUntil,
  isRenewalWatched,
  isRunning,
  isWithinWarning,
  nextRenewalOn,
  planRenewalAlerts,
  type RenewalCandidate,
  type RenewalSettings,
  renewalAlertKey,
} from "./renewals";
import { COMPANY_ASSIGNMENT } from "./allocation";
import { type ExpenseSubscription, nextChargeOn } from "./subscriptions";

const SETTINGS: RenewalSettings = { warningDays: 14, monthlyMinCents: 5000 };

const domain: RenewalCandidate = {
  id: "s-domain",
  name: "Dominio hotelllevant.com",
  chargeTotalCents: 1815,
  expenseGroup: "operating",
  interval: "yearly",
  startsOn: "2025-10-05",
  endsOn: null,
  billingDay: null,
  isActive: true,
};

const server: RenewalCandidate = {
  id: "s-server",
  name: "Servidor dedicado",
  chargeTotalCents: 7260,
  expenseGroup: "operating",
  interval: "monthly",
  startsOn: "2026-01-15",
  endsOn: null,
  billingDay: 15,
  isActive: true,
};

describe("próxima renovación (nextRenewalOn)", () => {
  it("anual: el aniversario del alta; mensual: el día de cargo, con hoy incluido", () => {
    expect(nextRenewalOn(domain, "2026-09-27")).toBe("2026-10-05");
    expect(nextRenewalOn(domain, "2026-10-05")).toBe("2026-10-05");
    expect(nextRenewalOn(domain, "2026-10-06")).toBe("2027-10-05");
    expect(nextRenewalOn(server, "2026-09-27")).toBe("2026-10-15");
    expect(nextRenewalOn(server, "2026-10-15")).toBe("2026-10-15");
  });

  it("el mismo calendario que sus gastos: día 31 en meses cortos y 29 de febrero en años no bisiestos", () => {
    expect(nextRenewalOn({ ...server, startsOn: "2026-01-31", billingDay: 31 }, "2026-02-01")).toBe("2026-02-28");
    expect(nextRenewalOn({ ...domain, startsOn: "2024-02-29" }, "2026-01-10")).toBe("2026-02-28");
    // Antes de empezar, su primer cargo (el día de alta aunque no sea el de cargo).
    expect(nextRenewalOn({ ...server, startsOn: "2026-11-20", billingDay: 1 }, "2026-09-27")).toBe("2026-11-20");
  });

  it("apagada o terminada: no hay próxima", () => {
    expect(nextRenewalOn({ ...domain, isActive: false }, "2026-09-27")).toBeNull();
    expect(nextRenewalOn({ ...domain, endsOn: "2026-09-30" }, "2026-09-27")).toBeNull();
    // Termina justo el día del cargo: ese cargo aún toca.
    expect(nextRenewalOn({ ...domain, endsOn: "2026-10-05" }, "2026-09-27")).toBe("2026-10-05");
  });

  it("coincide con el próximo cargo de la lista de suscripciones (nextChargeOn, desde ayer)", () => {
    const full = (sub: RenewalCandidate): ExpenseSubscription => ({
      ...COMPANY_ASSIGNMENT,
      id: sub.id,
      issuerId: "sl",
      vendorId: null,
      categoryId: "cat",
      memberId: null,
      description: sub.name,
      baseCents: 1000,
      vatBps: 2100,
      vatDeductible: true,
      irpfBps: 0,
      interval: sub.interval,
      startsOn: sub.startsOn,
      endsOn: sub.endsOn,
      billingDay: sub.billingDay,
      paymentMethod: "card",
      isActive: sub.isActive,
    });
    const days = ["2026-01-01", "2026-02-28", "2026-10-05", "2026-10-15", "2026-12-31", "2027-02-28"];
    for (const sub of [domain, server, { ...server, startsOn: "2026-01-31", billingDay: 31 }, { ...domain, endsOn: "2027-01-01" }]) {
      for (const today of days) expect(nextRenewalOn(sub, today), `${sub.id} ${today}`).toBe(nextChargeOn(full(sub), addDays(today, -1)));
    }
  });
});

describe("días y ventana de aviso", () => {
  it("días que faltan y si caen dentro del aviso (hoy y el último día, incluidos)", () => {
    expect(daysUntil("2026-10-05", "2026-09-27")).toBe(8);
    expect(daysUntil("2026-09-27", "2026-09-27")).toBe(0);
    expect(isWithinWarning("2026-09-27", "2026-09-27", 14)).toBe(true);
    expect(isWithinWarning("2026-10-11", "2026-09-27", 14)).toBe(true);
    expect(isWithinWarning("2026-10-12", "2026-09-27", 14)).toBe(false);
    expect(isWithinWarning("2026-09-26", "2026-09-27", 14)).toBe(false);
    expect(isWithinWarning(null, "2026-09-27", 14)).toBe(false);
  });

  it("en marcha: encendida y sin terminar (también antes de empezar)", () => {
    expect(isRunning(domain, "2026-09-27")).toBe(true);
    expect(isRunning({ ...domain, endsOn: "2026-09-27" }, "2026-09-27")).toBe(true);
    expect(isRunning({ ...domain, endsOn: "2026-09-26" }, "2026-09-27")).toBe(false);
    expect(isRunning({ ...domain, isActive: false }, "2026-09-27")).toBe(false);
  });

  it("de qué se avisa: anuales siempre, mensuales desde el importe mínimo, nunca nóminas ni socios", () => {
    expect(isRenewalWatched(domain, SETTINGS)).toBe(true);
    expect(isRenewalWatched(server, SETTINGS)).toBe(true);
    expect(isRenewalWatched({ ...server, chargeTotalCents: 4999 }, SETTINGS)).toBe(false);
    expect(isRenewalWatched({ ...server, chargeTotalCents: 5000 }, SETTINGS)).toBe(true);
    expect(isRenewalWatched({ ...server, chargeTotalCents: 1_000_000, expenseGroup: "partner_compensation" }, SETTINGS)).toBe(false);
    expect(isRenewalWatched({ ...domain, expenseGroup: "payroll" }, SETTINGS)).toBe(false);
  });
});

describe("avisos de renovación (planRenewalAlerts)", () => {
  it("dentro de los días de aviso, con su clave, su fecha, los días y el importe del cargo", () => {
    // Al dominio le faltan 8 días; al servidor, 18 (fuera de los 14 de aviso).
    expect(planRenewalAlerts([domain, server], "2026-09-27", SETTINGS)).toEqual([
      {
        subscriptionId: "s-domain",
        key: "subscription_renewal:s-domain:2026-10-05",
        renewalOn: "2026-10-05",
        params: { name: "Dominio hotelllevant.com", date: "2026-10-05", days: 8, amount_cents: 1815 },
      },
    ]);
    // Con 20 días de aviso, también el servidor; del cargo más cercano al más lejano.
    expect(planRenewalAlerts([server, domain], "2026-09-27", { ...SETTINGS, warningDays: 20 }).map((a) => [a.subscriptionId, a.params.days])).toEqual([
      ["s-domain", 8],
      ["s-server", 18],
    ]);
  });

  it("la misma clave cada día hasta el cargo; después, la del siguiente", () => {
    const keys = ["2026-09-21", "2026-09-30", "2026-10-05"].map((today) => planRenewalAlerts([domain], today, SETTINGS)[0]?.key);
    expect(new Set(keys)).toEqual(new Set([renewalAlertKey("s-domain", "2026-10-05")]));
    expect(planRenewalAlerts([domain], "2026-10-06", SETTINGS)).toEqual([]);
    expect(planRenewalAlerts([domain], "2027-09-25", SETTINGS)[0]?.key).toBe("subscription_renewal:s-domain:2027-10-05");
  });

  it("hoy también avisa (días 0); el primer cargo y las mensuales pequeñas, no", () => {
    expect(planRenewalAlerts([domain], "2026-10-05", SETTINGS)[0]?.params.days).toBe(0);
    expect(planRenewalAlerts([{ ...domain, startsOn: "2026-10-01" }], "2026-09-27", SETTINGS)).toEqual([]);
    expect(planRenewalAlerts([{ ...server, chargeTotalCents: 1210 }], "2026-10-10", SETTINGS)).toEqual([]);
    expect(planRenewalAlerts([server], "2026-10-10", SETTINGS).map((a) => a.params.days)).toEqual([5]);
  });

  it("apagadas, terminadas, nóminas y retribución de socios no avisan", () => {
    const today = "2026-09-27";
    expect(planRenewalAlerts([{ ...domain, isActive: false }], today, SETTINGS)).toEqual([]);
    expect(planRenewalAlerts([{ ...domain, endsOn: "2026-10-01" }], today, SETTINGS)).toEqual([]);
    expect(planRenewalAlerts([{ ...domain, expenseGroup: "partner_compensation" }], today, SETTINGS)).toEqual([]);
    expect(planRenewalAlerts([{ ...domain, expenseGroup: "payroll" }], today, SETTINGS)).toEqual([]);
  });

  it("el nombre va sin espacios de más y no acepta un «hoy» que no es una fecha", () => {
    expect(planRenewalAlerts([{ ...domain, name: "  Dominio  " }], "2026-09-27", SETTINGS)[0]?.params.name).toBe("Dominio");
    expect(() => planRenewalAlerts([domain], "27/09/2026", SETTINGS)).toThrow();
  });
});
