import { describe, expect, it } from "vitest";
import { formatInvoiceNumber } from "../invoicing/number-format";
import { formatHasYear, parseInvoiceNumber } from "./invoice-number";

describe("parseInvoiceNumber", () => {
  it("el formato de la app de facturas: {yyyy}-{n:4}", () => {
    expect(parseInvoiceNumber("{yyyy}-{n:4}", "2025-0042", 2025)).toEqual({ sequence: 42, year: 2025 });
    expect(parseInvoiceNumber("{yyyy}-{n:4}", "2025-12345", 2025)).toEqual({ sequence: 12_345, year: 2025 });
    // El año del número manda (una factura de 2025 con fecha de enero de 2026).
    expect(parseInvoiceNumber("{yyyy}-{n:4}", "2025-0042", 2026)).toEqual({ sequence: 42, year: 2025 });
  });

  it("el de gnerai-finance (prefijo-año/número) y otros", () => {
    expect(parseInvoiceNumber("MS-{yyyy}/{n:3}", "MS-2025/007", 2025)).toEqual({ sequence: 7, year: 2025 });
    expect(parseInvoiceNumber("F{yy}/{n}", "F26/12", 2026)).toEqual({ sequence: 12, year: 2026 });
    expect(parseInvoiceNumber("A-{n:2}", "A-05", 2024)).toEqual({ sequence: 5, year: 2024 });
    expect(parseInvoiceNumber("R{yyyy}-{n:4}", "R2026-0001", 2026)).toEqual({ sequence: 1, year: 2026 });
  });

  it("tiene que seguir el formato exactamente, relleno de ceros incluido", () => {
    expect(parseInvoiceNumber("{yyyy}-{n:4}", "2025-12", 2025)).toBeNull();
    expect(parseInvoiceNumber("{yyyy}-{n:4}", "2025-00042", 2025)).toBeNull();
    expect(parseInvoiceNumber("{yyyy}-{n:4}", "F2025-0042", 2025)).toBeNull();
    expect(parseInvoiceNumber("{yyyy}-{n:4}", "2025-0000", 2025)).toBeNull();
    expect(parseInvoiceNumber("{yyyy}-{n:4}", "", 2025)).toBeNull();
    expect(parseInvoiceNumber("{yyyy}.{n}", "2025x7", 2025)).toBeNull();
  });

  it("es la inversa de formatInvoiceNumber", () => {
    const cases: [string, number, number][] = [
      ["{yyyy}-{n:4}", 2026, 38],
      ["R{yyyy}-{n:4}", 2027, 1],
      ["F{yy}/{n}", 2026, 12_345],
      ["{n:3}-{yyyy}", 2030, 7],
      ["A-{n:2}", 2026, 1234],
    ];
    for (const [format, year, sequence] of cases) {
      expect(parseInvoiceNumber(format, formatInvoiceNumber(format, year, sequence), year)).toEqual({ sequence, year });
    }
  });

  it("formatHasYear", () => {
    expect(formatHasYear("{yyyy}-{n:4}")).toBe(true);
    expect(formatHasYear("F{yy}{n}")).toBe(true);
    expect(formatHasYear("A-{n:2}")).toBe(false);
  });
});
