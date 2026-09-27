import { describe, expect, it } from "vitest";
import type { ReportProjectFact, ReportTaskFact } from "./types";
import { doneTasks, monthActivities, nextSteps } from "./work";

const AUGUST = "2026-08-01";
const TZ = "Europe/Madrid";

function task(id: string, overrides: Partial<ReportTaskFact> = {}): ReportTaskFact {
  return { id, title: `Tarea ${id}`, status: "todo", dueOn: null, completedAt: null, ...overrides };
}

function project(id: string, tasks: ReportTaskFact[], overrides: Partial<ReportProjectFact> = {}): ReportProjectFact {
  return { id, name: `Proyecto ${id}`, kind: "seo", status: "active", tasks, ...overrides };
}

describe("doneTasks", () => {
  it("las terminadas en el mes según la hora de la org, en orden de fecha", () => {
    const projects = [
      project("seo", [
        // 1 de agosto a las 01:30 en Madrid.
        task("first", { status: "done", completedAt: "2026-07-31T23:30:00Z" }),
        task("mid", { status: "done", completedAt: "2026-08-14T10:00:00Z", title: "  Fichas de Google Business  " }),
        // 1 de septiembre a las 00:30 en Madrid.
        task("next-month", { status: "done", completedAt: "2026-08-31T22:30:00Z" }),
        task("open", { status: "doing" }),
      ]),
    ];
    const done = doneTasks(projects, AUGUST, TZ);
    expect(done.map((t) => [t.id, t.completedOn])).toEqual([
      ["first", "2026-08-01"],
      ["mid", "2026-08-14"],
    ]);
    expect(done[1]).toMatchObject({ title: "Fichas de Google Business", projectId: "seo", projectName: "Proyecto seo", projectKind: "seo" });
  });
});

describe("monthActivities", () => {
  it("las visibles del mes, con el cuerpo limpio", () => {
    const activities = monthActivities(
      [
        { id: "a", kind: "meeting", title: "Reunión de seguimiento", body: "  Revisamos las campañas.  ", occurredAt: "2026-08-20T08:00:00Z" },
        { id: "b", kind: "call", title: "Llamada", body: "   ", occurredAt: "2026-08-02T08:00:00Z" },
        { id: "c", kind: "email", title: "Fuera", body: null, occurredAt: "2026-09-02T08:00:00Z" },
      ],
      AUGUST,
      TZ,
    );
    expect(activities).toEqual([
      { id: "b", kind: "call", title: "Llamada", body: null, occurredOn: "2026-08-02" },
      { id: "a", kind: "meeting", title: "Reunión de seguimiento", body: "Revisamos las campañas.", occurredOn: "2026-08-20" },
    ]);
  });
});

describe("nextSteps", () => {
  it("lo que está en marcha y lo pendiente hasta el final del mes siguiente o sin fecha; primero lo que está en curso", () => {
    const projects = [
      project("seo", [
        task("doing-far", { status: "doing", dueOn: "2026-11-15" }),
        task("todo-sept", { dueOn: "2026-09-10" }),
        task("doing-undated", { status: "doing" }),
        task("review", { status: "review", dueOn: "2026-09-02" }),
        task("late", { dueOn: "2026-08-20" }),
        task("far", { dueOn: "2026-10-01" }),
        task("done", { status: "done", completedAt: "2026-08-10T10:00:00Z" }),
        task("todo-undated"),
      ]),
      project("paused", [task("p1")], { status: "paused" }),
      project("planned", [task("pl1", { dueOn: "2026-09-01" })], { status: "planned" }),
      project("cancelled", [task("c1")], { status: "cancelled" }),
    ];
    const { items, more } = nextSteps(projects, AUGUST);
    expect(items.map((s) => s.id)).toEqual(["doing-far", "doing-undated", "review", "late", "pl1", "todo-sept", "todo-undated"]);
    expect(items[1]).toEqual({ id: "doing-undated", title: "Tarea doing-undated", projectName: "Proyecto seo", status: "doing" });
    expect(more).toBe(0);
  });

  it("como mucho ocho, y cuenta cuántos más quedan", () => {
    const projects = [project("seo", Array.from({ length: 11 }, (_, i) => task(`t${i}`)))];
    const { items, more } = nextSteps(projects, AUGUST);
    expect(items).toHaveLength(8);
    expect(items[0]!.id).toBe("t0");
    expect(more).toBe(3);
  });
});
