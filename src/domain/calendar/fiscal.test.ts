import { describe, expect, it } from "vitest";
import {
  FISCAL_CALENDAR_DEFAULTS,
  type FiscalCalendarSettings,
  type FiscalIssuer,
  fiscalDeadlines,
  fiscalEvents,
  isoWeekday,
  modelsForIssuer,
  readFiscalCalendarSettings,
  shiftWeekend,
} from "./fiscal";

const SL: FiscalIssuer = {
  id: "sl",
  kind: "company",
  name: "GNERAI SL",
  memberId: null,
  activeFrom: "2026-03-15",
  activeUntil: null,
  archived: false,
  verifactuFrom: "2027-01-01",
  fiscalProvider: "internal",
  hasIntraEuOperations: false,
};

const MARC: FiscalIssuer = {
  id: "marc",
  kind: "self_employed",
  name: "Marc Sanjuan",
  memberId: "member-ms",
  activeFrom: null,
  activeUntil: null,
  archived: false,
  verifactuFrom: "2027-07-01",
  fiscalProvider: "internal",
  hasIntraEuOperations: false,
};

/** "fecha modelo emisor", para leer los plazos de un vistazo. */
function summary(issuers: FiscalIssuer[], from: string, to: string, settings: FiscalCalendarSettings = FISCAL_CALENDAR_DEFAULTS) {
  return fiscalDeadlines(issuers, settings, from, to).map((d) => `${d.dueOn} ${d.model} ${d.issuerId}`);
}

describe("fines de semana", () => {
  it("un último día en sábado o domingo pasa al lunes; entre semana no se mueve", () => {
    expect(isoWeekday("2026-10-20")).toBe(2);
    expect(shiftWeekend("2027-01-30")).toBe("2027-02-01"); // sábado
    expect(shiftWeekend("2027-01-31")).toBe("2027-02-01"); // domingo
    expect(shiftWeekend("2026-12-20")).toBe("2026-12-21"); // domingo
    expect(shiftWeekend("2026-10-20")).toBe("2026-10-20"); // martes
    expect(shiftWeekend("2027-12-20")).toBe("2027-12-20"); // lunes
  });
});

describe("plazos de la SL y de un autónomo", () => {
  it("de octubre a marzo: trimestrales, pagos fraccionados y anuales de enero y febrero, con los traslados", () => {
    expect(summary([SL, MARC], "2026-10-01", "2027-03-31")).toEqual([
      "2026-10-20 303 marc",
      "2026-10-20 303 sl",
      "2026-10-20 111 sl",
      "2026-10-20 130 marc",
      "2026-10-20 202 sl",
      // El 20 de diciembre de 2026 es domingo.
      "2026-12-21 202 sl",
      // El 4T del 111 cierra el 20 de enero, no el 30 como el 303.
      "2027-01-20 111 sl",
      // El 30 de enero es sábado y el 31, domingo: todo pasa al lunes 1 de febrero.
      "2027-02-01 303 marc",
      "2027-02-01 303 sl",
      "2027-02-01 130 marc",
      "2027-02-01 390 marc",
      "2027-02-01 390 sl",
      "2027-02-01 190 sl",
      // El 28 de febrero de 2027 es domingo.
      "2027-03-01 347 marc",
      "2027-03-01 347 sl",
    ]);
  });

  it("guarda el plazo legal y el día en que abre, además del trasladado", () => {
    const [q4] = fiscalDeadlines([SL], FISCAL_CALENDAR_DEFAULTS, "2027-02-01", "2027-02-01").filter((d) => d.model === "303");
    expect(q4).toEqual({
      model: "303",
      issuerId: "sl",
      period: { kind: "quarter", year: 2026, quarter: 4 },
      opensOn: "2027-01-01",
      statutoryDueOn: "2027-01-30",
      dueOn: "2027-02-01",
    });
  });

  it("el Impuesto sobre Sociedades, en julio (el 25 de 2027 es domingo), y el 347 en un febrero bisiesto", () => {
    expect(summary([SL], "2027-07-01", "2027-07-31")).toEqual(["2027-07-20 303 sl", "2027-07-20 111 sl", "2027-07-26 200 sl"]);
    expect(summary([SL], "2028-02-01", "2028-02-29")).toEqual(["2028-02-29 347 sl"]);
  });

  it("la SL sin constituir no tiene plazos; la de alta a mitad de año, desde su primer periodo", () => {
    const pending = { ...SL, activeFrom: null };
    expect(summary([pending], "2026-01-01", "2027-12-31")).toEqual([]);
    // Alta el 15 de marzo: el 1T (marzo) ya es suyo; el pago fraccionado de abril también.
    expect(summary([SL], "2026-04-01", "2026-04-30")).toEqual(["2026-04-20 303 sl", "2026-04-20 111 sl", "2026-04-20 202 sl"]);
    const july = { ...SL, activeFrom: "2026-07-01" };
    expect(summary([july], "2026-04-01", "2026-04-30")).toEqual([]);
  });

  it("un autónomo que deja de facturar presenta lo de su último trimestre y los anuales, y nada más", () => {
    const leaving = { ...MARC, activeUntil: "2027-06-30" };
    const dates = summary([leaving], "2027-07-01", "2028-03-31");
    expect(dates).toEqual([
      "2027-07-20 303 marc",
      "2027-07-20 130 marc",
      // Los resúmenes de 2027 sí (estuvo activo medio año); el 30 de enero de 2028 es domingo.
      "2028-01-31 390 marc",
      "2028-02-29 347 marc",
    ]);
    // …pero no el 3T ni el 4T de 2027, en los que ya no estaba activo.
    expect(dates.some((d) => d.startsWith("2027-10"))).toBe(false);
  });

  it("un emisor archivado ya no tiene plazos ni fecha Verifactu", () => {
    const archived = { ...MARC, archived: true };
    expect(summary([archived], "2026-01-01", "2027-12-31")).toEqual([]);
    expect(fiscalEvents([archived], FISCAL_CALENDAR_DEFAULTS, { from: "2027-01-01", to: "2027-12-31", today: "2026-10-01" })).toEqual([]);
  });
});

describe("qué modelos aplican", () => {
  it("el 349 solo con operaciones intracomunitarias, o si la org lo fuerza", () => {
    const withEu = { ...SL, hasIntraEuOperations: true };
    expect(summary([withEu], "2026-10-01", "2026-10-31")).toEqual([
      "2026-10-20 303 sl",
      "2026-10-20 111 sl",
      "2026-10-20 349 sl",
      "2026-10-20 202 sl",
    ]);
    expect(summary([withEu], "2026-10-01", "2026-10-31", { ...FISCAL_CALENDAR_DEFAULTS, intraEu: "never" })).not.toContain("2026-10-20 349 sl");
    expect(summary([SL], "2026-10-01", "2026-10-31", { ...FISCAL_CALENDAR_DEFAULTS, intraEu: "always" })).toContain("2026-10-20 349 sl");
  });

  it("el 115 y el 180 solo si la org los añade; el 130 no es de la SL ni el 202 de un autónomo", () => {
    const settings: FiscalCalendarSettings = {
      ...FISCAL_CALENDAR_DEFAULTS,
      models: { company: ["303", "115", "180", "130"], self_employed: ["303", "202", "200"] },
    };
    expect(modelsForIssuer(SL, settings)).toEqual(["303", "115", "180"]);
    expect(modelsForIssuer(MARC, settings)).toEqual(["303"]);
    expect(summary([SL], "2027-01-01", "2027-02-15", settings)).toEqual([
      "2027-01-20 115 sl", // el 4T del 115, como el del 111, cierra el 20
      "2027-02-01 303 sl",
      "2027-02-01 180 sl",
    ]);
  });

  it("un emisor puede tener su propia lista (un autónomo con trabajadores presenta el 111 y el 190)", () => {
    const settings: FiscalCalendarSettings = { ...FISCAL_CALENDAR_DEFAULTS, byIssuer: { marc: ["303", "111", "190", "130"] } };
    expect(modelsForIssuer(MARC, settings)).toEqual(["303", "111", "130", "190"]);
    expect(modelsForIssuer(SL, settings)).toEqual(modelsForIssuer(SL, FISCAL_CALENDAR_DEFAULTS));
  });

  it("apagado, no hay calendario fiscal", () => {
    const off = { ...FISCAL_CALENDAR_DEFAULTS, enabled: false };
    expect(summary([SL, MARC], "2026-01-01", "2027-12-31", off)).toEqual([]);
    expect(fiscalEvents([SL], off, { from: "2027-01-01", to: "2027-01-01", today: "2026-10-01" })).toEqual([]);
  });
});

describe("ajustes en orgs.settings", () => {
  it("sin ajustes, los valores por defecto", () => {
    expect(readFiscalCalendarSettings({ payment_terms_days: 30 })).toEqual(FISCAL_CALENDAR_DEFAULTS);
    expect(readFiscalCalendarSettings(null)).toEqual(FISCAL_CALENDAR_DEFAULTS);
    expect(readFiscalCalendarSettings({ fiscal_calendar: "sí" })).toEqual(FISCAL_CALENDAR_DEFAULTS);
  });

  it("lee campo a campo y descarta lo que no entiende", () => {
    const settings = readFiscalCalendarSettings({
      fiscal_calendar: {
        enabled: false,
        models: { company: [303, "111", "999", "111"], self_employed: "todos" },
        by_issuer: { marc: ["303", 130], otro: "no" },
        intra_eu: "always",
      },
    });
    expect(settings).toEqual({
      enabled: false,
      models: { company: ["303", "111"], self_employed: FISCAL_CALENDAR_DEFAULTS.models.self_employed },
      byIssuer: { marc: ["303", "130"] },
      intraEu: "always",
    });
    expect(readFiscalCalendarSettings({ fiscal_calendar: { intra_eu: "quizá" } }).intraEu).toBe("auto");
  });
});

describe("eventos fiscales", () => {
  const range = { from: "2026-10-01", to: "2027-01-31", today: "2026-10-15" };
  const events = fiscalEvents([SL, MARC], FISCAL_CALENDAR_DEFAULTS, range);

  it("uno por emisor, modelo y periodo, con un id estable y el socio del autónomo como responsable", () => {
    const q3 = events.find((e) => e.id === "fiscal:marc:130:2026-Q3");
    expect(q3).toMatchObject({
      type: "fiscal",
      kind: "130",
      date: "2026-10-20",
      title: "130",
      subtitle: "Marc Sanjuan",
      ownerMemberId: "member-ms",
      // El plazo está abierto (del 1 al 20 de octubre) y hoy es 15.
      status: "pending",
      movable: false,
      source: { table: "issuers", id: "marc" },
    });
    expect(q3?.facts).toEqual([
      { key: "issuer", type: "text", value: "Marc Sanjuan" },
      { key: "period", type: "fiscalPeriod", value: { kind: "quarter", year: 2026, quarter: 3 } },
      { key: "window", type: "range", from: "2026-10-01", to: "2026-10-20" },
    ]);
    expect(events.find((e) => e.id === "fiscal:sl:303:2026-Q3")?.ownerMemberId).toBeNull();
    expect(events.find((e) => e.id === "fiscal:sl:202:2026-P3")).toMatchObject({ date: "2026-12-21", status: "scheduled" });
  });

  it("si el plazo se ha trasladado, lo dice con la fecha legal", () => {
    const p3 = events.find((e) => e.id === "fiscal:sl:202:2026-P3");
    expect(p3?.facts).toContainEqual({ key: "statutoryDue", type: "date", value: "2026-12-20" });
  });

  it("un plazo que ya ha pasado queda como pasado (no se sabe si se presentó)", () => {
    const later = fiscalEvents([SL], FISCAL_CALENDAR_DEFAULTS, { ...range, today: "2026-10-21" });
    expect(later.find((e) => e.id === "fiscal:sl:303:2026-Q3")?.status).toBe("past");
  });

  it("la fecha Verifactu de cada emisor, pendiente en los 90 días anteriores", () => {
    expect(events.find((e) => e.kind === "verifactu")).toMatchObject({
      id: "fiscal:sl:verifactu",
      date: "2027-01-01",
      status: "pending",
      subtitle: "GNERAI SL",
      facts: [
        { key: "issuer", type: "text", value: "GNERAI SL" },
        { key: "provider", type: "label", value: "provider.internal" },
      ],
    });
    const far = fiscalEvents([MARC], FISCAL_CALENDAR_DEFAULTS, { from: "2027-07-01", to: "2027-07-31", today: "2026-10-15" });
    expect(far.find((e) => e.kind === "verifactu")?.status).toBe("scheduled");
  });
});
