import { describe, expect, it } from "vitest";
import { issuerOn } from "./issuer";

describe("emisor de un contrato por fecha", () => {
  const assignments = [
    { issuerId: "sl", validFrom: "2027-01-01" },
    { issuerId: "autonomo", validFrom: "2026-03-15" },
  ];

  it("usa la asignación vigente en la fecha, sin importar el orden", () => {
    expect(issuerOn(assignments, "2026-12-31")).toBe("autonomo");
    expect(issuerOn(assignments, "2027-01-01")).toBe("sl");
    expect(issuerOn(assignments, "2028-06-10")).toBe("sl");
  });

  it("antes de la primera asignación, factura el emisor con el que nació el contrato", () => {
    expect(issuerOn(assignments, "2025-01-01")).toBe("autonomo");
  });

  it("sin asignaciones no hay emisor", () => {
    expect(issuerOn([], "2026-01-01")).toBeNull();
  });
});
