import { describe, expect, it } from "vitest";
import {
  durationToInput,
  formatDuration,
  formatElapsed,
  formatHours,
  MAX_ENTRY_MINUTES,
  parseDurationInput,
  parseEstimateInput,
} from "./duration";

describe("formatDuration", () => {
  it("horas y minutos, sin ceros sobrantes", () => {
    expect(formatDuration(90)).toBe("1 h 30 min");
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(120)).toBe("2 h");
    expect(formatDuration(0)).toBe("0 min");
    expect(formatDuration(61)).toBe("1 h 1 min");
  });

  it("agrupa los miles también con 4 cifras y respeta el signo", () => {
    expect(formatDuration(1234 * 60 + 5)).toBe("1.234 h 5 min");
    expect(formatDuration(-90)).toBe("−1 h 30 min");
    expect(formatDuration(-30)).toBe("−30 min");
  });

  it("solo acepta minutos enteros", () => {
    expect(() => formatDuration(1.5)).toThrow();
  });
});

describe("formatHours y formatElapsed", () => {
  it("horas con un decimal", () => {
    expect(formatHours(90)).toBe("1,5 h");
    expect(formatHours(1500)).toBe("25 h");
    expect(formatHours(100)).toBe("1,7 h");
    expect(formatHours(90, "en-US")).toBe("1.5 h");
  });

  it("cronómetro con y sin horas", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(75)).toBe("1:15");
    expect(formatElapsed(3725)).toBe("1:02:05");
    expect(formatElapsed(-5)).toBe("0:00");
    expect(formatElapsed(59.9)).toBe("0:59");
  });

  it("propone h:mm al editar", () => {
    expect(durationToInput(90)).toBe("1:30");
    expect(durationToInput(45)).toBe("0:45");
    expect(durationToInput(600)).toBe("10:00");
  });
});

describe("parseDurationInput", () => {
  it.each([
    ["1:30", 90],
    ["0:45", 45],
    ["10:05", 605],
    ["1,5", 90],
    ["1.5", 90],
    ["1,25 h", 75],
    ["2", 120],
    ["2 horas", 120],
    ["2 hores", 120],
    ["45 min", 45],
    ["45m", 45],
    ["90 MIN", 90],
    ["1h30", 90],
    ["1 h 30 min", 90],
    ["1h 5m", 65],
    ["0,1", 6],
    ["0,01", 1],
    ["24", 1440],
  ])("«%s» son %i minutos", (input, minutes) => {
    expect(parseDurationInput(input)).toBe(minutes);
  });

  it.each(["", " ", "0", "0:00", "1:60", "abc", "1,555", "25", "24:01", "1h75", "-1", "1,5,5", "1:5"])("«%s» no vale", (input) => {
    expect(parseDurationInput(input)).toBeNull();
  });

  it("el tope por defecto es un día; con otro tope, lo que se pida", () => {
    expect(parseDurationInput("1441 min")).toBeNull();
    expect(parseDurationInput(`${MAX_ENTRY_MINUTES} min`)).toBe(MAX_ENTRY_MINUTES);
    expect(parseDurationInput("30", 40 * 60)).toBe(1800);
  });

  it("las estimaciones pasan de un día", () => {
    expect(parseEstimateInput("40")).toBe(2400);
    expect(parseEstimateInput("120:30")).toBe(7230);
    expect(parseEstimateInput("")).toBeNull();
    expect(parseEstimateInput("0")).toBeNull();
  });
});
