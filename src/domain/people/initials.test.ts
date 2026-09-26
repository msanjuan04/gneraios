import { describe, expect, it } from "vitest";
import { initialsFrom } from "./initials";

describe("initialsFrom", () => {
  it("takes the first letter of the first two words of a name", () => {
    expect(initialsFrom("Marc Cortada")).toBe("MC");
    expect(initialsFrom("marc sanjuan sardañes")).toBe("MS");
    expect(initialsFrom("  Hugo   Lago  ")).toBe("HL");
    expect(initialsFrom("Marc")).toBe("M");
    expect(initialsFrom("Jean-Pierre Dupont")).toBe("JD");
    expect(initialsFrom("J. R. R. Tolkien")).toBe("JR");
  });

  it("keeps accents and Ñ when uppercasing", () => {
    expect(initialsFrom("álvaro ñúñez")).toBe("ÁÑ");
    expect(initialsFrom("Ñandú Àlex")).toBe("ÑÀ");
    expect(initialsFrom("Álvaro Iñiguez")).toBe("ÁI"); // decomposed input
  });

  it("uses the local part of an email split on . _ -", () => {
    expect(initialsFrom("hugo.lago@x.com")).toBe("HL");
    expect(initialsFrom("marc_sanjuan@x.com")).toBe("MS");
    expect(initialsFrom("ana-maria.lopez@x.com")).toBe("AM");
    expect(initialsFrom("info@gnerai.com")).toBe("I");
    expect(initialsFrom("hugo.lago+crm@x.com")).toBe("HL");
  });

  it("skips words without letters or digits", () => {
    expect(initialsFrom("Marc & Hugo")).toBe("MH");
    expect(initialsFrom("(Marc) Cortada")).toBe("MC");
    expect(initialsFrom("😀 Marc")).toBe("M");
  });

  it("returns at most 3 characters", () => {
    expect(initialsFrom("ßa ßb")).toBe("SSS");
  });

  it("falls back to U", () => {
    for (const input of ["", "   ", "@x.com", "+tag@x.com", "...", "¡!"]) expect(initialsFrom(input), input).toBe("U");
  });
});
