// Las etiquetas que imprimen las facturas en castellano, catalán e inglés («Nº factura», «Data de
// venciment», «Base imponible», «Retención IRPF»…) y cómo se reconocen en el texto: sin distinguir
// mayúsculas ni acentos, con la puntuación y los espacios que se quieran en medio (también las
// etiquetas con espaciado de letras) y siempre en palabras enteras.

import { foldSameLength, keyOf } from "./text";

export type LabelKind =
  | "number"
  | "series"
  | "issueDate"
  | "dueDate"
  | "operationDate"
  | "paidDate"
  | "paidStamp"
  | "pendingStamp"
  | "base"
  | "vat"
  | "vatRate"
  | "irpf"
  | "irpfRate"
  | "total"
  | "issuer"
  | "recipient"
  | "taxLabel"
  | "name"
  | "paymentMethod"
  | "rectified"
  | "stop";

type Phrase = { kind: LabelKind; key: string; specific: boolean };

// «~» delante: etiqueta genérica («Fecha», «Total»): vale, pero con menos confianza.
const VOCABULARY: Record<LabelKind, readonly string[]> = {
  number: [
    "numero de factura", "numero factura", "num de factura", "num factura", "no de factura", "no factura",
    "n de factura", "n factura", "numero de la factura", "factura numero", "factura num", "factura no", "factura n",
    "fra no", "fra num", "fra n", "invoice number", "invoice no", "invoice num", "invoice nr", "invoice n",
    "numero de rebut", "~factura", "~factura rectificativa", "~invoice", "~numero", "~num", "~no", "~ref factura",
    "~referencia", "~ref",
  ],
  series: ["serie", "series", "serie de facturacion"],
  issueDate: [
    "fecha de emision", "fecha emision", "fecha de expedicion", "fecha expedicion", "fecha de factura", "fecha factura",
    "fecha de la factura", "fecha fra", "data d'emissio", "data emissio", "data de la factura", "data factura",
    "data d'expedicio", "data expedicio", "data de factura", "invoice date", "issue date", "date of issue",
    "emitida el", "~fecha", "~data", "~date",
  ],
  dueDate: [
    "fecha de vencimiento", "fecha vencimiento", "fecha de vto", "fecha vto", "vencimiento", "vto", "vence el", "vence",
    "data de venciment", "data venciment", "venciment", "due date", "payment due", "due on", "fecha limite de pago",
    "fecha limite", "a pagar antes del", "pagar antes del", "pagadera antes del", "data limit de pagament", "data limit",
  ],
  operationDate: [
    "fecha de operacion", "fecha operacion", "fecha de la operacion", "fecha de prestacion del servicio",
    "fecha de prestacion", "fecha del servicio", "fecha de realizacion", "fecha de devengo", "data de l'operacio",
    "data operacio", "data de prestacio", "operation date", "service date", "date of supply",
  ],
  paidDate: [
    "fecha de pago", "fecha pago", "fecha de cobro", "fecha cobro", "pagado el", "pagada el", "cobrado el", "cobrada el",
    "abonado el", "abonada el", "pagat el", "cobrat el", "data de pagament", "data pagament", "data de cobrament",
    "data cobrament", "paid on", "payment date", "date paid",
  ],
  paidStamp: [
    "pagada", "pagado", "cobrada", "cobrado", "pagat", "cobrat", "paid", "liquidada", "factura pagada",
    "factura cobrada", "factura pagat",
  ],
  pendingStamp: [
    "pendiente de pago", "pendiente de cobro", "pendent de pagament", "pendent de cobrament", "no pagada", "impagada",
    "sin pagar", "unpaid", "~pendiente", "~pendent",
  ],
  base: [
    "base imponible", "base imposable", "total base imponible", "total base imposable", "base", "subtotal", "sub total",
    "importe neto", "total neto", "neto", "total sin iva", "importe sin iva", "total sense iva", "import net",
    "net amount", "net total", "taxable base", "taxable amount", "subtotal sin iva", "honorarios", "honoraris",
  ],
  vat: [
    "iva", "cuota iva", "cuota de iva", "cuota del iva", "importe iva", "import iva", "total iva", "iva repercutido",
    "quota iva", "quota de l'iva", "impuesto", "impuestos", "vat", "vat amount", "tax",
  ],
  vatRate: ["pct iva", "iva pct", "tipo iva", "tipo de iva", "tipus iva", "tipus d'iva", "pct vat", "vat rate", "vat pct", "~tipo", "~tipus"],
  irpf: [
    "irpf", "retencion irpf", "retencion de irpf", "retencion", "retencion a cuenta", "ret irpf", "retencio",
    "retencio irpf", "retencio de l'irpf", "retencio d'irpf", "irpf retencion", "withholding", "withholding tax",
  ],
  irpfRate: ["pct irpf", "irpf pct", "tipo irpf", "tipo de irpf", "pct retencion", "pct ret", "tipo retencion", "tipus irpf"],
  total: [
    "total a pagar", "total factura", "total de la factura", "importe total", "total importe", "total eur", "total euros",
    "import total", "importe a pagar", "liquido a pagar", "total a abonar", "amount due", "total due", "balance due",
    "grand total", "total amount", "total general", "total a percibir", "liquido a percibir", "importe a percibir",
    "total a percebre", "~total", "~a pagar",
  ],
  issuer: [
    "emisor", "emissor", "datos del emisor", "datos emisor", "dades de l'emissor", "dades emissor", "proveedor",
    "proveidor", "prestador", "vendedor", "facturado por", "issuer", "supplier", "seller", "~from", "~de",
  ],
  recipient: [
    "cliente", "client", "datos del cliente", "datos cliente", "dades del client", "dades client", "facturar a",
    "facturado a", "destinatario", "destinatari", "receptor", "bill to", "billed to", "invoice to", "customer", "~para",
  ],
  taxLabel: [
    "nif", "cif", "dni", "nie", "nif cif", "cif nif", "nif iva", "nif-iva", "vat number", "vat no", "vat id", "tax id",
    "id fiscal", "identificacion fiscal",
  ],
  name: ["razon social", "rao social", "nombre", "nom", "name", "empresa", "company"],
  paymentMethod: [
    "forma de pago", "metodo de pago", "medio de pago", "modo de pago", "pago mediante", "pago por", "forma de pagament",
    "metode de pagament", "mitja de pagament", "payment method", "paid by", "pay by", "~condiciones de pago",
  ],
  rectified: [
    "factura rectificada", "rectifica a la factura", "rectifica la factura", "factura que se rectifica",
    "factura original", "rectified invoice", "rectifica a",
  ],
  stop: [
    "observaciones", "observacions", "notas", "notes", "iban", "titular", "datos de pago", "dades de pagament",
    "datos bancarios", "payment details", "bank details", "condiciones", "registro mercantil", "inscrita en el registro",
  ],
};

function toKey(phrase: string): string {
  let out = "";
  for (const char of foldSameLength(phrase)) out += keyOf(char);
  return out;
}

const PHRASES: readonly Phrase[] = Object.entries(VOCABULARY)
  .flatMap(([kind, list]) =>
    list.map((raw) => ({ kind: kind as LabelKind, key: toKey(raw.replace(/^~/, "")), specific: !raw.startsWith("~") })),
  )
  .sort((a, b) => b.key.length - a.key.length);

export type LabelMatch = {
  kind: LabelKind;
  specific: boolean;
  /** Posiciones de la etiqueta dentro del texto donde se ha buscado. */
  start: number;
  end: number;
};

const isWordChar = (char: string | undefined) => char !== undefined && /[\p{L}\p{N}]/u.test(char);

// Lo que puede haber entre una etiqueta y su valor (o detrás de una etiqueta sola): puntuación, un
// tipo («21 %») y la moneda («(EUR)», «€»).
const FILLER = /^(?:[\s:.#()*·|/=-]|€|eur(?:os)?\b|\d{1,3}(?:[.,]\d{1,3})?\s?%)*$/i;

/** Hasta dónde llega `key` empezando en `from` (saltando espacios y puntuación), o null. */
function matchKeyAt(folded: string, from: number, key: string): number | null {
  let k = 0;
  let i = from;
  while (k < key.length && i < folded.length) {
    const piece = keyOf(folded[i]!);
    if (piece === "") {
      i += 1;
      continue;
    }
    if (!key.startsWith(piece, k)) return null;
    k += piece.length;
    i += 1;
  }
  if (k < key.length) return null;
  // Palabra entera: una etiqueta que acaba en letra no puede seguir con otra letra («fecha» ≠ «fechas»).
  if (/[a-z]/.test(key.at(-1)!) && /\p{L}/u.test(folded[i] ?? "")) return null;
  return i;
}

/** La etiqueta (la más larga) con la que empieza `text` en `from`, si `from` es principio de palabra. */
export function labelAt(text: string, from = 0, kinds?: readonly LabelKind[], folded = foldSameLength(text)): LabelMatch | null {
  if (!isWordChar(folded[from]) && folded[from] !== "%") return null;
  if (from > 0 && isWordChar(folded[from - 1])) return null;
  for (const phrase of PHRASES) {
    if (kinds && !kinds.includes(phrase.kind)) continue;
    const end = matchKeyAt(folded, from, phrase.key);
    if (end !== null) return { kind: phrase.kind, specific: phrase.specific, start: from, end };
  }
  return null;
}

/** ¿El texto entero es una etiqueta (quitando puntuación, porcentajes y la moneda del final)? */
export function wholeLabel(text: string, kinds?: readonly LabelKind[]): LabelMatch | null {
  const trimmed = text.replace(/^[\s:.#·|*-]+/, "");
  const offset = text.length - trimmed.length;
  const folded = foldSameLength(trimmed);
  const match = labelAt(trimmed, 0, kinds, folded);
  if (!match) return null;
  if (!FILLER.test(trimmed.slice(match.end))) return null;
  return { ...match, start: match.start + offset, end: match.end + offset };
}

/**
 * La etiqueta más cercana por la izquierda a la posición `limit` del texto: de las que acaban más
 * cerca, la más larga («Total sin IVA» es base, no IVA). Entre la etiqueta y `limit` solo puede
 * haber puntuación, espacios, un porcentaje o la moneda.
 */
export function labelBefore(text: string, limit: number, kinds?: readonly LabelKind[]): LabelMatch | null {
  const region = text.slice(0, limit);
  const folded = foldSameLength(region);
  let best: LabelMatch | null = null;
  for (let i = region.length - 1; i >= 0; i -= 1) {
    if (!isWordChar(folded[i]) || isWordChar(folded[i - 1])) continue;
    const match = labelAt(region, i, kinds, folded);
    if (!match) continue;
    if (!FILLER.test(region.slice(match.end))) continue;
    if (!best || match.end > best.end || (match.end === best.end && match.end - match.start > best.end - best.start)) best = match;
  }
  return best;
}
