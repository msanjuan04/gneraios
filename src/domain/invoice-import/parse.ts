// Lector de facturas españolas a partir del texto de su PDF (sin inteligencia artificial): número y
// serie, fechas (expedición, operación, vencimiento y cobro), emisor y cliente con su NIF, base, IVA,
// IRPF, total, las líneas si hay una tabla reconocible, la forma de pago y si ya estaba cobrada.
// Cada dato sale con lo seguro que es (types.ts). Nunca inventa: lo que no encuentra queda vacío.
//
// Cómo lee: primero reconoce los valores por su forma (tokens.ts: fechas, importes, porcentajes,
// NIF) y después busca su etiqueta a la izquierda o encima (labels.ts, document.ts). El número de
// factura, que no tiene una forma propia, se busca al revés: la etiqueta y lo que la sigue.

import type { CivilDate } from "../dates/civil-date";
import { parseCountry, parsePaymentMethod, type PaymentMethod } from "../dataio/values";
import { applyBps } from "../money";
import type { VatRegime } from "../tax";
import { cellAt, cellInColumn, type DocLine, type FoundLabel, labelFor, linesAbove, readDocument, valuesAfterLabel } from "./document";
import { labelAt, type LabelKind, wholeLabel } from "./labels";
import { findLineTable, readTableLines } from "./table";
import { cleanValue, foldSameLength, overlaps } from "./text";
import { findDates, findNumbers, percentToBps, type Span, type TaxIdToken } from "./tokens";
import {
  type Confidence,
  emptyExtraction,
  emptyParty,
  type ExtractedInvoice,
  type ExtractedLine,
  type ExtractedParty,
  type ExtractionHints,
  type ExtractionWarning,
  type Field,
  field,
  minConfidence,
} from "./types";

/** Tipos de IVA e IRPF con los que se reconoce un tipo deducido de los importes. */
const VAT_RATES = [2100, 1000, 400, 500, 0] as const;
const IRPF_RATES = [1500, 700, 1900, 1800, 2100, 900, 100, 200, 2400] as const;

type Scope = { lines: readonly DocLine[]; inTableBody: (index: number) => boolean };

// ---------------------------------------------------------------------------
// Número y serie
// ---------------------------------------------------------------------------

const NUMBER_TOKEN = /^[\s:.#º°=-]*(?:n[º°o.]+\s*)?([\p{L}\p{N}][\p{L}\p{N}\-/._]*)/iu;

/** El número de factura con el que empieza un texto: con alguna cifra, que no sea una fecha ni un importe. */
export function readInvoiceNumber(text: string): string | null {
  if (/^[\s:.#=-]*-?\d{1,3}(?:\.\d{3})*,\d{2}\b/.test(text)) return null;
  const match = NUMBER_TOKEN.exec(text);
  if (!match) return null;
  const token = match[1]!.replace(/[.\-/_]+$/, "");
  if (token.length === 0 || token.length > 30 || !/\d/.test(token)) return null;
  if (findDates(token).length > 0) return null;
  if (/^\d{1,3}(?:\.\d{3})*,\d{2}$|^\d+[.,]\d{2}$/.test(token)) return null;
  return token;
}

function readSeries(text: string): string | null {
  const match = /^[\s:.#=-]*([\p{L}\p{N}][\p{L}\p{N}-]{0,11})\b/u.exec(text);
  return match ? match[1]!.toUpperCase() : null;
}

function findNumber(scope: Scope): { number: Field<string> | null; series: Field<string> | null } {
  let specific: string | null = null;
  let generic: string | null = null;
  let series: string | null = null;
  for (const line of scope.lines) {
    if (scope.inTableBody(line.index)) continue;
    for (const cell of line.cells) {
      const label = labelAt(cell.text, 0, ["number", "series", "rectified"]);
      if (!label || label.kind === "rectified") continue;
      const values = valuesAfterLabel(scope.lines, line, cell, label.end);
      if (label.kind === "series") {
        series ??= values.map(readSeries).find((v) => v !== null) ?? null;
        continue;
      }
      const value = values.map(readInvoiceNumber).find((v) => v !== null) ?? null;
      if (!value) continue;
      if (label.specific) specific ??= value;
      else generic ??= value;
    }
  }
  const number = specific ?? generic;
  return {
    number: number ? field(number, specific ? "high" : "medium") : null,
    series: series ? field(series, "high") : null,
  };
}

// ---------------------------------------------------------------------------
// Fechas
// ---------------------------------------------------------------------------

type DateKind = "issueDate" | "dueDate" | "operationDate" | "paidDate";
const DATE_LABELS: readonly LabelKind[] = ["issueDate", "dueDate", "operationDate", "paidDate", "paidStamp", "rectified"];

type DateFound = { value: CivilDate; label: FoundLabel | null; line: number };

function findDatesByKind(scope: Scope) {
  const found: DateFound[] = [];
  for (const line of scope.lines) {
    if (scope.inTableBody(line.index)) continue;
    let regionStart = 0;
    for (const token of line.dates) {
      const label = labelFor(scope.lines, line, token, DATE_LABELS, regionStart);
      found.push({ value: token.value, label, line: line.index });
      regionStart = token.end;
    }
  }
  const first = (kind: DateKind | "paidStamp", specific?: boolean) =>
    found.find((d) => d.label?.kind === kind && (specific === undefined || d.label.specific === specific)) ?? null;

  const issueSpecific = first("issueDate", true);
  const issueGeneric = first("issueDate", false);
  const unlabelled = found.find((d) => d.label === null) ?? null;
  const issued = issueSpecific ?? issueGeneric;
  const paidStamp = first("paidStamp");
  const paid = first("paidDate") ?? paidStamp;
  // «Pagado el», «Cobrada el» y un sello «PAGADA» con fecha no dejan duda; «Fecha de pago», sí.
  const explicitPaid = paid !== null && (paid === paidStamp || /el$/.test(foldSameLength(scope.lines[paid.line]!.text.slice(paid.label!.start, paid.label!.end)).trim()));

  return {
    issuedOn: issued
      ? field(issued.value, issueSpecific ? "high" : "medium")
      : unlabelled
        ? field(unlabelled.value, "low")
        : null,
    dueOn: first("dueDate") ? field(first("dueDate")!.value, "high") : null,
    operationOn: first("operationDate") ? field(first("operationDate")!.value, "high") : null,
    paidOn: paid ? field(paid.value, explicitPaid ? "high" : "medium") : null,
    explicitPaid,
  };
}

// ---------------------------------------------------------------------------
// Emisor y cliente
// ---------------------------------------------------------------------------

type Role = "issuer" | "recipient";
type TaxIdFound = TaxIdToken & { line: number; cell: Span };

const ADDRESS_WORDS =
  /\b(c\/|calle|carrer|c\.|avda|avenida|avinguda|av\.|plaza|placa|pl\.|paseo|passeig|pg\.|camino|cami|ronda|travessera|via|poligono|pol\.|ctra|carretera|urb\.|urbanizacion|edificio|piso|planta|local|nave|bajos|baixos|rue|street|st\.|road|avenue|strasse|n[º°o]\s?\d|\d+\s?[º°ª])/i;
const POSTAL_CITY = /^(?:[A-Z]{1,2}-)?(\d{5}|\d{4})\s+([\p{L}][\p{L}\s'.-]*?)(?:\s*\(([\p{L}\s'.-]+)\))?\s*$/u;
const CONTACT = /@|https?:|www\.|\b(?:tel|tlf|telf|telefono|telèfon|phone|movil|mobil|fax)\b|\+\d{2}\s?\d/i;

function isAddressLike(text: string): boolean {
  return ADDRESS_WORDS.test(foldSameLength(text)) || POSTAL_CITY.test(text.trim()) || CONTACT.test(text);
}

function isNameLike(text: string): boolean {
  const value = text.trim();
  if (value.length < 2 || value.length > 160 || !/\p{L}{2}/u.test(value)) return false;
  if (isAddressLike(value) || findDates(value).length > 0) return false;
  if (wholeLabel(value)) return false;
  return !/^\d/.test(value);
}

/** Un nombre sin la etiqueta de NIF que a veces lo sigue («Construccions Riera SL, CIF»). */
function nameValue(text: string): string | null {
  return cleanValue(text.replace(/[,;·\s-]*(?:n\.?i\.?f\.?|c\.?i\.?f\.?|d\.?n\.?i\.?|n\.?i\.?e\.?|vat(?:\s+(?:number|no|id))?)[\s:.-]*$/i, ""), 160);
}

/** Quita una etiqueta del principio («Cliente:», «Razón social:», «NIF») y deja el valor. */
function stripLabel(text: string, kinds: readonly LabelKind[]): string {
  const label = labelAt(text, 0, kinds);
  return label ? text.slice(label.end) : text;
}

type RoleLabel = { role: Role; specific: boolean; line: number; cell: Span; inline: string | null };

function roleLabelAbove(scope: Scope, found: TaxIdFound, others: readonly TaxIdFound[]): RoleLabel | null {
  const line = scope.lines[found.line]!;
  const own = cellAt(line, found.start);
  // En la misma celda: «Cliente: Fundació Mar i Cel, CIF G…» o «De: Jordi Vila, NIF …».
  const ownLabel = own ? labelAt(own.text, 0, ["issuer", "recipient"]) : null;
  if (own && ownLabel) {
    const inline = nameValue(stripLabel(own.text.slice(0, found.start - own.start), ["issuer", "recipient"]));
    return { role: ownLabel.kind as Role, specific: ownLabel.specific, line: line.index, cell: own, inline: inline && isNameLike(inline) ? inline : null };
  }
  // A la izquierda en la misma línea: «CIF cliente: B…».
  const left = labelFor(scope.lines, line, found, ["issuer", "recipient"], found.cell.start);
  if (left && left.source === "left") return { role: left.kind as Role, specific: left.specific, line: line.index, cell: found.cell, inline: null };
  for (const above of linesAbove(scope.lines, found.line, 10)) {
    const cell = cellInColumn(above, found.cell);
    if (!cell) continue;
    // Otro NIF encima en la misma columna: es el bloque de otra parte.
    if (others.some((o) => o.line === above.index && overlaps(o.cell, found.cell))) return null;
    const label = labelAt(cell.text, 0, ["issuer", "recipient"]);
    if (label) {
      const rest = nameValue(cell.text.slice(label.end));
      return { role: label.kind as Role, specific: label.specific, line: above.index, cell, inline: rest && isNameLike(rest) ? rest : null };
    }
  }
  return null;
}

function partyDetails(
  scope: Scope,
  found: TaxIdFound,
  others: readonly TaxIdFound[],
  roleLine: number | null,
  inline: string | null,
  withAddress: boolean,
): ExtractedParty {
  const party = emptyParty();
  party.taxId = field(found.value, "high");
  if (found.kind === "es") party.countryCode = field("ES", "high");
  else if (/^[A-Z]{2}/.test(found.value)) party.countryCode = field(found.value.startsWith("EL") ? "GR" : found.value.slice(0, 2), "high");

  // El bloque: de la etiqueta del rol (o unas líneas por encima del NIF) hasta unas líneas por
  // debajo, en su columna, sin pasar por el NIF de la otra parte.
  const from = roleLine !== null && roleLine < found.line ? roleLine + 1 : Math.max(0, found.line - 4);
  const blockLines = scope.lines.filter(
    (l) =>
      l.index >= from &&
      l.index <= found.line + 5 &&
      !scope.inTableBody(l.index) &&
      !others.some((o) => o.line === l.index && overlaps(o.cell, found.cell)),
  );
  const cells = blockLines.flatMap((l) => {
    const cell = cellInColumn(l, found.cell);
    return cell ? [{ line: l.index, text: cell.text }] : [];
  });
  // El bloque acaba donde empieza otro (otra etiqueta de rol, una fecha con su etiqueta, la tabla).
  const block: { line: number; text: string }[] = [];
  for (const c of cells) {
    if (c.line > found.line && labelAt(c.text, 0, ["issuer", "recipient", "issueDate", "dueDate", "number"])) break;
    block.push(c);
  }
  // Por encima del NIF, el bloque empieza después de otra etiqueta (la del número, una fecha…).
  const above = block.filter((c) => c.line < found.line);
  const lastBreak = above.map((c, i) => (labelAt(c.text, 0, ["number", "issueDate", "dueDate", "total", "base", "stop"]) ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
  const aboveInBlock = above.slice(lastBreak + 1);

  // Nombre: «Razón social: …», el de la etiqueta del rol, lo que va delante del NIF en su celda, la
  // primera línea del bloque o la de encima del NIF.
  const labelled = block.map((c) => (labelAt(c.text, 0, ["name"]) ? nameValue(stripLabel(c.text, ["name"])) : null)).find((v) => v && isNameLike(v));
  const sameLine = nameValue(stripLabel(scope.lines[found.line]!.text.slice(found.cell.start, found.start), ["taxLabel", "issuer", "recipient"]));
  const firstLine = roleLine !== null && roleLine < found.line ? aboveInBlock.find((c) => isNameLike(c.text)) : undefined;
  const beforeTaxId = [...aboveInBlock].reverse().find((c) => isNameLike(c.text));
  const name = labelled
    ? field(labelled, "high")
    : inline
      ? field(inline, "medium")
      : sameLine && isNameLike(sameLine)
        ? field(sameLine, "medium")
        : firstLine
          ? field(nameValue(firstLine.text)!, "medium")
          : beforeTaxId
            ? field(nameValue(beforeTaxId.text)!, "low")
            : null;
  party.name = name;
  if (!withAddress) return party;

  for (const c of block) {
    const text = cleanValue(stripLabel(c.text, ["taxLabel"]), 200);
    if (!text || text === name?.value || text.includes(found.value)) continue;
    const postal = POSTAL_CITY.exec(text);
    if (postal && !party.postalCode) {
      party.postalCode = field(postal[1]!.length === 4 && party.countryCode?.value === "ES" ? `0${postal[1]}` : postal[1]!, "medium");
      party.city = field(cleanValue(postal[2]!, 80)!, "medium");
      if (postal[3]) party.province = field(cleanValue(postal[3], 80)!, "medium");
      continue;
    }
    const country = parseCountry(text);
    if (country && text.length <= 30) {
      party.countryCode ??= field(country, "medium");
      continue;
    }
    if (!party.address && ADDRESS_WORDS.test(foldSameLength(text)) && !CONTACT.test(text)) party.address = field(text, "medium");
  }
  return party;
}

function findParties(scope: Scope, hints: ExtractionHints): { issuer: ExtractedParty; recipient: ExtractedParty } {
  const known = new Set((hints.issuerTaxIds ?? []).map((t) => t.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^ES(?=[A-Z0-9]{9}$)/, "")));
  const all: TaxIdFound[] = [];
  for (const line of scope.lines) {
    if (scope.inTableBody(line.index)) continue;
    for (const token of line.taxIds) {
      if (all.some((f) => f.value === token.value)) continue;
      const cell = cellAt(line, token.start) ?? token;
      all.push({ ...token, line: line.index, cell: { start: cell.start, end: cell.end } });
    }
  }
  const result = { issuer: emptyParty(), recipient: emptyParty() };
  if (all.length === 0) return result;

  const assigned: { found: TaxIdFound; role: Role; confidence: Confidence; roleLine: number | null; inline: string | null }[] = [];
  for (const found of all) {
    const byHint = known.has(found.value);
    const label = roleLabelAbove(scope, found, all.filter((o) => o !== found));
    if (byHint) assigned.push({ found, role: "issuer", confidence: "high", roleLine: label?.line ?? null, inline: label?.inline ?? null });
    else if (label) assigned.push({ found, role: label.role, confidence: label.specific ? "high" : "medium", roleLine: label.line, inline: label.inline });
  }
  const taken = (role: Role) => assigned.some((a) => a.role === role);
  const rest = all.filter((f) => !assigned.some((a) => a.found === f));
  for (const found of rest) {
    // Sin etiqueta: el primero que falte, por orden (el emisor suele ir primero). Si la org dijo
    // con qué NIF factura y este no es, es el cliente.
    const role: Role = known.size > 0 ? "recipient" : !taken("issuer") ? "issuer" : "recipient";
    if (taken(role)) continue;
    assigned.push({ found, role, confidence: known.size > 0 ? "medium" : "low", roleLine: null, inline: null });
  }
  for (const role of ["issuer", "recipient"] as const) {
    const a = assigned.find((x) => x.role === role);
    if (!a) continue;
    const party = partyDetails(scope, a.found, all.filter((o) => o !== a.found), a.roleLine, a.inline, role === "recipient");
    party.taxId = field(a.found.value, a.confidence);
    result[role] = party;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Importes
// ---------------------------------------------------------------------------

type AmountKind = "base" | "vat" | "irpf" | "total";
type AmountCandidate = { kind: AmountKind; cents: number; rate: number | null; specific: boolean; line: number };
const AMOUNT_LABELS: readonly LabelKind[] = ["base", "vat", "vatRate", "irpf", "irpfRate", "total"];

function findAmounts(scope: Scope) {
  const candidates: AmountCandidate[] = [];
  const rates: { kind: "vat" | "irpf"; bps: number }[] = [];
  for (const line of scope.lines) {
    if (scope.inTableBody(line.index)) continue;
    let regionStart = 0;
    for (const token of line.money) {
      const label = labelFor(scope.lines, line, token, AMOUNT_LABELS, regionStart);
      regionStart = token.end;
      if (!label) continue;
      if (label.kind === "vatRate" || label.kind === "irpfRate") {
        // «21,00» debajo de «% IVA»: es el tipo, no un importe.
        if (token.cents >= 0 && token.cents <= 10_000) rates.push({ kind: label.kind === "vatRate" ? "vat" : "irpf", bps: token.cents });
        continue;
      }
      const kind = label.kind as AmountKind;
      const between = line.percents.find((p) => p.start >= (label.source === "left" ? label.start : 0) && p.end <= token.start && (label.source === "left" || p.start >= label.start));
      const rate = label.source === "left" ? (between?.bps ?? null) : null;
      candidates.push({ kind, cents: Math.abs(token.cents), rate, specific: label.specific, line: line.index });
      if (rate !== null && (kind === "vat" || kind === "irpf")) rates.push({ kind, bps: rate });
    }
    // Tipos sueltos: «IVA 21 %» sin importe en la línea, o «21» debajo de «% IVA».
    for (const percent of line.percents) {
      const label = labelFor(scope.lines, line, percent, ["vat", "vatRate", "irpf", "irpfRate"]);
      if (!label) continue;
      rates.push({ kind: label.kind === "vat" || label.kind === "vatRate" ? "vat" : "irpf", bps: percent.bps });
    }
    for (const number of findNumbers(line.text, [...line.money, ...line.dates, ...line.percents, ...line.taxIds, ...line.ibans])) {
      const label = labelFor(scope.lines, line, number, ["vatRate", "irpfRate"]);
      const bps = label ? percentToBps(number.value) : null;
      if (label && bps !== null) rates.push({ kind: label.kind === "vatRate" ? "vat" : "irpf", bps });
    }
  }

  const pick = (kind: AmountKind, last = false) => {
    const list = candidates.filter((c) => c.kind === kind);
    const specific = list.filter((c) => c.specific);
    const pool = specific.length > 0 ? specific : list;
    return (last ? pool.at(-1) : pool[0]) ?? null;
  };
  // IVA: una cuota por tipo (sin repetir la misma cuota del desglose y de los totales).
  const vatList = candidates.filter((c) => c.kind === "vat");
  const distinctVat = vatList.filter((c, i) => vatList.findIndex((o) => o.cents === c.cents && (o.rate ?? -1) === (c.rate ?? -1)) === i);
  const vatRates = [...new Set(rates.filter((r) => r.kind === "vat").map((r) => r.bps))];
  const withRate = distinctVat.filter((c) => c.rate !== null);
  let vatCents: number | null = null;
  let multipleRates = false;
  if (withRate.length > 1 && new Set(withRate.map((c) => c.rate)).size > 1) {
    const byRate = new Map<number, number>();
    for (const c of withRate) if (!byRate.has(c.rate!)) byRate.set(c.rate!, c.cents);
    vatCents = [...byRate.values()].reduce((s, v) => s + v, 0);
    multipleRates = true;
  } else if (distinctVat.length > 0) {
    vatCents = distinctVat[0]!.cents;
  }
  if (vatRates.length > 1) multipleRates = true;
  const vatSpecific = vatList.some((c) => c.specific);

  return {
    base: pick("base"),
    vatCents,
    vatSpecific,
    vatBps: multipleRates ? null : (vatRates[0] ?? null),
    multipleRates,
    irpf: pick("irpf"),
    irpfBps: rates.find((r) => r.kind === "irpf")?.bps ?? null,
    total: pick("total", true),
  };
}

function snapRate(base: number, amount: number, candidates: readonly number[]): number | null {
  if (base <= 0) return null;
  const hit = candidates.find((bps) => Math.abs(applyBps(base, bps) - amount) <= 1);
  return hit ?? null;
}

// ---------------------------------------------------------------------------
// IVA, forma de pago y cobro
// ---------------------------------------------------------------------------

function vatRegimeOf(text: string): VatRegime | null {
  const t = foldSameLength(text);
  if (/inversion del sujeto pasivo|inversio del subjecte passiu|reverse charge|autoliquidacion|operacion intracomunitaria|intra-?community|art\.?\s?196|article 196/.test(t)) {
    return "reverse_charge_eu";
  }
  if (/\bno sujet[oa]|no subjecte|not subject|fuera del ambito|reglas de localizacion|art\.?\s?69\b|outside the scope/.test(t)) return "not_subject";
  if (/\bexent[oa]\b|\bexempt[ae]?\b|exencion|exempcio|art\.?\s?20\b/.test(t)) return "exempt";
  return null;
}

function findPaymentMethod(scope: Scope): Field<PaymentMethod> | null {
  for (const line of scope.lines) {
    for (const cell of line.cells) {
      const label = labelAt(cell.text, 0, ["paymentMethod"]);
      if (!label) continue;
      for (const value of valuesAfterLabel(scope.lines, line, cell, label.end)) {
        const method = parsePaymentMethod(value);
        if (method) return field(method, "high");
      }
    }
  }
  const text = foldSameLength(scope.lines.map((l) => l.text).join("\n"));
  if (/domiciliaci|recibo domiciliado|adeudo|\bsepa\b|rebut domiciliat/.test(text)) return field("sepa_debit", "low");
  if (/transferencia|transfer\b|\biban\b/.test(text)) return field("transfer", "low");
  if (/\bbizum\b/.test(text)) return field("other", "low");
  if (/\btarjeta\b|\btargeta\b|\bstripe\b|\bpaypal\b/.test(text)) return field("card", "low");
  if (/\befectivo\b|\befectiu\b/.test(text)) return field("cash", "low");
  return null;
}

/**
 * Un sello o un estado: «PAGADA», «Estado: Cobrada», «PAGADA 15/04/2025», «Pendiente de pago:
 * 605,00 €». Lo que sigue a la palabra solo puede ser puntuación, una fecha o un importe (así no
 * cuenta «deberá ser pagada antes del…»).
 */
function findPaidStamp(scope: Scope): Field<boolean> | null {
  let paid = false;
  let pending: Confidence | null = null;
  for (const line of scope.lines) {
    if (scope.inTableBody(line.index)) continue;
    for (const cell of line.cells) {
      const folded = foldSameLength(cell.text);
      for (let i = 0; i < cell.text.length; i += 1) {
        const match = labelAt(cell.text, i, ["paidStamp", "pendingStamp"], folded);
        if (!match) continue;
        const rest = cell.text.slice(match.end);
        const tail = rest.replace(/^[\s:.·|-]+/, "");
        const ok = tail === "" || findDates(tail)[0]?.start === 0 || /^-?\s?(?:€\s?)?\d[\d.,]*\s?(?:€|eur)?\s*$/i.test(tail);
        if (!ok) continue;
        if (match.kind === "paidStamp") paid = true;
        else pending = pending === "medium" || match.specific ? "medium" : "low";
        break;
      }
    }
  }
  if (paid && pending === null) return field(true, "high");
  if (!paid && pending) return field(false, pending);
  return null;
}

// ---------------------------------------------------------------------------
// Todo junto
// ---------------------------------------------------------------------------

export function parseInvoiceText(raw: string, hints: ExtractionHints = {}): ExtractedInvoice {
  if (raw.replace(/[^\p{L}\p{N}]/gu, "").length < 20) return emptyExtraction(["no_text"]);
  const lines = readDocument(raw);
  const table = findLineTable(lines);
  const scope: Scope = { lines, inTableBody: (index) => table !== null && index > table.header && index < table.end };
  const warnings = new Set<ExtractionWarning>();
  const fullText = lines.map((l) => l.text).join("\n");
  const folded = foldSameLength(fullText);

  const { number, series } = findNumber(scope);
  const dates = findDatesByKind(scope);
  const { issuer, recipient } = findParties(scope, hints);
  const amounts = findAmounts(scope);
  const extractedLines: ExtractedLine[] = table ? readTableLines(lines, table) : [];
  const regime = vatRegimeOf(fullText);

  if (/rectificativ|\babono\b|credit note|nota de abono/.test(folded)) warnings.add("rectifying");
  const euros = (fullText.match(/€|\beur\b|euros?\b/gi) ?? []).length;
  const foreign = (fullText.match(/\$|£|\busd\b|\bgbp\b|\bchf\b/gi) ?? []).length;
  if (foreign > euros) warnings.add("foreign_currency");
  if (amounts.multipleRates) warnings.add("multiple_vat_rates");

  // Base, IVA, IRPF y total: lo impreso y, lo que falte, deducido de lo demás.
  const linesSum = extractedLines.length > 0 ? extractedLines.reduce((s, l) => s + l.amountCents, 0) : null;
  let base: Field<number> | null = amounts.base ? field(amounts.base.cents, amounts.base.specific ? "high" : "medium") : null;
  let vat: Field<number> | null = amounts.vatCents !== null ? field(amounts.vatCents, amounts.vatSpecific ? "high" : "medium") : null;
  let irpf: Field<number> | null = amounts.irpf ? field(amounts.irpf.cents, "high") : null;
  let total: Field<number> | null = amounts.total ? field(amounts.total.cents, amounts.total.specific ? "high" : "medium") : null;
  let vatBps: Field<number> | null = amounts.vatBps !== null ? field(amounts.vatBps, "high") : null;
  let irpfBps: Field<number> | null = amounts.irpfBps !== null ? field(amounts.irpfBps, "high") : null;

  if (!base && linesSum !== null) base = field(linesSum, "medium");
  if (!base && total && vat) base = field(total.value - vat.value + (irpf?.value ?? 0), "low");
  if (base && !vat && vatBps) vat = field(applyBps(base.value, vatBps.value), "medium");
  if (base && !vat && regime) vat = field(0, "medium");
  if (base && vat && total && !irpf) {
    const diff = base.value + vat.value - total.value;
    if (diff > 1) {
      irpf = field(diff, "medium");
      const rate = irpfBps?.value ?? snapRate(base.value, diff, IRPF_RATES);
      if (rate !== null && !irpfBps) irpfBps = field(rate, "medium");
    } else if (Math.abs(diff) <= 1) {
      irpf = field(0, "medium");
    }
  }
  if (base && total && !vat) {
    const derived = total.value - base.value + (irpf?.value ?? 0);
    if (derived >= 0) vat = field(derived, "low");
  }
  if (base && vat && !total) total = field(base.value + vat.value - (irpf?.value ?? 0), "medium");
  if (base && vat && !vatBps && !amounts.multipleRates) {
    const rate = vat.value === 0 ? 0 : snapRate(base.value, vat.value, VAT_RATES);
    if (rate !== null) vatBps = field(rate, "medium");
  }
  if (base && irpf && irpf.value > 0 && !irpfBps) {
    const rate = snapRate(base.value, irpf.value, IRPF_RATES);
    if (rate !== null) irpfBps = field(rate, "medium");
  }
  if (!irpf && base && total && vat) irpf = field(0, "medium");

  // ¿Cuadra? Si sí, todo lo impreso es seguro (también con una etiqueta genérica como «Total»); si
  // no, se avisa y nada pasa de «medium».
  if (base && vat && total) {
    const consistent = Math.abs(base.value + vat.value - (irpf?.value ?? 0) - total.value) <= 1;
    if (consistent) {
      const printed = (f: Field<number> | null, found: unknown) => (f && found && f.confidence === "medium" ? field(f.value, "high") : f);
      base = printed(base, amounts.base);
      vat = printed(vat, amounts.vatCents !== null);
      irpf = printed(irpf, amounts.irpf);
      total = printed(total, amounts.total);
    } else {
      warnings.add("totals_mismatch");
      const cap = (f: Field<number> | null) => (f ? field(f.value, minConfidence(f.confidence, "medium")) : null);
      base = cap(base);
      vat = cap(vat);
      irpf = cap(irpf);
      total = cap(total);
    }
  }
  if (base && linesSum !== null && Math.abs(linesSum - base.value) > Math.max(1, extractedLines.length)) warnings.add("lines_mismatch");
  // Si las líneas cuadran con la base, son tan seguras como ella.
  const lines_ =
    base && linesSum !== null && Math.abs(linesSum - base.value) <= Math.max(1, extractedLines.length)
      ? extractedLines.map((l) => ({ ...l, confidence: l.confidence === "low" ? "medium" : ("high" as Confidence) }))
      : extractedLines.map((l) => ({ ...l, confidence: minConfidence(l.confidence, "medium") }));

  const stamp = findPaidStamp(scope);
  const paid: Field<boolean> | null = stamp ?? (dates.paidOn && dates.explicitPaid ? field(true, "high") : null);

  return {
    number,
    series,
    issuedOn: dates.issuedOn,
    operationOn: dates.operationOn,
    dueOn: dates.dueOn,
    issuer,
    recipient,
    baseCents: base,
    vatBps,
    vatRegime: regime ? field(regime, "medium") : vatBps && vatBps.value > 0 ? field("general", vatBps.confidence) : null,
    vatCents: vat,
    irpfBps,
    irpfCents: irpf,
    totalCents: total,
    lines: lines_,
    paymentMethod: findPaymentMethod(scope),
    paid,
    paidOn: dates.paidOn,
    warnings: [...warnings],
  };
}
