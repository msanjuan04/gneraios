import { describe, expect, it } from "vitest";
import {
  activityEvents,
  type BuildRange,
  type CalendarContract,
  type CalendarContractLine,
  type CalendarInvoice,
  collectionEvents,
  contractEvents,
  dealEvents,
  issuedEvents,
  moveEvent,
  quoteEvents,
  reminderEvents,
  type CalendarProjectItem,
  taskEvents,
} from "./build";
import { filterEvents } from "./group";

const TODAY = "2026-10-10";
const RANGE: BuildRange = { from: "2026-10-10", to: "2026-12-31", today: TODAY };

function invoice(overrides: Partial<CalendarInvoice> = {}): CalendarInvoice {
  return {
    id: "inv-1",
    number: "2026-0012",
    kind: "ordinary",
    clientId: "client-1",
    clientName: "Clínica Dental",
    ownerMemberId: "member-ms",
    issuedOn: "2026-09-10",
    dueOn: "2026-10-20",
    totalCents: 121_000,
    paidCents: 0,
    outstandingCents: 121_000,
    ...overrides,
  };
}

function line(overrides: Partial<CalendarContractLine>): CalendarContractLine {
  return {
    id: "line",
    description: "Mantenimiento web",
    billingType: "monthly",
    quantity: "1",
    unitPriceCents: 50_000,
    discountBps: 0,
    startsOn: "2026-01-01",
    endsOn: null,
    billingDay: 1,
    prorateFirst: true,
    cancelledOn: null,
    replacesLineId: null,
    pauses: [],
    ...overrides,
  };
}

function contract(overrides: Partial<CalendarContract>): CalendarContract {
  return {
    id: "contract-1",
    title: "Web + mantenimiento",
    clientId: "client-1",
    clientName: "Clínica Dental",
    ownerMemberId: "member-ms",
    signedOn: "2025-12-15",
    lines: [],
    milestones: [],
    ...overrides,
  };
}

const NO_PREPARED = { preparedStarts: new Map<string, Set<string>>(), renewalWindowDays: 60 };

describe("cobros previstos", () => {
  it("el vencimiento de cada factura con algo pendiente, con su estado derivado de hoy", () => {
    const events = collectionEvents(
      [
        invoice({ id: "due-later", dueOn: "2026-10-20" }),
        invoice({ id: "due-today", dueOn: TODAY, paidCents: 21_000, outstandingCents: 100_000 }),
        invoice({ id: "paid", outstandingCents: 0, paidCents: 121_000 }),
        invoice({ id: "rect", kind: "rectifying", outstandingCents: -121_000 }),
        invoice({ id: "out-of-range", dueOn: "2027-01-15" }),
      ],
      RANGE,
    );
    expect(events.map((e) => [e.id, e.status, e.amountCents])).toEqual([
      ["collection:due-later", "scheduled", 121_000],
      ["collection:due-today", "pending", 100_000],
    ]);
    expect(events[1]).toMatchObject({
      type: "collection",
      date: TODAY,
      title: "2026-0012",
      subtitle: "Clínica Dental",
      amountBasis: "gross",
      ownerMemberId: "member-ms",
      href: "/invoices/due-today",
      source: { table: "invoices", id: "due-today" },
      movable: false,
      links: [{ key: "client", href: "/clients/client-1" }],
    });
    expect(events[1]!.facts).toEqual([
      { key: "client", type: "text", value: "Clínica Dental" },
      { key: "issuedOn", type: "date", value: "2026-09-10" },
      { key: "dueOn", type: "date", value: TODAY },
      { key: "total", type: "money", value: 121_000 },
      { key: "paid", type: "money", value: 21_000 },
      { key: "outstanding", type: "money", value: 100_000 },
    ]);
  });

  it("lo vencido de antes del rango solo si se pide, en rojo y con los días de retraso", () => {
    const overdue = invoice({ id: "late", dueOn: "2026-09-30" });
    expect(collectionEvents([overdue], RANGE)).toEqual([]);
    const [event] = collectionEvents([overdue], { ...RANGE, includeOverdue: true });
    expect(event).toMatchObject({ date: "2026-09-30", status: "overdue" });
    expect(event!.facts.at(-1)).toEqual({ key: "daysOverdue", type: "number", value: 10 });
  });

  it("la capa de emitidas, en su fecha de emisión y ya hecha", () => {
    const events = issuedEvents(
      [invoice({ id: "a", issuedOn: "2026-10-12" }), invoice({ id: "r", kind: "rectifying", issuedOn: "2026-10-15", totalCents: -121_000 })],
      RANGE,
    );
    expect(events.map((e) => [e.id, e.kind, e.date, e.status, e.amountCents])).toEqual([
      ["issued:a", "ordinary", "2026-10-12", "done", 121_000],
      ["issued:r", "rectifying", "2026-10-15", "done", -121_000],
    ]);
  });
});

describe("recordatorios por aprobar", () => {
  it("pendientes desde el día en que se prepararon; los de días anteriores, atrasados", () => {
    const base = {
      template: "payment_reminder",
      invoiceId: "inv-1",
      invoiceNumber: "2026-0012",
      clientId: "client-1",
      clientName: "Clínica Dental",
      ownerMemberId: null,
      outstandingCents: 121_000,
      dueOn: "2026-09-26",
    };
    const events = reminderEvents(
      [
        { ...base, id: "today", preparedOn: TODAY },
        { ...base, id: "old", preparedOn: "2026-10-03" },
      ],
      { ...RANGE, includeOverdue: true },
    );
    expect(events.map((e) => [e.id, e.status, e.date])).toEqual([
      ["reminder:today", "pending", TODAY],
      ["reminder:old", "overdue", "2026-10-03"],
    ]);
    expect(events[0]).toMatchObject({
      href: "/invoices/outbox",
      links: [
        { key: "invoice", href: "/invoices/inv-1" },
        { key: "client", href: "/clients/client-1" },
      ],
    });
  });
});

describe("contratos", () => {
  it("facturación prevista con el calendario del cron: prorrateo, agrupada por contrato y día", () => {
    const events = contractEvents(
      [
        contract({
          lines: [
            // 500 € desde el 15 de octubre: el primer periodo son 17/31 → 274,19 €.
            line({ id: "seo", description: "SEO local", startsOn: "2026-10-15" }),
            // Desde enero: el periodo de octubre ya pasó; quedan noviembre y diciembre.
            line({ id: "maint", description: "Mantenimiento", unitPriceCents: 15_000 }),
          ],
        }),
      ],
      RANGE,
      NO_PREPARED,
    );
    const billing = events.filter((e) => e.type === "billing");
    expect(billing.map((e) => [e.id, e.date, e.amountCents])).toEqual([
      ["billing:contract-1:2026-10-15", "2026-10-15", 27_419],
      ["billing:contract-1:2026-11-01", "2026-11-01", 65_000],
      ["billing:contract-1:2026-12-01", "2026-12-01", 65_000],
    ]);
    expect(billing[1]).toMatchObject({ status: "scheduled", amountBasis: "base", href: "/contracts/contract-1", movable: false });
    expect(billing[1]!.facts).toEqual([
      { key: "client", type: "text", value: "Clínica Dental" },
      { key: "period", type: "range", from: "2026-11-01", to: "2026-11-30" },
      { key: "line", type: "item", label: "SEO local", cents: 50_000, period: "month" },
      { key: "line", type: "item", label: "Mantenimiento", cents: 15_000, period: "month" },
      { key: "amount", type: "money", value: 65_000 },
    ]);
    // El alta de la línea nueva también sale, aparte.
    expect(events.find((e) => e.type === "contract")).toMatchObject({ id: "contract:contract-1:start:2026-10-15", kind: "start", amountCents: 50_000, amountPeriod: "month" });
  });

  it("lo que el cron ya ha preparado no se repite, y un contrato sin firmar no sale", () => {
    const signed = contract({ lines: [line({ id: "maint" })] });
    const prepared = { ...NO_PREPARED, preparedStarts: new Map([["maint", new Set(["2026-11-01"])]]) };
    expect(contractEvents([signed], RANGE, prepared).map((e) => e.date)).toEqual(["2026-12-01"]);
    expect(contractEvents([contract({ signedOn: null, lines: [line({ id: "maint" })] })], RANGE, NO_PREPARED)).toEqual([]);
  });

  it("una anual renueva en su aniversario (pendiente dentro de la ventana de avisos); su primera facturación no es una renovación", () => {
    const events = contractEvents(
      [
        contract({
          lines: [
            line({ id: "hosting", description: "Hosting anual", billingType: "yearly", billingDay: null, unitPriceCents: 36_000, startsOn: "2025-11-20" }),
            line({ id: "domain", description: "Dominio", billingType: "yearly", billingDay: null, unitPriceCents: 2_000, startsOn: "2026-12-05" }),
          ],
        }),
      ],
      RANGE,
      NO_PREPARED,
    ).filter((e) => e.type !== "contract");
    expect(events.map((e) => [e.type, e.id, e.status, e.amountCents, e.amountPeriod])).toEqual([
      ["renewal", "renewal:hosting:2026-11-20", "pending", 36_000, "year"],
      ["billing", "billing:contract-1:2026-12-05", "scheduled", 2_000, null],
    ]);
    const later = contractEvents([contract({ lines: [line({ id: "h", billingType: "yearly", billingDay: null, startsOn: "2026-01-01" })] })], { ...RANGE, to: "2027-01-31" }, { ...NO_PREPARED, renewalWindowDays: 30 });
    expect(later.find((e) => e.type === "renewal")?.status).toBe("scheduled");
  });

  it("altas, bajas y cambios de condiciones: un cambio de precio no es una baja y un alta", () => {
    const events = contractEvents(
      [
        contract({
          lines: [
            line({ id: "old", description: "SEO", endsOn: "2026-10-31" }),
            line({ id: "new", description: "SEO", unitPriceCents: 60_000, startsOn: "2026-11-01", replacesLineId: "old" }),
            line({ id: "ads", description: "Gestión de Ads", unitPriceCents: 40_000, endsOn: "2026-11-30", cancelledOn: "2026-10-01" }),
            line({ id: "web", description: "Web", billingType: "one_off", billingDay: null, unitPriceCents: 300_000, startsOn: "2026-12-01" }),
          ],
        }),
      ],
      RANGE,
      NO_PREPARED,
    ).filter((e) => e.type === "contract");
    expect(events.map((e) => [e.kind, e.date, e.amountCents, e.amountPeriod])).toEqual([
      ["change", "2026-11-01", 60_000, "month"],
      ["cancel", "2026-11-30", 40_000, "month"],
      ["start", "2026-12-01", 300_000, null],
    ]);
  });

  it("hitos: lo que factura cada uno; sin facturar se mueve y, si ya pasó, está atrasado", () => {
    const withMilestones = contract({
      lines: [line({ id: "web", description: "Web", billingType: "one_off", billingDay: null, unitPriceCents: 300_001, startsOn: null })],
      milestones: [
        { id: "m1", position: 1, label: "A la firma", percentBps: 5000, plannedOn: "2025-12-15", auto: false, billing: { state: "invoiced", invoiceId: "inv-9", invoiceNumber: "2025-0040" } },
        { id: "m2", position: 2, label: "Diseño aprobado", percentBps: 2500, plannedOn: "2026-10-05", auto: false, billing: null },
        { id: "m3", position: 3, label: "Entrega", percentBps: 2500, plannedOn: "2026-11-15", auto: true, billing: null },
      ],
    });
    const inRange = contractEvents([withMilestones], RANGE, NO_PREPARED);
    expect(inRange.map((e) => [e.id, e.status, e.amountCents, e.movable])).toEqual([["milestone:m3", "scheduled", 75_000, true]]);

    const withOverdue = contractEvents([withMilestones], { ...RANGE, includeOverdue: true }, NO_PREPARED);
    // El facturado no es "atrasado": solo lo que sigue pidiendo algo.
    expect(withOverdue.map((e) => [e.id, e.status, e.amountCents])).toEqual([
      ["milestone:m2", "overdue", 75_000],
      ["milestone:m3", "scheduled", 75_000],
    ]);

    // El primero redondea y el último factura el resto: la línea cuadra al céntimo.
    const all = contractEvents([withMilestones], { from: "2025-12-01", to: "2026-12-31", today: TODAY }, NO_PREPARED);
    expect(all.map((e) => e.amountCents)).toEqual([150_001, 75_000, 75_000]);
    expect(all[0]).toMatchObject({
      status: "done",
      movable: false,
      links: [
        { key: "invoice", href: "/invoices/inv-9" },
        { key: "client", href: "/clients/client-1" },
      ],
    });
    expect(all[0]!.facts).toContainEqual({ key: "state", type: "label", value: "billable.invoiced" });
  });
});

describe("deals, presupuestos y reuniones", () => {
  it("la próxima acción de los deals no perdidos, movible y en rojo si está atrasada", () => {
    const deal = {
      id: "d1",
      title: "Web + SEO",
      clientId: "client-1",
      clientName: "Clínica Dental",
      stageName: "Propuesta enviada",
      stageKind: "open" as const,
      nextAction: "Llamar para cerrar",
      nextActionOn: "2026-10-08",
      ownerMemberId: "member-mc",
      estOneOffCents: 250_000,
      estMrrCents: 35_000,
      probabilityBps: 5000,
    };
    const events = dealEvents(
      [deal, { ...deal, id: "d2", stageKind: "lost", nextActionOn: "2026-10-20" }, { ...deal, id: "d3", nextActionOn: "2026-10-20", nextAction: null }],
      { ...RANGE, includeOverdue: true },
    );
    expect(events.map((e) => [e.id, e.status, e.title])).toEqual([
      ["deal:d1", "overdue", "Llamar para cerrar"],
      ["deal:d3", "scheduled", ""],
    ]);
    expect(events[0]).toMatchObject({ movable: true, href: "/pipeline?deal=d1", subtitle: "Web + SEO", ownerMemberId: "member-mc", amountCents: null });
    expect(events[0]!.facts).toContainEqual({ key: "estMrr", type: "money", value: 35_000, period: "month" });

    // Moverla (vista optimista mientras se guarda): deja de estar atrasada; lo no movible no cambia.
    expect(moveEvent(events[0]!, "2026-10-15", TODAY)).toMatchObject({ id: "deal:d1", date: "2026-10-15", status: "scheduled" });
    expect(moveEvent(events[0]!, TODAY, TODAY).status).toBe("pending");
    const fixed = { ...events[0]!, movable: false };
    expect(moveEvent(fixed, "2026-10-15", TODAY)).toBe(fixed);
  });

  it("la validez de los presupuestos enviados: el importe puntual o, si no hay, el recurrente", () => {
    const quote = {
      id: "q1",
      number: "P2026-0007",
      title: "Rediseño web",
      clientId: "client-1",
      clientName: "Clínica Dental",
      ownerMemberId: null,
      issuedOn: "2026-09-01",
      validUntil: "2026-10-01",
      oneOffCents: 0,
      monthlyCents: 45_000,
      yearlyCents: 0,
      usageLinesCount: 0,
    };
    const events = quoteEvents([quote, { ...quote, id: "q2", validUntil: "2026-10-30", oneOffCents: 180_000 }], { ...RANGE, includeOverdue: true });
    expect(events.map((e) => [e.id, e.kind, e.status, e.amountCents, e.amountPeriod])).toEqual([
      ["quote:q1", "expired", "overdue", 45_000, "month"],
      ["quote:q2", "sent", "scheduled", 180_000, null],
    ]);
  });

  it("reuniones y llamadas en la hora de Madrid (también cuando cambian de día)", () => {
    const base = { kind: "meeting" as const, title: "Kickoff", clientId: "client-1", clientName: "Clínica Dental", memberId: "member-ms" };
    const events = activityEvents(
      [
        { ...base, id: "a1", occurredAt: "2026-10-20T08:30:00Z" },
        { ...base, id: "a2", kind: "call", occurredAt: "2026-10-20T22:30:00Z" },
        { ...base, id: "a3", occurredAt: "2026-10-10T07:00:00Z" },
        { ...base, id: "a4", occurredAt: "2026-12-31T23:30:00Z" },
      ],
      { ...RANGE, timeZone: "Europe/Madrid", now: "2026-10-10T08:00:00Z" },
    );
    expect(events.map((e) => [e.id, e.date, e.time, e.status])).toEqual([
      ["meeting:a1", "2026-10-20", "10:30", "scheduled"],
      ["meeting:a2", "2026-10-21", "00:30", "scheduled"],
      ["meeting:a3", "2026-10-10", "09:00", "done"],
      // El 31 de diciembre a las 23:30 UTC ya es 1 de enero en Madrid: fuera del rango.
    ]);
    expect(events[0]).toMatchObject({ startsAt: "2026-10-20T08:30:00.000Z", href: "/clients/client-1", ownerMemberId: "member-ms", kind: "meeting" });
  });
});

describe("tareas y entregas de proyectos", () => {
  function item(overrides: Partial<CalendarProjectItem> & Pick<CalendarProjectItem, "sourceId">): CalendarProjectItem {
    return {
      kind: "task",
      date: "2026-10-20",
      title: "Diseñar la home",
      href: `/projects/p1?task=${overrides.sourceId}`,
      status: "todo",
      assigneeMemberId: "member-ms",
      projectId: "p1",
      projectName: "Web corporativa",
      clientId: "client-1",
      clientName: "Clínica Dental",
      ...overrides,
    };
  }
  const OCTOBER: BuildRange = { from: "2026-10-01", to: "2026-10-31", today: TODAY };

  it("estado derivado de hoy: hecha → hecho; sin hacer, atrasada, pendiente hoy o prevista", () => {
    const events = taskEvents(
      [
        item({ sourceId: "late", date: "2026-10-07", status: "doing" }),
        item({ sourceId: "late-done", date: "2026-10-07", status: "done" }),
        item({ sourceId: "today", date: TODAY, status: "review" }),
        item({ sourceId: "later", date: "2026-10-28" }),
        item({ sourceId: "november", date: "2026-11-02" }),
      ],
      OCTOBER,
    );
    expect(events.map((e) => [e.id, e.status, e.movable])).toEqual([
      ["task:late", "overdue", true],
      ["task:late-done", "done", false],
      ["task:today", "pending", true],
      ["task:later", "scheduled", true],
    ]);
    expect(events[0]).toMatchObject({
      type: "task",
      kind: "task",
      date: "2026-10-07",
      title: "Diseñar la home",
      subtitle: "Web corporativa",
      amountCents: null,
      ownerMemberId: "member-ms",
      href: "/projects/p1?task=late",
      source: { table: "project_tasks", id: "late" },
      links: [{ key: "client", href: "/clients/client-1" }],
    });
    expect(events[0]!.facts).toEqual([
      { key: "client", type: "text", value: "Clínica Dental" },
      { key: "project", type: "text", value: "Web corporativa" },
      { key: "state", type: "label", value: "task.doing" },
      { key: "daysOverdue", type: "number", value: 3 },
    ]);
    expect(events[1]!.facts).toContainEqual({ key: "state", type: "label", value: "task.done" });
    expect(events[1]!.facts.some((f) => f.key === "daysOverdue")).toBe(false);
  });

  it("la entrega de un proyecto es otro tipo de evento: no se arrastra y lleva al proyecto", () => {
    const [deadline, internal] = taskEvents(
      [
        item({ sourceId: "p1", kind: "project", title: "Web corporativa", href: "/projects/p1", status: "active", date: "2026-10-30" }),
        item({ sourceId: "p2", kind: "project", title: "Web propia", href: "/projects/p2", status: "done", clientId: null, clientName: null, assigneeMemberId: null }),
      ],
      OCTOBER,
    );
    expect(deadline).toMatchObject({
      id: "project:p1",
      type: "task",
      kind: "project",
      status: "scheduled",
      movable: false,
      subtitle: "Clínica Dental",
      href: "/projects/p1",
      source: { table: "projects", id: "p1" },
    });
    expect(deadline!.facts).toEqual([
      { key: "client", type: "text", value: "Clínica Dental" },
      { key: "state", type: "label", value: "project.active" },
    ]);
    // Un proyecto interno terminado: hecho, sin cliente y de todos.
    expect(internal).toMatchObject({ id: "project:p2", status: "done", subtitle: null, ownerMemberId: null, links: [] });
  });

  it("lo atrasado de antes del rango solo si se pide y aún pide trabajo", () => {
    const old = [
      item({ sourceId: "open", date: "2026-09-15" }),
      item({ sourceId: "done", date: "2026-09-15", status: "done" }),
      item({ sourceId: "late-project", kind: "project", status: "paused", date: "2026-09-30" }),
    ];
    expect(taskEvents(old, RANGE)).toEqual([]);
    expect(taskEvents(old, { ...RANGE, includeOverdue: true }).map((e) => [e.id, e.status])).toEqual([
      ["task:open", "overdue"],
      ["project:late-project", "overdue"],
    ]);
  });

  it("'solo lo mío' es lo asignado al socio y lo que no tiene a nadie", () => {
    const events = taskEvents(
      [item({ sourceId: "mine" }), item({ sourceId: "theirs", assigneeMemberId: "member-mc" }), item({ sourceId: "nobody", assigneeMemberId: null })],
      OCTOBER,
    );
    expect(filterEvents(events, { types: ["task"], memberId: "member-ms" }).map((e) => e.id)).toEqual(["task:mine", "task:nobody"]);
  });

  it("moverla recalcula el estado y el retraso (vista optimista)", () => {
    const [late] = taskEvents([item({ sourceId: "late", date: "2026-10-07" })], OCTOBER);
    const moved = moveEvent(late!, "2026-10-15", TODAY);
    expect(moved).toMatchObject({ id: "task:late", date: "2026-10-15", status: "scheduled" });
    expect(moved.facts.some((f) => f.key === "daysOverdue")).toBe(false);
    expect(moveEvent(late!, "2026-10-05", TODAY).facts.at(-1)).toEqual({ key: "daysOverdue", type: "number", value: 5 });
  });
});
