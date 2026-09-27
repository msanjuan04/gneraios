import { describe, expect, it } from "vitest";
import { derivedAsManual, effectiveClientStatus, isClientManualStatus, manualDiffers } from "./status";

describe("estado del cliente", () => {
  it("sin marcar a mano se ve el calculado, con las mismas palabras", () => {
    expect(effectiveClientStatus("active", null)).toBe("active");
    expect(effectiveClientStatus("former", undefined)).toBe("finished");
    expect(derivedAsManual("lead")).toBe("lead");
  });

  it("marcado a mano manda en lo que se ve", () => {
    expect(effectiveClientStatus("lead", "pending_contact")).toBe("pending_contact");
    expect(effectiveClientStatus("active", "finished")).toBe("finished");
  });

  it("avisa cuando el marcado a mano no coincide con los contratos", () => {
    expect(manualDiffers("active", "finished")).toBe(true);
    expect(manualDiffers("former", "finished")).toBe(false);
    expect(manualDiffers("active", null)).toBe(false);
  });

  it("solo acepta los estados que existen", () => {
    expect(isClientManualStatus("discarded")).toBe(true);
    expect(isClientManualStatus("former")).toBe(false);
    expect(isClientManualStatus(null)).toBe(false);
  });
});
