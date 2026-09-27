import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { notificationMessageKey, notificationValues } from "@/domain/notifications/text";
import caCore from "@/i18n/messages/ca/core.json";
import caAll from "@/i18n/messages/ca/index";
import caInfrastructure from "@/i18n/messages/ca/infrastructure.json";
import enCore from "@/i18n/messages/en/core.json";
import enAll from "@/i18n/messages/en/index";
import enInfrastructure from "@/i18n/messages/en/infrastructure.json";
import esCore from "@/i18n/messages/es/core.json";
import esAll from "@/i18n/messages/es/index";
import esInfrastructure from "@/i18n/messages/es/infrastructure.json";
import type { Messages } from "@/i18n/messages/merge";

// Los textos de Finanzas → Infraestructura (infrastructure.json) y del aviso de renovación
// (core.json: inbox.kinds.subscription_renewal, push.titles.subscription_renewal). Las claves que usa
// el código se sacan leyendo el código (una clave nueva sin traducir hace fallar el test) y, las que
// se montan al vuelo, se listan aquí.

type Locale = "es" | "ca" | "en";
const LOCALES: Locale[] = ["es", "ca", "en"];
const OWN = { es: esInfrastructure, ca: caInfrastructure, en: enInfrastructure } as Record<Locale, Messages>;
const CORE = { es: esCore, ca: caCore, en: enCore } as Record<Locale, Messages>;
/** El catálogo entero de cada idioma, sin caer al español: lo que falte aquí se vería en español. */
const ALL = { es: esAll, ca: caAll, en: enAll } as Record<Locale, Messages>;

const ROOT = join(import.meta.dirname, "../../../..");
const SOURCE_DIRS = ["src/app/[org]/finance/infrastructure", "src/components/finance/infrastructure"];

/** Todos los parámetros que usan los textos de Infraestructura. */
const PARAMS: Record<string, string | number> = { count: 2, days: 14, amount: "49,90 €" };

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
 * Las claves que usa el código: cada `t("…")` con el espacio de nombres de su
 * `useTranslations`/`getTranslations` más reciente, y los mensajes de los esquemas.
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
      for (const m of code.matchAll(new RegExp(`\\b${name}\\(\\s*"([^"]+)"`, "g"))) {
        const ns = namespaceAt(name, m.index!);
        if (ns !== undefined) keys.add(ns ? `${ns}.${m[1]}` : m[1]!);
      }
    }
    if (file.endsWith("schema.ts")) {
      // El mensaje de Zod: último argumento (`.min(1, "required")`) o el de z.number("…") / .int("…").
      for (const m of code.matchAll(/,\s*"(\w+)"\)|\.(?:number|int)\(\s*"(\w+)"\)/g)) validation.add((m[1] ?? m[2])!);
    }
  }
  return { keys, validation };
}

/** Las que se montan al vuelo (periodicidad) y las del título de la página y de la pestaña. */
const DYNAMIC_KEYS = ["infrastructure.renewals.intervals.monthly", "infrastructure.renewals.intervals.yearly", "infrastructure.tab", "finance.title"];

describe("textos de Infraestructura", () => {
  const esKeys = flatten(OWN.es).sort();

  it("el catalán y el inglés están completos: las mismas claves que el español, ni una más", () => {
    expect(esKeys.length).toBeGreaterThan(60);
    expect(flatten(OWN.ca).sort()).toEqual(esKeys);
    expect(flatten(OWN.en).sort()).toEqual(esKeys);
  });

  it("cada clave que usa el código existe en los tres idiomas", () => {
    const { keys } = scannedKeys();
    // El escáner encuentra las claves de verdad (si dejara de hacerlo, este test no probaría nada).
    expect(keys.size).toBeGreaterThan(50);
    expect(keys).toContain("infrastructure.renewals.days");
    expect(keys).toContain("infrastructure.hosting.noShared");
    expect(keys).toContain("infrastructure.settings.monthlyMinHint");
    const used = [...keys, ...DYNAMIC_KEYS];
    for (const locale of LOCALES) {
      const errors: string[] = [];
      const own = translator(OWN[locale], locale, errors);
      const all = translator(ALL[locale], locale, errors);
      const missing = used.filter((key) => !(key.startsWith("infrastructure.") ? own.has(key) : all.has(key)));
      expect(missing, locale).toEqual([]);
    }
  });

  it("los mensajes del esquema tienen su texto (infrastructure.validation.*)", () => {
    const { validation } = scannedKeys();
    expect([...validation].sort()).toEqual(["amount", "required", "warningDays"]);
    for (const locale of LOCALES) {
      const errors: string[] = [];
      const own = translator(OWN[locale], locale, errors);
      expect([...validation].filter((m) => !own.has(`infrastructure.validation.${m}`)), locale).toEqual([]);
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

  it("plurales y formatos", () => {
    const errors: string[] = [];
    const es = translator(OWN.es, "es", errors);
    const ca = translator(OWN.ca, "ca", errors);
    const en = translator(OWN.en, "en", errors);
    expect(es("infrastructure.renewals.days", { days: 0 })).toBe("hoy");
    expect(es("infrastructure.renewals.days", { days: 1 })).toBe("mañana");
    expect(es("infrastructure.renewals.days", { days: 8 })).toBe("en 8 días");
    expect(ca("infrastructure.renewals.days", { days: 8 })).toBe("d'aquí a 8 dies");
    expect(en("infrastructure.renewals.days", { days: 1 })).toBe("tomorrow");
    expect(es("infrastructure.summary.monthlyHint", { count: 1 })).toBe("1 suscripción en marcha");
    expect(en("infrastructure.summary.perSiteHint", { count: 0 })).toBe("No active hosted websites");
    expect(ca("infrastructure.hosting.summary", { count: 3, amount: "90 €" })).toBe("3 webs allotjades · 90 € al mes");
    expect(es("infrastructure.summary.dueSoonHint", { days: 1 })).toBe("Con aviso hoy o mañana");
    expect(es("infrastructure.summary.dueSoonHint", { days: 14 })).toBe("Con aviso en los próximos 14 días");
    expect(errors).toEqual([]);
  });
});

describe("aviso de renovación de una suscripción (bandeja y push)", () => {
  const fmt = { date: (civil: string) => `«${civil}»`, money: (cents: number) => `${cents / 100} €` };

  it("tiene su texto y su título en los tres idiomas, y se formatea con sus parámetros", () => {
    const errors: string[] = [];
    for (const locale of LOCALES) {
      const t = translator(CORE[locale], locale, errors);
      expect(t.has("push.titles.subscription_renewal"), locale).toBe(true);
      for (const days of [14, 1, 0]) {
        const params = { name: "Dominio hotelllevant.com", date: "2026-10-05", days, amount_cents: 1815 };
        const key = `inbox.kinds.${notificationMessageKey("subscription_renewal", params)}`;
        expect(t.has(key), `${locale}:${key}`).toBe(true);
        const text = t(key, notificationValues(params, fmt));
        expect(text, `${locale}:${days}`).not.toMatch(/[{}]/);
        expect(text).toContain("Dominio hotelllevant.com");
        expect(text).toContain("18.15 €");
        expect(text).toContain("«2026-10-05»");
      }
    }
    expect(errors).toEqual([]);
  });

  it("dice cuándo", () => {
    const errors: string[] = [];
    const es = translator(CORE.es, "es", errors);
    const text = (days: number) =>
      es("inbox.kinds.subscription_renewal", notificationValues({ name: "Servidor", date: "2026-10-05", days, amount_cents: 7260 }, fmt));
    expect(text(8)).toBe("«Servidor» se renueva en 8 días («2026-10-05»): 72.6 €.");
    expect(text(0)).toContain("se renueva hoy");
    expect(text(1)).toContain("se renueva mañana");
    expect(errors).toEqual([]);
  });
});
