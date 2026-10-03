import { describe, expect, it } from "vitest";
import {
  createVaultSettings,
  decryptWithKey,
  encryptWithKey,
  generatePassword,
  openVault,
  passwordStrength,
} from "./crypto";

// Vitest corre sobre Node, que trae el mismo WebCrypto que el navegador.

describe("la contraseña del equipo", () => {
  it("abre la bóveda con la contraseña buena y la rechaza con cualquier otra", async () => {
    const { settings, key } = await createVaultSettings("la del equipo 2026");
    const sealed = await encryptWithKey(key, "la contraseña del banco");

    const otra = await openVault("la del equipo 2026", settings);
    expect(await decryptWithKey(otra, sealed)).toBe("la contraseña del banco");

    await expect(openVault("no es esta", settings)).rejects.toMatchObject({ code: "wrong_password" });
    // Con la sal de otra bóveda tampoco: la clave sale de la contraseña Y de la sal.
    const otraBoveda = await createVaultSettings("la del equipo 2026");
    await expect(openVault("la del equipo 2026", { ...settings, kdfSalt: otraBoveda.settings.kdfSalt })).rejects.toMatchObject({ code: "wrong_password" });
  });

  it("dos bóvedas con la misma contraseña no comparten clave (cada una con su sal)", async () => {
    const a = await createVaultSettings("igual");
    const b = await createVaultSettings("igual");
    expect(a.settings.kdfSalt).not.toBe(b.settings.kdfSalt);
    const sealed = await encryptWithKey(a.key, "secreto");
    await expect(decryptWithKey(b.key, sealed)).rejects.toMatchObject({ code: "wrong_password" });
  });

  it("lo guardado no permite abrir nada por sí solo", async () => {
    const { settings } = await createVaultSettings("la del equipo");
    // La sal y el verificador son públicos para quien lea la base de datos; la contraseña no está.
    expect(JSON.stringify(settings)).not.toContain("la del equipo");
  });
}, 60_000);

describe("secretos cifrados", () => {
  it("un texto manipulado no se abre en silencio", async () => {
    const { key } = await createVaultSettings("equipo");
    const sealed = await encryptWithKey(key, "hola");
    const [iv, body] = sealed.split(".");
    await expect(decryptWithKey(key, `${iv}.${body!.slice(0, -4)}AAAA`)).rejects.toMatchObject({ code: "wrong_password" });
    await expect(decryptWithKey(key, "sin-punto")).rejects.toMatchObject({ code: "corrupt" });
  });

  it("cifrar dos veces lo mismo da textos distintos (cada vez su propio IV)", async () => {
    const { key } = await createVaultSettings("equipo");
    expect(await encryptWithKey(key, "igual")).not.toBe(await encryptWithKey(key, "igual"));
  });
}, 60_000);

describe("contraseñas generadas", () => {
  it("tienen la longitud pedida y no repiten", () => {
    expect(generatePassword(24)).toHaveLength(24);
    expect(generatePassword()).not.toBe(generatePassword());
    // Sin caracteres que se confundan de un vistazo.
    expect(generatePassword(200)).not.toMatch(/[0O1lI]/);
  });

  it("el medidor premia longitud y variedad", () => {
    expect(passwordStrength("")).toBe(0);
    expect(passwordStrength("hola")).toBe(0);
    expect(passwordStrength("holaquetal1")).toBe(1);
    expect(passwordStrength("Hola.Que.Tal.1")).toBe(3);
    expect(passwordStrength(generatePassword(24))).toBe(4);
  });
});
