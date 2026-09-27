import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { COST_PERIODS, VENDOR_KIND_FILTERS, VENDOR_KINDS } from "@/domain/vendors";
import caAll from "@/i18n/messages/ca/index";
import caVendors from "@/i18n/messages/ca/vendors.json";
import enAll from "@/i18n/messages/en/index";
import enVendors from "@/i18n/messages/en/vendors.json";
import esAll from "@/i18n/messages/es/index";
import esVendors from "@/i18n/messages/es/vendors.json";
import type { Messages } from "@/i18n/messages/merge";

// Los textos de Finanzas → Proveedores (vendors.json). Las claves que usa el código se sacan leyendo
// el código (así, una clave nueva sin traducir hace fallar el test) y, las que se montan al vuelo, de
// las mismas constantes del dominio que las montan.

type Locale = "es" | "ca" | "en";
const LOCALES: Locale[] = ["es", "ca", "en"];
const VENDORS = { es: esVendors, ca: caVendors, en: enVendors } as Record<Locale, Messages>;
/** El catálogo entero de cada idioma, sin caer al español: lo que falte aquí se vería en español. */
const ALL = { es: esAll, ca: caAll, en: enAll } as Record<Locale, Messages>;

const ROOT = join(import.meta.dirname, "../../..");
const SOURCE_DIRS = ["src/app/[org]/finance/vendors", "src/components/vendors", "src/server/vendors"];

/** Todos los parámetros que usan los textos de proveedores. */
const PARAMS: Record<string, string | number> = {
  count: 2,
  name: "Clara Font Studio",
  amount: "1.234,56 €",
  column: "Total",
  year: "2026",
  date: "20 dic 2025",
  share: "46,1 %",
};

function flatten(messages: Messages, prefix = ""): string[] {
  return Object.entries(messages).flatMap(([key, value]) =>
    typeof value === "string" ? [`${prefix}${key}`] : flatten(value as Messages, `${prefix}${key}.`),
  );
}

type LooseTranslator = ((key: string, params?: Record<string, string | number>) => string) & { has: (key: string) => boolean };

function translator(messages: Messages, locale: Locale, errors: string[]): LooseTranslator {
  return createTranslator({ locale, messages, onError: (e) => errors.push(`${locale}: ${e.message}`) }) as unknown as LooseTranslator;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/**
 * Las claves que usa el código de proveedores: cada `t("…")` (también `t(cond ? "a" : "b")`) con el
 * espacio de nombres de su `useTranslations`/`getTranslations` más reciente, las de las acciones
 * (`failure("…")`, los `return "…"` de errors.ts) y los mensajes del esquema (vendors.validation.*).
 */
function scannedKeys(): { keys: Set<string>; validation: Set<string> } {
  const keys = new Set<string>();
  const validation = new Set<string>();
  for (const file of SOURCE_DIRS.flatMap((dir) => sourceFiles(join(ROOT, dir)))) {
    const code = readFileSync(file, "utf8");
    const bindings = [...code.matchAll(/\b(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*"([^"]*)"\s*\)/g)].map(
      (m) => ({ name: m[1]!, namespace: m[2]!, at: m.index! }),
    );
    const namespaceAt = (name: string, at: number) => bindings.filter((b) => b.name === name && b.at < at).at(-1)?.namespace;
    for (const name of new Set(bindings.map((b) => b.name))) {
      const call = new RegExp(`\\b${name}(?:\\.rich|\\.markup)?\\(\\s*"([^"]+)"`, "g");
      const ternary = new RegExp(`\\b${name}\\(\\s*[^"\`()]*?\\?\\s*"([^"]+)"\\s*:\\s*"([^"]+)"`, "g");
      for (const m of code.matchAll(call)) {
        const ns = namespaceAt(name, m.index!);
        if (ns !== undefined) keys.add(ns ? `${ns}.${m[1]}` : m[1]!);
      }
      for (const m of code.matchAll(ternary)) {
        const ns = namespaceAt(name, m.index!);
        if (ns !== undefined) for (const key of [m[1]!, m[2]!]) keys.add(ns ? `${ns}.${key}` : key);
      }
    }
    for (const m of code.matchAll(/\bfailure\(\s*"([^"]+)"/g)) keys.add(m[1]!);
    if (file.endsWith("errors.ts")) for (const m of code.matchAll(/return\s+"([a-z]+\.[A-Za-z0-9_.]+)"/g)) keys.add(m[1]!);
    if (file.endsWith("schema.ts")) {
      // El mensaje de Zod: último argumento (`.max(254, "tooLong")`) o el de z.email("…").
      for (const m of code.matchAll(/,\s*"(\w+)"\)|\.email\(\s*"(\w+)"\)/g)) validation.add((m[1] ?? m[2])!);
    }
  }
  return { keys, validation };
}

/** Las que se montan al vuelo (tipos, filtros, periodos) y las de los metadatos y la pestaña de Finanzas. */
function dynamicKeys(): string[] {
  return [
    ...VENDOR_KINDS.flatMap((k) => [`vendors.kinds.${k}`, `vendors.sheet.kindHints.${k}`]),
    ...VENDOR_KIND_FILTERS.map((f) => `vendors.list.filters.${f}`),
    ...COST_PERIODS.map((p) => `vendors.detail.allocation.${p}`),
    "vendors.tab",
    "finance.title",
  ];
}

describe("textos de proveedores", () => {
  const esKeys = flatten(VENDORS.es).sort();

  it("el catalán y el inglés están completos: las mismas claves que el español, ni una más", () => {
    expect(esKeys.length).toBeGreaterThan(120);
    expect(flatten(VENDORS.ca).sort()).toEqual(esKeys);
    expect(flatten(VENDORS.en).sort()).toEqual(esKeys);
  });

  it("cada clave que usa el código existe en los tres idiomas", () => {
    const { keys } = scannedKeys();
    // El escáner encuentra las claves de verdad (si dejara de hacerlo, este test no probaría nada).
    expect(keys.size).toBeGreaterThan(110);
    expect(keys).toContain("vendors.list.columns.sortBy");
    expect(keys).toContain("vendors.detail.allocation.clientShare");
    expect(keys).toContain("vendors.detail.expenses.due");
    expect(keys).toContain("vendors.errors.duplicateTaxId");
    expect(keys).toContain("vendors.errors.notFound");
    expect(keys).toContain("common.cancel");
    const used = [...keys, ...dynamicKeys()];
    for (const locale of LOCALES) {
      const errors: string[] = [];
      const own = translator(VENDORS[locale], locale, errors);
      const all = translator(ALL[locale], locale, errors);
      const missing = used.filter((key) => !(key.startsWith("vendors.") ? own.has(key) : all.has(key)));
      expect(missing, locale).toEqual([]);
    }
  });

  it("los mensajes del esquema tienen su texto (vendors.validation.* o validation.*)", () => {
    const { validation } = scannedKeys();
    expect(validation).toContain("taxIdVendor");
    expect(validation).toContain("website");
    expect(validation).toContain("email");
    for (const locale of LOCALES) {
      const errors: string[] = [];
      const own = translator(VENDORS[locale], locale, errors);
      const all = translator(ALL[locale], locale, errors);
      // `required` e `iban` vienen de los campos compartidos (src/lib/validation/fiscal.ts).
      const missing = [...validation, "required", "iban"].filter((m) => !own.has(`vendors.validation.${m}`) && !all.has(`validation.${m}`));
      expect(missing, locale).toEqual([]);
    }
  });

  it("todo el ICU se formatea en los tres idiomas, sin claves ni llaves a la vista", () => {
    const errors: string[] = [];
    for (const locale of LOCALES) {
      const t = translator(VENDORS[locale], locale, errors);
      for (const key of esKeys) {
        const text = t(key, PARAMS);
        expect(text, `${locale}:${key}`).not.toBe(key);
        expect(text, `${locale}:${key}`).not.toMatch(/[{}]/);
      }
    }
    expect(errors).toEqual([]);
  });

  it("plurales, formatos y botones en imperativo en catalán", () => {
    const errors: string[] = [];
    const es = translator(VENDORS.es, "es", errors);
    const ca = translator(VENDORS.ca, "ca", errors);
    const en = translator(VENDORS.en, "en", errors);
    expect(es("vendors.list.summary.vendors", { count: 0 })).toBe("Ningún proveedor");
    expect(es("vendors.list.summary.vendors", { count: 1 })).toBe("1 proveedor");
    expect(ca("vendors.list.summary.vendors", { count: 3 })).toBe("3 proveïdors");
    expect(en("vendors.list.showArchived", { count: 1 })).toBe("Show 1 archived");
    expect(ca("vendors.sheet.save")).toBe("Desa");
    expect(ca("vendors.list.new")).toBe("Nou proveïdor");
    expect(ca("vendors.detail.newExpense")).toBe("Registra una despesa");
    expect(ca("vendors.detail.copyIban")).toBe("Copia l'IBAN");
    expect(es("vendors.detail.stats.pendingHint", { count: 0 })).toBe("Todo pagado");
    expect(en("vendors.detail.stats.overdueHint", { amount: "31,80 €", count: 1 })).toBe("31,80 € overdue (1 expense)");
    expect(es("vendors.detail.stats.yearHint", { count: 0, year: "2026" })).toBe("Sin gastos en 2026");
    expect(es("vendors.detail.allocation.clientShare", { share: "86,2 %", count: 2 })).toBe("86,2 % para 2 clientes");
    expect(ca("vendors.detail.allocation.summary", { count: 1, amount: "10 €" })).toBe("1 despesa · 10 €");
    expect(es("vendors.client.description", { count: 1, amount: "260,50 €" })).toBe("1 proveedor ha trabajado para este cliente · 260,50 € en total");
    expect(en("vendors.list.columns.sortBy", { column: "Total" })).toBe("Sort by “Total”");
    expect(errors).toEqual([]);
  });
});
