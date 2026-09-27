import { describe, expect, it } from "vitest";
import {
  allocationKey,
  type AllocationCostRow,
  clientVendorCosts,
  countVendorKinds,
  DEFAULT_VENDOR_SORT,
  filterVendors,
  foldText,
  isVendorKind,
  matchesVendorQuery,
  nextVendorSort,
  phoneHref,
  readVendorKindFilter,
  sharesBps,
  sortVendors,
  summarizeAllocations,
  topClientBuckets,
  type VendorListRow,
  vendorListTotals,
  websiteLink,
} from ".";

const row = (overrides: Partial<AllocationCostRow>): AllocationCostRow => ({
  allocation: "company",
  clientId: null,
  clientName: null,
  expensesCount: 1,
  costCents: 0,
  yearExpensesCount: 0,
  yearCostCents: 0,
  pendingCents: 0,
  lastExpenseOn: null,
  ...overrides,
});

describe("tipos de proveedor", () => {
  it("empresa o freelance; en la URL, cualquier otra cosa es «todos»", () => {
    expect(isVendorKind("freelancer")).toBe(true);
    expect(isVendorKind("person")).toBe(false);
    expect(readVendorKindFilter("company")).toBe("company");
    expect(readVendorKindFilter("freelancer")).toBe("freelancer");
    expect(readVendorKindFilter("nadie")).toBe("all");
    expect(readVendorKindFilter(null)).toBe("all");
  });
});

describe("reparto en puntos básicos (mayor resto)", () => {
  it("suma exactamente 10.000 y el resto va al primero en caso de empate", () => {
    expect(sharesBps([1, 1, 1])).toEqual([3334, 3333, 3333]);
    expect(sharesBps([2, 1])).toEqual([6667, 3333]);
    expect(sharesBps([100_000])).toEqual([10_000]);
    const odd = sharesBps([33_333, 33_333, 33_334, 7]);
    expect(odd.reduce((a, b) => a + b, 0)).toBe(10_000);
  });

  it("lo negativo cuenta como 0; sin nada positivo, todo es 0", () => {
    expect(sharesBps([-5_000, 10_000])).toEqual([0, 10_000]);
    expect(sharesBps([0, 0])).toEqual([0, 0]);
    expect(sharesBps([-1])).toEqual([0]);
    expect(sharesBps([])).toEqual([]);
  });

  it("importes enormes sin perder precisión", () => {
    const big = Number.MAX_SAFE_INTEGER;
    expect(sharesBps([big, big]).reduce((a, b) => a + b, 0)).toBe(10_000);
    expect(() => sharesBps([1.5])).toThrow();
  });
});

describe("¿para quién? (destinos de un proveedor)", () => {
  const rows: AllocationCostRow[] = [
    row({ allocation: "company", expensesCount: 2, costCents: 8_000, yearExpensesCount: 1, yearCostCents: -2_000, lastExpenseOn: "2026-09-27" }),
    row({ allocation: "client", clientId: "a", clientName: "Hotel Llevant", expensesCount: 2, costCents: 26_050, yearExpensesCount: 2, yearCostCents: 26_050, pendingCents: 24_200, lastExpenseOn: "2026-09-27" }),
    row({ allocation: "client", clientId: "b", clientName: "Clínica Mar Blau", expensesCount: 1, costCents: 30_000, pendingCents: 31_800, lastExpenseOn: "2025-12-20" }),
    row({ allocation: "hosted_sites", expensesCount: 1, costCents: 1_000, yearExpensesCount: 1, yearCostCents: 1_000, lastExpenseOn: "2026-09-27" }),
  ];

  it("de siempre: todos los destinos, del que más cuesta al que menos, con su parte", () => {
    const summary = summarizeAllocations(rows);
    expect(summary.period).toBe("total");
    expect(summary.buckets.map((b) => [b.key, b.amountCents, b.shareBps])).toEqual([
      ["client:b", 30_000, 4612],
      ["client:a", 26_050, 4004],
      ["company", 8_000, 1230],
      ["hosted_sites", 1_000, 154],
    ]);
    expect(summary.buckets.reduce((s, b) => s + b.shareBps, 0)).toBe(10_000);
    expect(summary).toMatchObject({ count: 6, amountCents: 65_050, pendingCents: 56_000, clientsCount: 2, clientShareBps: 8616 });
  });

  it("este año: solo lo que tiene gastos del año; un abono resta pero no se reparte", () => {
    const summary = summarizeAllocations(rows, "year");
    expect(summary.buckets.map((b) => [b.key, b.count, b.amountCents, b.shareBps])).toEqual([
      ["client:a", 2, 26_050, 9630],
      ["hosted_sites", 1, 1_000, 370],
      ["company", 1, -2_000, 0],
    ]);
    // El cliente B no tiene gastos este año: fuera. Lo pendiente sí cuenta (se le debe hoy).
    expect(summary).toMatchObject({ count: 4, amountCents: 25_050, pendingCents: 56_000, clientsCount: 1, clientShareBps: 9630 });
  });

  it("dos filas del mismo destino se suman (y se queda la fecha más reciente)", () => {
    const summary = summarizeAllocations([
      row({ allocation: "client", clientId: "a", clientName: "Hotel", costCents: 100, lastExpenseOn: "2026-01-10" }),
      row({ allocation: "client", clientId: "a", clientName: null, costCents: 50, pendingCents: 20, lastExpenseOn: "2026-03-01" }),
    ]);
    expect(summary.buckets).toEqual([
      {
        key: "client:a",
        allocation: "client",
        clientId: "a",
        clientName: "Hotel",
        count: 2,
        amountCents: 150,
        shareBps: 10_000,
        pendingCents: 20,
        lastExpenseOn: "2026-03-01",
      },
    ]);
  });

  it("a igualdad de coste: la empresa, los clientes por nombre y las webs", () => {
    const summary = summarizeAllocations([
      row({ allocation: "hosted_sites", costCents: 500 }),
      row({ allocation: "client", clientId: "z", clientName: "Zeta", costCents: 500 }),
      row({ allocation: "client", clientId: "a", clientName: "Àlex", costCents: 500 }),
      row({ allocation: "company", costCents: 500 }),
    ]);
    expect(summary.buckets.map((b) => b.key)).toEqual(["company", "client:a", "client:z", "hosted_sites"]);
    expect(summary.buckets.map((b) => b.shareBps)).toEqual([2500, 2500, 2500, 2500]);
  });

  it("sin gastos, nada que repartir", () => {
    expect(summarizeAllocations([])).toEqual({
      period: "total",
      buckets: [],
      count: 0,
      amountCents: 0,
      pendingCents: 0,
      clientsCount: 0,
      clientShareBps: 0,
    });
  });

  it("los invariantes del reparto (los mismos que la base de datos)", () => {
    expect(allocationKey("company", null)).toBe("company");
    expect(allocationKey("client", "a")).toBe("client:a");
    expect(() => allocationKey("client", null)).toThrow();
    expect(() => allocationKey("hosted_sites", "a")).toThrow();
  });

  it("los clientes que más cuestan y lo que suman los demás", () => {
    const summary = summarizeAllocations(rows);
    const { top, rest } = topClientBuckets(summary, 1);
    expect(top.map((b) => b.clientName)).toEqual(["Clínica Mar Blau"]);
    expect(rest).toEqual({ clients: 1, amountCents: 26_050, shareBps: 4004 });
    expect(topClientBuckets(summary, 5).rest).toEqual({ clients: 0, amountCents: 0, shareBps: 0 });
    expect(topClientBuckets(summary, -1).top).toEqual([]);
  });
});

describe("proveedores de un cliente", () => {
  it("del que más ha costado este año al que menos, luego por lo de siempre y por nombre; con los totales", () => {
    const { vendors, totals } = clientVendorCosts([
      { vendorId: "1", name: "Oriol Pons Dev", expensesCount: 3, costCents: 90_000, yearCostCents: 0, lastExpenseOn: "2025-11-02" },
      { vendorId: "2", name: "Clara Font Studio", expensesCount: 2, costCents: 40_000, yearCostCents: 40_000, lastExpenseOn: "2026-06-01" },
      { vendorId: "3", name: "Aerial Maresme SL", expensesCount: 1, costCents: 40_000, yearCostCents: 40_000, lastExpenseOn: "2026-02-01" },
      { vendorId: "2", name: "Clara Font Studio", expensesCount: 1, costCents: 5_000, yearCostCents: 5_000, lastExpenseOn: "2026-07-15" },
    ]);
    expect(vendors.map((v) => [v.name, v.expensesCount, v.yearCostCents, v.costCents, v.lastExpenseOn])).toEqual([
      ["Clara Font Studio", 3, 45_000, 45_000, "2026-07-15"],
      ["Aerial Maresme SL", 1, 40_000, 40_000, "2026-02-01"],
      ["Oriol Pons Dev", 3, 0, 90_000, "2025-11-02"],
    ]);
    expect(totals).toEqual({ expensesCount: 7, costCents: 175_000, yearCostCents: 85_000 });
  });
});

describe("listado de proveedores", () => {
  const vendor = (overrides: Partial<VendorListRow>): VendorListRow => ({
    name: "Proveedor",
    kind: "company",
    taxId: null,
    contactName: null,
    email: null,
    archived: false,
    yearCostCents: 0,
    costCents: 0,
    pendingCents: 0,
    clientsCount: 0,
    lastExpenseOn: null,
    ...overrides,
  });
  const list = [
    vendor({ name: "Espai Cowork Mataró SL", taxId: "B37085107", yearCostCents: 300_000, costCents: 900_000 }),
    vendor({ name: "Clara Font Studio", kind: "freelancer", contactName: "Clara Font", email: "hola@clarafont.cat", yearCostCents: 450_000, costCents: 450_000, clientsCount: 2, lastExpenseOn: "2026-09-01" }),
    vendor({ name: "Oriol Pons Dev", kind: "freelancer", taxId: "95647921Y", pendingCents: 120_000, costCents: 120_000, lastExpenseOn: "2026-08-15" }),
    vendor({ name: "Antigua Gestoría", archived: true, yearCostCents: 999_999, costCents: 999_999, lastExpenseOn: "2024-01-01" }),
  ];

  it("busca sin acentos ni mayúsculas en el nombre, el NIF (con o sin guiones), el contacto y el email", () => {
    expect(foldText("Mataró ÀLEX")).toBe("mataro alex");
    expect(matchesVendorQuery(list[0]!, "mataro cowork")).toBe(true);
    expect(matchesVendorQuery(list[0]!, "b-370.851")).toBe(true);
    expect(matchesVendorQuery(list[1]!, "clarafont.cat")).toBe(true);
    expect(matchesVendorQuery(list[1]!, "  ")).toBe(true);
    expect(matchesVendorQuery(list[2]!, "clara")).toBe(false);
    // Un término sin letras ni números no casa con cualquier NIF.
    expect(matchesVendorQuery(list[2]!, "--")).toBe(false);
  });

  it("filtra por tipo y, si no se piden, deja fuera los archivados", () => {
    const names = (filter: Parameters<typeof filterVendors>[1]) => filterVendors(list, filter).map((v) => v.name);
    expect(names({ query: "", kind: "all", showArchived: false })).toEqual(["Espai Cowork Mataró SL", "Clara Font Studio", "Oriol Pons Dev"]);
    expect(names({ query: "", kind: "freelancer", showArchived: false })).toEqual(["Clara Font Studio", "Oriol Pons Dev"]);
    expect(names({ query: "gestoria", kind: "all", showArchived: false })).toEqual([]);
    expect(names({ query: "gestoria", kind: "company", showArchived: true })).toEqual(["Antigua Gestoría"]);
    expect(countVendorKinds(list, false)).toEqual({ all: 3, company: 1, freelancer: 2 });
    expect(countVendorKinds(list, true)).toEqual({ all: 4, company: 2, freelancer: 2 });
  });

  it("ordena por la columna (los archivados, siempre al final; sin gastos, al final por fecha)", () => {
    const names = (sort: Parameters<typeof sortVendors>[1]) => sortVendors(list, sort).map((v) => v.name);
    expect(DEFAULT_VENDOR_SORT).toEqual({ key: "yearCost", direction: "desc" });
    expect(names(DEFAULT_VENDOR_SORT)).toEqual(["Clara Font Studio", "Espai Cowork Mataró SL", "Oriol Pons Dev", "Antigua Gestoría"]);
    expect(names({ key: "name", direction: "asc" })).toEqual(["Clara Font Studio", "Espai Cowork Mataró SL", "Oriol Pons Dev", "Antigua Gestoría"]);
    expect(names({ key: "name", direction: "desc" })).toEqual(["Oriol Pons Dev", "Espai Cowork Mataró SL", "Clara Font Studio", "Antigua Gestoría"]);
    expect(names({ key: "pending", direction: "desc" })[0]).toBe("Oriol Pons Dev");
    expect(names({ key: "lastExpense", direction: "desc" })).toEqual(["Clara Font Studio", "Oriol Pons Dev", "Espai Cowork Mataró SL", "Antigua Gestoría"]);
    expect(names({ key: "lastExpense", direction: "asc" })).toEqual(["Oriol Pons Dev", "Clara Font Studio", "Espai Cowork Mataró SL", "Antigua Gestoría"]);
    // A igualdad (0 clientes), lo de siempre de mayor a menor.
    expect(names({ key: "clients", direction: "desc" })).toEqual(["Clara Font Studio", "Espai Cowork Mataró SL", "Oriol Pons Dev", "Antigua Gestoría"]);
    expect(list[0]!.name).toBe("Espai Cowork Mataró SL");
  });

  it("al pulsar una columna: el nombre de la A a la Z, las cifras de mayor a menor; otra vez, al revés", () => {
    expect(nextVendorSort(DEFAULT_VENDOR_SORT, "name")).toEqual({ key: "name", direction: "asc" });
    expect(nextVendorSort(DEFAULT_VENDOR_SORT, "cost")).toEqual({ key: "cost", direction: "desc" });
    expect(nextVendorSort(DEFAULT_VENDOR_SORT, "yearCost")).toEqual({ key: "yearCost", direction: "asc" });
    expect(nextVendorSort({ key: "name", direction: "asc" }, "name")).toEqual({ key: "name", direction: "desc" });
  });

  it("totales de lo que se ve", () => {
    expect(vendorListTotals(list.slice(0, 3))).toEqual({ yearCostCents: 750_000, costCents: 1_470_000, pendingCents: 120_000 });
    expect(vendorListTotals([])).toEqual({ yearCostCents: 0, costCents: 0, pendingCents: 0 });
  });
});

describe("contacto", () => {
  it("la web, con https:// para el enlace y sin él (ni www ni la barra final) para leer", () => {
    expect(websiteLink("estudi.cat/portfolio/")).toEqual({ href: "https://estudi.cat/portfolio/", label: "estudi.cat/portfolio" });
    expect(websiteLink(" https://www.clarafont.cat ")).toEqual({ href: "https://www.clarafont.cat", label: "clarafont.cat" });
    expect(websiteLink("HTTP://oriol.dev")).toEqual({ href: "HTTP://oriol.dev", label: "oriol.dev" });
  });

  it("el teléfono, para llamar", () => {
    expect(phoneHref("+34 600 11 22 33")).toBe("tel:+34600112233");
    expect(phoneHref("(93) 790-12.34")).toBe("tel:937901234");
  });
});
