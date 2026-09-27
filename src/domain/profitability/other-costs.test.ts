import { describe, expect, it } from "vitest";
import {
  addOtherCosts,
  type ClientExpenseRef,
  hasOtherCosts,
  noOtherCosts,
  type OtherCosts,
  otherCostsByClient,
  otherCostsCents,
  splitHosting,
  splitHostingCosts,
} from "./other-costs";

const site = (id: string, clientId: string | null) => ({ id, clientId });

describe("reparto de la infraestructura entre las webs alojadas (splitHosting)", () => {
  it("a partes iguales por web; cada cliente suma las suyas", () => {
    // 90 € entre 3 webs: 30 € cada una; el hotel tiene dos.
    const split = splitHosting(9000, [site("w-hotel-1", "c-hotel"), site("w-hotel-2", "c-hotel"), site("w-dental", "c-dental")]);
    expect(split.sites).toBe(3);
    expect(split.byClient.get("c-hotel")).toEqual({ cents: 6000, sites: 2 });
    expect(split.byClient.get("c-dental")).toEqual({ cents: 3000, sites: 1 });
    expect(split.unassigned).toEqual({ cents: 0, sites: 0 });
  });

  it("es exacto: el céntimo que sobra va a la primera web por id, venga en el orden que venga", () => {
    const sites = [site("w-c", "c-3"), site("w-a", "c-1"), site("w-b", "c-2")];
    const split = splitHosting(1000, sites);
    expect([...split.bySite]).toEqual([
      ["w-a", 334],
      ["w-b", 333],
      ["w-c", 333],
    ]);
    expect(splitHosting(1000, [...sites].reverse()).bySite).toEqual(split.bySite);
    const parts = [...split.bySite.values()];
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it("las webs sin cliente (la nuestra) no van a ningún cliente; sin webs, todo queda sin cliente", () => {
    const split = splitHosting(6000, [site("w-propia", null), site("w-hotel", "c-hotel")]);
    expect(split.unassigned).toEqual({ cents: 3000, sites: 1 });
    expect(split.byClient.get("c-hotel")).toEqual({ cents: 3000, sites: 1 });

    const none = splitHosting(6000, []);
    expect(none).toMatchObject({ totalCents: 6000, sites: 0, unassigned: { cents: 6000, sites: 0 } });
    expect(none.byClient.size).toBe(0);
  });

  it("una web repetida cuenta una vez y un abono (negativo) se reparte igual, con su signo", () => {
    const split = splitHosting(-900, [site("w-1", "c-1"), site("w-1", "c-1"), site("w-2", "c-2")]);
    expect(split.sites).toBe(2);
    expect(split.byClient.get("c-1")).toEqual({ cents: -450, sites: 1 });
    expect(split.byClient.get("c-2")).toEqual({ cents: -450, sites: 1 });
  });

  it("no acepta importes que no son céntimos enteros", () => {
    expect(() => splitHosting(10.5, [site("w", null)])).toThrow();
  });
});

describe("reparto gasto a gasto con la fecha en que cada uno pasó a ser cliente (splitHostingCosts)", () => {
  const sites = [site("w-a", "c-a"), site("w-b", "c-b"), site("w-own", null)];

  it("sin fechas de alta, es el reparto del total", () => {
    const dated = splitHostingCosts([{ costCents: 600 }, { costCents: 300, issuedOn: "2026-02-01" }], sites);
    const plain = splitHosting(900, sites);
    expect(dated).toEqual({ totalCents: 900, sites: 3, byClient: plain.byClient, unassigned: plain.unassigned, beforeStartCents: 0 });
  });

  it("antes de su alta, la parte de un cliente no es suya; los gastos sin fecha cuentan siempre", () => {
    const split = splitHostingCosts(
      [
        { costCents: 900, issuedOn: "2026-01-10" },
        { costCents: 900, issuedOn: "2026-03-10" },
        { costCents: 300 },
      ],
      sites,
      new Map([
        ["c-a", "2025-06-01"],
        ["c-b", "2026-02-01"],
      ]),
    );
    expect(split.byClient.get("c-a")).toEqual({ cents: 700, sites: 1 });
    // c-b: nada del de enero; sí el de marzo y el que no tiene fecha.
    expect(split.byClient.get("c-b")).toEqual({ cents: 400, sites: 1 });
    expect(split.unassigned).toEqual({ cents: 1000, sites: 1 });
    expect(split.beforeStartCents).toBe(300);
    expect(split.byClient.get("c-a")!.cents + split.byClient.get("c-b")!.cents + split.unassigned.cents).toBe(split.totalCents);
  });

  it("el mismo día de alta ya cuenta", () => {
    const split = splitHostingCosts([{ costCents: 200, issuedOn: "2026-02-01" }], [site("w-b", "c-b")], new Map([["c-b", "2026-02-01"]]));
    expect(split.byClient.get("c-b")).toEqual({ cents: 200, sites: 1 });
  });
});

describe("lo que cuesta cada cliente además de sus horas (otherCostsByClient)", () => {
  const expense = (clientId: string, costCents: number, rebill = false, rebilled = false): ClientExpenseRef => ({
    clientId,
    costCents,
    rebill,
    rebilled,
  });

  it("suma sus gastos y separa lo repercutible y lo que aún no tiene factura", () => {
    const byClient = otherCostsByClient(
      [expense("c-hotel", 12_000), expense("c-hotel", 5000, true, true), expense("c-hotel", 3000, true, false), expense("c-dental", -2000)],
      splitHosting(0, []),
    );
    expect(byClient.get("c-hotel")).toEqual({ expensesCents: 20_000, rebillCents: 8000, rebillPendingCents: 3000, hostingCents: 0, hostedSites: 0 });
    // Un abono del proveedor resta.
    expect(byClient.get("c-dental")).toMatchObject({ expensesCents: -2000, rebillCents: 0 });
  });

  it("añade la parte de sus webs, también a quien no tiene gastos", () => {
    const hosting = splitHosting(4000, [site("w-hotel", "c-hotel"), site("w-celler", "c-celler")]);
    const byClient = otherCostsByClient([expense("c-hotel", 1000)], hosting);
    expect(byClient.get("c-hotel")).toMatchObject({ expensesCents: 1000, hostingCents: 2000, hostedSites: 1 });
    expect(byClient.get("c-celler")).toMatchObject({ expensesCents: 0, hostingCents: 2000, hostedSites: 1 });
    expect(otherCostsCents(byClient.get("c-hotel")!)).toBe(3000);
  });

  it("utilidades: sin costes, sumas y si hay algo que contar", () => {
    expect(hasOtherCosts(noOtherCosts())).toBe(false);
    // Webs sin coste en el periodo: nada que contar.
    const sitesWithoutCost: OtherCosts = { ...noOtherCosts(), hostedSites: 2 };
    expect(hasOtherCosts(sitesWithoutCost)).toBe(false);
    expect(hasOtherCosts({ ...noOtherCosts(), hostingCents: 1 })).toBe(true);
    expect(
      addOtherCosts(
        { expensesCents: 100, rebillCents: 50, rebillPendingCents: 10, hostingCents: 7, hostedSites: 1 },
        { expensesCents: 1, rebillCents: 1, rebillPendingCents: 1, hostingCents: 1, hostedSites: 2 },
      ),
    ).toEqual({ expensesCents: 101, rebillCents: 51, rebillPendingCents: 11, hostingCents: 8, hostedSites: 3 });
  });
});
