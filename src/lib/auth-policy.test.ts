import { afterEach, describe, expect, it, vi } from "vitest";
import { deviceConfirmationByEmail, mfaRequired, passwordProblems } from "./auth-policy";

describe("contraseñas de los socios", () => {
  it("pide 12 caracteres con minúsculas, mayúsculas y números", () => {
    expect(passwordProblems("Maresme2026!x")).toEqual([]);
    expect(passwordProblems("corta1A")).toEqual(["length"]);
    expect(passwordProblems("todominusculas123")).toEqual(["upper"]);
    expect(passwordProblems("SinNumerosNiNada")).toEqual(["digit"]);
    expect(passwordProblems("ÀgènciaMataró2026")).toEqual([]);
    expect(passwordProblems(`A1${"a".repeat(80)}`)).toEqual(["tooLong"]);
  });
});

describe("verificación en dos pasos", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("solo se obliga a configurarla si se pide (la entrada con código ya son dos factores)", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_MFA_REQUIRED", "");
    expect(mfaRequired()).toBe(false);
    vi.stubEnv("AUTH_MFA_REQUIRED", "false");
    expect(mfaRequired()).toBe(false);
    vi.stubEnv("AUTH_MFA_REQUIRED", "true");
    expect(mfaRequired()).toBe(true);
    vi.stubEnv("NODE_ENV", "development");
    expect(mfaRequired()).toBe(true);
  });
});

describe("confirmación de dispositivos nuevos", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("solo por email si se pide expresamente; si no, el código basta", () => {
    vi.stubEnv("AUTH_DEVICE_CONFIRMATION", "");
    expect(deviceConfirmationByEmail()).toBe(false);
    vi.stubEnv("AUTH_DEVICE_CONFIRMATION", "off");
    expect(deviceConfirmationByEmail()).toBe(false);
    vi.stubEnv("AUTH_DEVICE_CONFIRMATION", "email");
    expect(deviceConfirmationByEmail()).toBe(true);
  });
});
