import { describe, expect, it } from "vitest";
import { isClient, isLead } from "./relationship";

describe("cliente o lead", () => {
  it("con contrato o factura es cliente, aunque nadie lo haya marcado", () => {
    expect(isClient({ status: "active", manualStatus: null })).toBe(true);
    expect(isClient({ status: "paused", manualStatus: null })).toBe(true);
    expect(isClient({ status: "former", manualStatus: null })).toBe(true);
  });

  it("sin contratos es lead", () => {
    expect(isLead({ status: "lead", manualStatus: null })).toBe(true);
    expect(isLead({ status: "lead", manualStatus: "lead" })).toBe(true);
    expect(isLead({ status: "lead", manualStatus: "pending_contact" })).toBe(true);
    expect(isLead({ status: "lead", manualStatus: "discarded" })).toBe(true);
  });

  it("lo que un socio marca a mano manda sobre lo calculado", () => {
    // Marcado activo antes de firmar nada: cuenta como cliente.
    expect(isClient({ status: "lead", manualStatus: "active" })).toBe(true);
    expect(isClient({ status: "lead", manualStatus: "finished" })).toBe(true);
    // Y al revés: con contratos pero marcado como descartado, vuelve a leads.
    expect(isLead({ status: "active", manualStatus: "discarded" })).toBe(true);
  });

  it("sin datos, lead", () => {
    expect(isLead({ status: null, manualStatus: null })).toBe(true);
  });
});
