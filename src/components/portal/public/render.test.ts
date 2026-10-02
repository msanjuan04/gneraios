import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpaceData } from "@/components/portal/types";
import type { PortalLocale } from "@/domain/portal";

vi.mock("server-only", () => ({}));
// Las acciones de servidor no se ejecutan aquí: solo se pinta el formulario.
vi.mock("@/server/portal/public-actions", () => ({ acceptQuoteAction: vi.fn(), rejectQuoteAction: vi.fn(), sendRequestAction: vi.fn() }));

const { PortalShell } = await import("./shell");
const { SpaceHero, SpaceNav } = await import("./space/hero");
const { SpaceSections } = await import("./space/sections");
const { LinkStatePage } = await import("./link-state");
const { PublicQuotePage } = await import("./quote-page");
const { buildQuoteView } = await import("@/pdf");
const { sampleQuote } = await import("@/pdf/quote-samples");

const TOKEN = "A".repeat(43);

function space(locale: PortalLocale): SpaceData {
  return {
    locale,
    clientName: "Restaurant del Port",
    greeting: "morning",
    today: "2026-09-26",
    sections: ["progress", "work_log", "files", "services", "documents", "requests", "web_data"],
    progress: {
      nextSteps: "Revisamos los textos de la home.",
      workProjects: [
        {
          id: "p1",
          name: "Rediseño de la web",
          kind: "web",
          status: "active",
          progress: { done: 2, total: 6, ratio: 2 / 6 },
          nextDueOn: "2026-10-05",
          nextTasks: [
            { id: "t1", title: "Diseño de la home", status: "doing" },
            { id: "t2", title: "Textos de servicios", status: "review" },
            { id: "t3", title: "Versión móvil", status: "todo" },
          ],
          moreOpen: 1,
        },
        // Visible pero sin tareas marcadas: ni barra ni lista, solo el estado.
        { id: "p2", name: "SEO local", kind: "seo", status: "planned", progress: { done: 0, total: 0, ratio: null }, nextDueOn: null, nextTasks: [], moreOpen: 0 },
      ],
      projects: [
        {
          contractId: "c1",
          title: "Web corporativa",
          phases: [
            { id: "m1", label: "Inicio", state: "done", plannedOn: "2026-09-01" },
            { id: "m2", label: "Entrega", state: "current", plannedOn: "2026-10-15" },
          ],
          progress: { done: 1, total: 2, ratio: 0.5 },
        },
      ],
    },
    workLog: [
      { id: "t0", kind: "task", title: "Guía de estilo cerrada", body: null, project: "Rediseño de la web", occurredOn: "2026-09-24" },
      { id: "a1", kind: "meeting", title: "Kick-off", body: "Reunión inicial", project: null, occurredOn: "2026-09-20" },
    ],
    files: [
      { id: "f1", kind: "file", title: "Guía de estilo", fileName: "guia.pdf", sizeBytes: 1_572_864, url: null, addedOn: "2026-09-21", contractTitle: "Web corporativa" },
      { id: "f2", kind: "link", title: "Figma", fileName: null, sizeBytes: null, url: "https://figma.com/file/abc", addedOn: "2026-09-22", contractTitle: null },
    ],
    services: [{ id: "l1", description: "Mantenimiento web", billingType: "monthly", status: "active", startsOn: "2026-09-01", endsOn: null, contractTitle: "Web corporativa" }],
    documents: {
      invoices: [
        {
          id: "i1",
          number: "2026-0042",
          status: "pending",
          issuedOn: "2026-09-26",
          dueOn: "2026-10-26",
          totalCents: 159_000,
          outstandingCents: 159_000,
          issuerName: "GNERAI",
          payment: { kind: "transfer", iban: "ES91 2100 0418 4502 0005 1332", amountCents: 159_000, reference: "2026-0042", dueOn: "2026-10-26", overdue: false, holder: "GNERAI SL" },
        },
        {
          id: "i2",
          number: "2026-0043",
          status: "overdue",
          issuedOn: "2026-08-01",
          dueOn: "2026-08-31",
          totalCents: 18_150,
          outstandingCents: 18_150,
          issuerName: "GNERAI",
          payment: { kind: "sepa_debit", amountCents: 18_150, dueOn: "2026-08-31", overdue: true, holder: "GNERAI SL" },
        },
        { id: "i3", number: "2026-0001", status: "paid", issuedOn: "2026-01-10", dueOn: "2026-02-09", totalCents: 50_000, outstandingCents: 0, issuerName: "GNERAI", payment: null },
      ],
      quotes: [{ id: "q1", number: "P2026-0007", title: "Campaña de verano", state: "open", validUntil: "2026-10-20", acceptedOn: null }],
      contracts: [{ id: "c1", title: "Web corporativa", signedOn: "2026-09-01", status: "active", quote: { id: "q0", number: "P2026-0003" } }],
    },
    webData: {
      site: "restaurantdelport.cat",
      source: "gsc",
      range: { from: "2026-08-29", to: "2026-09-25" },
      clicks: 1234,
      impressions: 56789,
      position: 8.4,
      sessions: 980,
      change: { clicks: 0.12, impressions: null, position: 1.5, sessions: -0.05 },
    },
    adsData: null,
    footer: { issuers: ["GNERAI SL"], email: "hola@gnerai.com" },
  };
}

function renderSpace(locale: PortalLocale) {
  const data = space(locale);
  const children = createElement(Fragment, null, createElement(SpaceNav, { data }), createElement(SpaceSections, { data, token: TOKEN }));
  // Sin JSX (.ts): PortalShell pide `children` en sus props, así que va como prop.
  // eslint-disable-next-line react/no-children-prop
  return renderToStaticMarkup(createElement(PortalShell, { locale, footer: data.footer, hero: createElement(SpaceHero, { data }), children }));
}

let errors: unknown[][];
beforeEach(() => {
  errors = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args);
  });
});
afterEach(() => vi.restoreAllMocks());

describe("«Tu espacio»", () => {
  it.each(["es", "ca", "en"] as const)("se pinta entero en %s, sin textos que falten", (locale) => {
    const html = renderSpace(locale);
    // next-intl avisa por console.error de cada clave que no existe.
    expect(errors).toEqual([]);
    expect(html).toContain(`lang="${locale}"`);
    expect(html).toContain("Restaurant del Port");
    expect(html).toContain("ES91 2100 0418 4502 0005 1332");
    expect(html).toContain("2026-0042");
    expect(html).toContain(`/api/public/c/${TOKEN}/files/f1`);
    expect(html).toContain(`/p/c/${TOKEN}/q/q1`);
    // Un enlace externo nunca pasa el token por el Referer.
    expect(html).toMatch(/href="https:\/\/figma\.com\/file\/abc" target="_blank" rel="noopener noreferrer"/);
  });

  it("los proyectos visibles: estado, avance por tareas visibles, próxima fecha y lo siguiente", () => {
    const html = renderSpace("es");
    expect(html).toContain("Rediseño de la web");
    expect(html).toContain("En marcha");
    expect(html).toContain("2 de 6 tareas hechas");
    expect(html).toContain('aria-valuenow="33"');
    expect(html).toContain("Próxima fecha prevista: 5 oct 2026");
    for (const title of ["Diseño de la home", "Textos de servicios", "Versión móvil"]) expect(html).toContain(title);
    expect(html).toContain("Y 1 tarea más");
    expect(html).toContain("Por empezar");
    // Lo terminado sale en «Lo que hemos hecho» junto a las actividades, lo último primero.
    expect(html).toContain("Tarea terminada · Rediseño de la web");
    expect(html.indexOf("Guía de estilo cerrada")).toBeLessThan(html.indexOf("Kick-off"));

    const en = renderSpace("en");
    expect(en).toContain("2 of 6 tasks done");
    expect(en).toContain("Not started yet");
    expect(en).toContain("And 1 more task");
    expect(renderSpace("ca")).toContain("2 de 6 tasques fetes");
  });

  it("sin nada que enseñar, «En qué estamos» y «Lo que hemos hecho» siguen con su estado vacío", () => {
    const data = { ...space("es"), sections: ["progress", "work_log"] as SpaceData["sections"], progress: { nextSteps: null, workProjects: [], projects: [] }, workLog: [] };
    const html = renderToStaticMarkup(createElement(SpaceSections, { data, token: TOKEN }));
    expect(errors).toEqual([]);
    expect(html).toContain("Cuando arranque un proyecto por fases, verás aquí cómo avanza.");
    expect(html).toContain("Aquí irás viendo el trabajo que hacemos contigo.");
  });

  it("el saludo y lo pendiente, en el idioma del cliente", () => {
    const html = renderSpace("ca");
    expect(html).toContain("Bon dia, <span");
    expect(html).toContain("2 factures pendents");
    expect(html).toContain("Domiciliada");
    expect(html).toMatch(/1\.590,00\s€/);
  });

  it("el presupuesto abierto se ve como el PDF y se acepta online", () => {
    const quote = {
      quoteId: "11111111-1111-4111-8111-111111111111",
      orgId: "o",
      clientId: "c",
      locale: "es" as const,
      number: "P2026-0012",
      title: "Web corporativa y mantenimiento",
      state: "open" as const,
      version: "2026-09-26T10:00:00.000000+00:00",
      issuedOn: "2026-09-26",
      validUntil: "2026-10-26",
      view: buildQuoteView({ ...sampleQuote, isDraft: false, number: "P2026-0012", locale: "es" }),
      clientName: "Restaurant del Port",
      issuerName: "GNERAI",
      issuerEmail: "hola@gnerai.com",
      firstPayment: { label: "Inicio del proyecto", totalCents: 181_500 },
      acceptance: null,
      answeredOn: null,
      loaded: {} as never,
    };
    const html = renderToStaticMarkup(
      createElement(PublicQuotePage, { token: TOKEN, quote, done: null, pdfHref: `/api/public/q/${TOKEN}/pdf`, footer: { issuers: ["GNERAI SL"], email: null } }),
    );
    expect(errors).toEqual([]);
    expect(html).toContain("Presupuesto P2026-0012");
    expect(html).toContain("He leído y acepto el presupuesto P2026-0012 y sus condiciones.");
    expect(html).toContain("Inicio del proyecto · 1.815,00");
    expect(html).toContain(`name="quote_id" value="${quote.quoteId}"`);
    expect(html).toContain(`name="version" value="${quote.version}"`);
    // Recurrente y puntual por separado, como en el PDF.
    for (const title of [quote.view.oneOff?.title, quote.view.recurring?.title].filter(Boolean)) expect(html).toContain(title);

    const accepted = renderToStaticMarkup(
      createElement(PublicQuotePage, {
        token: TOKEN,
        quote: { ...quote, state: "accepted" as const, acceptance: { signerName: "Laura Puig", acceptedAt: "2026-09-26T10:05:00Z", pdfPath: null }, answeredOn: "2026-09-26" },
        done: "accepted" as const,
        pdfHref: "#",
        footer: { issuers: [], email: null },
      }),
    );
    expect(accepted).toContain("¡Gracias, Laura!");
    expect(accepted).not.toContain('name="consent"');
  });

  it("un enlace que no sirve no enseña nada del destino", () => {
    const html = renderToStaticMarkup(createElement(LinkStatePage, { locale: "en", state: "expired" }));
    expect(errors).toEqual([]);
    expect(html).toContain("This link has expired");
  });
});
