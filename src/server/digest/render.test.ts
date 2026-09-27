import { describe, expect, it } from "vitest";
import type { UpcomingWeek } from "@/server/calendar/upcoming";
import { mondayOf } from "./monday";
import type { DigestOrgData } from "./data";
import { renderWeeklyDigest } from "./render";

const data: DigestOrgData = {
  weekStart: "2026-09-28",
  lastWeek: { from: "2026-09-21", to: "2026-09-27", collectedCents: 245_000, invoicedNetCents: 180_000, invoicesIssued: 3, newDeals: 2 },
  mrrCents: 291_000,
  receivables: { outstandingCents: 454_340, overdueCents: 272_950, overdueCount: 4 },
  goals: { mrr: null, revenue: null },
  queue: [{ key: "reminders", count: 4, amountCents: null, href: "/demo/invoices/outbox", tone: "warning" }],
  council: [{ id: "r1", title: "Subir la cuota de SEO a Mar Blau", agent: "pricing", urgency: "esta_semana" }],
  money: { locale: "es-ES", currency: "EUR" },
};

const week: UpcomingWeek = {
  basePath: "/demo",
  today: "2026-09-28",
  days: [{ date: "2026-09-28", events: [] }],
  overdue: [],
  collections: { expectedCents: 120_000, expectedCount: 2, overdueCents: 0, overdueCount: 0 } as UpcomingWeek["collections"],
  money: { locale: "es-ES", currency: "EUR" },
  mine: true,
};

describe("resumen semanal", () => {
  it("cuenta la semana en el idioma del socio, con asunto, texto y HTML", () => {
    const out = renderWeeklyDigest({ locale: "es", orgName: "GNERAI", firstName: "Marc", appUrl: "http://localhost:3100", slug: "demo", data, week });
    expect(out.subject).toMatch(/^Tu semana en GNERAI: 1\.?200\s€ en cobros previstos y 4 cosas por hacer$/);
    expect(out.text).toContain("Buenos días, Marc");
    expect(out.text).toMatch(/Cobrado: 2\.?450\s€/);
    expect(out.text).toMatch(/Vencido \(4 facturas\): 2\.?729,50\s€/);
    expect(out.text).toContain("4 recordatorios de cobro por enviar");
    expect(out.text).toContain("http://localhost:3100/demo");
    expect(out.html).toContain("<!doctype html>");
    expect(out.html).toContain("http://localhost:3100/demo/invoices/outbox");
    expect(out.pushTitle).toBe("Tu semana en GNERAI OS");
    expect(out.text).toContain("Del consejo");
    expect(out.text).toContain("Subir la cuota de SEO a Mar Blau");
  });

  it("en catalán y sin nada pendiente", () => {
    const out = renderWeeklyDigest({
      locale: "ca",
      orgName: "GNERAI",
      firstName: "Laia",
      appUrl: "https://os.gnerai.com/",
      slug: "gnerai",
      data: { ...data, queue: [] },
      week,
    });
    expect(out.text).toContain("Bon dia, Laia");
    expect(out.subject).toContain("res pendent");
    expect(out.text).toContain("https://os.gnerai.com/gnerai");
  });

  it("la fila de la rentabilidad de «Por hacer» también tiene su texto", () => {
    const out = renderWeeklyDigest({
      locale: "es",
      orgName: "GNERAI",
      firstName: "Marc",
      appUrl: "http://localhost:3100",
      slug: "demo",
      data: { ...data, queue: [{ key: "profitability", count: 2, amountCents: null, href: "/demo/finance/profitability?period=last3m", tone: "warning" }] },
      week,
    });
    expect(out.text).toContain("2 clientes por debajo de los umbrales");
    expect(out.text).not.toContain("dashboard.actionQueue");
  });

  it("escapa lo que viene de los datos en el HTML", () => {
    const out = renderWeeklyDigest({ locale: "es", orgName: "<b>GN</b>", firstName: "M", appUrl: "http://x", slug: "demo", data, week });
    expect(out.html).not.toContain("<b>GN</b>");
    expect(out.html).toContain("&lt;b&gt;GN&lt;/b&gt;");
  });

  it("las semanas empiezan en lunes", () => {
    expect(mondayOf("2026-09-26")).toBe("2026-09-21");
    expect(mondayOf("2026-09-28")).toBe("2026-09-28");
    expect(mondayOf("2026-10-04")).toBe("2026-09-28");
  });
});
