import { addDays } from "@/domain/dates/civil-date";
import { buildClientMonthReport, type ClientMonthReport, type ClientMonthReportInput, type ReportLocale } from "@/domain/reports";
import type { TrafficChannel, WebDay } from "@/domain/seo";
import { eachDay } from "@/domain/seo/period";

// Informes de ejemplo para los tests y para revisar la plantilla. Se montan con el dominio real
// (buildClientMonthReport) a partir de hechos inventados: agosto de 2026 de una clínica dental.

function webDays(from: string, to: string, sessions: (day: number) => number): WebDay[] {
  return eachDay({ from, to }).map((date, index) => {
    const value = sessions(index);
    return { date, sessions: value, users: value, engagedSessions: Math.round(value * 0.6), conversions: 0 };
  });
}

const channelShape: Record<TrafficChannel, [number, number]> = {
  organic_search: [26, 31],
  paid_search: [6, 5],
  organic_social: [2, 3],
  paid_social: [3, 2],
  direct: [10, 11],
  referral: [2, 2],
  email: [0, 1],
  other: [0, 0],
};

export function sampleReportInput(overrides: Partial<ClientMonthReportInput> = {}): ClientMonthReportInput {
  const byChannel = new Map<TrafficChannel, WebDay[]>(
    (Object.entries(channelShape) as [TrafficChannel, [number, number]][]).map(([channel, [july, august]]) => [
      channel,
      [...webDays("2026-07-01", "2026-07-31", () => july), ...webDays("2026-08-01", "2026-08-31", () => august)],
    ]),
  );
  const all = (month: 0 | 1) => Object.values(channelShape).reduce((sum, pair) => sum + pair[month], 0);
  return {
    month: "2026-08-01",
    today: "2026-09-05",
    timeZone: "Europe/Madrid",
    locale: "es",
    clientName: "Clínica Dental Mar Blau",
    senderName: "GNERAI",
    contracts: [
      {
        id: "k1",
        title: "SEO local y campañas",
        signedOn: "2025-04-10",
        archived: false,
        lines: [
          { id: "l1", position: 0, description: "SEO local", billingType: "monthly", startsOn: "2026-01-01", endsOn: null, replacesLineId: null, pauses: [], milestonesBilledOn: [] },
          { id: "l2", position: 1, description: "Gestión de Google Ads", billingType: "monthly", startsOn: "2025-06-01", endsOn: null, replacesLineId: null, pauses: [], milestonesBilledOn: [] },
          { id: "l3", position: 2, description: "Campaña Meta Ads", billingType: "usage", startsOn: null, endsOn: null, replacesLineId: null, pauses: [], milestonesBilledOn: [] },
        ],
      },
      {
        id: "k2",
        title: "Rediseño de la web",
        signedOn: "2026-06-20",
        archived: false,
        lines: [
          { id: "l4", position: 0, description: "Diseño y desarrollo de la nueva web", billingType: "one_off", startsOn: null, endsOn: null, replacesLineId: null, pauses: [], milestonesBilledOn: ["2026-06-20", null] },
        ],
      },
    ],
    projects: [
      {
        id: "p1",
        name: "SEO local mensual",
        kind: "seo",
        status: "active",
        tasks: [
          { id: "t1", title: "Fichas de Google Business por tratamiento", status: "done", dueOn: "2026-08-17", completedAt: "2026-08-15T10:30:00Z" },
          { id: "t2", title: "Auditoría técnica de agosto", status: "done", dueOn: "2026-08-06", completedAt: "2026-08-05T16:30:00Z" },
          { id: "t3", title: "Artículo: precio de un implante dental", status: "review", dueOn: "2026-09-25", completedAt: null },
          { id: "t4", title: "Artículo: ortodoncia invisible en Mataró", status: "doing", dueOn: "2026-09-12", completedAt: null },
          { id: "t5", title: "Informe mensual de septiembre", status: "todo", dueOn: "2026-10-05", completedAt: null },
        ],
      },
      {
        id: "p2",
        name: "Rediseño de la web",
        kind: "web",
        status: "active",
        tasks: [
          { id: "t6", title: "Arquitectura y wireframes", status: "done", dueOn: "2026-08-22", completedAt: "2026-08-21T09:00:00Z" },
          { id: "t7", title: "Diseño de la home y plantillas", status: "doing", dueOn: "2026-09-18", completedAt: null },
          { id: "t8", title: "Revisión con el cliente", status: "todo", dueOn: null, completedAt: null },
        ],
      },
    ],
    activities: [
      {
        id: "a1",
        kind: "meeting",
        title: "Revisión mensual de resultados",
        body: "Repasamos las campañas de verano y acordamos priorizar las fichas de implantes y ortodoncia.",
        occurredAt: "2026-08-27T08:00:00Z",
      },
    ],
    files: [
      { id: "f1", kind: "file", title: "Auditoría técnica de agosto", fileName: "auditoria-agosto-2026.pdf", url: null, uploadedAt: "2026-08-05T17:00:00Z", createdAt: "2026-08-05T16:59:00Z" },
      { id: "f2", kind: "link", title: "Wireframes de la nueva web", fileName: null, url: "https://www.figma.com/file/abc123/wireframes-mar-blau", uploadedAt: null, createdAt: "2026-08-21T10:00:00Z" },
    ],
    webGate: "eligible",
    web: {
      site: "clinicamarblau.com",
      source: "gsc",
      searchSpan: { first: "2025-05-27", last: "2026-09-03" },
      webSpan: { first: "2025-05-27", last: "2026-09-03" },
      searchDays: [
        ...eachDay({ from: "2026-07-01", to: "2026-07-31" }).map((date) => ({ date, clicks: 31, impressions: 1_020, position: 9.1 })),
        ...eachDay({ from: "2026-08-01", to: "2026-08-31" }).map((date) => ({ date, clicks: 36, impressions: 1_130, position: 8.4 })),
      ],
      webAll: [...webDays("2026-07-01", "2026-07-31", () => all(0)), ...webDays("2026-08-01", "2026-08-31", () => all(1))],
      webByChannel: byChannel,
      topQueries: [
        { key: "clínica dental mataró", clicks: 212, impressions: 2_140, position: 2.1, compareClicks: 190, compareImpressions: 2_050, comparePosition: 2.4 },
        { key: "dentista mataró", clicks: 164, impressions: 3_310, position: 4.6, compareClicks: 150, compareImpressions: 3_200, comparePosition: 5.1 },
        { key: "implantes dentales mataró", clicks: 88, impressions: 1_920, position: 6.8, compareClicks: 61, compareImpressions: 1_500, comparePosition: 8.2 },
        { key: "ortodoncia invisible maresme", clicks: 41, impressions: 980, position: 7.9, compareClicks: 44, compareImpressions: 1_010, comparePosition: 7.5 },
        { key: "blanqueamiento dental precio", clicks: 27, impressions: 1_450, position: 11.3, compareClicks: 12, compareImpressions: 900, comparePosition: 14.2 },
      ],
    },
    invoices: [
      { id: "i1", number: "2026-0046", kind: "ordinary", status: "paid", issuedOn: "2026-08-02", dueOn: "2026-09-01", totalCents: 123_490, outstandingCents: 0 },
      { id: "i2", number: "2026-0049", kind: "ordinary", status: "issued", issuedOn: "2026-08-20", dueOn: "2026-09-19", totalCents: 181_500, outstandingCents: 181_500 },
      { id: "i3", number: "2026-0051", kind: "ordinary", status: "issued", issuedOn: "2026-09-02", dueOn: "2026-10-02", totalCents: 83_740, outstandingCents: 83_740 },
    ],
    hours: null,
    ...overrides,
  };
}

export function sampleReport(locale: ReportLocale = "es", overrides: Partial<ClientMonthReportInput> = {}): ClientMonthReport {
  return buildClientMonthReport(sampleReportInput({ locale, ...overrides }));
}

/** Un mes muy cargado (muchas tareas y actividades) para comprobar que pagina bien. */
export function sampleLongReport(tasks: number): ClientMonthReport {
  const base = sampleReportInput();
  const project = base.projects[0]!;
  const many = Array.from({ length: tasks }, (_, i) => ({
    id: `x${i}`,
    title: `Tarea número ${i + 1} del mes con un título algo más largo de lo normal para ocupar sitio`,
    status: "done" as const,
    dueOn: null,
    completedAt: `${addDays("2026-08-01", i % 31)}T10:00:00Z`,
  }));
  return buildClientMonthReport({ ...base, projects: [{ ...project, tasks: [...project.tasks, ...many] }, ...base.projects.slice(1)] });
}
