import { describe, expect, it } from "vitest";
import { DEFAULT_EVENT_TYPES } from "./types";
import {
  AGENDA_DAYS,
  calendarSearch,
  eachDay,
  monthWeeks,
  parseCalendarState,
  shiftAnchor,
  viewRange,
  weekStart,
} from "./views";

describe("rangos de cada vista", () => {
  it("las semanas empiezan en lunes", () => {
    expect(weekStart("2026-10-01")).toBe("2026-09-28"); // jueves → lunes anterior
    expect(weekStart("2026-10-05")).toBe("2026-10-05"); // ya es lunes
    expect(weekStart("2026-10-04")).toBe("2026-09-28"); // domingo → lunes de esa semana
  });

  it("el mes en semanas completas: 4, 5 o 6 según caiga", () => {
    expect(viewRange("month", "2026-10-17")).toEqual({ from: "2026-09-28", to: "2026-11-01" });
    expect(monthWeeks("2026-10-17")).toHaveLength(5);
    // Febrero de 2027 empieza en lunes y acaba en domingo: 4 semanas justas.
    expect(viewRange("month", "2027-02-10")).toEqual({ from: "2027-02-01", to: "2027-02-28" });
    // Marzo de 2026 empieza en domingo: 6 semanas.
    const march = monthWeeks("2026-03-01");
    expect(march).toHaveLength(6);
    expect(march[0]![0]).toBe("2026-02-23");
    expect(march.at(-1)!.at(-1)).toBe("2026-04-05");
    expect(march.every((week) => week.length === 7)).toBe(true);
  });

  it("la semana de lunes a domingo y la agenda desde su fecha", () => {
    expect(viewRange("week", "2026-10-01")).toEqual({ from: "2026-09-28", to: "2026-10-04" });
    const agenda = viewRange("agenda", "2026-10-10");
    expect(agenda.from).toBe("2026-10-10");
    expect(eachDay(agenda)).toHaveLength(AGENDA_DAYS);
  });

  it("← y → cambian de mes (anclado en el día 1), de semana o de tramo de agenda", () => {
    expect(shiftAnchor("month", "2026-01-31", 1)).toBe("2026-02-01");
    expect(shiftAnchor("month", "2026-01-31", -1)).toBe("2025-12-01");
    expect(shiftAnchor("week", "2026-10-01", 1)).toBe("2026-10-08");
    expect(shiftAnchor("agenda", "2026-10-10", -1)).toBe("2026-09-10");
  });
});

describe("estado en la URL", () => {
  const today = "2026-10-10";

  it("sin parámetros: la vista del dispositivo, hoy y los tipos de por defecto", () => {
    expect(parseCalendarState({}, today)).toEqual({ view: "month", date: today, types: [...DEFAULT_EVENT_TYPES], mine: false });
    expect(parseCalendarState({}, today, "agenda").view).toBe("agenda");
  });

  it("descarta lo que no entiende y respeta un filtro vacío", () => {
    const state = parseCalendarState({ view: "año", date: "2026-02-30", types: "deal,nada,fiscal", mine: "1" }, today);
    expect(state).toEqual({ view: "month", date: today, types: ["fiscal", "deal"], mine: true });
    expect(parseCalendarState({ types: "" }, today).types).toEqual([]);
    expect(parseCalendarState({ date: "1850-01-01" }, today).date).toBe(today);
    expect(parseCalendarState({ view: ["week", "month"], date: "2026-11-02" }, today)).toMatchObject({ view: "week", date: "2026-11-02" });
  });

  it("la URL solo lleva lo que no es por defecto, y se vuelve a leer igual", () => {
    expect(calendarSearch({ view: "month", date: today, types: [...DEFAULT_EVENT_TYPES], mine: false }, today)).toBe("");
    const state = { view: "week" as const, date: "2026-11-02", types: ["deal" as const, "collection" as const], mine: true };
    const search = calendarSearch(state, today);
    expect(search).toBe("?view=week&date=2026-11-02&types=collection%2Cdeal&mine=1");
    const parsed = parseCalendarState(Object.fromEntries(new URLSearchParams(search)), today);
    expect(parsed).toEqual({ ...state, types: ["collection", "deal"] });
    // En el móvil la agenda es la de por defecto: no se fija en la URL.
    expect(calendarSearch({ view: "agenda", date: today, types: [...DEFAULT_EVENT_TYPES], mine: false }, today, "agenda")).toBe("");
  });
});
