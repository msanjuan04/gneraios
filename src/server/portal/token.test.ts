import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashPortalToken, isPortalToken, newPortalToken, PORTAL_TOKEN_BYTES, sha256Hex } from "./token";

describe("tokens de enlaces públicos", () => {
  it("son 32 bytes aleatorios en base64url (43 caracteres) y distintos cada vez", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const { token } = newPortalToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(token, "base64url")).toHaveLength(PORTAL_TOKEN_BYTES);
      seen.add(token);
    }
    expect(seen.size).toBe(200);
  });

  it("la huella es el SHA-256 en hex del token, estable y distinta del token", () => {
    const { token, hash } = newPortalToken();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(hashPortalToken(token)).toBe(hash);
    expect(hash).not.toContain(token);
  });

  it("descarta lo que no tiene forma de token sin llegar a la base de datos", () => {
    const { token } = newPortalToken();
    expect(isPortalToken(token)).toBe(true);
    for (const bad of ["", "abc", `${token}x`, token.slice(1), `${token.slice(0, 42)}=`, `${token.slice(0, 42)}/`, null, 42]) {
      expect(isPortalToken(bad)).toBe(false);
    }
    expect(() => hashPortalToken("../../etc/passwd")).toThrow(/mal formado/);
  });

  it("sha256Hex sirve para la huella del PDF aceptado", () => {
    expect(sha256Hex(new Uint8Array([1, 2, 3]))).toBe("039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81");
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});
