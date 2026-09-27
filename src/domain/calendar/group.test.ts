import { describe, expect, it } from "vitest";
import { collectionTotals, dayHints, filterEvents, groupByDay, overlappingEvents, sortEvents } from "./group";
import { eventDetail, eventSummary, type Translate } from "./summary";
import type { CalendarEvent } from "./types";

function ev(overrides: Partial<CalendarEvent> & Pick<CalendarEvent, "id">): CalendarEvent {
  return {
    type: "collection",
    kind: null,
    date: "2026-10-20",
    time: null,
    startsAt: null,
    title: "",
    subtitle: null,
    amountCents: null,
    amountPeriod: null,
    amountBasis: null,
    status: "scheduled",
    ownerMemberId: null,
    href: null,
    source: { table: "invoices", id: overrides.id },
    movable: false,
    facts: [],
    links: [],
    ...overrides,
  };
}

describe("orden y agrupación", () => {
  it("por fecha y, en el día, lo que pide algo primero, luego todo el día, luego por hora y por tipo", () => {
    const events = [
      ev({ id: "meeting-11", type: "meeting", time: "11:00", startsAt: "2026-10-20T09:00:00Z" }),
      ev({ id: "meeting-9", type: "meeting", time: "09:00", startsAt: "2026-10-20T07:00:00Z" }),
      ev({ id: "quote", type: "quote" }),
      ev({ id: "fiscal", type: "fiscal" }),
      ev({ id: "overdue-deal", type: "deal", status: "overdue" }),
      ev({ id: "done", type: "fiscal", status: "done" }),
      ev({ id: "yesterday", date: "2026-10-19", type: "renewal" }),
    ];
    expect(sortEvents(events).map((e) => e.id)).toEqual(["yesterday", "overdue-deal", "fiscal", "quote", "meeting-9", "meeting-11", "done"]);
    const days = groupByDay(events);
    expect([...days.keys()]).toEqual(["2026-10-19", "2026-10-20"]);
    expect(days.get("2026-10-20")![0]!.id).toBe("overdue-deal");
  });

  it("filtra por tipo y 'solo lo mío' incluye lo que es de todos", () => {
    const events = [
      ev({ id: "mine", type: "deal", ownerMemberId: "ms" }),
      ev({ id: "theirs", type: "deal", ownerMemberId: "mc" }),
      ev({ id: "shared", type: "fiscal", ownerMemberId: null }),
      ev({ id: "issued", type: "issued", ownerMemberId: "ms" }),
    ];
    expect(filterEvents(events, { types: ["deal", "fiscal"], memberId: "ms" }).map((e) => e.id)).toEqual(["mine", "shared"]);
    expect(filterEvents(events, { types: ["deal", "fiscal"], memberId: null }).map((e) => e.id)).toEqual(["mine", "theirs", "shared"]);
    expect(filterEvents(events, { types: [], memberId: null })).toEqual([]);
  });
});

describe("avisos de carga", () => {
  it("muchos cobros el mismo día, con lo que suman; y los plazos fiscales de un día 20", () => {
    const collections = [1, 2, 3].map((n) => ev({ id: `c${n}`, amountCents: n * 100_000 }));
    const deadlines = ["303", "111", "130", "verifactu"].map((kind) => ev({ id: `f${kind}`, type: "fiscal", kind }));
    expect(dayHints([...collections, ...deadlines])).toEqual([
      { kind: "collections", count: 3, amountCents: 600_000 },
      { kind: "deadlines", count: 3 },
    ]);
    expect(dayHints(collections.slice(0, 2))).toEqual([]);
    expect(dayHints(Array.from({ length: 8 }, (_, i) => ev({ id: `x${i}`, type: "deal" })))).toEqual([{ kind: "busy", count: 8 }]);
  });

  it("reuniones del mismo socio que se pisan (una reunión dura una hora; una llamada, media)", () => {
    const meeting = (id: string, startsAt: string, owner: string, kind = "meeting") =>
      ev({ id, type: "meeting", kind, startsAt, time: startsAt.slice(11, 16), ownerMemberId: owner });
    const clash = [meeting("a", "2026-10-20T08:00:00Z", "ms"), meeting("b", "2026-10-20T08:30:00Z", "ms")];
    expect(overlappingEvents(clash).map((e) => e.id)).toEqual(["a", "b"]);
    expect(dayHints(clash)).toEqual([{ kind: "overlap", count: 2 }]);
    // Otro socio a la misma hora no es un conflicto; una llamada de 30 min que acaba cuando empieza la otra, tampoco.
    expect(overlappingEvents([meeting("a", "2026-10-20T08:00:00Z", "ms"), meeting("b", "2026-10-20T08:30:00Z", "mc")])).toEqual([]);
    expect(overlappingEvents([meeting("a", "2026-10-20T08:00:00Z", "ms", "call"), meeting("b", "2026-10-20T08:30:00Z", "ms")])).toEqual([]);
  });

  it("totales de cobros: previstos y vencidos por separado", () => {
    expect(
      collectionTotals([
        ev({ id: "a", amountCents: 100_000 }),
        ev({ id: "b", amountCents: 50_000, status: "overdue" }),
        ev({ id: "c", amountCents: 25_000, status: "pending" }),
        ev({ id: "d", type: "billing", amountCents: 999_999 }),
      ]),
    ).toEqual({ expectedCents: 125_000, expectedCount: 2, overdueCents: 50_000, overdueCount: 1 });
  });
});

describe("textos de un evento", () => {
  // Devuelve la clave y los valores: comprueba qué se pide a i18n, no el texto.
  const t: Translate = (key, values) => (values ? `${key}${JSON.stringify(values)}` : key);

  it("qué pasa y con quién, y el documento o el contexto debajo", () => {
    const collection = ev({ id: "c", title: "2026-0012", subtitle: "Clínica Dental" });
    expect(eventSummary(collection, t)).toBe('summary.collection{"client":"Clínica Dental"}');
    expect(eventDetail(collection, t)).toBe("2026-0012");

    const deal = ev({ id: "d", type: "deal", title: "", subtitle: "Web + SEO" });
    expect(eventSummary(deal, t)).toBe('summary.dealNoAction{"deal":"Web + SEO"}');
    expect(eventDetail(deal, t)).toBeNull();
    expect(eventSummary({ ...deal, title: "Llamar" }, t)).toBe("Llamar");

    expect(eventSummary(ev({ id: "k", type: "contract", kind: "cancel", subtitle: "Bar Pepe" }), t)).toBe('summary.contractCancel{"client":"Bar Pepe"}');
    expect(eventSummary(ev({ id: "q", type: "quote", kind: "expired", title: "Rediseño" }), t)).toBe('summary.quoteExpired{"title":"Rediseño"}');
  });

  it("una tarea: su título y, debajo, el proyecto y el cliente; una entrega: el proyecto y su cliente", () => {
    const task = ev({
      id: "t",
      type: "task",
      kind: "task",
      title: "Diseñar la home",
      subtitle: "Web corporativa",
      facts: [{ key: "client", type: "text", value: "Clínica Dental" }],
    });
    expect(eventSummary(task, t)).toBe("Diseñar la home");
    expect(eventDetail(task, t)).toBe("Web corporativa · Clínica Dental");
    // Un proyecto interno no tiene cliente.
    expect(eventDetail({ ...task, facts: [] }, t)).toBe("Web corporativa");

    const deadline = ev({ id: "p", type: "task", kind: "project", title: "Web corporativa", subtitle: "Clínica Dental" });
    expect(eventSummary(deadline, t)).toBe('summary.projectDue{"project":"Web corporativa"}');
    expect(eventDetail(deadline, t)).toBe("Clínica Dental");
    expect(eventDetail({ ...deadline, subtitle: null }, t)).toBeNull();
  });

  it("un plazo fiscal: modelo y nombre; debajo, el periodo y el emisor", () => {
    const fiscal = ev({
      id: "f",
      type: "fiscal",
      kind: "303",
      title: "303",
      subtitle: "GNERAI SL",
      facts: [{ key: "period", type: "fiscalPeriod", value: { kind: "quarter", year: 2026, quarter: 3 } }],
    });
    expect(eventSummary(fiscal, t)).toBe('summary.fiscal{"model":"303","name":"fiscal.models.m303.short"}');
    expect(eventDetail(fiscal, t)).toBe('fiscal.period.quarter{"quarter":3,"year":2026} · GNERAI SL');
    expect(eventSummary({ ...fiscal, kind: "verifactu", facts: [] }, t)).toBe("summary.verifactu");
    expect(eventDetail({ ...fiscal, kind: "verifactu", facts: [] }, t)).toBe("GNERAI SL");
  });
});
