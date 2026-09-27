import { describe, expect, it } from "vitest";
import { easterSunday, isTargetBusinessDay, nextTargetBusinessDay, suggestCollectionDate } from "./business-day";
import { isSepaIdentifier, isSepaText, toIdentifierPart, toSepaText } from "./sepa-text";

describe("toSepaText", () => {
  it("translitera acentos, eñes, cedillas y el punto volado", () => {
    expect(toSepaText("Mataró", 70)).toBe("Mataro");
    expect(toSepaText("Ñandú Diseño, S.L.", 70)).toBe("Nandu Diseno, S.L.");
    expect(toSepaText("Cafè l'Àvia · Col·legi", 70)).toBe("Cafe l'Avia . Col.legi");
    expect(toSepaText("Façanes Güell", 70)).toBe("Facanes Guell");
    expect(toSepaText("Straße Øresund Œuvre", 70)).toBe("Strasse Oresund OEuvre");
  });

  it("cambia & por + y lo que no tiene equivalente por espacios, sin repetirlos", () => {
    expect(toSepaText("Pérez & Hijos", 70)).toBe("Perez + Hijos");
    expect(toSepaText("  Web — «pro» #1 @ 50 % ", 70)).toBe("Web - 'pro' 1 50");
    expect(toSepaText("Nº 3, 2ª planta", 70)).toBe("No 3, 2a planta");
    expect(toSepaText("línea\nnueva\tcon espacios", 70)).toBe("linea nueva con espacios");
  });

  it("recorta a la longitud máxima sin dejar un espacio al final", () => {
    expect(toSepaText("Restaurant del Port", 11)).toBe("Restaurant");
    expect(toSepaText("🙂", 10)).toBe("");
    expect(isSepaText(toSepaText("Ärger über Ölpreise ½ ™", 140))).toBe(true);
    expect(() => toSepaText("x", 0)).toThrow();
  });
});

describe("identificadores SEPA", () => {
  it("sin espacios, sin '/' en los extremos ni '//', hasta 35 caracteres", () => {
    expect(isSepaIdentifier("2026-0038-1A2B3C4D")).toBe(true);
    expect(isSepaIdentifier("MANDATO/2026")).toBe(true);
    expect(isSepaIdentifier("MANDATO 2026")).toBe(false);
    expect(isSepaIdentifier("/MANDATO")).toBe(false);
    expect(isSepaIdentifier("MANDATO/")).toBe(false);
    expect(isSepaIdentifier("A//B")).toBe(false);
    expect(isSepaIdentifier("")).toBe(false);
    expect(isSepaIdentifier("X".repeat(35))).toBe(true);
    expect(isSepaIdentifier("X".repeat(36))).toBe(false);
    expect(isSepaIdentifier("Año")).toBe(false);
  });

  it("toIdentifierPart deja letras, números y guiones sueltos", () => {
    expect(toIdentifierPart("F26/0038", 20)).toBe("F26-0038");
    expect(toIdentifierPart("Restaurant del Port, S.L.", 16)).toBe("RESTAURANT-DEL-P");
    expect(toIdentifierPart("Cafè l'Àvia", 20)).toBe("CAFE-L-AVIA");
    expect(toIdentifierPart("Ab-", 2)).toBe("AB");
    expect(toIdentifierPart("***", 10)).toBe("");
  });
});

describe("días hábiles TARGET2", () => {
  it("calcula el domingo de Pascua", () => {
    expect(easterSunday(2024)).toBe("2024-03-31");
    expect(easterSunday(2025)).toBe("2025-04-20");
    expect(easterSunday(2026)).toBe("2026-04-05");
    expect(easterSunday(2027)).toBe("2027-03-28");
  });

  it("cierra fines de semana, 1 de enero, Viernes Santo, Lunes de Pascua, 1 de mayo y Navidad", () => {
    for (const day of ["2026-10-03", "2026-10-04", "2027-01-01", "2026-04-03", "2026-04-06", "2026-05-01", "2026-12-25", "2026-12-26"]) {
      expect(isTargetBusinessDay(day), day).toBe(false);
    }
    // Festivos en España que no lo son en TARGET2 (12 de octubre; 7 de diciembre, el traslado de la
    // Constitución en 2026) y el martes después de Pascua.
    for (const day of ["2026-10-05", "2026-10-12", "2026-12-07", "2026-04-07"]) {
      expect(isTargetBusinessDay(day), day).toBe(true);
    }
  });

  it("propone cobrar el primer día hábil tras el margen", () => {
    // Sábado 26/09/2026 + 3 = martes 29.
    expect(suggestCollectionDate("2026-09-26")).toBe("2026-09-29");
    // Miércoles 23/12/2026 + 3 = sábado 26 (el 25 y el 26 cierra) → lunes 28.
    expect(suggestCollectionDate("2026-12-23")).toBe("2026-12-28");
  });

  it("el siguiente día hábil salta fines de semana y festivos", () => {
    expect(nextTargetBusinessDay("2026-10-05")).toBe("2026-10-05");
    expect(nextTargetBusinessDay("2026-10-03")).toBe("2026-10-05");
    expect(nextTargetBusinessDay("2026-12-25")).toBe("2026-12-28");
    expect(nextTargetBusinessDay("2026-04-03")).toBe("2026-04-07");
  });
});
