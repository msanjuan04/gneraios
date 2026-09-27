import { describe, expect, it } from "vitest";
import { activeServices } from "./services";
import type { ReportContractFact, ReportLineFact } from "./types";

const AUGUST = "2026-08-01";

function line(id: string, overrides: Partial<ReportLineFact> = {}): ReportLineFact {
  return {
    id,
    position: 0,
    description: `Línea ${id}`,
    billingType: "monthly",
    startsOn: "2026-01-01",
    endsOn: null,
    replacesLineId: null,
    pauses: [],
    milestonesBilledOn: [],
    ...overrides,
  };
}

function contract(lines: ReportLineFact[], overrides: Partial<ReportContractFact> = {}): ReportContractFact {
  return { id: "k1", title: "SEO local y campañas", signedOn: "2025-12-15", archived: false, lines, ...overrides };
}

const ids = (services: { id: string }[]) => services.map((s) => s.id);

describe("activeServices", () => {
  it("una mensual en marcha sale entera, con el contrato y desde cuándo", () => {
    const { recurring, oneOff } = activeServices([contract([line("seo", { description: "  SEO local  " })])], AUGUST);
    expect(oneOff).toEqual([]);
    expect(recurring).toEqual([
      {
        id: "seo",
        description: "SEO local",
        billingType: "monthly",
        contractTitle: "SEO local y campañas",
        startsOn: "2026-01-01",
        endsOn: null,
        pausedInMonth: false,
      },
    ]);
  });

  it("fuera del mes no sale: terminada antes, empieza después o contrato sin firmar o archivado", () => {
    const services = activeServices(
      [
        contract([line("ended", { endsOn: "2026-07-31" }), line("later", { startsOn: "2026-09-01" }), line("last-day", { endsOn: "2026-08-01" })]),
        contract([line("unsigned")], { id: "k2", signedOn: null }),
        contract([line("archived")], { id: "k3", archived: true }),
        contract([line("signed-late", { startsOn: null, billingType: "usage" })], { id: "k4", signedOn: "2026-09-02" }),
      ],
      AUGUST,
    );
    expect(ids(services.recurring)).toEqual(["last-day"]);
  });

  it("en pausa todo el mes no sale; en pausa unos días, sí, y lo dice", () => {
    const { recurring } = activeServices(
      [
        contract([
          line("all-month", { pauses: [{ startsOn: "2026-07-20", endsOn: null }] }),
          line("some-days", { position: 1, pauses: [{ startsOn: "2026-08-10", endsOn: "2026-08-20" }] }),
        ]),
      ],
      AUGUST,
    );
    expect(recurring.map((s) => [s.id, s.pausedInMonth])).toEqual([["some-days", true]]);
  });

  it("las pausas no cuentan en las de uso; sin fecha de inicio empiezan con la firma", () => {
    const { recurring } = activeServices(
      [contract([line("ads", { billingType: "usage", startsOn: null, pauses: [{ startsOn: "2026-08-01", endsOn: null }] })])],
      AUGUST,
    );
    expect(recurring).toMatchObject([{ id: "ads", billingType: "usage", startsOn: "2025-12-15", pausedInMonth: false }]);
  });

  it("un cambio de precio a mitad de mes: solo la línea nueva", () => {
    const { recurring } = activeServices(
      [contract([line("old", { endsOn: "2026-08-15" }), line("new", { position: 1, startsOn: "2026-08-16", replacesLineId: "old" })])],
      AUGUST,
    );
    expect(ids(recurring)).toEqual(["new"]);
  });

  it("puntual: termina cuando se factura el último hito", () => {
    const { oneOff } = activeServices(
      [
        contract([
          line("done-before", { billingType: "one_off", startsOn: null, milestonesBilledOn: ["2026-05-01", "2026-07-30"] }),
          line("done-in-month", { billingType: "one_off", startsOn: null, milestonesBilledOn: ["2026-05-01", "2026-08-12"] }),
          line("half", { billingType: "one_off", startsOn: null, milestonesBilledOn: ["2026-05-01", null] }),
          line("no-milestones", { billingType: "one_off", startsOn: "2026-06-01", endsOn: null }),
        ]),
      ],
      AUGUST,
    );
    expect(ids(oneOff)).toEqual(["done-in-month", "half", "no-milestones"]);
  });

  it("en el orden de los contratos (por firma) y de sus líneas", () => {
    const { recurring } = activeServices(
      [
        contract([line("b2", { position: 2 }), line("b1", { position: 1 })], { id: "b", signedOn: "2026-03-01" }),
        contract([line("a1")], { id: "a", signedOn: "2025-01-01" }),
      ],
      AUGUST,
    );
    expect(ids(recurring)).toEqual(["a1", "b1", "b2"]);
  });
});
