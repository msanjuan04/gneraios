import { describe, expect, it } from "vitest";
import { groupMyTasks, myTaskGroup } from "./my-tasks";
import { planMove, POSITION_STEP, positionAtEnd, positionAtStart } from "./ordering";
import { daysLate, isProjectOverdue, isTaskOverdue } from "./overdue";
import { progressPercent, projectProgress } from "./progress";
import { readTemplateTasks, templateSummary } from "./template";
import type { TaskPriority, TaskStatus } from "./types";

const TODAY = "2026-09-23"; // miércoles

describe("retrasos", () => {
  it("un proyecto va tarde si su entrega pasó y aún pide trabajo", () => {
    expect(isProjectOverdue({ dueOn: "2026-09-22", status: "active" }, TODAY)).toBe(true);
    expect(isProjectOverdue({ dueOn: "2026-09-22", status: "planned" }, TODAY)).toBe(true);
    expect(isProjectOverdue({ dueOn: "2026-09-22", status: "paused" }, TODAY)).toBe(true);
    expect(isProjectOverdue({ dueOn: "2026-09-23", status: "active" }, TODAY)).toBe(false); // hoy aún está a tiempo
    expect(isProjectOverdue({ dueOn: "2026-09-22", status: "done" }, TODAY)).toBe(false);
    expect(isProjectOverdue({ dueOn: "2026-09-22", status: "cancelled" }, TODAY)).toBe(false);
    expect(isProjectOverdue({ dueOn: null, status: "active" }, TODAY)).toBe(false);
  });

  it("una tarea va tarde si su fecha pasó y no está hecha", () => {
    expect(isTaskOverdue({ dueOn: "2026-09-01", status: "doing" }, TODAY)).toBe(true);
    expect(isTaskOverdue({ dueOn: "2026-09-01", status: "done" }, TODAY)).toBe(false);
    expect(isTaskOverdue({ dueOn: TODAY, status: "todo" }, TODAY)).toBe(false);
    expect(daysLate("2026-09-20", TODAY)).toBe(3);
    expect(daysLate("2026-09-30", TODAY)).toBe(0);
    expect(daysLate(null, TODAY)).toBe(0);
  });
});

describe("avance", () => {
  it("tareas hechas entre tareas", () => {
    expect(projectProgress({ tasksTotal: 3, tasksDone: 2, status: "active" })).toEqual({ done: 2, total: 3, ratio: 2 / 3 });
    expect(progressPercent(projectProgress({ tasksTotal: 3, tasksDone: 2, status: "active" }))).toBe(67);
  });

  it("sin tareas no hay nada que medir, salvo que el proyecto esté hecho", () => {
    expect(projectProgress({ tasksTotal: 0, tasksDone: 0, status: "active" }).ratio).toBeNull();
    expect(projectProgress({ tasksTotal: 0, tasksDone: 0, status: "done" }).ratio).toBe(1);
    // Hecho con tareas abiertas: el avance cuenta la verdad de las tareas.
    expect(projectProgress({ tasksTotal: 4, tasksDone: 1, status: "done" }).ratio).toBe(0.25);
    expect(progressPercent({ done: 0, total: 0, ratio: null })).toBeNull();
  });
});

describe("mis tareas", () => {
  it("con retraso, hoy, esta semana (hasta el domingo), más adelante y sin fecha", () => {
    expect(myTaskGroup("2026-09-22", TODAY)).toBe("overdue");
    expect(myTaskGroup(TODAY, TODAY)).toBe("today");
    expect(myTaskGroup("2026-09-27", TODAY)).toBe("thisWeek");
    expect(myTaskGroup("2026-09-28", TODAY)).toBe("later");
    expect(myTaskGroup(null, TODAY)).toBe("noDate");
    // El domingo, mañana ya es "más adelante".
    expect(myTaskGroup("2026-09-28", "2026-09-27")).toBe("later");
  });

  it("agrupa sin las hechas y ordena por fecha, urgencia y título", () => {
    const task = (title: string, dueOn: string | null, priority: TaskPriority = "normal", status: TaskStatus = "todo") => ({
      title,
      dueOn,
      priority,
      status,
    });
    const groups = groupMyTasks(
      [
        task("b", "2026-09-25"),
        task("a", "2026-09-25", "urgent"),
        task("c", "2026-09-24"),
        task("hecha", "2026-09-24", "normal", "done"),
        task("tarde", "2026-09-01"),
        task("sin fecha", null),
        task("hoy", TODAY, "low"),
        task("lejos", "2026-12-01"),
      ],
      TODAY,
    );
    expect(groups.map((g) => [g.group, g.tasks.map((t) => t.title)])).toEqual([
      ["overdue", ["tarde"]],
      ["today", ["hoy"]],
      ["thisWeek", ["c", "a", "b"]],
      ["later", ["lejos"]],
      ["noDate", ["sin fecha"]],
    ]);
  });
});

describe("orden en el tablero", () => {
  const column = [
    { id: "a", position: 1024 },
    { id: "b", position: 2048 },
    { id: "c", position: 3072 },
  ];

  it("al principio, al final o entre dos: cambia solo la tarjeta movida", () => {
    expect(planMove([], 0)).toEqual({ position: POSITION_STEP, renumber: [] });
    expect(planMove(column, 0)).toEqual({ position: 0, renumber: [] });
    expect(planMove(column, 3)).toEqual({ position: 4096, renumber: [] });
    expect(planMove(column, 1)).toEqual({ position: 1536, renumber: [] });
    expect(planMove(column, 99)).toEqual({ position: 4096, renumber: [] });
  });

  it("sin hueco entre dos, renumera la columna", () => {
    const tight = [
      { id: "a", position: 1 },
      { id: "b", position: 1 + 1e-7 },
      { id: "c", position: 5000 },
    ];
    expect(planMove(tight, 1)).toEqual({
      position: 2048,
      renumber: [
        { id: "a", position: 1024 },
        { id: "b", position: 3072 },
        { id: "c", position: 4096 },
      ],
    });
  });

  it("al final o al principio de lo que haya", () => {
    expect(positionAtEnd([])).toBe(POSITION_STEP);
    expect(positionAtEnd([5, 2048, 12])).toBe(3072);
    expect(positionAtStart([2048, 1024])).toBe(0);
  });
});

describe("plantillas", () => {
  it("resume tareas, horas estimadas y hasta qué día llegan", () => {
    expect(
      templateSummary([
        { title: "Briefing", estimate_minutes: 60, offset_days: 0 },
        { title: "Diseño", estimate_minutes: 480, offset_days: 10 },
        { title: "Lanzamiento", offset_days: 30 },
      ]),
    ).toEqual({ tasks: 3, estimateMinutes: 540, spanDays: 30 });
    expect(templateSummary([{ title: "Sin datos" }])).toEqual({ tasks: 1, estimateMinutes: null, spanDays: null });
  });

  it("lee el jsonb y descarta lo que no es una tarea", () => {
    expect(readTemplateTasks([{ title: "A", estimate_minutes: 30, client_visible: true }, 3, { nope: 1 }, null])).toEqual([
      { title: "A", estimate_minutes: 30, offset_days: null, client_visible: true },
    ]);
    expect(readTemplateTasks("x")).toEqual([]);
  });
});
