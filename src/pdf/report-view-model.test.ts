import { describe, expect, it } from "vitest";
import { buildReportView, reportPdfFilename } from "./report-view-model";
import { sampleReport, sampleReportInput } from "./report-samples";

// Lo que imprime el informe, sin generar el PDF. Intl separa el % y el € con un espacio duro (\u00a0).

describe("buildReportView", () => {
  it("cabecera: el mes, el cliente, el periodo y quién lo prepara", () => {
    const view = buildReportView(sampleReport("es"));
    expect(view.documentType).toBe("Informe mensual");
    expect(view.headline).toBe("Agosto de 2026");
    expect(view.subtitle).toBe("Clínica Dental Mar Blau");
    expect(view.language).toBe("es-ES");
    expect(view.title).toBe("Informe mensual · Agosto de 2026 · Clínica Dental Mar Blau");
    expect(view.dates).toEqual([
      { label: "Periodo", value: "01/08/2026 – 31/08/2026" },
      { label: "Fecha del informe", value: "05/09/2026" },
      { label: "Preparado por", value: "GNERAI" },
    ]);
    expect(view.notice).toBeNull();
    expect(view.footer.text).toBe("GNERAI · gnerai.com");
    expect(view.footer.pageLabel(1, 2)).toBe("Página 1 / 2");
  });

  it("el resumen cuenta lo hecho, lo que viene, los entregables y las visitas", () => {
    const view = buildReportView(sampleReport("es"));
    expect(view.summary).toEqual([
      { label: "Tareas terminadas", value: "3" },
      { label: "Próximos pasos", value: "4" },
      { label: "Entregables", value: "2" },
      { label: "Visitas a la web", value: "1.705" },
    ]);
  });

  it("lo hecho va por proyecto y, al final, las reuniones", () => {
    const { workDone } = buildReportView(sampleReport("es"));
    expect(workDone.empty).toBeNull();
    expect(workDone.groups.map((g) => g.title)).toEqual(["Rediseño de la web", "SEO local mensual", "Reuniones y comunicaciones"]);
    expect(workDone.groups[1]!.items.map((i) => [i.title, i.aside])).toEqual([
      ["Auditoría técnica de agosto", "05/08/2026"],
      ["Fichas de Google Business por tratamiento", "15/08/2026"],
    ]);
    expect(workDone.groups[2]!.items[0]).toMatchObject({ title: "Reunión · Revisión mensual de resultados", aside: "27/08/2026" });
  });

  it("los próximos pasos llevan el proyecto y el estado, nunca una fecha", () => {
    const { nextSteps } = buildReportView(sampleReport("es"));
    expect(nextSteps.items.map((i) => [i.title, i.detail, i.aside])).toEqual([
      ["Artículo: ortodoncia invisible en Mataró", "SEO local mensual", "En curso"],
      ["Diseño de la home y plantillas", "Rediseño de la web", "En curso"],
      ["Artículo: precio de un implante dental", "SEO local mensual", "En revisión"],
      ["Revisión con el cliente", "Rediseño de la web", "Por empezar"],
    ]);
    expect(nextSteps.more).toBeNull();
  });

  it("la web: cifras del mes con su variación frente al anterior, sin juicios", () => {
    const { web } = buildReportView(sampleReport("es"));
    expect(web!.subtitle).toBe("Lo que miden Google Search Console y Google Analytics de clinicamarblau.com.");
    expect(web!.tiles).toEqual([
      { label: "Clics desde Google", value: "1.116", delta: "+16\u00a0%", caption: "frente a julio" },
      { label: "Apariciones en Google", value: "35.030", delta: "+11\u00a0%", caption: "frente a julio" },
      { label: "Posición media", value: "8,4", delta: "0,7 posiciones más arriba", caption: "frente a julio" },
      { label: "Visitas a la web", value: "1.705", delta: "+12\u00a0%", caption: "frente a julio" },
    ]);
    expect(web!.channels!.legend).toEqual({ current: "Agosto", previous: "Julio" });
    expect(web!.channels!.rows[0]).toMatchObject({ label: "Búsqueda orgánica", value: "961", ratio: 1 });
    expect(web!.queries!.headers.previous).toBe("Mes anterior");
    expect(web!.queries!.rows[0]).toEqual({ query: "clínica dental mataró", clicks: "212", previous: "190", position: "2,1" });
    expect(web!.notes).toEqual(["Datos medidos tal cual por Google, sin estimaciones ni previsiones."]);
  });

  it("en catalán e inglés, cada idioma con su forma de comparar", () => {
    const ca = buildReportView(sampleReport("ca"));
    expect(ca.headline).toBe("Agost de 2026");
    expect(ca.web!.tiles[0]).toMatchObject({ delta: "+16\u00a0%", caption: "respecte al juliol" });
    expect(ca.web!.tiles[2]!.delta).toBe("0,7 posicions més amunt");
    const en = buildReportView(sampleReport("en"));
    expect(en.headline).toBe("August 2026");
    expect(en.language).toBe("en-IE");
    expect(en.web!.tiles[0]).toMatchObject({ value: "1,116", delta: "+16%", caption: "vs July" });
    expect(en.invoices.note).toBe("Amounts include VAT. Status as of 05/09/2026.");
  });

  it("facturación: las del mes, las pendientes de antes y el total pendiente a la fecha", () => {
    const { invoices } = buildReportView(sampleReport("es"));
    expect(invoices.issued.rows.map((r) => [r.number, r.total, r.status])).toEqual([
      ["2026-0046", "1.234,90\u00a0€", "Pagada"],
      ["2026-0049", "1.815,00\u00a0€", "Pendiente"],
    ]);
    expect(invoices.pending!.rows.map((r) => [r.number, r.outstanding, r.status])).toEqual([["2026-0051", "837,40\u00a0€", "Pendiente"]]);
    expect(invoices.total).toEqual({ label: "Pendiente de pago a 05/09/2026", value: "2.652,40\u00a0€" });
    expect(invoices.allPaid).toBeNull();
  });

  it("servicios: recurrentes y proyectos por separado, con el contrato si hay varios", () => {
    const { services } = buildReportView(sampleReport("es"));
    expect(services!.groups.map((g) => [g.title, g.items.map((i) => i.title)])).toEqual([
      ["Servicios", ["SEO local", "Gestión de Google Ads", "Campaña Meta Ads"]],
      ["Proyectos", ["Diseño y desarrollo de la nueva web"]],
    ]);
    expect(services!.groups[0]!.items[0]!.detail).toBe("Mensual · Desde el 01/01/2026 · SEO local y campañas");
    // Con un solo tipo de servicio, sin título de grupo.
    const single = buildReportView(sampleReport("es", { contracts: sampleReportInput().contracts.slice(0, 1) }));
    expect(single.services!.groups.map((g) => g.title)).toEqual([null]);
  });

  it("sin datos del mes anterior: sin variaciones y lo dice", () => {
    const input = sampleReportInput();
    const report = sampleReport("es", { web: { ...input.web!, searchSpan: { first: "2026-07-15", last: "2026-09-03" }, webSpan: { first: "2026-07-15", last: "2026-09-03" } } });
    const { web } = buildReportView(report);
    expect(web!.tiles.every((t) => t.delta === null && t.caption === null)).toBe(true);
    expect(web!.channels!.legend.previous).toBeNull();
    expect(web!.queries!.headers.previous).toBeNull();
    expect(web!.notes).toContain("Sin comparación con el mes anterior: no hay datos de los dos meses completos.");
  });

  it("el mes en curso lo avisa y el periodo acaba hoy", () => {
    const view = buildReportView(sampleReport("es", { month: "2026-09-01", today: "2026-09-20" }));
    expect(view.notice).toBe("Mes en curso: datos hasta el 20/09/2026.");
    expect(view.dates[0]!.value).toBe("01/09/2026 – 20/09/2026");
  });

  it("con horas: por proyecto y el total; sin nada hecho, lo dice sin dramatizar", () => {
    const view = buildReportView(
      sampleReport("es", {
        projects: [],
        activities: [],
        hours: {
          entries: [
            { projectId: "p1", workedOn: "2026-08-04", minutes: 330 },
            { projectId: "p9", workedOn: "2026-08-05", minutes: 60 },
          ],
          projects: [
            { id: "p1", name: "SEO local mensual", visible: true },
            { id: "p9", name: "Interno", visible: false },
          ],
        },
      }),
    );
    expect(view.hours).toEqual({
      title: "Horas dedicadas",
      rows: [
        { label: "SEO local mensual", value: "5,5 h" },
        { label: "Otro trabajo", value: "1 h" },
      ],
      total: { label: "Total del mes", value: "6,5 h" },
    });
    expect(view.summary.at(-1)).toEqual({ label: "Horas dedicadas", value: "6,5 h" });
    expect(view.workDone.empty).toBe("Este mes no hay tareas terminadas.");
    expect(view.nextSteps.empty).toBe("No hay próximos pasos marcados.");
  });
});

describe("reportPdfFilename", () => {
  it("sin acentos ni espacios, con el mes", () => {
    expect(reportPdfFilename(sampleReport("es"))).toBe("informe-2026-08-clinica-dental-mar-blau.pdf");
    expect(reportPdfFilename(sampleReport("en"))).toBe("report-2026-08-clinica-dental-mar-blau.pdf");
  });
});
