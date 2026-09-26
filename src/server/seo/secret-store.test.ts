import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AesGcmSecretStore, deriveKey, integrationSecretContext, parseEncryptionKey, secretStoreFromEnv } from "./secret-store";

const key = randomBytes(32);

describe("almacén de secretos (AES-256-GCM)", () => {
  it("cifra y descifra; cada cifrado es distinto", async () => {
    const store = new AesGcmSecretStore(key);
    const context = integrationSecretContext("org-1", "google");
    const a = await store.seal("1//refresh-token", context);
    const b = await store.seal("1//refresh-token", context);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(a).not.toContain("refresh");
    expect(await store.open(a, context)).toBe("1//refresh-token");
  });

  it("un texto cifrado no se abre con otra org, otra clave ni retocado", async () => {
    const store = new AesGcmSecretStore(key);
    const sealed = await store.seal("secreto", integrationSecretContext("org-1", "google"));
    await expect(store.open(sealed, integrationSecretContext("org-2", "google"))).rejects.toMatchObject({ code: "secret_invalid" });
    await expect(new AesGcmSecretStore(randomBytes(32)).open(sealed, integrationSecretContext("org-1", "google"))).rejects.toMatchObject({
      code: "secret_invalid",
    });
    const [v, iv, body, tag] = sealed.split(".");
    const flipped = `${v}.${iv}.${body!.slice(0, -2)}${body!.endsWith("A") ? "B" : "A"}${body!.slice(-1)}.${tag}`;
    await expect(store.open(flipped, integrationSecretContext("org-1", "google"))).rejects.toMatchObject({ code: "secret_invalid" });
    await expect(store.open("no-es-un-secreto", "x")).rejects.toMatchObject({ code: "secret_format" });
  });

  it("la clave del entorno es de 32 bytes, en base64 o en hexadecimal", async () => {
    expect(parseEncryptionKey(key.toString("base64"))).toEqual(key);
    expect(parseEncryptionKey(key.toString("base64url"))).toEqual(key);
    expect(parseEncryptionKey(key.toString("hex"))).toEqual(key);
    expect(parseEncryptionKey(randomBytes(16).toString("base64"))).toBeNull();
    expect(parseEncryptionKey("")).toBeNull();
    expect(() => secretStoreFromEnv({})).toThrow("missing_key");
    expect(() => secretStoreFromEnv({ INTEGRATIONS_ENCRYPTION_KEY: "corta" })).toThrow("invalid_key");
    const store = secretStoreFromEnv({ INTEGRATIONS_ENCRYPTION_KEY: key.toString("base64") });
    expect(await store.open(await store.seal("x", "c"), "c")).toBe("x");
    // Las subclaves por uso no coinciden entre sí ni con la maestra.
    expect(deriveKey(key, "a")).not.toEqual(deriveKey(key, "b"));
    expect(deriveKey(key, "a")).not.toEqual(key);
  });
});
