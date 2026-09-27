import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { FORM_ISSUE_CODES, PAYMENT_STATUSES, REVIEW_REASONS } from "@/domain/invoice-import/form";
import { CONFIDENCES, EXTRACTION_WARNINGS } from "@/domain/invoice-import/types";
import caAll from "@/i18n/messages/ca/index";
import caImport from "@/i18n/messages/ca/invoice-import.json";
import enAll from "@/i18n/messages/en/index";
import enImport from "@/i18n/messages/en/invoice-import.json";
import esAll from "@/i18n/messages/es/index";
import esImport from "@/i18n/messages/es/invoice-import.json";
import type { Messages } from "@/i18n/messages/merge";
import { ROW_STATUSES, SAVED_KINDS } from "./types";

// Los textos de «Importar facturas emitidas» (invoice-import.json). Las claves que usa el código se
// sacan leyendo el código (así, una clave nueva sin traducir hace fallar el test) y, las que se
// montan al vuelo, de las mismas constantes del dominio que las montan.

type Locale = "es" | "ca" | "en";
const LOCALES: Locale[] = ["es", "ca", "en"];
const OWN = { es: esImport, ca: caImport, en: enImport } as Record<Locale, Messages>;
/** El catálogo entero de cada idioma, sin caer al español: lo que falte aquí se vería en español. */
const ALL = { es: esAll, ca: caAll, en: enAll } as Record<Locale, Messages>;

const ROOT = join(import.meta.dirname, "../../..");
const SOURCE_DIRS = ["src/components/invoice-import", "src/server/invoice-import", "src/app/api/invoice-import"];

/** Todos los parámetros que usan los textos. */
const PARAMS: Record<string, string | number> = {
  count: 2,
  name: "Restaurant del Port SL",
  done: 3,
  total: "954,00 €",
  ready: 4,
  review: 1,
  existing: 2,
  errors: 0,
  saved: 5,
  failed: 1,
  created: 2,
  reused: 1,
  taxId: "B12345674",
  pdf: "954,00 €",
  client: "B65432106",
  computed: "953,99 €",
  from: "01/03/2025",
  to: "31/03/2025",
  date: "15/03/2025",
  amount: "300,00 €",
  number: "2025-0036",
  format: "yyyy-n",
  suggested: "yy/n",
  line: 2,
  detail: "2026-0012",
  codes: "BRK, ACM",
  moved: 3,
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

/** Cada `t("…")` (también `t(cond ? "a" : "b")`) con el espacio de nombres de su useTranslations/getTranslations. */
function scannedKeys(): Set<string> {
  const keys = new Set<string>();
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
    // Las rutas: `fail("clave", …)` sobre invoiceImport.errors; las acciones: `failure("clave")`.
    if (file.includes("/app/api/invoice-import/")) {
      for (const m of code.matchAll(/\bfail\(\s*"([^"]+)"/g)) keys.add(`invoiceImport.errors.${m[1]}`);
      for (const m of code.matchAll(/\bfail\(\s*[^?()]*?\?\s*"([^"]+)"\s*:\s*"([^"]+)"/g)) {
        keys.add(`invoiceImport.errors.${m[1]}`);
        keys.add(`invoiceImport.errors.${m[2]}`);
      }
    }
    for (const m of code.matchAll(/\bfailure\(\s*"([^"]+)"/g)) keys.add(m[1]!);
  }
  return keys;
}

/** Las que se montan al vuelo: estados, motivos, avisos, confianzas, problemas y errores de las rutas. */
function dynamicKeys(): string[] {
  return [
    ...ROW_STATUSES.map((s) => `invoiceImport.status.${s}`),
    ...SAVED_KINDS.map((k) => `invoiceImport.status.saved_${k}`),
    ...["existingPaid", "existingApp", "existingAppPaid"].map((s) => `invoiceImport.status.${s}`),
    ...REVIEW_REASONS.map((r) => `invoiceImport.reasons.${r}`),
    ...EXTRACTION_WARNINGS.map((w) => `invoiceImport.warnings.${w}`),
    ...CONFIDENCES.flatMap((c) => [`invoiceImport.confidence.${c}`, `invoiceImport.confidence.${c}Hint`]),
    ...FORM_ISSUE_CODES.map((c) => `invoiceImport.issues.${c}`),
    ...PAYMENT_STATUSES.map((s) => `invoiceImport.payment.${s}`),
    // Los errores de subida (readPdfUpload) y los de import_historical_invoice (save.ts → DB_HINTS).
    ...["too_large", "missing", "not_pdf"].map((e) => `invoiceImport.errors.${e}`),
    ...[
      "future_date",
      "issuer_inactive",
      "series_invalid",
      "number_format_mismatch",
      "series_order_conflict",
      "series_external_numbering",
      "totals_mismatch",
      "no_lines",
      "client_not_found",
      "counter_below_used",
      "import_invalid",
    ].map((h) => `invoiceImport.errors.db.${h}`),
    ...["transfer", "sepa_debit", "card", "cash", "other"].map((m) => `billing.paymentMethod.${m}`),
    ...["one_off", "monthly", "yearly", "usage"].map((b) => `billing.billingType.${b}`),
  ];
}

describe("textos de «Importar facturas emitidas»", () => {
  const esKeys = flatten(OWN.es).sort();

  it("el catalán y el inglés están completos: las mismas claves que el español, ni una más", () => {
    expect(esKeys.length).toBeGreaterThan(150);
    expect(flatten(OWN.ca).sort()).toEqual(esKeys);
    expect(flatten(OWN.en).sort()).toEqual(esKeys);
  });

  it("cada clave que usa el código existe en los tres idiomas", () => {
    const keys = scannedKeys();
    // El escáner encuentra las claves de verdad (si dejara de hacerlo, este test no probaría nada).
    expect(keys.size).toBeGreaterThan(120);
    expect(keys).toContain("invoiceImport.payment.paidOnHint");
    expect(keys).toContain("invoiceImport.existing.register");
    expect(keys).toContain("invoiceImport.errors.pdf_encrypted");
    const used = [...keys, ...dynamicKeys()];
    for (const locale of LOCALES) {
      const errors: string[] = [];
      const own = translator(OWN[locale], locale, errors);
      const all = translator(ALL[locale], locale, errors);
      const missing = used.filter((key) => !(key.startsWith("invoiceImport.") ? own.has(key) : all.has(key)));
      expect(missing, locale).toEqual([]);
    }
  });

  it("todo el ICU se formatea en los tres idiomas, sin claves ni llaves a la vista", () => {
    const errors: string[] = [];
    for (const locale of LOCALES) {
      const t = translator(OWN[locale], locale, errors);
      for (const key of esKeys) {
        const text = t(key, PARAMS);
        expect(text, `${locale}:${key}`).not.toBe(key);
        expect(text, `${locale}:${key}`).not.toMatch(/[{}]/);
      }
    }
    expect(errors).toEqual([]);
  });

  it("plurales y textos clave", () => {
    const errors: string[] = [];
    const es = translator(OWN.es, "es", errors);
    const ca = translator(OWN.ca, "ca", errors);
    const en = translator(OWN.en, "en", errors);
    expect(es("invoiceImport.toolbar.saveReady", { count: 0 })).toBe("Guardar las listas");
    expect(es("invoiceImport.toolbar.saveReady", { count: 1 })).toBe("Guardar la lista");
    expect(es("invoiceImport.toolbar.saveReady", { count: 12 })).toBe("Guardar las 12 listas");
    expect(ca("invoiceImport.toolbar.saveReady", { count: 3 })).toBe("Desa les 3 que estan a punt");
    expect(en("invoiceImport.toolbar.createClients", { count: 1 })).toBe("Create the missing client");
    expect(es("invoiceImport.totals.adjusted", { count: 1 })).toBe("Se ha ajustado 1 céntimo para cuadrar con el PDF");
    expect(es("invoiceImport.payment.paidOnHint")).toContain("no es la fecha de la factura");
    expect(ca("invoiceImport.status.payment")).toBe("Registra el cobrament");
    expect(en("invoiceImport.status.existingPaid")).toBe("Already imported and paid");
    expect(errors).toEqual([]);
  });
});
