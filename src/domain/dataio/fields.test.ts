import { describe, expect, it } from "vitest";
import { autoMapColumns, missingRequired, sanitizeMapping } from "./fields";

describe("autoMapColumns", () => {
  it("facturas de un Excel hecho a mano en castellano", () => {
    const headers = ["Nº Factura", "Fecha", "Cliente", "NIF/CIF", "Concepto", "Base imponible", "% IVA", "Cuota IVA", "% IRPF", "Retención", "Total", "Fecha de cobro"];
    expect(autoMapColumns("invoices", headers)).toEqual({
      number: 0,
      issued_on: 1,
      client_name: 2,
      client_tax_id: 3,
      description: 4,
      base: 5,
      vat_rate: 6,
      vat_amount: 7,
      irpf_rate: 8,
      irpf_amount: 9,
      total: 10,
      paid_on: 11,
    });
  });

  it("la exportación de gnerai-finance (nombres de columna de su tabla)", () => {
    const headers = ["invoice_number", "fecha_emision", "fecha_vencimiento", "fecha_cobro", "base_imponible", "iva_pct", "iva_amount", "irpf_pct", "irpf_amount", "total", "concepto", "recurrence", "status"];
    expect(autoMapColumns("invoices", headers)).toMatchObject({
      number: 0,
      issued_on: 1,
      due_on: 2,
      paid_on: 3,
      base: 4,
      vat_rate: 5,
      vat_amount: 6,
      irpf_rate: 7,
      irpf_amount: 8,
      total: 9,
      description: 10,
      billing_type: 11,
      paid: 12,
    });
  });

  it("en catalán y en inglés", () => {
    expect(autoMapColumns("invoices", ["Número", "Data", "Client", "Concepte", "Import", "Tipus IVA"])).toMatchObject({
      number: 0,
      issued_on: 1,
      client_name: 2,
      description: 3,
      line_amount: 4,
      vat_rate: 5,
    });
    expect(autoMapColumns("clients", ["Company", "VAT number", "Address", "City", "Country", "Contact name", "Email", "Phone"])).toEqual({
      display_name: 0,
      tax_id: 1,
      address_line: 2,
      city: 3,
      country: 4,
      contact_name: 5,
      contact_email: 6,
      contact_phone: 7,
    });
  });

  it("cada columna se usa una vez: la coincidencia exacta gana a la que solo contiene la palabra", () => {
    const mapping = autoMapColumns("clients", ["Nombre", "Nombre contacto", "Código postal", "Código"]);
    expect(mapping).toEqual({ display_name: 0, contact_name: 1, postal_code: 2, external_id: 3 });
  });

  it("columnas sin título o desconocidas se quedan sin mapear", () => {
    expect(autoMapColumns("clients", ["", "Color favorito", "Razón social"])).toEqual({ legal_name: 2 });
  });
});

describe("missingRequired y sanitizeMapping", () => {
  it("lo imprescindible de cada importación", () => {
    expect(missingRequired("clients", {})).toEqual(["display_name"]);
    expect(missingRequired("clients", { legal_name: 0 })).toEqual([]);
    expect(missingRequired("invoices", { number: 0 })).toEqual(["issued_on", "client_name", "base"]);
    expect(missingRequired("invoices", { number: 0, issued_on: 1, client_tax_id: 2, total: 3, unit_price: 4 })).toEqual([]);
  });

  it("descarta campos desconocidos, columnas fuera de rango y columnas repetidas", () => {
    expect(sanitizeMapping("clients", { display_name: 0, tax_id: 0, city: 9, hacker: 1, sector: 1.5, website: "2" }, 3)).toEqual({ display_name: 0 });
  });
});
