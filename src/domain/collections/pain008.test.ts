import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPain008,
  endToEndId,
  formatSepaAmount,
  type Pain008Input,
  remittanceMessageId,
  SEPA_LIMITS,
  sumCents,
} from "./pain008";
import { isSepaIdentifier, isSepaText } from "./sepa-text";

// Fichero de referencia: validado con xmllint contra el XSD oficial pain.008.001.02 de ISO 20022.
const GOLDEN = readFileSync(join(import.meta.dirname, "__fixtures__/pain008-core.golden.xml"), "utf8");

// IBAN de ejemplo públicos (formato y control correctos, no son cuentas reales).
const golden: Pain008Input = {
  messageId: remittanceMessageId("2026-09-26T10:15:30", "7c9e6679-7425-40de-944b-e07fc1f90ae7"),
  createdAt: "2026-09-26T10:15:30",
  collectionOn: "2026-10-05",
  creditor: { name: "GNERAI, S.L.", creditorId: "ES11000B12345674", iban: "ES91 2100 0418 4502 0005 1332", bic: "CAIXESBBXXX" },
  transactions: [
    {
      endToEndId: endToEndId("2026-0038", "0f8fad5b-d9cb-469f-a165-70867728950e"),
      amountCents: 95_400,
      sequenceType: "FRST",
      mandateId: "PORT-MATARO-20260115",
      mandateSignedOn: "2026-01-15",
      debtorName: "Port Mataró, S.L.",
      debtorIban: "ES79 2100 0813 6101 2345 6789",
      debtorBic: null,
      remittanceInfo: "Factura 2026-0038",
    },
    {
      endToEndId: endToEndId("2026-0041", "1b4e28ba-2fa1-11d2-883f-0016d3cca427"),
      amountCents: 12_345,
      sequenceType: "RCUR",
      mandateId: "PEREZ-HIJOS-20250301",
      mandateSignedOn: "2025-03-01",
      debtorName: "Pérez & Hijos Distribución, S.A.",
      debtorIban: "DE89370400440532013000",
      debtorBic: "COBADEFFXXX",
      remittanceInfo: "Factura 2026-0041",
    },
    {
      endToEndId: endToEndId("R2026/0002", "6fa459ea-ee8a-3ca4-894e-db77e160355e"),
      amountCents: 1,
      sequenceType: "FRST",
      mandateId: "CAFE-L-AVIA-20260920",
      mandateSignedOn: "2026-09-20",
      debtorName: "Cafè l'Àvia · Col·legi",
      debtorIban: "ES6000491500051234567892",
      debtorBic: "BSCHESMMXXX",
      remittanceInfo: "Factura R2026/0002 · Menú del día",
    },
  ],
};

/** Contenido de todas las etiquetas `tag` del XML, en orden. */
const values = (xml: string, tag: string) => [...xml.matchAll(new RegExp(`<${tag}(?: [^>]*)?>([^<]*)</${tag}>`, "g"))].map((m) => m[1]!);
const cents = (amount: string) => {
  const [whole, fraction] = amount.split(".");
  return Number(whole) * 100 + Number(fraction);
};

describe("pain.008.001.02", () => {
  it("genera exactamente el fichero de referencia", () => {
    expect(buildPain008(golden)).toBe(GOLDEN);
  });

  it("CtrlSum y NbOfTxs cuadran al céntimo con los adeudos, en la cabecera y en cada bloque", () => {
    const xml = buildPain008(golden);
    const amounts = values(xml, "InstdAmt").map(cents);
    const [groupSum, ...blockSums] = values(xml, "CtrlSum").map(cents);
    const [groupCount, ...blockCounts] = values(xml, "NbOfTxs").map(Number);
    expect(amounts).toEqual([95_400, 1, 12_345]);
    expect(groupSum).toBe(107_746);
    expect(groupCount).toBe(3);
    expect(blockSums).toEqual([95_401, 12_345]);
    expect(blockCounts).toEqual([2, 1]);
  });

  it("todo el texto va en el juego de caracteres SEPA", () => {
    const xml = buildPain008(golden);
    const texts = [...xml.matchAll(/>([^<]+)</g)].map((m) => m[1]!.replace(/&apos;/g, "'")).filter((t) => t.trim() !== "");
    expect(texts.length).toBeGreaterThan(50);
    for (const text of texts) expect(isSepaText(text), text).toBe(true);
    expect(values(xml, "Nm")).toContain("Perez + Hijos Distribucion, S.A.");
  });

  it("sin adeudos de un tipo no hay bloque de ese tipo, y sin BIC el agente va como NOTPROVIDED", () => {
    const xml = buildPain008({ ...golden, transactions: golden.transactions.filter((t) => t.sequenceType === "RCUR") });
    expect(values(xml, "SeqTp")).toEqual(["RCUR"]);
    const noBic = buildPain008({ ...golden, creditor: { ...golden.creditor, bic: null } });
    expect(noBic).toContain("<CdtrAgt>\n        <FinInstnId>\n          <Othr>\n            <Id>NOTPROVIDED</Id>");
  });

  it("rechaza datos que el banco no aceptaría", () => {
    const tx = golden.transactions[0]!;
    const withTx = (patch: Partial<typeof tx>) => ({ ...golden, transactions: [{ ...tx, ...patch }] });
    expect(() => buildPain008({ ...golden, transactions: [] })).toThrow();
    expect(() => buildPain008(withTx({ amountCents: 0 }))).toThrow();
    expect(() => buildPain008(withTx({ amountCents: -100 }))).toThrow();
    expect(() => buildPain008(withTx({ amountCents: 12.5 }))).toThrow();
    expect(() => buildPain008(withTx({ amountCents: SEPA_LIMITS.maxAmountCents + 1 }))).toThrow();
    expect(() => buildPain008(withTx({ debtorIban: "ES7921000813610123456780" }))).toThrow(/IBAN/);
    expect(() => buildPain008(withTx({ debtorBic: "NOPE" }))).toThrow(/BIC/);
    expect(() => buildPain008(withTx({ mandateId: "CON ESPACIO" }))).toThrow();
    expect(() => buildPain008(withTx({ debtorName: "🙂" }))).toThrow();
    expect(() => buildPain008({ ...golden, transactions: [tx, tx] })).toThrow(/repetida/);
    expect(() => buildPain008({ ...golden, creditor: { ...golden.creditor, creditorId: "ES12000B12345674" } })).toThrow();
    expect(() => buildPain008({ ...golden, createdAt: "2026-09-26 10:15" })).toThrow();
  });
});

describe("importes e identificadores", () => {
  it("escribe los céntimos con dos decimales exactos", () => {
    expect(formatSepaAmount(95_400)).toBe("954.00");
    expect(formatSepaAmount(5)).toBe("0.05");
    expect(formatSepaAmount(0)).toBe("0.00");
    expect(formatSepaAmount(100_001)).toBe("1000.01");
    expect(formatSepaAmount(SEPA_LIMITS.maxAmountCents)).toBe("999999999.99");
    expect(() => formatSepaAmount(-1)).toThrow();
  });

  it("suma céntimos sin perder precisión", () => {
    expect(sumCents([10, 20, 30])).toBe(60);
    expect(sumCents(Array.from({ length: 1000 }, () => SEPA_LIMITS.maxAmountCents))).toBe(99_999_999_999_000);
    expect(sumCents([])).toBe(0);
  });

  it("las referencias del fichero y de cada adeudo son identificadores SEPA de hasta 35 caracteres", () => {
    const msgId = remittanceMessageId("2026-09-26T10:15:30", "7c9e6679-7425-40de-944b-e07fc1f90ae7");
    expect(msgId).toBe("REM-20260926101530-7C9E6679");
    expect(isSepaIdentifier(`${msgId}-FRST`)).toBe(true);
    const e2e = endToEndId("F/2026/000000000000000000000000038", "0f8fad5b-d9cb-469f-a165-70867728950e");
    expect(e2e.length).toBeLessThanOrEqual(35);
    expect(isSepaIdentifier(e2e)).toBe(true);
    expect(endToEndId("2026-0038", "0f8fad5b-d9cb-469f-a165-70867728950e")).toBe("2026-0038-0F8FAD5B");
    expect(endToEndId("", "0f8fad5b-d9cb-469f-a165-70867728950e")).toBe("RECIBO-0F8FAD5B");
  });
});
