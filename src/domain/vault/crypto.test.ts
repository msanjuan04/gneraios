import { describe, expect, it } from "vitest";
import {
  createMemberKeys,
  createVaultKey,
  decryptWithKey,
  encryptWithKey,
  generatePassword,
  passwordStrength,
  unlockPrivateKey,
  unwrapVaultKey,
  VaultCryptoError,
  wrapVaultKey,
} from "./crypto";

// Vitest corre sobre Node, que trae el mismo WebCrypto que el navegador.

describe("bóveda: contraseña maestra y par de claves", () => {
  it("la clave privada solo se abre con la contraseña maestra correcta", async () => {
    const keys = await createMemberKeys("un secreto muy largo 2026");
    await expect(unlockPrivateKey("un secreto muy largo 2026", keys)).resolves.toBeDefined();
    await expect(unlockPrivateKey("otra cosa", keys)).rejects.toMatchObject({ code: "wrong_password" });
  });

  it("dos miembros con la misma contraseña maestra tienen claves distintas (la sal es de cada uno)", async () => {
    const a = await createMemberKeys("igual");
    const b = await createMemberKeys("igual");
    expect(a.kdfSalt).not.toBe(b.kdfSalt);
    expect(a.publicKey).not.toBe(b.publicKey);
    // La privada de uno no se abre con los parámetros del otro.
    await expect(unlockPrivateKey("igual", { ...a, kdfSalt: b.kdfSalt })).rejects.toMatchObject({ code: "wrong_password" });
  });
}, 60_000);

describe("bóveda: la clave compartida y sus sobres", () => {
  it("quien tiene sobre abre los secretos; quien no, no", async () => {
    const vaultKey = await createVaultKey();
    const sealed = await encryptWithKey(vaultKey, "la contraseña del banco");

    const socio = await createMemberKeys("maestra del socio");
    const extraño = await createMemberKeys("maestra de otro");
    const sobre = await wrapVaultKey(vaultKey, socio.publicKey);

    const suya = await unwrapVaultKey(await unlockPrivateKey("maestra del socio", socio), sobre);
    expect(await decryptWithKey(suya, sealed)).toBe("la contraseña del banco");

    // El sobre de otro no se abre con mi clave privada.
    await expect(unwrapVaultKey(await unlockPrivateKey("maestra de otro", extraño), sobre)).rejects.toBeInstanceOf(VaultCryptoError);
  });

  it("un texto cifrado manipulado no se abre en silencio", async () => {
    const key = await createVaultKey();
    const sealed = await encryptWithKey(key, "hola");
    const [iv, body] = sealed.split(".");
    await expect(decryptWithKey(key, `${iv}.${body!.slice(0, -4)}AAAA`)).rejects.toMatchObject({ code: "wrong_password" });
    await expect(decryptWithKey(key, "sin-punto")).rejects.toMatchObject({ code: "corrupt" });
  });

  it("cifrar dos veces lo mismo da textos distintos (cada vez su propio IV)", async () => {
    const key = await createVaultKey();
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
