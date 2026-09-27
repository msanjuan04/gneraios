import { describe, expect, it } from "vitest";
import { isValidSlug, RESERVED_SLUGS, slugify } from "./slug";

describe("RESERVED_SLUGS", () => {
  it("lists the top-level routes", () => {
    expect(RESERVED_SLUGS).toEqual([
      "login", "logout", "auth", "onboarding", "api", "preview", "settings", "invite", "admin", "app", "brand", "static", "_next",
      "p", "icons",
    ]);
  });
});

describe("slugify", () => {
  it("lowercases and strips accents", () => {
    expect(slugify("Mataró")).toBe("mataro");
    expect(slugify("Ñandú")).toBe("nandu");
    expect(slugify("Àlex Güell Pérez")).toBe("alex-guell-perez");
    expect(slugify("Ça va")).toBe("ca-va");
    expect(slugify("Agència Mataró, S.L.")).toBe("agencia-mataro-s-l");
    expect(slugify("Mataró")).toBe("mataro"); // already decomposed input
  });

  it("collapses other characters into single dashes and trims them", () => {
    expect(slugify("  GNERAI  S.L. ")).toBe("gnerai-s-l");
    expect(slugify("Café & Co.")).toBe("cafe-co");
    expect(slugify("--hello--world--")).toBe("hello-world");
    expect(slugify("hola_mundo 2026")).toBe("hola-mundo-2026");
    expect(slugify("l'Hospitalet")).toBe("l-hospitalet");
  });

  it("caps the length at 40 characters without a trailing dash", () => {
    expect(slugify("a".repeat(50))).toBe("a".repeat(40));
    expect(slugify(`${"a".repeat(39)} bcd`)).toBe("a".repeat(39));
    expect(slugify(`${"a".repeat(38)} bcd`)).toBe(`${"a".repeat(38)}-b`);
  });

  it("returns an empty string when nothing is left", () => {
    expect(slugify("")).toBe("");
    expect(slugify("¡¿!?")).toBe("");
    expect(slugify("日本語")).toBe("");
  });

  it("produces valid slugs for ordinary names", () => {
    for (const name of ["GNERAI", "Mataró Digital", "Hugo Lago Estudio", "Clínica Dental Sant Joan", "x".repeat(80)]) {
      expect(isValidSlug(slugify(name)), name).toBe(true);
    }
  });
});

describe("isValidSlug", () => {
  it("accepts 1–40 lowercase alphanumerics and inner dashes", () => {
    for (const slug of ["a", "0", "gnerai", "a-b", "mataro-2026", "a".repeat(40)]) {
      expect(isValidSlug(slug), slug).toBe(true);
    }
  });

  it("rejects malformed slugs", () => {
    for (const slug of ["", "-a", "a-", "-", "A", "Gnerai", "a_b", "a b", "mataró", "a.b", "a".repeat(41)]) {
      expect(isValidSlug(slug), slug).toBe(false);
    }
  });

  it("rejects every reserved slug", () => {
    for (const slug of RESERVED_SLUGS) expect(isValidSlug(slug), slug).toBe(false);
    expect(slugify("Admin")).toBe("admin");
    expect(isValidSlug(slugify("Admin"))).toBe(false);
  });
});
