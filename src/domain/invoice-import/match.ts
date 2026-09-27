// Lo leído del PDF frente a lo que ya hay en la org: qué emisor la emitió (por su NIF), qué cliente
// es (por NIF o, si no lo tiene, por nombre), en qué serie encaja el número (su formato) y qué tipos
// de IVA e IRPF de la org corresponden a los impresos.

import { type CivilDate, parseCivilDate } from "../dates/civil-date";
import { formatHasYear, parseInvoiceNumber } from "../dataio/invoice-number";
import { normalizeKey } from "../dataio/text";
import type { VatRegime } from "../tax";
import { validateSpanishTaxId } from "../tax-id";
import type { Confidence, ExtractedInvoice, ExtractedParty } from "./types";

export type SetupIssuer = {
  id: string;
  name: string;
  legalName: string;
  taxId: string | null;
  kind: "company" | "self_employed";
  activeFrom: CivilDate | null;
  activeUntil: CivilDate | null;
  archived: boolean;
  isPrimary: boolean;
  defaultIrpfBps: number;
};

export type SetupSeries = {
  id: string;
  issuerId: string;
  code: string;
  name: string;
  format: string;
  resetYearly: boolean;
  isDefault: boolean;
  archived: boolean;
};

export type SetupTaxRate = {
  id: string;
  name: string;
  rateBps: number;
  regime: VatRegime | null;
  legalNote: string | null;
  isDefault: boolean;
};

export type SetupClient = {
  id: string;
  name: string;
  legalName: string | null;
  taxId: string | null;
  paymentTermsDays: number | null;
};

/** Lo que el panel de importar necesita saber de la org (lo carga el servidor con RLS). */
export type ImportSetup = {
  today: CivilDate;
  orgPaymentTermsDays: number;
  issuers: SetupIssuer[];
  /** Series de facturas ordinarias (las rectificativas no se importan desde PDF). */
  series: SetupSeries[];
  vatRates: SetupTaxRate[];
  irpfRates: SetupTaxRate[];
  clients: SetupClient[];
  /** Mandatos SEPA activos: el cliente paga por domiciliación con ese emisor. */
  mandates: { clientId: string; issuerId: string }[];
};

/** Un NIF como se compara: solo letras y números, sin el «ES» del IVA intracomunitario. */
export function taxIdKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const key = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (key === "") return null;
  if (key.startsWith("ES") && validateSpanishTaxId(key.slice(2)).valid) return key.slice(2);
  return key;
}

export type IssuerMatch = { issuerId: string | null; confidence: Confidence; swapped: boolean };

/**
 * El emisor: el de la org cuyo NIF sale en la factura como emisor (seguro) o, si el lector los ha
 * cruzado, como cliente. Sin NIF que coincida, el único activo o el principal (a revisar).
 */
export function matchIssuer(extraction: Pick<ExtractedInvoice, "issuer" | "recipient">, setup: Pick<ImportSetup, "issuers">): IssuerMatch {
  const byTaxId = (party: ExtractedParty) => {
    const key = taxIdKey(party.taxId?.value);
    return key ? (setup.issuers.find((i) => taxIdKey(i.taxId) === key) ?? null) : null;
  };
  const direct = byTaxId(extraction.issuer);
  if (direct) return { issuerId: direct.id, confidence: "high", swapped: false };
  const crossed = byTaxId(extraction.recipient);
  if (crossed) return { issuerId: crossed.id, confidence: "medium", swapped: true };
  const active = setup.issuers.filter((i) => !i.archived);
  if (active.length === 1) return { issuerId: active[0]!.id, confidence: "low", swapped: false };
  const primary = active.find((i) => i.isPrimary) ?? active[0] ?? null;
  return { issuerId: primary?.id ?? null, confidence: "low", swapped: false };
}

export type ClientMatch = { clientId: string; confidence: Confidence; by: "taxId" | "name" };

/** El cliente: por NIF; si la factura no lo trae (o no coincide), por nombre exacto y único. */
export function matchClient(party: ExtractedParty, setup: Pick<ImportSetup, "clients">): ClientMatch | null {
  const key = taxIdKey(party.taxId?.value);
  if (key) {
    const found = setup.clients.find((c) => taxIdKey(c.taxId) === key);
    if (found) return { clientId: found.id, confidence: "high", by: "taxId" };
  }
  const name = party.name?.value ? normalizeKey(party.name.value) : "";
  if (!name) return null;
  const byName = setup.clients.filter((c) => normalizeKey(c.name) === name || (c.legalName !== null && normalizeKey(c.legalName) === name));
  // Mismo nombre pero otro NIF: no es el mismo cliente.
  const compatible = byName.filter((c) => !key || !c.taxId || taxIdKey(c.taxId) === key);
  return compatible.length === 1 ? { clientId: compatible[0]!.id, confidence: "medium", by: "name" } : null;
}

export type SeriesMatch = { seriesId: string; number: string; sequence: number; year: number };

const yearOf = (date: string | null | undefined, today: CivilDate) => {
  try {
    return parseCivilDate(date || today).year;
  } catch {
    return parseCivilDate(today).year;
  }
};

/**
 * La serie del emisor en cuyo formato encaja el número (primero la de por defecto, las archivadas al
 * final: un histórico puede ser de una serie antigua). Si la factura imprime la serie aparte
 * («Serie A · Nº 42»), se prueba también con ella delante.
 */
export function matchSeries(
  input: { number: string; issuerId: string; issuedOn: string | null; seriesCode?: string | null },
  setup: Pick<ImportSetup, "series" | "today">,
): SeriesMatch | null {
  const number = input.number.trim();
  if (!number) return null;
  const year = yearOf(input.issuedOn, setup.today);
  const candidates = setup.series
    .filter((s) => s.issuerId === input.issuerId)
    .sort((a, b) => Number(a.archived) - Number(b.archived) || Number(b.isDefault) - Number(a.isDefault));
  const code = input.seriesCode?.trim().toUpperCase() ?? "";
  const variants = code && !number.toUpperCase().startsWith(code) ? [number, `${code}${number}`, `${code}-${number}`, `${code}/${number}`] : [number];
  const tryWith = (pool: readonly SetupSeries[], texts: readonly string[]): SeriesMatch | null => {
    for (const text of texts) {
      for (const series of pool) {
        const parsed = parseInvoiceNumber(series.format, text, year);
        if (parsed) return { seriesId: series.id, number: text, sequence: parsed.sequence, year: parsed.year };
      }
    }
    return null;
  };
  // Primero la serie impresa (si la hay), después cualquiera del emisor.
  const printed = code ? candidates.filter((s) => s.code.toUpperCase() === code) : [];
  return (printed.length > 0 ? tryWith(printed, variants) : null) ?? tryWith(candidates, [number]) ?? tryWith(candidates, variants);
}

/**
 * El formato de serie que sigue un número, para crear la serie si no existe: el año (con 4 o 2
 * cifras) y la secuencia (con sus ceros): «2025-0042» → `{yyyy}-{n:4}`, «MS-2025/007» →
 * `MS-{yyyy}/{n:3}`, «F25/12» → `F{yy}/{n}`. null si no se ve una secuencia.
 */
export function suggestSeriesFormat(number: string, year: number): string | null {
  const text = number.trim();
  const runs = [...text.matchAll(/\d+/g)];
  if (runs.length === 0) return null;
  const escape = (s: string) => s.replace(/[{}]/g, "");
  const sequence = runs.at(-1)!;
  let format = "";
  let last = 0;
  let usedYear = false;
  for (const run of runs) {
    const value = run[0];
    const start = run.index;
    let token: string | null = null;
    if (run === sequence) {
      token = value.length > 1 && value.startsWith("0") ? `{n:${value.length}}` : "{n}";
    } else if (!usedYear && value === String(year)) {
      token = "{yyyy}";
      usedYear = true;
    } else if (!usedYear && value.length === 2 && value === String(year).slice(-2)) {
      token = "{yy}";
      usedYear = true;
    } else if (!usedYear && value.length >= 6 && value.startsWith(String(year))) {
      // «2025042»: el año pegado a la secuencia (solo si la secuencia es la última racha).
      continue;
    }
    format += escape(text.slice(last, start)) + (token ?? value);
    last = start + value.length;
  }
  format += escape(text.slice(last));
  if (!format.includes("{n")) return null;
  const parsed = parseInvoiceNumber(format, text, year);
  return parsed ? format : null;
}

/** ¿El formato lleva el año? (Entonces el número dice de qué año es.) */
export const seriesHasYear = formatHasYear;

/** El tipo de IVA de la org con ese porcentaje y régimen (el de por defecto primero). */
export function matchVatRate(bps: number | null, regime: VatRegime | null, setup: Pick<ImportSetup, "vatRates">): SetupTaxRate | null {
  if (bps === null) return setup.vatRates.find((r) => r.isDefault) ?? setup.vatRates[0] ?? null;
  const wanted: VatRegime = bps > 0 ? "general" : (regime ?? "exempt");
  const same = setup.vatRates.filter((r) => r.rateBps === bps && (r.regime ?? "general") === wanted);
  const byRate = same.length > 0 ? same : setup.vatRates.filter((r) => r.rateBps === bps);
  return byRate.find((r) => r.isDefault) ?? byRate[0] ?? null;
}
