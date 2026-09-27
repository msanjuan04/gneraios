import { describe, expect, it } from "vitest";
import { buildClientMonthReport, reportCounts } from "./build";
import { monthDeliverables } from "./deliverables";
import { reportHours } from "./hours";
import { reportInvoices } from "./invoices";
import type { ClientMonthReportInput, ReportInvoiceFact } from "./types";

const AUGUST = "2026-08-01";
const TZ = "Europe/Madrid";

function invoice(id: string, overrides: Partial<ReportInvoiceFact> = {}): ReportInvoiceFact {
  return {
    id,
    number: `2026-${id}`,
    kind: "ordinary",
    status: "paid",
    issuedOn: "2026-08-02",
    dueOn: "2026-09-01",
    totalCents: 123_490,
    outstandingCents: 0,
    ...overrides,
  };
}

describe("reportInvoices", () => {
  it("las del mes y, aparte, lo que sigue pendiente de antes; el total pendiente suma las dos", () => {
    const { issued, pending, pendingTotalCents } = reportInvoices(
      [
        invoice("0046"),
        invoice("0048", { issuedOn: "2026-08-20", status: "issued", outstandingCents: 50_000, totalCents: 50_000 }),
        invoice("0040", { issuedOn: "2026-06-02", status: "overdue", outstandingCents: 20_000, dueOn: "2026-07-02" }),
        invoice("0051", { issuedOn: "2026-09-02", status: "issued", outstandingCents: 83_740, totalCents: 83_740 }),
        invoice("0030", { issuedOn: "2026-05-02" }),
        invoice("R0001", { kind: "rectifying", status: "issued", issuedOn: "2026-08-25", totalCents: -50_000, outstandingCents: 0 }),
        invoice("draft", { number: null, issuedOn: null, status: "draft" }),
      ],
      AUGUST,
    );
    expect(issued.map((i) => [i.number, i.status])).toEqual([
      ["2026-0046", "paid"],
      ["2026-0048", "pending"],
      ["2026-R0001", "rectifying"],
    ]);
    expect(pending.map((i) => [i.number, i.status])).toEqual([
      ["2026-0040", "overdue"],
      ["2026-0051", "pending"],
    ]);
    expect(pendingTotalCents).toBe(50_000 + 20_000 + 83_740);
  });
});

describe("reportHours", () => {
  it("por proyecto; los que el cliente no ve, juntos y sin nombre", () => {
    const hours = reportHours(
      [
        { projectId: "seo", workedOn: "2026-08-03", minutes: 120 },
        { projectId: "seo", workedOn: "2026-08-20", minutes: 90 },
        { projectId: "ads", workedOn: "2026-08-10", minutes: 300 },
        { projectId: "internal", workedOn: "2026-08-11", minutes: 60 },
        { projectId: "seo", workedOn: "2026-09-01", minutes: 600 },
        { projectId: "other-client", workedOn: "2026-08-01", minutes: 600 },
      ],
      [
        { id: "seo", name: "SEO local", visible: true },
        { id: "ads", name: "Campañas", visible: true },
        { id: "internal", name: "Revisión interna", visible: false },
      ],
      AUGUST,
    );
    expect(hours).toEqual({
      totalMinutes: 570,
      projects: [
        { name: "Campañas", minutes: 300 },
        { name: "SEO local", minutes: 210 },
        { name: null, minutes: 60 },
      ],
    });
  });
});

describe("monthDeliverables", () => {
  it("ficheros por su subida confirmada y enlaces por su alta; solo URLs http(s)", () => {
    const items = monthDeliverables(
      [
        { id: "f1", kind: "file", title: "Informe técnico", fileName: "auditoria.pdf", url: null, uploadedAt: "2026-08-12T09:00:00Z", createdAt: "2026-08-12T08:59:00Z" },
        { id: "f2", kind: "file", title: "Sin confirmar", fileName: "x.pdf", url: null, uploadedAt: null, createdAt: "2026-08-12T08:59:00Z" },
        { id: "l1", kind: "link", title: "Diseños en Figma", fileName: null, url: "https://figma.com/file/abc", uploadedAt: null, createdAt: "2026-08-03T10:00:00Z" },
        { id: "l2", kind: "link", title: "Raro", fileName: null, url: "javascript:alert(1)", uploadedAt: null, createdAt: "2026-08-04T10:00:00Z" },
        { id: "f3", kind: "file", title: "Julio", fileName: "julio.pdf", url: null, uploadedAt: "2026-07-31T21:00:00Z", createdAt: "2026-07-31T21:00:00Z" },
      ],
      AUGUST,
      TZ,
    );
    expect(items.map((d) => [d.id, d.sharedOn, d.url])).toEqual([
      ["l1", "2026-08-03", "https://figma.com/file/abc"],
      ["l2", "2026-08-04", null],
      ["f1", "2026-08-12", null],
    ]);
    expect(items[2]!.fileName).toBe("auditoria.pdf");
  });
});

function input(overrides: Partial<ClientMonthReportInput> = {}): ClientMonthReportInput {
  return {
    month: AUGUST,
    today: "2026-09-05",
    timeZone: TZ,
    locale: "es",
    clientName: " Clínica Dental Mar Blau ",
    senderName: "GNERAI",
    contracts: [],
    projects: [
      {
        id: "seo",
        name: "SEO local mensual",
        kind: "seo",
        status: "active",
        tasks: [
          { id: "t1", title: "Fichas de Google Business", status: "done", dueOn: "2026-08-17", completedAt: "2026-08-15T10:30:00Z" },
          { id: "t2", title: "Artículo", status: "doing", dueOn: "2026-09-25", completedAt: null },
        ],
      },
    ],
    activities: [],
    files: [],
    webGate: "section_off",
    web: null,
    invoices: [invoice("0046")],
    hours: null,
    ...overrides,
  };
}

describe("buildClientMonthReport", () => {
  it("monta el informe y sus cuentas", () => {
    const report = buildClientMonthReport(input());
    expect(report).toMatchObject({ month: AUGUST, generatedOn: "2026-09-05", inProgress: false, clientName: "Clínica Dental Mar Blau", webStatus: "section_off", hours: null });
    expect(reportCounts(report)).toEqual({
      tasksDone: 1,
      activities: 0,
      nextSteps: 1,
      deliverables: 0,
      services: 0,
      invoices: 1,
      webStatus: "section_off",
      hoursMinutes: null,
    });
  });

  it("el mes en curso sale como tal; un mes futuro no se puede generar", () => {
    expect(buildClientMonthReport(input({ month: "2026-09-01" })).inProgress).toBe(true);
    expect(() => buildClientMonthReport(input({ month: "2026-10-01" }))).toThrow(/todavía no ha empezado/);
  });

  it("la web: sin datos del mes es «no_data»; sin web o apagada, lo dice", () => {
    const eligible = buildClientMonthReport(
      input({
        webGate: "eligible",
        web: {
          site: "x.com",
          source: "gsc",
          searchSpan: { first: "2026-09-01", last: "2026-09-04" },
          webSpan: null,
          searchDays: [],
          webAll: [],
          webByChannel: new Map(),
          topQueries: [],
        },
      }),
    );
    expect(eligible.web).toBeNull();
    expect(eligible.webStatus).toBe("no_data");
    expect(buildClientMonthReport(input({ webGate: "eligible", web: null })).webStatus).toBe("no_data");
    expect(buildClientMonthReport(input({ webGate: "no_property" })).webStatus).toBe("no_property");
  });

  it("con horas, las cuenta", () => {
    const report = buildClientMonthReport(
      input({ hours: { entries: [{ projectId: "seo", workedOn: "2026-08-03", minutes: 150 }], projects: [{ id: "seo", name: "SEO local mensual", visible: true }] } }),
    );
    expect(reportCounts(report).hoursMinutes).toBe(150);
  });
});
