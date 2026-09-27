import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { SITE_THRESHOLD_LIMITS } from "@/app/[org]/settings/schema";
import { notificationMessageKey, notificationValues } from "@/domain/notifications/text";
import { CHECK_ERRORS, SITE_STATUSES } from "@/domain/sites";
import caCore from "@/i18n/messages/ca/core.json";
import caAll from "@/i18n/messages/ca/index";
import caSites from "@/i18n/messages/ca/sites.json";
import enCore from "@/i18n/messages/en/core.json";
import enAll from "@/i18n/messages/en/index";
import enSites from "@/i18n/messages/en/sites.json";
import esCore from "@/i18n/messages/es/core.json";
import esAll from "@/i18n/messages/es/index";
import esSites from "@/i18n/messages/es/sites.json";
import type { Messages } from "@/i18n/messages/merge";
import { SITES_FILTERS } from "./filters";

// Los textos de Webs (sites.json) y sus avisos (core.json: inbox.kinds.*, push.titles.*). Las claves
// que usa el código se sacan leyendo el código (así, una clave nueva sin traducir hace fallar el
// test) y, las que se montan al vuelo, de las mismas constantes del dominio que las montan.

type Locale = "es" | "ca" | "en";
const LOCALES: Locale[] = ["es", "ca", "en"];
const SITES = { es: esSites, ca: caSites, en: enSites } as Record<Locale, Messages>;
const CORE = { es: esCore, ca: caCore, en: enCore } as Record<Locale, Messages>;
/** El catálogo entero de cada idioma, sin caer al español: lo que falte aquí se vería en español. */
const ALL = { es: esAll, ca: caAll, en: enAll } as Record<Locale, Messages>;

const ROOT = join(import.meta.dirname, "../../..");
const SOURCE_DIRS = ["src/app/[org]/sites", "src/components/sites", "src/server/sites"];

/** Todos los parámetros que usan los textos de Webs y de sus avisos. */
const PARAMS: Record<string, string | number> = {
  count: 2,
  name: "Clínica Mar Blau",
  site: "Clínica Mar Blau",
  time: "412 ms",
  reason: "HTTP 503",
  since: "hace 12 min",
  url: "https://clinicamarblau.com",
  max: 200,
  min: 1,
  add: 3,
  known: 1,
  invalid: 1,
  status: 503,
  value: "3 s",
  day: "26 sept 2026, 10:00",
  end: "11:00",
  ok: 11,
  total: 12,
  duration: "1 h 35 min",
  date: "10 oct 2026",
  month: "99,95 %",
  blips: 1,
  error: "timeout",
  days: 14,
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
 * Las claves que usa el código de Webs: cada `t("…")` (también `t(cond ? "a" : "b")`) con el
 * espacio de nombres de su `useTranslations`/`getTranslations` más reciente, las de las acciones
 * (`failure("…")`, los `return "…"` de errors.ts) y los mensajes de los esquemas (sites.validation.*).
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
    for (const m of code.matchAll(/\(await getTranslations\("([^"]+)"\)\)\("([^"]+)"\)/g)) keys.add(`${m[1]}.${m[2]}`);
    for (const m of code.matchAll(/\bfailure\(\s*"([^"]+)"/g)) keys.add(m[1]!);
    if (file.endsWith("errors.ts")) for (const m of code.matchAll(/return\s+"([a-z]+\.[A-Za-z0-9_.]+)"/g)) keys.add(m[1]!);
    if (file.endsWith("schema.ts")) {
      // El mensaje de Zod: último argumento (`.min(1, "required")`) o el de z.number("…") / .int("…").
      for (const m of code.matchAll(/,\s*"(\w+)"\)|\.(?:number|int)\(\s*"(\w+)"\)/g)) validation.add((m[1] ?? m[2])!);
    }
  }
  return { keys, validation };
}

/** Las que se montan al vuelo: estados, fallos, filtros, umbrales y unidades; y el título de las páginas. */
function dynamicKeys(): string[] {
  return [
    ...SITE_STATUSES.map((s) => `sites.status.${s}`),
    ...CHECK_ERRORS.map((e) => `sites.errors.${e}`),
    ...SITES_FILTERS.map((f) => `sites.filters.${f}`),
    ...Object.keys(SITE_THRESHOLD_LIMITS).flatMap((k) => [`sites.thresholds.${k}.label`, `sites.thresholds.${k}.hint`]),
    ...["days", "ms", "checks"].map((u) => `sites.thresholds.units.${u}`),
    "nav.sites",
  ];
}

const ALERT_KINDS = ["site_down", "site_up", "ssl_expiring", "domain_expiring"] as const;

describe("textos de Webs", () => {
  const esKeys = flatten(SITES.es).sort();

  it("el catalán y el inglés están completos: las mismas claves que el español, ni una más", () => {
    expect(esKeys.length).toBeGreaterThan(100);
    expect(flatten(SITES.ca).sort()).toEqual(esKeys);
    expect(flatten(SITES.en).sort()).toEqual(esKeys);
  });

  it("cada clave que usa el código existe en los tres idiomas", () => {
    const { keys } = scannedKeys();
    // El escáner encuentra las claves de verdad (si dejara de hacerlo, este test no probaría nada).
    expect(keys.size).toBeGreaterThan(150);
    expect(keys).toContain("sites.sheet.urlNormalized");
    expect(keys).toContain("sites.detail.expiredOn");
    expect(keys).toContain("sites.errors.notFound");
    const used = [...keys, ...dynamicKeys()];
    for (const locale of LOCALES) {
      const errors: string[] = [];
      const own = translator(SITES[locale], locale, errors);
      const all = translator(ALL[locale], locale, errors);
      const missing = used.filter((key) => !(key.startsWith("sites.") ? own.has(key) : all.has(key)));
      expect(missing, locale).toEqual([]);
    }
  });

  it("los mensajes de los esquemas tienen su texto (sites.validation.* o validation.*)", () => {
    const { validation } = scannedKeys();
    expect(validation).toContain("url");
    expect(validation).toContain("thresholdRange");
    for (const locale of LOCALES) {
      const errors: string[] = [];
      const own = translator(SITES[locale], locale, errors);
      const all = translator(ALL[locale], locale, errors);
      const missing = [...validation].filter((m) => !own.has(`sites.validation.${m}`) && !all.has(`validation.${m}`));
      expect(missing, locale).toEqual([]);
    }
  });

  it("todo el ICU se formatea en los tres idiomas, sin claves ni llaves a la vista", () => {
    const errors: string[] = [];
    for (const locale of LOCALES) {
      const t = translator(SITES[locale], locale, errors);
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
    const es = translator(SITES.es, "es", errors);
    const ca = translator(SITES.ca, "ca", errors);
    const en = translator(SITES.en, "en", errors);
    expect(es("sites.bulk.submit", { count: 0 })).toBe("Añadir");
    expect(es("sites.bulk.submit", { count: 1 })).toBe("Añadir 1 web");
    expect(ca("sites.bulk.submit", { count: 3 })).toBe("Afegeix 3 webs");
    expect(en("sites.bulk.submit", { count: 3 })).toBe("Add 3 websites");
    expect(ca("sites.actions.checkNow")).toBe("Comprova-ho ara");
    expect(ca("sites.sheet.save")).toBe("Desa");
    expect(es("sites.detail.daysLeft", { count: 0 })).toBe("Hoy");
    expect(en("sites.detail.daysLeft", { count: 1 })).toBe("1 day");
    expect(es("sites.detail.incidents.summary", { count: 2, blips: 0 })).toBe("2 caídas en 7 días");
    expect(es("sites.detail.incidents.summary", { count: 1, blips: 3 })).toBe("1 caída en 7 días · 3 fallos sueltos");
    expect(ca("sites.bulk.previewSummary", { add: 1, known: 2, invalid: 0 })).toBe("1 nova · 2 ja vigilades · 0 no vàlides");
    expect(en("sites.sheet.clientSuggestion", { name: "Hotel Llevant" })).toBe("Is it Hotel Llevant's? Choose it");
    expect(ca("sites.list.hostedByUs")).toBe("L'allotgem nosaltres");
    expect(errors).toEqual([]);
  });
});

describe("avisos de Webs (bandeja y push)", () => {
  const cases: { kind: (typeof ALERT_KINDS)[number]; params: Record<string, string | number> }[] = [
    ...CHECK_ERRORS.map((error) => ({ kind: "site_down" as const, params: { site: "Clínica", error, status: error === "http" ? 503 : 0 } })),
    { kind: "site_up", params: { site: "Clínica", minutes: 95 } },
    ...[14, 1, 0, -1].map((days) => ({ kind: "ssl_expiring" as const, params: { site: "Clínica", days, date: "2026-10-10" } })),
    ...[30, 1, 0, -6].map((days) => ({ kind: "domain_expiring" as const, params: { site: "Clínica", days, date: "2026-10-26" } })),
  ];
  const fmt = { date: (civil: string) => `«${civil}»`, money: (cents: number) => `${cents / 100} €` };

  it("cada aviso tiene su texto y su título en los tres idiomas, y se formatea", () => {
    const errors: string[] = [];
    for (const locale of LOCALES) {
      const t = translator(CORE[locale], locale, errors);
      for (const kind of ALERT_KINDS) expect(t.has(`push.titles.${kind}`), `${locale}:${kind}`).toBe(true);
      for (const { kind, params } of cases) {
        const key = `inbox.kinds.${notificationMessageKey(kind, params)}`;
        expect(t.has(key), `${locale}:${key}`).toBe(true);
        const text = t(key, notificationValues(params, fmt));
        expect(text, `${locale}:${key}`).not.toMatch(/[{}]/);
        expect(text, `${locale}:${key}`).toContain("Clínica");
      }
    }
    expect(errors).toEqual([]);
  });

  it("dicen lo que ha pasado", () => {
    const errors: string[] = [];
    const es = translator(CORE.es, "es", errors);
    const en = translator(CORE.en, "en", errors);
    const text = (t: LooseTranslator, kind: string, params: Record<string, string | number>) =>
      t(`inbox.kinds.${notificationMessageKey(kind, params)}`, notificationValues(params, fmt));
    expect(text(es, "site_down", { site: "Clínica", error: "http", status: 503 })).toBe("La web Clínica está caída: responde con el error 503.");
    expect(text(en, "site_down", { site: "Clínica", error: "dns", status: 0 })).toBe("Clínica is down: the domain doesn't resolve.");
    expect(text(es, "site_up", { site: "Clínica", minutes: 95 })).toBe("La web Clínica vuelve a funcionar (ha estado caída 1 h 35 min).");
    expect(text(es, "ssl_expiring", { site: "Clínica", days: 0, date: "2026-10-10" })).toContain("caduca hoy («2026-10-10»)");
    expect(text(es, "ssl_expiring", { site: "Clínica", days: -1, date: "2026-10-10" })).toBe(
      "El certificado SSL de Clínica caducó el «2026-10-10»: los navegadores avisan de que la web no es segura.",
    );
    expect(text(en, "domain_expiring", { site: "Clínica", days: 12, date: "2026-10-08" })).toContain("expires in 12 days");
    expect(errors).toEqual([]);
  });
});
