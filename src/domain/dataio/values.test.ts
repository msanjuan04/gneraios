import { describe, expect, it } from "vitest";
import {
  classifyTaxId,
  excelSerialToCivil,
  inferDateOrder,
  inferDecimalSeparator,
  isScientificNumber,
  parseAmountCents,
  parseBooleanLoose,
  parseCountry,
  parseDateLoose,
  parseEmails,
  parseLanguage,
  parsePaymentMethod,
  parsePostalCode,
  parseQuantity,
  parseRateBps,
} from "./values";

describe("importes", () => {
  it.each([
    ["1.234,56", 123_456],
    ["1234,56", 123_456],
    ["1234,5", 123_450],
    ["1.234", 123_400],
    ["1.234.567", 123_456_700],
    [" 1 234,56 € ", 123_456],
    ["-1.234,56", -123_456],
    ["1.234,56-", -123_456],
    ["(1.234,56)", -123_456],
    ["−12,00", -1200],
    ["EUR 100", 10_000],
    ["100 euros", 10_000],
    [",5", 50],
    ["0,005", 1],
    ["-0,005", -1],
    ["12,344", 1234],
    ["1234.5", 123_450],
    ["0", 0],
  ])("coma decimal: «%s» → %i céntimos", (input, cents) => {
    expect(parseAmountCents(input, ",")).toBe(cents);
  });

  it.each([
    ["1,234.56", 123_456],
    ["1234.56", 123_456],
    ["1,234", 123_400],
    ["12,5", 1250],
    ["1.234,56", 123_456],
  ])("punto decimal: «%s» → %i céntimos", (input, cents) => {
    expect(parseAmountCents(input, ".")).toBe(cents);
  });

  it.each(["", "abc", "12,", "1.23.45", "12,34,56,7", "1e5", "--1", "1.234,56.7"])("«%s» no es un importe", (input) => {
    expect(parseAmountCents(input, ",")).toBeNull();
  });

  it("deduce el separador decimal de una columna", () => {
    expect(inferDecimalSeparator(["1.234,56", "12", "150,00"], ".")).toBe(",");
    expect(inferDecimalSeparator(["1234.56", "12.5"], ",")).toBe(".");
    expect(inferDecimalSeparator(["1.234", "12"], ".")).toBe(".");
    expect(inferDecimalSeparator(["1.234.567"], ".")).toBe(",");
    expect(inferDecimalSeparator([], ",")).toBe(",");
  });
});

describe("cantidades y porcentajes", () => {
  it("cantidades con hasta 3 decimales, positivas", () => {
    expect(parseQuantity("1,5", ",")).toEqual({ value: "1.5", negative: false });
    expect(parseQuantity("-2", ",")).toEqual({ value: "2", negative: true });
    expect(parseQuantity("0,125", ",")).toEqual({ value: "0.125", negative: false });
    expect(parseQuantity("1,2345", ",")).toBeNull();
    expect(parseQuantity("0", ",")).toBeNull();
  });

  it.each([
    ["21", 2100],
    ["21 %", 2100],
    ["21,00", 2100],
    ["0,21", 2100],
    ["10,5", 1050],
    ["0", 0],
    ["0,5 %", 50],
    ["15%", 1500],
  ])("«%s» → %i pb", (input, bps) => {
    expect(parseRateBps(input, ",")).toBe(bps);
  });

  it("fuera de 0-100 % no es un tipo", () => {
    expect(parseRateBps("150", ",")).toBeNull();
    expect(parseRateBps("-21", ",")).toBeNull();
    expect(parseRateBps("IVA", ",")).toBeNull();
  });
});

describe("fechas", () => {
  it.each([
    ["05/01/2026", "2026-01-05"],
    ["5/1/2026", "2026-01-05"],
    ["05-01-2026", "2026-01-05"],
    ["05.01.2026", "2026-01-05"],
    ["05/01/26", "2026-01-05"],
    ["2026-01-05", "2026-01-05"],
    ["2026/1/5", "2026-01-05"],
    ["2026-01-05T10:30:00Z", "2026-01-05"],
    ["05/01/2026 0:00", "2026-01-05"],
    ["46027", "2026-01-05"],
  ])("«%s» → %s", (input, date) => {
    expect(parseDateLoose(input)).toBe(date);
  });

  it("fechas imposibles o irreconocibles", () => {
    expect(parseDateLoose("31/02/2026")).toBeNull();
    expect(parseDateLoose("2026-13-01")).toBeNull();
    expect(parseDateLoose("enero 2026")).toBeNull();
    expect(parseDateLoose("")).toBeNull();
    expect(excelSerialToCivil(12)).toBeNull();
  });

  it("orden día/mes: por defecto dd/mm; mm/dd solo si la columna lo deja claro", () => {
    expect(inferDateOrder(["03/04/2026", "15/04/2026"])).toBe("dmy");
    expect(inferDateOrder(["03/04/2026", "04/15/2026"])).toBe("mdy");
    expect(inferDateOrder(["03/04/2026"])).toBe("dmy");
    expect(parseDateLoose("04/15/2026", "mdy")).toBe("2026-04-15");
  });
});

describe("sí/no, emails, idioma y forma de pago", () => {
  it("sí / no y los estados de cobro", () => {
    expect(parseBooleanLoose("Sí")).toBe(true);
    expect(parseBooleanLoose("x")).toBe(true);
    expect(parseBooleanLoose("Cobrada")).toBe(true);
    expect(parseBooleanLoose("paid")).toBe(true);
    expect(parseBooleanLoose("No")).toBe(false);
    expect(parseBooleanLoose("Pendiente")).toBe(false);
    expect(parseBooleanLoose("overdue")).toBe(false);
    expect(parseBooleanLoose("quizá")).toBeNull();
    expect(parseBooleanLoose("")).toBeNull();
  });

  it("uno o varios emails en una celda", () => {
    expect(parseEmails(" Info@Port.cat ")).toEqual({ email: "info@port.cat", extra: [], invalid: [] });
    expect(parseEmails("a@x.com; b@y.com")).toEqual({ email: "a@x.com", extra: ["b@y.com"], invalid: [] });
    expect(parseEmails("Ana <ana@x.com>")).toEqual({ email: "ana@x.com", extra: [], invalid: [] });
    expect(parseEmails("ana@x")).toEqual({ email: null, extra: [], invalid: ["ana@x"] });
    expect(parseEmails("")).toEqual({ email: null, extra: [], invalid: [] });
  });

  it("idiomas y formas de pago de la app de facturas", () => {
    expect(parseLanguage("Català")).toBe("ca");
    expect(parseLanguage("English")).toBe("en");
    expect(parseLanguage("klingon")).toBeNull();
    expect(parsePaymentMethod("Transferencia")).toBe("transfer");
    expect(parsePaymentMethod("Bizum")).toBe("other");
    expect(parsePaymentMethod("Stripe")).toBe("card");
    expect(parsePaymentMethod("Efectivo")).toBe("cash");
    expect(parsePaymentMethod("Domiciliación SEPA")).toBe("sepa_debit");
  });
});

describe("países, NIF y códigos postales", () => {
  it("países por nombre o código", () => {
    expect(parseCountry("España")).toBe("ES");
    expect(parseCountry("Espanya")).toBe("ES");
    expect(parseCountry("fr")).toBe("FR");
    expect(parseCountry("UK")).toBe("GB");
    expect(parseCountry("Reino Unido")).toBe("GB");
    expect(parseCountry("Atlántida")).toBeNull();
  });

  it("NIF español (también con el prefijo ES), IVA intracomunitario y extranjero", () => {
    expect(classifyTaxId("b-1234567-4", "ES")).toEqual({ ok: true, kind: "es", value: "B12345674" });
    expect(classifyTaxId("ESB12345674", null)).toEqual({ ok: true, kind: "es", value: "B12345674" });
    expect(classifyTaxId("12.345.678-Z", null)).toEqual({ ok: true, kind: "es", value: "12345678Z" });
    expect(classifyTaxId("FR12345678901", "FR")).toEqual({ ok: true, kind: "eu_vat", value: "FR12345678901" });
    expect(classifyTaxId("FR12345678901", null)).toEqual({ ok: true, kind: "eu_vat", value: "FR12345678901" });
    expect(classifyTaxId("12-3456789", "US")).toEqual({ ok: true, kind: "foreign", value: "123456789" });
  });

  it("un NIF con forma española y el control mal es un error; lo irreconocible, también", () => {
    expect(classifyTaxId("12345678A", "ES")).toEqual({ ok: false, reason: "control" });
    expect(classifyTaxId("B12345670", null)).toEqual({ ok: false, reason: "control" });
    expect(classifyTaxId("ABC", "ES")).toEqual({ ok: false, reason: "format" });
    expect(classifyTaxId("", "ES")).toEqual({ ok: false, reason: "format" });
  });

  it("código postal: repone el cero que Excel se come", () => {
    expect(parsePostalCode("8301", "ES")).toEqual({ value: "08301", padded: true, valid: true });
    expect(parsePostalCode("08301", "ES")).toEqual({ value: "08301", padded: false, valid: true });
    expect(parsePostalCode("083", "ES")).toEqual({ value: "083", padded: false, valid: false });
    expect(parsePostalCode("75001", "FR")).toEqual({ value: "75001", padded: false, valid: true });
    expect(parsePostalCode("", "ES")).toEqual({ value: null, padded: false, valid: true });
  });

  it("teléfonos convertidos en número por Excel", () => {
    expect(isScientificNumber("6,12E+08")).toBe(true);
    expect(isScientificNumber("612 345 678")).toBe(false);
  });
});
