// Textos de un evento: el mismo resumen en la pantalla, en la tarjeta del dashboard y en el ICS.
// Puro: recibe la función de traducción (`calendar.*`), así que no depende de next-intl.

import type { CalendarEvent, CalendarFactKey, FiscalPeriod } from "./types";

/** Traductor del espacio `calendar` (el `t` de next-intl o de createTranslator). */
export type Translate = (key: string, values?: Record<string, string | number>) => string;

export function fiscalPeriodLabel(period: FiscalPeriod, t: Translate): string {
  if (period.kind === "quarter") return t("fiscal.period.quarter", { quarter: period.quarter, year: period.year });
  if (period.kind === "installment") return t("fiscal.period.installment", { index: period.index, year: period.year });
  return t("fiscal.period.year", { year: period.year });
}

function fiscalPeriodOf(event: CalendarEvent): FiscalPeriod | null {
  for (const fact of event.facts) if (fact.type === "fiscalPeriod") return fact.value;
  return null;
}

function textFact(event: CalendarEvent, key: CalendarFactKey): string | null {
  for (const fact of event.facts) if (fact.type === "text" && fact.key === key) return fact.value;
  return null;
}

const CONTRACT_KINDS: Record<string, string> = {
  start: "summary.contractStart",
  change: "summary.contractChange",
  end: "summary.contractEnd",
  cancel: "summary.contractCancel",
};

/** Lo que se lee primero: qué pasa y con quién ("Cobro · Clínica Dental", "Modelo 303 · IVA"). */
export function eventSummary(event: CalendarEvent, t: Translate): string {
  const client = event.subtitle ?? "";
  switch (event.type) {
    case "collection":
      return t("summary.collection", { client });
    case "issued":
      return t(event.kind === "rectifying" ? "summary.issuedRectifying" : "summary.issued", { client });
    case "reminder":
      return t("summary.reminder", { client: client || event.title });
    case "billing":
      return t("summary.billing", { client });
    case "renewal":
      return t("summary.renewal", { line: event.title });
    case "milestone":
      return t("summary.milestone", { label: event.title });
    case "contract":
      return t(CONTRACT_KINDS[event.kind ?? ""] ?? "summary.contractStart", { client });
    case "deal":
      return event.title ? event.title : t("summary.dealNoAction", { deal: event.subtitle ?? "" });
    case "task":
      return event.kind === "project" ? t("summary.projectDue", { project: event.title }) : event.title;
    case "quote":
      return t(event.kind === "expired" ? "summary.quoteExpired" : "summary.quote", { title: event.title });
    case "fiscal":
      return event.kind === "verifactu"
        ? t("summary.verifactu")
        : t("summary.fiscal", { model: event.kind ?? event.title, name: t(`fiscal.models.m${event.kind ?? event.title}.short`) });
    case "meeting":
    case "appointment":
      return event.title;
  }
}

/** La segunda línea: el documento o el contexto ("2026-0012", "3T 2026 · GNERAI SL"). */
export function eventDetail(event: CalendarEvent, t: Translate): string | null {
  switch (event.type) {
    case "collection":
    case "issued":
    case "reminder":
      return event.title || null;
    case "billing":
    case "contract":
      return event.title;
    case "fiscal": {
      const period = fiscalPeriodOf(event);
      return [period ? fiscalPeriodLabel(period, t) : null, event.subtitle].filter(Boolean).join(" · ") || null;
    }
    case "deal":
      return event.title ? event.subtitle : null;
    case "task":
      // Una tarea: su proyecto y su cliente. Una entrega: el cliente (nada si es interno).
      return event.kind === "project" ? event.subtitle : [event.subtitle, textFact(event, "client")].filter(Boolean).join(" · ") || null;
    case "renewal":
    case "milestone":
    case "quote":
    case "meeting":
      return event.subtitle;
    case "appointment":
      return event.description ?? null;
  }
}
