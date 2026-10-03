import { describe, expect, it, vi } from "vitest";
import { openGoogleSession, SeoConnectionError } from "./google-session";
import { type SecretStore, SecretStoreError } from "./secret-store";

// Una credencial que no se puede abrir (clave perdida) pide reconectar Google, no revienta.

const config = { clientId: "id", clientSecret: "secret", redirectUri: "https://example.test/cb" } as never;

function fakeAdmin(row: Record<string, unknown> | null) {
  const updates: unknown[] = [];
  const admin = {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }),
      update: (values: unknown) => {
        updates.push(values);
        return { eq: () => ({ neq: async () => ({ error: null }) }) };
      },
    }),
  };
  return { admin: admin as never, updates };
}

const row = { id: "i1", status: "connected", scopes: [], refresh_token_encrypted: "v1.a.b.c" };

describe("credencial de Google que no se puede abrir", () => {
  it("pide reconectar y marca la integración con error, sin lanzar el error técnico", async () => {
    const { admin, updates } = fakeAdmin(row);
    const secrets: SecretStore = { seal: vi.fn(), open: vi.fn().mockRejectedValue(new SecretStoreError("secret_invalid")) };
    await expect(openGoogleSession(admin, "org", { config, secrets })).rejects.toMatchObject({ code: "reconnect" });
    expect(updates).toEqual([{ status: "error", last_error: "secret_unreadable" }]);
  });

  it("un fallo que no es de la clave sí se propaga tal cual", async () => {
    const { admin } = fakeAdmin(row);
    const secrets: SecretStore = { seal: vi.fn(), open: vi.fn().mockRejectedValue(new Error("boom")) };
    await expect(openGoogleSession(admin, "org", { config, secrets })).rejects.toThrow("boom");
  });

  it("sin integración conectada sigue diciendo que no está conectada", async () => {
    const { admin } = fakeAdmin(null);
    await expect(openGoogleSession(admin, "org", { config })).rejects.toBeInstanceOf(SeoConnectionError);
  });
});
