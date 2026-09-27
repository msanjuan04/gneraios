// Clasificación de las líneas de facturas históricas (ARCHITECTURE.md §7.8 y §15): sin contratos
// detrás, lo recurrente, lo puntual y el uso se distinguen por palabras clave del concepto. Cada
// línea lleva la regla que ha decidido, para que la simulación la enseñe y el socio la corrija.

import { normalizeKey } from "./text";

export type ImportBillingType = "one_off" | "monthly" | "yearly" | "usage";
export type RevenueCategory = "recurring" | "one_off" | "usage";

export type ClassificationSource = "column" | "keyword" | "default" | "manual";

export type LineClassification = {
  billingType: ImportBillingType;
  category: RevenueCategory;
  source: ClassificationSource;
  /** Regla que ha decidido (id estable para i18n) y la palabra que ha coincidido. */
  rule: { id: string; keyword: string } | null;
  /** Ha coincidido a la vez con palabras de recurrente y de uso: conviene revisarla. */
  ambiguous: boolean;
};

export function categoryOf(type: ImportBillingType): RevenueCategory {
  return type === "monthly" || type === "yearly" ? "recurring" : type;
}

type Rule = {
  id: string;
  type: ImportBillingType;
  /** "strong": la periodicidad explícita ("mensual", "anual") manda sobre todo lo demás. */
  strength: "strong" | "normal" | "weak";
  /** Palabras o expresiones (en forma de clave) que deben aparecer como palabras enteras; "*" al final = prefijo. */
  keywords: readonly string[];
};

/**
 * Reglas por orden de prioridad (gana la primera que coincide). La periodicidad explícita va
 * primero; después el uso (375 €/campaña), los servicios recurrentes y, al final, lo puntual,
 * que es lo que queda: "mantenimiento web" es recurrente aunque diga "web".
 */
export const CLASSIFICATION_RULES: readonly Rule[] = [
  {
    id: "monthly_period",
    type: "monthly",
    strength: "strong",
    keywords: ["mensual*", "mensualidad*", "mensualitat*", "al mes", "por mes", "cada mes", "per mes", "monthly", "per month", "a month", "retainer"],
  },
  {
    id: "yearly_period",
    type: "yearly",
    strength: "strong",
    keywords: ["anual*", "anualidad*", "anualitat*", "al ano", "por ano", "cada ano", "annual*", "yearly", "per year", "a year", "renovacion anual"],
  },
  {
    id: "one_off_explicit",
    type: "one_off",
    strength: "strong",
    keywords: ["cuota de alta", "alta inicial", "pago unico", "pagament unic", "unica vez", "setup fee", "one off", "puntual"],
  },
  {
    id: "usage_campaign",
    type: "usage",
    strength: "normal",
    keywords: ["campana*", "campany*", "campaign*", "horas extra", "horas adicionales", "hores extra", "extra hours", "por uso", "per us", "por unidad"],
  },
  {
    id: "yearly_hosting",
    type: "yearly",
    strength: "normal",
    keywords: ["hosting", "alojamiento", "allotjament", "dominio*", "domini", "dominis", "domain*", "certificado ssl", "ssl"],
  },
  {
    id: "monthly_service",
    type: "monthly",
    strength: "normal",
    keywords: [
      "mantenimiento", "manteniment", "maintenance", "cuota*", "quota*", "fee", "suscripcion*", "subscripcio*",
      "subscription*", "licencia*", "llicencia*", "license*", "licence*", "soporte", "suport", "support",
      "gestion de redes", "gestion redes", "gestio de xarxes", "community manager", "community management",
      "gestion de ads", "gestion ads", "gestion meta ads", "gestion google ads", "iguala",
    ],
  },
  {
    id: "one_off_project",
    type: "one_off",
    strength: "weak",
    keywords: [
      "web", "website", "pagina web", "landing*", "tienda online", "ecommerce", "e commerce", "diseno*", "disseny*",
      "design*", "desarrollo*", "desenvolupament*", "development", "rebranding", "branding", "logo*", "identidad",
      "identitat", "app", "aplicacion", "aplicacio", "setup", "alta", "puesta en marcha", "implantacion",
      "implementacion", "implementacio", "migracion", "migracio", "migration", "auditoria", "audit", "consultoria",
      "formacion", "formacio", "training", "video*", "dron", "drone", "fotografia", "photography", "sesion de fotos",
      "proyecto", "projecte", "project",
    ],
  },
];

function matches(text: string, keyword: string): boolean {
  const padded = ` ${text} `;
  if (keyword.endsWith("*")) {
    const stem = keyword.slice(0, -1);
    return padded.includes(` ${stem}`);
  }
  return padded.includes(` ${keyword} `);
}

function firstMatch(text: string, rule: Rule): string | null {
  for (const keyword of rule.keywords) if (matches(text, keyword)) return keyword.replace(/\*$/, "");
  return null;
}

/**
 * Tipo de facturación de una línea por su concepto. Sin ninguna palabra clave, puntual y sin regla
 * (la simulación lo marca para revisar). "Ambigua" si coinciden a la vez el uso y un servicio
 * recurrente sin periodicidad explícita ("gestión de campañas").
 */
export function classifyLine(description: string): LineClassification {
  const text = normalizeKey(description);
  let winner: { rule: Rule; keyword: string } | null = null;
  const categories = new Set<RevenueCategory>();
  for (const rule of CLASSIFICATION_RULES) {
    const keyword = firstMatch(text, rule);
    if (!keyword) continue;
    if (rule.strength !== "weak") categories.add(categoryOf(rule.type));
    winner ??= { rule, keyword };
  }
  if (!winner) return { billingType: "one_off", category: "one_off", source: "default", rule: null, ambiguous: false };
  const ambiguous = winner.rule.strength !== "strong" && categories.has("recurring") && categories.has("usage");
  return {
    billingType: winner.rule.type,
    category: categoryOf(winner.rule.type),
    source: "keyword",
    rule: { id: winner.rule.id, keyword: winner.keyword },
    ambiguous,
  };
}

const COLUMN_VALUES: [RegExp, ImportBillingType, string][] = [
  [/^(mensual|mensualidad|mes|monthly|month|recurrente|recurrent|recurring|recurrente mensual)$/, "monthly", "column_monthly"],
  [/^(trimestral|quarterly|semestral|semiannual|bimestral)$/, "monthly", "column_quarterly"],
  [/^(anual|anualidad|ano|yearly|annual|year|anyal)$/, "yearly", "column_yearly"],
  [/^(unica|unico|puntual|one off|oneoff|one_off|unique|once|proyecto|projecte|setup)$/, "one_off", "column_one_off"],
  [/^(uso|us|usage|variable|por uso|consumo|campana)$/, "usage", "column_usage"],
];

/**
 * Valor de una columna de periodicidad (la `recurrence` de gnerai-finance: unique / monthly /
 * quarterly / annual, o "mensual", "anual", "puntual", "uso"). Trimestral y semestral cuentan como
 * recurrentes (mensual): el tipo de línea no tiene otra periodicidad.
 */
export function classifyFromColumn(value: string): LineClassification | null {
  const key = normalizeKey(value);
  if (key === "") return null;
  for (const [pattern, type, id] of COLUMN_VALUES) {
    if (pattern.test(key)) {
      return { billingType: type, category: categoryOf(type), source: "column", rule: { id, keyword: value.trim() }, ambiguous: false };
    }
  }
  return null;
}

/** La que ha elegido el socio en la simulación: manda sobre las reglas. */
export function manualClassification(type: ImportBillingType): LineClassification {
  return { billingType: type, category: categoryOf(type), source: "manual", rule: null, ambiguous: false };
}
