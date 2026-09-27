import { describe, expect, it } from "vitest";
import { chosenCodeProblem, generateAccessCode, hashAccessCode, isGuessableCode, maskEmail, normalizeAccessCode, verifyAccessCode } from "./code-crypto";

describe("códigos de acceso", () => {
  it("se generan de 8 cifras al azar", () => {
    const codes = new Set(Array.from({ length: 50 }, generateAccessCode));
    for (const code of codes) expect(code).toMatch(/^\d{8}$/);
    expect(codes.size).toBeGreaterThan(45);
  });

  it("nunca se reparten los que alguien probaría primero", () => {
    for (const code of ["11111111", "12121212", "11223344", "12345678", "87654321", "00123456", "90456789"]) {
      expect(isGuessableCode(code)).toBe(true);
    }
    for (const code of ["04021987", "73019264", "58203917", "12340987"]) expect(isGuessableCode(code)).toBe(false);
    for (let i = 0; i < 200; i++) expect(isGuessableCode(generateAccessCode())).toBe(false);
  });

  it("un código elegido: 8 cifras, no obvio y repetido igual", () => {
    expect(chosenCodeProblem("0417 1900", "04171900")).toBeNull();
    expect(chosenCodeProblem("1234567", "1234567")).toBe("format");
    expect(chosenCodeProblem("12345678", "12345678")).toBe("weak");
    expect(chosenCodeProblem("11112222", "11112222")).toBe("weak");
    expect(chosenCodeProblem("04171900", "04171901")).toBe("mismatch");
  });

  it("se aceptan con espacios o guiones, pero siempre 8 cifras", () => {
    expect(normalizeAccessCode("1234 5678")).toBe("12345678");
    expect(normalizeAccessCode("12-34-56-78")).toBe("12345678");
    expect(normalizeAccessCode("1234567")).toBeNull();
    expect(normalizeAccessCode("12345678a")).toBeNull();
  });

  it("solo se guarda el hash, con sal, y se verifica en tiempo constante", async () => {
    const code = "04021987";
    const a = await hashAccessCode(code);
    const b = await hashAccessCode(code);
    expect(a).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(a).not.toContain(code);
    expect(a).not.toBe(b);
    expect(await verifyAccessCode(code, a)).toBe(true);
    expect(await verifyAccessCode("04021988", a)).toBe(false);
    expect(await verifyAccessCode(code, "bcrypt$x")).toBe(false);
  });

  it("enmascara el email al que va el enlace", () => {
    expect(maskEmail("marc@gnerai.com")).toBe("m•••@gnerai.com");
  });
});
