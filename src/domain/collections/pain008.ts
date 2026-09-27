// Fichero de adeudos directos SEPA, esquema básico (CORE), en el formato ISO 20022
// pain.008.001.02: el que piden los bancos españoles (cuaderno 19.14 en XML) y el EPC.
//
// Estructura:
//   Document/CstmrDrctDbtInitn
//     GrpHdr: MsgId, CreDtTm, NbOfTxs, CtrlSum, InitgPty (nombre e identificador del acreedor)
//     PmtInf (uno por tipo de secuencia: FRST primero, RCUR después), con ReqdColltnDt, Cdtr,
//       CdtrAcct, CdtrAgt, ChrgBr SLEV y CdtrSchmeId, y sus adeudos:
//       DrctDbtTxInf: PmtId/EndToEndId, InstdAmt (EUR, dos decimales), MndtRltdInf (MndtId,
//         DtOfSgntr), DbtrAgt, Dbtr, DbtrAcct y RmtInf/Ustrd (el número de la factura)
//
// Los importes se suman en céntimos enteros y se escriben con dos decimales exactos: CtrlSum es
// siempre la suma exacta de sus adeudos. Todo texto pasa por el juego de caracteres SEPA. Sin BIC
// (opcional desde 2016), el agente va como Othr/Id "NOTPROVIDED", como indica el EPC.
//
// Esta función no decide nada de negocio: recibe datos ya validados (checkRemittance) y lanza si
// algo no cumple el formato, porque sería un error de programación.

import { type CivilDate, parseCivilDate } from "@/domain/dates/civil-date";
import { normalizeIban, validateIban } from "@/domain/tax-id";
import { normalizeBic, normalizeCreditorId, validateBic, validateCreditorId } from "./creditor-id";
import { isSepaIdentifier, toIdentifierPart, toSepaText } from "./sepa-text";

export const SEQUENCE_TYPES = ["FRST", "RCUR"] as const;
export type SequenceType = (typeof SEQUENCE_TYPES)[number];

/** Límites de las guías del EPC para el esquema básico. */
export const SEPA_LIMITS = {
  name: 70,
  remittanceInfo: 140,
  identifier: 35,
  /** 999.999.999,99 € */
  maxAmountCents: 99_999_999_999,
} as const;

export const PAIN_008_NAMESPACE = "urn:iso:std:iso:20022:tech:xsd:pain.008.001.02";

export type Pain008Creditor = {
  name: string;
  creditorId: string;
  iban: string;
  bic: string | null;
};

export type Pain008Transaction = {
  endToEndId: string;
  amountCents: number;
  sequenceType: SequenceType;
  mandateId: string;
  mandateSignedOn: CivilDate;
  debtorName: string;
  debtorIban: string;
  debtorBic: string | null;
  /** Concepto que ve el deudor en su banco, p. ej. "Factura 2026-0038". */
  remittanceInfo: string;
};

export type Pain008Input = {
  messageId: string;
  /** Creación del fichero en la zona horaria de la org, sin zona: "2026-09-26T10:15:30". */
  createdAt: string;
  /** Fecha de cobro pedida (ReqdColltnDt). */
  collectionOn: CivilDate;
  creditor: Pain008Creditor;
  transactions: Pain008Transaction[];
};

const LOCAL_DATE_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})$/;

// ---------------------------------------------------------------------------
// Importes e identificadores
// ---------------------------------------------------------------------------

function assertAmount(cents: number): void {
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > SEPA_LIMITS.maxAmountCents) {
    throw new Error(`Importe de adeudo no válido: ${String(cents)}`);
  }
}

/** Céntimos a importe SEPA con dos decimales exactos: 95400 → "954.00", 5 → "0.05". */
export function formatSepaAmount(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error(`Importe no válido: ${String(cents)}`);
  return `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** Suma exacta de céntimos (en BigInt, sin redondeos). */
export function sumCents(values: readonly number[]): number {
  const total = values.reduce((acc, v) => {
    if (!Number.isSafeInteger(v)) throw new Error(`Importe no válido: ${String(v)}`);
    return acc + BigInt(v);
  }, BigInt(0));
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("La suma excede el rango admitido");
  return Number(total);
}

/** Ocho primeras cifras hexadecimales de un UUID, en mayúsculas. */
function shortId(uuid: string): string {
  const hex = uuid.replace(/-/g, "").toUpperCase();
  if (!/^[0-9A-F]{8,}$/.test(hex)) throw new Error(`Identificador no válido: ${uuid}`);
  return hex.slice(0, 8);
}

/**
 * Referencia del adeudo (EndToEndId), la que devuelve el banco en cobros y devoluciones: el
 * número de la factura y el principio del id del recibo ("2026-0038" → "2026-0038-1A2B3C4D").
 */
export function endToEndId(invoiceNumber: string, itemId: string): string {
  const number = toIdentifierPart(invoiceNumber, SEPA_LIMITS.identifier - 9) || "RECIBO";
  return `${number}-${shortId(itemId)}`;
}

/** Identificador del fichero (MsgId): fecha y hora de creación y el principio del id de la remesa. */
export function remittanceMessageId(createdAt: string, remittanceId: string): string {
  const m = LOCAL_DATE_TIME.exec(createdAt);
  if (!m) throw new Error(`Fecha y hora no válidas: ${createdAt}`);
  return `REM-${m[1]!.replace(/-/g, "")}${m[2]}${m[3]}${m[4]}-${shortId(remittanceId)}`;
}

// ---------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------

type XmlNode = { tag: string; attrs?: Record<string, string>; text?: string; children?: XmlNode[] };

const node = (tag: string, content: string | XmlNode[], attrs?: Record<string, string>): XmlNode =>
  typeof content === "string" ? { tag, text: content, attrs } : { tag, children: content, attrs };

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function render(n: XmlNode, depth: number, out: string[]): void {
  const pad = "  ".repeat(depth);
  const attrs = Object.entries(n.attrs ?? {})
    .map(([k, v]) => ` ${k}="${escapeXml(v)}"`)
    .join("");
  if (n.children) {
    out.push(`${pad}<${n.tag}${attrs}>`);
    for (const child of n.children) render(child, depth + 1, out);
    out.push(`${pad}</${n.tag}>`);
  } else {
    out.push(`${pad}<${n.tag}${attrs}>${escapeXml(n.text ?? "")}</${n.tag}>`);
  }
}

/** Agente (banco) de una cuenta: su BIC o, sin él, "NOTPROVIDED". */
function agent(tag: string, bic: string | null): XmlNode {
  return node(tag, [
    node("FinInstnId", bic ? [node("BIC", normalizeBic(bic))] : [node("Othr", [node("Id", "NOTPROVIDED")])]),
  ]);
}

function account(tag: string, iban: string): XmlNode {
  return node(tag, [node("Id", [node("IBAN", normalizeIban(iban))])]);
}

function requiredName(value: string, what: string): string {
  const name = toSepaText(value, SEPA_LIMITS.name);
  if (!name) throw new Error(`Falta ${what}`);
  return name;
}

function assertIdentifier(value: string, what: string): void {
  if (!isSepaIdentifier(value, SEPA_LIMITS.identifier)) throw new Error(`${what} no válido: ${value}`);
}

function assertAccount(iban: string, bic: string | null, what: string): void {
  if (!validateIban(iban)) throw new Error(`IBAN no válido (${what})`);
  if (bic !== null && !validateBic(bic)) throw new Error(`BIC no válido (${what})`);
}

function transactionNode(tx: Pain008Transaction): XmlNode {
  const remittanceInfo = toSepaText(tx.remittanceInfo, SEPA_LIMITS.remittanceInfo);
  return node("DrctDbtTxInf", [
    node("PmtId", [node("EndToEndId", tx.endToEndId)]),
    node("InstdAmt", formatSepaAmount(tx.amountCents), { Ccy: "EUR" }),
    node("DrctDbtTx", [node("MndtRltdInf", [node("MndtId", tx.mandateId), node("DtOfSgntr", tx.mandateSignedOn)])]),
    agent("DbtrAgt", tx.debtorBic),
    node("Dbtr", [node("Nm", requiredName(tx.debtorName, "el nombre del deudor"))]),
    account("DbtrAcct", tx.debtorIban),
    ...(remittanceInfo ? [node("RmtInf", [node("Ustrd", remittanceInfo)])] : []),
  ]);
}

/**
 * XML pain.008.001.02 de una remesa: cabecera, un bloque por tipo de secuencia (FRST, RCUR) y sus
 * adeudos en el orden recibido. Determinista: los mismos datos dan siempre el mismo fichero.
 */
export function buildPain008(input: Pain008Input): string {
  const { creditor, transactions } = input;
  assertIdentifier(input.messageId, "Identificador del fichero");
  if (input.messageId.length > SEPA_LIMITS.identifier - 5) throw new Error("Identificador del fichero demasiado largo");
  if (!LOCAL_DATE_TIME.test(input.createdAt)) throw new Error(`Fecha de creación no válida: ${input.createdAt}`);
  parseCivilDate(input.collectionOn);
  if (!validateCreditorId(creditor.creditorId)) throw new Error("Identificador de acreedor no válido");
  assertAccount(creditor.iban, creditor.bic, "acreedor");
  const creditorName = requiredName(creditor.name, "el nombre del acreedor");
  const creditorId = normalizeCreditorId(creditor.creditorId);

  if (transactions.length === 0) throw new Error("Una remesa necesita al menos un adeudo");
  const seen = new Set<string>();
  for (const tx of transactions) {
    assertIdentifier(tx.endToEndId, "Referencia del adeudo");
    assertIdentifier(tx.mandateId, "Referencia del mandato");
    if (seen.has(tx.endToEndId)) throw new Error(`Referencia de adeudo repetida: ${tx.endToEndId}`);
    seen.add(tx.endToEndId);
    assertAmount(tx.amountCents);
    parseCivilDate(tx.mandateSignedOn);
    assertAccount(tx.debtorIban, tx.debtorBic, tx.endToEndId);
    if (!SEQUENCE_TYPES.includes(tx.sequenceType)) throw new Error(`Secuencia no válida: ${String(tx.sequenceType)}`);
  }

  const blocks = SEQUENCE_TYPES.flatMap((sequence) => {
    const txs = transactions.filter((tx) => tx.sequenceType === sequence);
    if (txs.length === 0) return [];
    return [
      node("PmtInf", [
        node("PmtInfId", `${input.messageId}-${sequence}`),
        node("PmtMtd", "DD"),
        node("NbOfTxs", String(txs.length)),
        node("CtrlSum", formatSepaAmount(sumCents(txs.map((tx) => tx.amountCents)))),
        node("PmtTpInf", [
          node("SvcLvl", [node("Cd", "SEPA")]),
          node("LclInstrm", [node("Cd", "CORE")]),
          node("SeqTp", sequence),
        ]),
        node("ReqdColltnDt", input.collectionOn),
        node("Cdtr", [node("Nm", creditorName)]),
        account("CdtrAcct", creditor.iban),
        agent("CdtrAgt", creditor.bic),
        node("ChrgBr", "SLEV"),
        node("CdtrSchmeId", [
          node("Id", [node("PrvtId", [node("Othr", [node("Id", creditorId), node("SchmeNm", [node("Prtry", "SEPA")])])])]),
        ]),
        ...txs.map(transactionNode),
      ]),
    ];
  });

  const document = node(
    "Document",
    [
      node("CstmrDrctDbtInitn", [
        node("GrpHdr", [
          node("MsgId", input.messageId),
          node("CreDtTm", input.createdAt),
          node("NbOfTxs", String(transactions.length)),
          node("CtrlSum", formatSepaAmount(sumCents(transactions.map((tx) => tx.amountCents)))),
          node("InitgPty", [node("Nm", creditorName), node("Id", [node("OrgId", [node("Othr", [node("Id", creditorId)])])])]),
        ]),
        ...blocks,
      ]),
    ],
    { xmlns: PAIN_008_NAMESPACE, "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance" },
  );

  const lines = ['<?xml version="1.0" encoding="UTF-8"?>'];
  render(document, 0, lines);
  return `${lines.join("\n")}\n`;
}
