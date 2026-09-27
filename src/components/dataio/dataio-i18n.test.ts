import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { CLIENT_FIELDS, INVOICE_FIELDS, TEMPLATE_HEADERS } from "@/domain/dataio/fields";
import { ISSUE_CODES } from "@/domain/dataio/issues";
import messages from "@/i18n/messages/es";

const PARAMS = {
  value: "x", number: "2026-0001", date: "01/01/2026", name: "Port", formats: "{yyyy}-{n:4}", row: 2, rate: "21 %",
  regime: "Exenta", taxId: "B12345674", a: "a", b: "b", expected: "1,00 €", computed: "2,00 €", cents: "0,01 €",
  total: "1,00 €", year: 2026, field: "Número", fields: "Ciudad, Web", reason: "motivo",
};

describe("textos de dataio (es)", () => {
  const errors: string[] = [];
  // El catálogo fusionado no lleva tipos por clave: se usa como traductor genérico.
  const t = createTranslator({ locale: "es", messages, namespace: "dataio", onError: (e) => errors.push(e.message) }) as unknown as ((
    key: string,
    params?: Record<string, string | number>,
  ) => string) & { has: (key: string) => boolean };

  it("cada motivo, campo y plantilla tiene su texto, y los mensajes ICU se formatean sin errores", () => {
    for (const code of ISSUE_CODES) expect(t(`issues.${code}`, PARAMS), code).not.toContain("dataio.");
    for (const field of [...CLIENT_FIELDS, ...INVOICE_FIELDS]) expect(t(`fields.${field}`), field).not.toContain("dataio.");
    for (const kind of ["clients", "invoices"] as const) {
      for (const [field] of TEMPLATE_HEADERS[kind]) expect(t.has(`template.${kind}.${field}`) || field === "notes" || field === "rectifies_number", `${kind}.${field}`).toBe(true);
    }
    expect(t("simulation.invoicesSummary", { create: 2, total: "10,00 €", clients: 0, error: 0 })).toBe(
      "Se importarán 2 facturas (10,00 €) y ningún cliente nuevo. ",
    );
    expect(t("jobs.rows", { count: 1 })).toBe("1 fila");
    expect(errors).toEqual([]);
  });
});
