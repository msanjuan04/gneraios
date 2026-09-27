import { describe, expect, it } from "vitest";
import { buildIcs, escapeText, foldLine, type IcsEvent } from "./ics";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const GENERATED_AT = new Date("2026-10-10T08:00:00Z");

function calendar(events: IcsEvent[], timeZone = "Europe/Madrid") {
  return buildIcs({ name: "GNERAI OS · GNERAI", description: "Fechas", timeZone, events, generatedAt: GENERATED_AT });
}

/** Las líneas lógicas (desplegadas) del ICS. */
function unfold(ics: string): string[] {
  return ics.replace(/\r\n /g, "").split("\r\n").filter(Boolean);
}

describe("texto y plegado", () => {
  it("escapa barras, puntos y coma, comas y saltos de línea", () => {
    expect(escapeText("Cobro; F2026-0012, Clínica\\Dental\nVence el 20")).toBe("Cobro\\; F2026-0012\\, Clínica\\\\Dental\\nVence el 20");
  });

  it("pliega a 75 octetos sin partir caracteres de varios bytes", () => {
    expect(foldLine("SUMMARY:corto")).toBe("SUMMARY:corto");
    const line = `DESCRIPTION:${"Cobro de 1.210 € · ".repeat(12)}`;
    const folded = foldLine(line);
    const physical = folded.split("\r\n");
    expect(physical.length).toBeGreaterThan(1);
    physical.forEach((part, i) => {
      const bytes = encoder.encode(part);
      expect(bytes.length).toBeLessThanOrEqual(75);
      if (i > 0) expect(part.startsWith(" ")).toBe(true);
      // Cada trozo es UTF-8 válido por sí solo: ningún carácter partido.
      expect(() => decoder.decode(bytes)).not.toThrow();
    });
    expect(folded.replace(/\r\n /g, "")).toBe(line);
  });
});

describe("calendario", () => {
  it("cabecera, zona de Madrid, CRLF y un evento de todo el día con fin exclusivo", () => {
    const ics = calendar([{ uid: "fiscal-sl-303-2026-Q4@os.gnerai.com", summary: "Modelo 303 · IVA, 4T", start: { date: "2026-12-31" } }]);
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    const lines = unfold(ics);
    expect(lines.slice(0, 5)).toEqual(["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//GNERAI//GNERAI OS//ES", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"]);
    expect(lines).toContain("X-WR-TIMEZONE:Europe/Madrid");
    expect(lines).toContain("TZID:Europe/Madrid");
    expect(lines).toContain("RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU");
    const event = lines.slice(lines.indexOf("BEGIN:VEVENT"), lines.indexOf("END:VEVENT") + 1);
    expect(event).toEqual([
      "BEGIN:VEVENT",
      "UID:fiscal-sl-303-2026-Q4@os.gnerai.com",
      "DTSTAMP:20261010T080000Z",
      "DTSTART;VALUE=DATE:20261231",
      "DTEND;VALUE=DATE:20270101",
      "TRANSP:TRANSPARENT",
      "SUMMARY:Modelo 303 · IVA\\, 4T",
      "END:VEVENT",
    ]);
    expect(lines.at(-1)).toBe("END:VCALENDAR");
  });

  it("con hora: hora de Madrid con TZID, en verano y en invierno", () => {
    const lines = unfold(
      calendar([
        { uid: "a@x", summary: "Kickoff", start: { instant: "2026-07-01T08:30:00Z", minutes: 60 } },
        { uid: "b@x", summary: "Llamada", start: { instant: "2026-11-02T09:00:00Z", minutes: 30 } },
      ]),
    );
    expect(lines).toContain("DTSTART;TZID=Europe/Madrid:20260701T103000");
    expect(lines).toContain("DTEND;TZID=Europe/Madrid:20260701T113000");
    expect(lines).toContain("DTSTART;TZID=Europe/Madrid:20261102T100000");
    expect(lines).toContain("DTEND;TZID=Europe/Madrid:20261102T103000");
    expect(lines.filter((l) => l === "TRANSP:OPAQUE")).toHaveLength(2);
  });

  it("la hora repetida del cambio de octubre: la primera vez con TZID, la segunda en UTC", () => {
    // 25/10/2026: a las 03:00 CEST (01:00 UTC) el reloj vuelve a las 02:00 CET.
    const lines = unfold(
      calendar([
        { uid: "first@x", summary: "Primera", start: { instant: "2026-10-25T00:30:00Z", minutes: 30 } },
        { uid: "second@x", summary: "Segunda", start: { instant: "2026-10-25T01:30:00Z", minutes: 60 } },
      ]),
    );
    expect(lines).toContain("DTSTART;TZID=Europe/Madrid:20261025T023000");
    // 01:00 UTC ya es la segunda vez que marca las 02:00: va en UTC.
    expect(lines).toContain("DTEND:20261025T010000Z");
    expect(lines).toContain("DTSTART:20261025T013000Z");
    expect(lines).toContain("DTEND;TZID=Europe/Madrid:20261025T033000");
  });

  it("con otra zona horaria, las horas van en UTC y sin VTIMEZONE", () => {
    const lines = unfold(calendar([{ uid: "a@x", summary: "Call", start: { instant: "2026-07-01T08:30:00Z", minutes: 30 } }], "America/New_York"));
    expect(lines).not.toContain("BEGIN:VTIMEZONE");
    expect(lines).toContain("X-WR-TIMEZONE:America/New_York");
    expect(lines).toContain("DTSTART:20260701T083000Z");
    expect(lines).toContain("DTEND:20260701T090000Z");
  });

  it("descripción, enlace y categorías", () => {
    const lines = unfold(
      calendar([
        {
          uid: "c@x",
          summary: "Cobro · Clínica Dental",
          description: "2026-0012\nVence: 20 de octubre de 2026",
          url: "https://os.gnerai.com/gnerai/invoices/1",
          categories: ["Cobros"],
          start: { date: "2026-10-20" },
        },
      ]),
    );
    expect(lines).toContain("DESCRIPTION:2026-0012\\nVence: 20 de octubre de 2026");
    expect(lines).toContain("URL:https://os.gnerai.com/gnerai/invoices/1");
    expect(lines).toContain("CATEGORIES:Cobros");
    expect(lines).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT60M");
  });
});
