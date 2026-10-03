import { describe, expect, it } from "vitest";
import { isLiveLead } from "./lead-freshness";

const now = new Date("2026-10-03T12:00:00Z");
const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

describe("lead vivo", () => {
  it("un contacto de hace menos de dos semanas está vivo", () => {
    expect(isLiveLead({ lastContactAt: ago(5), createdAt: ago(90), temperature: null }, now)).toBe(true);
    expect(isLiveLead({ lastContactAt: ago(14), createdAt: ago(90), temperature: null }, now)).toBe(true);
  });

  it("sin novedad desde hace más de dos semanas, no", () => {
    expect(isLiveLead({ lastContactAt: ago(15), createdAt: ago(90), temperature: null }, now)).toBe(false);
    expect(isLiveLead({ lastContactAt: null, createdAt: ago(40), temperature: null }, now)).toBe(false);
  });

  it("uno recién dado de alta cuenta aunque no haya contacto", () => {
    expect(isLiveLead({ lastContactAt: null, createdAt: ago(2), temperature: null }, now)).toBe(true);
  });

  it("caliente siempre; frío nunca", () => {
    expect(isLiveLead({ lastContactAt: ago(200), createdAt: ago(300), temperature: "hot" }, now)).toBe(true);
    expect(isLiveLead({ lastContactAt: ago(1), createdAt: ago(1), temperature: "cold" }, now)).toBe(false);
  });

  it("templado se rige por las fechas, como si no estuviera calificado", () => {
    expect(isLiveLead({ lastContactAt: ago(3), createdAt: ago(60), temperature: "warm" }, now)).toBe(true);
    expect(isLiveLead({ lastContactAt: ago(30), createdAt: ago(60), temperature: "warm" }, now)).toBe(false);
  });

  it("una fecha rota no cuela un lead", () => {
    expect(isLiveLead({ lastContactAt: null, createdAt: "no-es-fecha", temperature: null }, now)).toBe(false);
  });
});
