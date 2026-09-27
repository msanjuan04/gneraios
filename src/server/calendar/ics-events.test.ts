import { describe, expect, it } from "vitest";
import {
  CALENDAR_EVENT_STATUSES,
  CALENDAR_EVENT_TYPES,
  type CalendarEvent,
  collectionEvents,
  contractEvents,
  dealEvents,
  eventDetail,
  eventSummary,
  FISCAL_CALENDAR_DEFAULTS,
  FISCAL_MODELS,
  factLabel,
  factValue,
  fiscalEvents,
  activityEvents,
  quoteEvents,
  reminderEvents,
  taskEvents,
} from "@/domain/calendar";
import { PROJECT_STATUSES, TASK_STATUSES } from "@/domain/projects";
import { toIcsEvent } from "./ics-events";
import { calendarTranslator } from "./translator";

// Estricto: una clave de i18n que falte hace fallar el test (la pantalla y el ICS usan las mismas).
const t = calendarTranslator("es", { strict: true });
const format = {
  t,
  locale: "es",
  moneyLocale: "es-ES",
  currency: "EUR",
  orgUrl: "https://os.gnerai.com/gnerai",
  uidDomain: "os.gnerai.com",
};
const RANGE = { from: "2026-09-01", to: "2027-01-31", today: "2026-10-10", includeOverdue: true };
const nbsp = (value: string) => value.replace(/ /g, " ");

/** Un evento de cada tipo (y de cada variante), construido con el dominio real. */
function sampleEvents(): CalendarEvent[] {
  const client = { clientId: "c1", clientName: "Clínica Dental", ownerMemberId: "m1" };
  return [
    ...collectionEvents(
      [{ id: "inv-1", number: "2026-0012", kind: "ordinary", ...client, issuedOn: "2026-09-10", dueOn: "2026-10-05", totalCents: 121_000, paidCents: 21_000, outstandingCents: 100_000 }],
      RANGE,
    ),
    ...reminderEvents(
      [{ id: "e1", preparedOn: "2026-10-10", template: "payment_reminder", invoiceId: "inv-1", invoiceNumber: "2026-0012", clientId: "c1", clientName: "Clínica Dental", ownerMemberId: null, outstandingCents: 100_000, dueOn: "2026-10-05" }],
      RANGE,
    ),
    ...contractEvents(
      [
        {
          id: "k1",
          title: "Web + mantenimiento",
          ...client,
          signedOn: "2026-01-01",
          lines: [
            { id: "l1", description: "Mantenimiento", billingType: "monthly", quantity: "1", unitPriceCents: 15_000, discountBps: 0, startsOn: "2026-01-01", endsOn: "2026-12-31", billingDay: 1, prorateFirst: true, cancelledOn: "2026-10-01", replacesLineId: null, pauses: [] },
            { id: "l2", description: "Hosting", billingType: "yearly", quantity: "1", unitPriceCents: 36_000, discountBps: 0, startsOn: "2025-11-20", endsOn: null, billingDay: null, prorateFirst: false, cancelledOn: null, replacesLineId: null, pauses: [] },
            { id: "l3", description: "Web", billingType: "one_off", quantity: "1", unitPriceCents: 300_000, discountBps: 0, startsOn: "2026-10-15", endsOn: null, billingDay: null, prorateFirst: true, cancelledOn: null, replacesLineId: null, pauses: [] },
          ],
          milestones: [
            { id: "ms1", position: 1, label: "A la firma", percentBps: 5000, plannedOn: "2026-09-15", auto: false, billing: { state: "drafted", invoiceId: "inv-2", invoiceNumber: null } },
            { id: "ms2", position: 2, label: "Entrega", percentBps: 5000, plannedOn: "2026-11-15", auto: true, billing: null },
          ],
        },
      ],
      RANGE,
      { preparedStarts: new Map(), renewalWindowDays: 60 },
    ),
    ...dealEvents(
      [{ id: "d1", title: "Web + SEO", ...client, stageName: "Propuesta enviada", stageKind: "open", nextAction: "Llamar para cerrar", nextActionOn: "2026-10-12", estOneOffCents: 250_000, estMrrCents: 35_000, probabilityBps: 5000 }],
      RANGE,
    ),
    ...quoteEvents(
      [{ id: "q1", number: "P2026-0007", title: "Rediseño web", ...client, issuedOn: "2026-09-01", validUntil: "2026-10-01", oneOffCents: 180_000, monthlyCents: 45_000, yearlyCents: 0, usageLinesCount: 2 }],
      RANGE,
    ),
    ...taskEvents(
      [
        { kind: "task", sourceId: "t1", date: "2026-10-07", title: "Diseñar la home", href: "/projects/p1?task=t1", status: "doing", assigneeMemberId: "m1", projectId: "p1", projectName: "Web corporativa", clientId: "c1", clientName: "Clínica Dental" },
        { kind: "project", sourceId: "p1", date: "2026-11-30", title: "Web corporativa", href: "/projects/p1", status: "active", assigneeMemberId: "m1", projectId: "p1", projectName: "Web corporativa", clientId: "c1", clientName: "Clínica Dental" },
      ],
      RANGE,
    ),
    ...activityEvents(
      [
        { id: "a1", kind: "meeting", title: "Kickoff", clientId: "c1", clientName: "Clínica Dental", memberId: "m1", occurredAt: "2026-10-20T08:30:00Z" },
        { id: "a2", kind: "call", title: "Seguimiento", clientId: "c1", clientName: "Clínica Dental", memberId: "m1", occurredAt: "2026-10-01T08:30:00Z" },
      ],
      { ...RANGE, timeZone: "Europe/Madrid", now: "2026-10-10T08:00:00Z" },
    ),
    ...fiscalEvents(
      [
        { id: "sl", kind: "company", name: "GNERAI SL", memberId: null, activeFrom: "2026-01-01", activeUntil: null, archived: false, verifactuFrom: "2027-01-01", fiscalProvider: "internal", hasIntraEuOperations: true },
      ],
      FISCAL_CALENDAR_DEFAULTS,
      RANGE,
    ),
  ];
}

describe("textos del calendario (catálogo real en español)", () => {
  it("cada evento tiene su resumen, su contexto y sus datos, sin claves que falten", () => {
    const events = sampleEvents();
    const types = new Set(events.map((e) => e.type));
    // Todos los tipos salvo las emitidas (que usan las mismas claves que los cobros) aparecen aquí.
    expect([...types].sort()).toEqual(CALENDAR_EVENT_TYPES.filter((type) => type !== "issued").sort());
    for (const event of events) {
      expect(eventSummary(event, t)).not.toMatch(/calendar\.|\{/);
      eventDetail(event, t);
      for (const fact of event.facts) {
        expect(factLabel(fact, t)).not.toMatch(/^calendar\./);
        expect(factValue(fact, format)).not.toMatch(/^calendar\./);
      }
    }
  });

  it("las etiquetas de la pantalla existen para cada tipo, estado y modelo", () => {
    for (const type of CALENDAR_EVENT_TYPES) {
      for (const key of [`types.${type}`, `typeHints.${type}`, `open.${type}`]) expect(t(key)).toBeTruthy();
      if (type !== "milestone") expect(t(`readOnly.${type}`)).toBeTruthy();
    }
    // Lo que el panel pide según el tipo: cómo se mueve cada movible y la entrega de un proyecto.
    for (const key of ["movable.deal", "movable.milestone", "movable.task", "open.project", "readOnly.project"]) expect(t(key)).toBeTruthy();
    for (const status of TASK_STATUSES) expect(t(`values.task.${status}`)).toBeTruthy();
    for (const status of PROJECT_STATUSES) expect(t(`values.project.${status}`)).toBeTruthy();
    for (const status of CALENDAR_EVENT_STATUSES) expect(t(`status.${status}`)).toBeTruthy();
    for (const model of FISCAL_MODELS) {
      expect(t(`fiscal.models.m${model}.short`)).toBeTruthy();
      expect(t(`fiscal.models.m${model}.description`)).toBeTruthy();
    }
    for (const view of ["month", "week", "agenda"]) {
      expect(t(`views.${view}`)).toBeTruthy();
      expect(t(`toolbar.previous.${view}`)).toBeTruthy();
      expect(t(`toolbar.next.${view}`)).toBeTruthy();
    }
    for (const hint of ["deadlines", "overlap", "busy"]) expect(t(`hints.${hint}`, { count: 3 })).toContain("3");
    expect(nbsp(t("hints.collections", { count: 3, amount: "1.000 €" }))).toBe("3 cobros el mismo día · 1.000 €");
  });
});

describe("eventos ICS", () => {
  const byId = new Map(sampleEvents().map((e) => [e.id, toIcsEvent(e, format)]));

  it("un cobro vencido: título con importe, datos en la descripción y enlace a la factura", () => {
    const ics = byId.get("collection:inv-1")!;
    expect(nbsp(ics.summary)).toBe("Vencido · Cobro · Clínica Dental · 1.000 €");
    expect(ics.uid).toBe("collection-inv-1@os.gnerai.com");
    expect(ics.start).toEqual({ date: "2026-10-05" });
    expect(ics.url).toBe("https://os.gnerai.com/gnerai/invoices/inv-1");
    expect(ics.categories).toEqual(["Cobros"]);
    const description = nbsp(ics.description ?? "");
    expect(description).toContain("2026-0012");
    expect(description).toContain("Vence: 5 de octubre de 2026");
    expect(description).toContain("Pendiente: 1.000 €");
    expect(description).toContain("Retraso: 5 días");
    expect(description).toContain("Abrir en GNERAI OS: https://os.gnerai.com/gnerai/invoices/inv-1");
  });

  it("un plazo fiscal: modelo, periodo y emisor en el título, y el aviso de la gestoría", () => {
    const ics = byId.get("fiscal:sl:303:2026-Q3")!;
    expect(ics.summary).toBe("Modelo 303 · IVA trimestral · 3T 2026 · GNERAI SL");
    expect(ics.description).toContain("Plazo: 1 oct 2026 – 20 oct 2026");
    expect(ics.description).toContain("valídalo con la gestoría");
    expect(byId.get("fiscal:sl:349:2026-Q3")?.summary).toBe("Modelo 349 · Operaciones intracomunitarias · 3T 2026 · GNERAI SL");
    expect(byId.get("fiscal:sl:verifactu")?.summary).toBe("Verifactu obligatorio · GNERAI SL");
  });

  it("una reunión con hora y duración; una acción con su deal; una renovación con su importe anual", () => {
    expect(byId.get("meeting:a1")).toMatchObject({ summary: "Kickoff · Clínica Dental", start: { instant: "2026-10-20T08:30:00.000Z", minutes: 60 } });
    expect(byId.get("meeting:a2")?.start).toEqual({ instant: "2026-10-01T08:30:00.000Z", minutes: 30 });
    expect(byId.get("deal:d1")?.summary).toBe("Llamar para cerrar · Web + SEO");
    expect(nbsp(byId.get("renewal:l2:2026-11-20")!.summary)).toBe("Renovación · Hosting · 360 €/año");
    expect(nbsp(byId.get("quote:q1")!.summary)).toBe("Vencido · Caducado · Rediseño web · 1.800 €");
    expect(byId.get("contract:k1:cancel:2026-12-31")?.summary).toContain("Baja · Clínica Dental");
    expect(byId.get("milestone:ms1")?.description).toContain("Estado: En borrador");
  });

  it("una tarea atrasada con su proyecto y su cliente en el título; la entrega de un proyecto, aparte", () => {
    const task = byId.get("task:t1")!;
    expect(task.summary).toBe("Vencido · Diseñar la home · Web corporativa · Clínica Dental");
    expect(task).toMatchObject({ uid: "task-t1@os.gnerai.com", start: { date: "2026-10-07" }, categories: ["Tareas"] });
    expect(task.url).toBe("https://os.gnerai.com/gnerai/projects/p1?task=t1");
    expect(task.description).toContain("Proyecto: Web corporativa");
    expect(task.description).toContain("Estado: En curso");
    expect(task.description).toContain("Retraso: 3 días");

    const deadline = byId.get("project:p1")!;
    expect(deadline.summary).toBe("Entrega · Web corporativa · Clínica Dental");
    expect(deadline).toMatchObject({ uid: "project-p1@os.gnerai.com", start: { date: "2026-11-30" }, url: "https://os.gnerai.com/gnerai/projects/p1" });
    expect(deadline.description).toContain("Estado: En marcha");
  });
});
