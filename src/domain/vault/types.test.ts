import { describe, expect, it } from "vitest";
import { matchesQuery, readVaultSecret } from "./types";

describe("secretos de la bóveda", () => {
  it("lee lo guardado y rellena lo que falta", () => {
    expect(readVaultSecret(JSON.stringify({ name: "Banco", password: "x" }))).toEqual({
      name: "Banco", username: "", password: "x", url: "", notes: "", totp: "",
    });
  });

  it("lo que no se puede leer no rompe la lista", () => {
    expect(readVaultSecret("{roto").name).toBe("—");
    expect(readVaultSecret(JSON.stringify({ username: "sin nombre" })).name).toBe("—");
  });

  it("busca sin acentos ni mayúsculas en nombre, usuario, web y notas", () => {
    const secret = readVaultSecret(JSON.stringify({ name: "Correo Jesús", username: "info@gnerai.com", url: "ionos.es", notes: "del móvil" }));
    expect(matchesQuery(secret, "jesus")).toBe(true);
    expect(matchesQuery(secret, "IONOS")).toBe(true);
    expect(matchesQuery(secret, "movil")).toBe(true);
    expect(matchesQuery(secret, "")).toBe(true);
    expect(matchesQuery(secret, "banco")).toBe(false);
  });
});
