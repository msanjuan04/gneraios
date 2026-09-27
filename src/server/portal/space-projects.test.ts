import { describe, expect, it } from "vitest";
import type { PortalProject, PortalProjectTask } from "@/server/projects/portal";
import { completedTaskItems, type DatedWorkItem, mergeWorkLog, nextDueOn, toSpaceWorkProject } from "./space-projects";

const TODAY = "2026-09-26";

const task = (id: string, status: PortalProjectTask["status"], dueOn: string | null = null): PortalProjectTask => ({ id, title: `Tarea ${id}`, status, dueOn });

function project(tasks: PortalProjectTask[], over: Partial<PortalProject> = {}): PortalProject {
  return {
    id: "p1",
    name: "Web corporativa",
    kind: "web",
    status: "active",
    startsOn: "2026-09-01",
    dueOn: "2026-11-30",
    // El avance del módulo cuenta también las internas: el portal no lo usa.
    progress: { done: 9, total: 20, ratio: 0.45 },
    tasks,
    ...over,
  };
}

describe("proyectos en «Tu espacio»", () => {
  it("el avance cuenta solo las tareas visibles, nunca el del proyecto entero", () => {
    const view = toSpaceWorkProject(project([task("a", "done"), task("b", "doing"), task("c", "todo"), task("d", "done")]), TODAY);
    expect(view.progress).toEqual({ done: 2, total: 4, ratio: 0.5 });
    expect(view).not.toHaveProperty("startsOn");
  });

  it("sin tareas visibles no hay nada que medir, salvo que el proyecto esté terminado", () => {
    expect(toSpaceWorkProject(project([]), TODAY).progress.ratio).toBeNull();
    expect(toSpaceWorkProject(project([], { status: "done" }), TODAY).progress.ratio).toBe(1);
  });

  it("lo siguiente son las 3 primeras tareas sin hacer, en el orden en que llegan, y cuántas quedan", () => {
    const view = toSpaceWorkProject(
      project([task("a", "doing"), task("b", "review"), task("c", "todo"), task("d", "todo"), task("e", "todo"), task("f", "done")]),
      TODAY,
    );
    expect(view.nextTasks).toEqual([
      { id: "a", title: "Tarea a", status: "doing" },
      { id: "b", title: "Tarea b", status: "review" },
      { id: "c", title: "Tarea c", status: "todo" },
    ]);
    expect(view.moreOpen).toBe(2);
    expect(toSpaceWorkProject(project([task("a", "done")]), TODAY)).toMatchObject({ nextTasks: [], moreOpen: 0 });
  });

  it("la próxima fecha es la más cercana de hoy en adelante entre lo pendiente y la entrega", () => {
    const tasks = [task("a", "doing", "2026-09-20"), task("b", "todo", "2026-10-15"), task("c", "done", "2026-10-01"), task("d", "todo", "2026-10-03")];
    // Lo que ya pasó y lo hecho no cuentan.
    expect(nextDueOn(project(tasks), TODAY)).toBe("2026-10-03");
    expect(nextDueOn(project([task("a", "todo", TODAY)]), TODAY)).toBe(TODAY);
    // Sin fechas en las tareas, la entrega del proyecto.
    expect(nextDueOn(project([task("a", "todo")]), TODAY)).toBe("2026-11-30");
    expect(nextDueOn(project([task("a", "todo", "2026-09-01")], { dueOn: "2026-09-10" }), TODAY)).toBeNull();
    expect(nextDueOn(project([], { status: "planned", dueOn: "2026-12-01" }), TODAY)).toBe("2026-12-01");
  });

  it("un proyecto en pausa o terminado no tiene próxima fecha", () => {
    const tasks = [task("a", "todo", "2026-10-15")];
    expect(nextDueOn(project(tasks, { status: "paused" }), TODAY)).toBeNull();
    expect(nextDueOn(project(tasks, { status: "done" }), TODAY)).toBeNull();
  });
});

describe("«Lo que hemos hecho» con tareas", () => {
  const projects = [
    project([task("a", "done"), task("b", "done"), task("c", "doing"), task("old", "done"), task("edge", "done")]),
    project([task("x", "done")], { id: "p2", name: "SEO local", kind: "seo" }),
  ];
  const completedAt = new Map([
    ["a", "2026-09-25T09:00:00Z"],
    ["b", "2026-09-10T16:30:00Z"],
    ["old", "2026-07-01T10:00:00Z"],
    // 60 días justos: aún cuenta.
    ["edge", "2026-07-28T10:00:00Z"],
    ["x", "2026-09-24T08:00:00Z"],
    // No viene en los proyectos (interna u oculta): nunca sale.
    ["ghost", "2026-09-25T10:00:00Z"],
  ]);

  it("solo las visibles terminadas de los últimos 60 días, con su día en la zona de la org y su proyecto", () => {
    const items = completedTaskItems(projects, completedAt, { today: TODAY, timeZone: "Europe/Madrid" });
    expect(items.map((e) => e.item.id).sort()).toEqual(["a", "b", "edge", "x"]);
    expect(items.find((e) => e.item.id === "x")?.item).toEqual({
      id: "x",
      kind: "task",
      title: "Tarea x",
      body: null,
      project: "SEO local",
      occurredOn: "2026-09-24",
    });
  });

  it("el día es el de la org: lo terminado a las 23:30 UTC ya es el día siguiente en Madrid", () => {
    const items = completedTaskItems([project([task("a", "done")])], new Map([["a", "2026-09-24T23:30:00Z"]]), { today: TODAY, timeZone: "Europe/Madrid" });
    expect(items[0]?.item.occurredOn).toBe("2026-09-25");
  });

  it("una tarea que ya no está hecha no sale aunque tenga fecha", () => {
    const items = completedTaskItems([project([task("a", "doing")])], new Map([["a", "2026-09-25T09:00:00Z"]]), { today: TODAY, timeZone: "UTC" });
    expect(items).toEqual([]);
  });

  it("se mezcla con las actividades, lo más reciente primero y hasta el límite", () => {
    const activity = (id: string, at: string): DatedWorkItem => ({
      at,
      item: { id, kind: "meeting", title: id, body: null, project: null, occurredOn: at.slice(0, 10) },
    });
    const tasks = completedTaskItems(projects, completedAt, { today: TODAY, timeZone: "UTC" });
    const merged = mergeWorkLog([activity("kickoff", "2026-09-24T12:00:00+00:00"), activity("call", "2026-09-26T08:00:00+00:00"), ...tasks], 4);
    expect(merged.map((i) => i.id)).toEqual(["call", "a", "kickoff", "x"]);
  });
});
