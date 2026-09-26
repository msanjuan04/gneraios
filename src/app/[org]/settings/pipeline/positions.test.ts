import { describe, expect, it } from "vitest";
import {
  hasDuplicateName,
  isOnlyOfKind,
  nextPosition,
  planInsertBeforeFirstWon,
  planMove,
  sameName,
  sortByPosition,
} from "./positions";

const at = "2026-09-26T10:00:00.000000+00:00";
const row = (id: string, position: number, created_at = at) => ({ id, position, created_at });

// La semilla de toda org nueva.
const seed = [
  { ...row("lead", 1), kind: "open" },
  { ...row("meeting", 2), kind: "open" },
  { ...row("proposal", 3), kind: "open" },
  { ...row("negotiation", 4), kind: "open" },
  { ...row("won", 5), kind: "won" },
  { ...row("lost", 6), kind: "lost" },
  { ...row("active", 7), kind: "won" },
];

describe("sortByPosition", () => {
  it("ordena por posición y, a igualdad, por antigüedad e id", () => {
    const rows = [
      row("c", 2),
      row("b", 1, "2026-09-26T11:00:00.000000+00:00"),
      row("z", 1, "2026-09-26T09:00:00.000000+00:00"),
      row("a", 2),
    ];
    expect(sortByPosition(rows).map((r) => r.id)).toEqual(["z", "b", "a", "c"]);
  });

  it("no toca la lista original", () => {
    const rows = [row("b", 2), row("a", 1)];
    sortByPosition(rows);
    expect(rows.map((r) => r.id)).toEqual(["b", "a"]);
  });
});

describe("nextPosition", () => {
  it("va detrás de la última posición usada (archivadas incluidas)", () => {
    expect(nextPosition([row("a", 1), row("b", 9), row("c", 3)])).toBe(10);
  });

  it("empieza en 1 con la lista vacía", () => {
    expect(nextPosition([])).toBe(1);
  });
});

describe("planMove", () => {
  const list = [row("a", 1), row("b", 2), row("c", 3)];

  it("sube intercambiando la posición con la anterior", () => {
    expect(planMove(list, "b", "up")).toEqual([
      { id: "b", from: 2, to: 1 },
      { id: "a", from: 1, to: 2 },
    ]);
  });

  it("baja intercambiando la posición con la siguiente, aunque haya huecos", () => {
    expect(planMove([row("a", 1), row("b", 5), row("c", 9)], "b", "down")).toEqual([
      { id: "b", from: 5, to: 9 },
      { id: "c", from: 9, to: 5 },
    ]);
  });

  it("no mueve más allá de los extremos ni lo que no está en la lista", () => {
    expect(planMove(list, "a", "up")).toBeNull();
    expect(planMove(list, "c", "down")).toBeNull();
    expect(planMove(list, "x", "up")).toBeNull();
  });

  it("con posiciones empatadas, renumera la lista en el nuevo orden", () => {
    const tied = [row("a", 0), row("b", 0), row("c", 0)];
    expect(planMove(tied, "c", "up")).toEqual([
      { id: "a", from: 0, to: 1 },
      { id: "c", from: 0, to: 2 },
      { id: "b", from: 0, to: 3 },
    ]);
  });
});

describe("planInsertBeforeFirstWon", () => {
  it("con la semilla, la etapa nueva va tras Negociación y las cerradas bajan un puesto", () => {
    expect(planInsertBeforeFirstWon(seed, seed)).toEqual({
      position: 5,
      shift: [
        { id: "active", from: 7, to: 8 },
        { id: "lost", from: 6, to: 7 },
        { id: "won", from: 5, to: 6 },
      ],
    });
  });

  it("desplaza también las archivadas que van detrás, no las de delante", () => {
    const archived = [row("old-demo", 2), row("old-closed", 9)];
    const { position, shift } = planInsertBeforeFirstWon(seed, [...seed, ...archived]);
    expect(position).toBe(5);
    expect(shift.map((c) => c.id)).toEqual(["old-closed", "active", "lost", "won"]);
  });

  it("usa la primera ganada del orden actual, aunque haya una perdida antes", () => {
    const reordered = sortByPosition([
      { ...row("lead", 1), kind: "open" },
      { ...row("lost", 2), kind: "lost" },
      { ...row("won", 3), kind: "won" },
    ]);
    expect(planInsertBeforeFirstWon(reordered, reordered)).toEqual({
      position: 3,
      shift: [{ id: "won", from: 3, to: 4 }],
    });
  });

  it("sin etapas ganadas, al final", () => {
    const open = [{ ...row("lead", 1), kind: "open" }];
    expect(planInsertBeforeFirstWon(open, [...open, row("archived", 4)])).toEqual({ position: 5, shift: [] });
  });
});

describe("isOnlyOfKind", () => {
  it("detecta la única etapa de su tipo", () => {
    expect(isOnlyOfKind(seed, "lost")).toBe(true);
    expect(isOnlyOfKind(seed, "won")).toBe(false);
    expect(isOnlyOfKind(seed, "lead")).toBe(false);
  });

  it("false si la etapa no está entre las activas", () => {
    expect(isOnlyOfKind(seed, "missing")).toBe(false);
  });
});

describe("nombres repetidos", () => {
  it("no distingue mayúsculas, acentos ni espacios de más", () => {
    expect(sameName("Reunión", "reunion")).toBe(true);
    expect(sameName("  Meta   Ads ", "meta ads")).toBe(true);
    expect(sameName("SEO", "SEM")).toBe(false);
  });

  it("ignora la propia fila al renombrar", () => {
    const rows = [
      { id: "a", name: "Web" },
      { id: "b", name: "SEO" },
    ];
    expect(hasDuplicateName(rows, "web")).toBe(true);
    expect(hasDuplicateName(rows, "WEB", "a")).toBe(false);
    expect(hasDuplicateName(rows, "Referido")).toBe(false);
  });
});
