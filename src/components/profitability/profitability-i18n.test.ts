import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { FLAGS, PERIOD_KINDS } from "@/domain/profitability";
import caCatalog from "@/i18n/messages/ca/profitability.json";
import enCatalog from "@/i18n/messages/en/profitability.json";
import esCatalog from "@/i18n/messages/es/profitability.json";
import type { Messages } from "@/i18n/messages/merge";

const CATALOGS = { es: esCatalog, ca: caCatalog, en: enCatalog } as Record<"es" | "ca" | "en", Messages>;

/** Todos los parámetros que usan los textos de la rentabilidad. */
const PARAMS = {
  count: 2,
  min: "30 %",
  value: "45 €/h",
  amount: "30 €",
  hours: "12 h",
  date: "01/09/2026",
  name: "Laia",
  client: "Hotel Llevant",
  column: "Margen",
  quarter: 3,
  year: "2026",
  total: 3,
};

function flatten(messages: Messages, prefix = ""): string[] {
  return Object.entries(messages).flatMap(([key, value]) =>
    typeof value === "string" ? [`${prefix}${key}`] : flatten(value, `${prefix}${key}.`),
  );
}

function translator(locale: "es" | "ca" | "en", errors: string[]) {
  return createTranslator({ locale, messages: CATALOGS[locale], onError: (e) => errors.push(`${locale}: ${e.message}`) }) as unknown as ((
    key: string,
    params?: Record<string, string | number>,
  ) => string) & { has: (key: string) => boolean };
}

describe("textos de la rentabilidad", () => {
  const esKeys = flatten(CATALOGS.es).sort();

  it("el catalán y el inglés están completos: las mismas claves que el español, ni una más", () => {
    expect(flatten(CATALOGS.ca).sort()).toEqual(esKeys);
    expect(flatten(CATALOGS.en).sort()).toEqual(esKeys);
  });

  it("todo el ICU se formatea en los tres idiomas, sin claves a la vista", () => {
    const errors: string[] = [];
    for (const locale of ["es", "ca", "en"] as const) {
      const t = translator(locale, errors);
      for (const key of esKeys) {
        const text = t(key, PARAMS);
        expect(text, `${locale}:${key}`).not.toBe(key);
        expect(text, `${locale}:${key}`).not.toMatch(/[{}]/);
      }
    }
    expect(errors).toEqual([]);
  });

  it("cada aviso y cada tipo de periodo tiene su texto", () => {
    const errors: string[] = [];
    for (const locale of ["es", "ca", "en"] as const) {
      const t = translator(locale, errors);
      for (const flag of FLAGS) {
        expect(t.has(`profitability.flags.${flag}`), `${locale}:${flag}`).toBe(true);
        expect(t.has(`profitability.flagHints.${flag}`), `${locale}:${flag}`).toBe(true);
      }
      for (const kind of PERIOD_KINDS) expect(t.has(`profitability.period.kinds.${kind}`), `${locale}:${kind}`).toBe(true);
      // «Por hacer» del dashboard (se fusiona con dashboard.json).
      expect(t.has("dashboard.actionQueue.items.profitability.title"), locale).toBe(true);
      expect(t.has("dashboard.actionQueue.items.profitability.hint"), locale).toBe(true);
    }
    expect(errors).toEqual([]);
  });

  it("plurales y formatos", () => {
    const errors: string[] = [];
    const es = translator("es", errors);
    const ca = translator("ca", errors);
    const en = translator("en", errors);
    expect(es("profitability.summary.clients", { count: 0 })).toBe("Ningún cliente");
    expect(es("profitability.summary.clients", { count: 1 })).toBe("1 cliente");
    expect(ca("profitability.summary.clients", { count: 3 })).toBe("3 clients");
    expect(es("profitability.period.quarter", { quarter: 3, year: "2026" })).toBe("3T 2026");
    expect(en("profitability.period.quarter", { quarter: 3, year: "2026" })).toBe("Q3 2026");
    expect(en("profitability.table.expand", { client: "Hotel" })).toBe("Show Hotel's projects");
    expect(es("dashboard.actionQueue.items.profitability.title", { count: 1 })).toBe("1 cliente por debajo de los umbrales");
    expect(ca("dashboard.actionQueue.items.profitability.title", { count: 2 })).toBe("2 clients per sota dels llindars");
    expect(es("profitability.table.costs.hosting", { count: 1 })).toBe("Infraestructura (1 web)");
    expect(en("profitability.table.costs.hosting", { count: 0 })).toBe("Infrastructure (no websites)");
    expect(es("profitability.table.unassignedHostingHint", { count: 1, total: 4 })).toContain("1 web alojada sin cliente (de 4)");
    expect(ca("profitability.summary.costSplit", { hours: "1.200 €", amount: "300 €" })).toBe("Hores 1.200 € · altres 300 €");
    expect(errors).toEqual([]);
  });
});
