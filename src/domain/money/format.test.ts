import { describe, expect, it } from "vitest";
import { formatBps, formatMoney, parseMoneyInput } from "./format";

// Intl separates the number from "€" and "%" with a non-breaking space.
const NBSP = " ";
const eur = (text: string) => `${text}${NBSP}€`;

describe("formatMoney", () => {
  it("groups thousands of 4-digit amounts in es-ES", () => {
    // The pitfall: plain es-ES leaves 4-digit numbers ungrouped.
    expect(new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(4730)).toBe(eur("4730,00"));
    expect(formatMoney(473000)).toBe(eur("4.730,00"));
    expect(formatMoney(473000)).toBe("4.730,00 €");
  });

  it("formats typical amounts in euros", () => {
    const cases: [number, string][] = [
      [0, "0,00"], [5, "0,05"], [100, "1,00"], [95400, "954,00"], [123456, "1.234,56"],
      [123456789, "1.234.567,89"], [-5, "-0,05"], [-123456, "-1.234,56"],
    ];
    for (const [cents, text] of cases) expect(formatMoney(cents)).toBe(eur(text));
  });

  it("is exact up to the largest safe integer and never prints -0", () => {
    expect(formatMoney(Number.MAX_SAFE_INTEGER)).toBe(eur("90.071.992.547.409,91"));
    expect(formatMoney(Number.MIN_SAFE_INTEGER)).toBe(eur("-90.071.992.547.409,91"));
    expect(formatMoney(-0)).toBe(eur("0,00"));
  });

  it("accepts other locales and currencies", () => {
    expect(formatMoney(473000, { locale: "en-US", currency: "USD" })).toBe("$4,730.00");
    expect(formatMoney(473000, { locale: "ca-ES" })).toBe(eur("4.730,00"));
    expect(formatMoney(-123456, { locale: "en-US" })).toBe("-€1,234.56");
  });

  it("rejects amounts that are not integer cents", () => {
    expect(() => formatMoney(10.5)).toThrow(/céntimos/);
    expect(() => formatMoney(Number.NaN)).toThrow(/céntimos/);
  });
});

describe("formatBps", () => {
  it("formats basis points as a percentage with up to 2 decimals", () => {
    const cases: [number, string][] = [
      [2100, "21"], [1550, "15,5"], [1500, "15"], [700, "7"], [0, "0"], [1, "0,01"], [12345, "123,45"], [-700, "-7"],
    ];
    for (const [bps, text] of cases) expect(formatBps(bps)).toBe(`${text}${NBSP}%`);
  });

  it("accepts another locale", () => {
    expect(formatBps(1550, "en-US")).toBe("15.5%");
    expect(formatBps(1550, "ca-ES")).toBe(`15,5${NBSP}%`);
  });

  it("rejects non-integer basis points", () => {
    expect(() => formatBps(21.5)).toThrow(/puntos básicos/);
  });
});

describe("parseMoneyInput", () => {
  const expectParsed = (cases: [string, number][]) => {
    for (const [input, cents] of cases) expect(parseMoneyInput(input), JSON.stringify(input)).toBe(cents);
  };

  it("treats a comma as the decimal separator and dots as thousands separators", () => {
    expectParsed([
      ["1.234,56", 123456], ["1234,56", 123456], ["1234,5", 123450], ["12,00", 1200], ["0,05", 5],
      [",5", 50], ["1.234.567,89", 123456789], ["1.234,5", 123450],
    ]);
  });

  it("reads integers and dotted thousands when there is no comma", () => {
    expectParsed([["1234", 123400], ["0", 0], ["007", 700], ["1.234", 123400], ["1.234.567", 123456700], ["12.345", 1234500]]);
  });

  it("treats a single dot followed by 1–2 digits as the decimal separator", () => {
    expectParsed([["1234.5", 123450], ["1234.56", 123456], ["12.34", 1234], ["1.23", 123], ["1.2", 120], ["0.5", 50], [".5", 50]]);
  });

  it("ignores whitespace and a single euro sign at either end", () => {
    expectParsed([
      [" 1.234,56 € ", 123456], ["1234,56€", 123456], ["€1234,56", 123456], ["€ 12", 1200],
      ["1 234,56", 123456], [eur("4.730,00"), 473000], ["\t12\n", 1200], ["12 345,00", 1234500],
    ]);
  });

  it("supports a leading minus sign", () => {
    expectParsed([["-1.234,56 €", -123456], ["-€12", -1200], ["- 12,5", -1250], ["-0,00", 0], ["-.5", -50]]);
  });

  it("returns null for anything else", () => {
    const invalid = [
      "", "   ", "€", "-", ",", ".", "abc", "12a", "1e3", "Infinity", "NaN", "0x10",
      "1,234.56", "1,234", "12,345", "1.2345", "12.34.56", "1.23.456", "1234.567,89", "1..2", "12,5.3", "1,2,3",
      "12,", "12.", "--12", "12-", "+12", "−12", "€-12", "€12€", "12 €€", "EUR 12", "12$",
    ];
    for (const input of invalid) expect(parseMoneyInput(input), JSON.stringify(input)).toBeNull();
  });

  it("returns null outside the safe integer range", () => {
    expect(parseMoneyInput("90.071.992.547.409,91")).toBe(Number.MAX_SAFE_INTEGER);
    expect(parseMoneyInput("-90.071.992.547.409,91")).toBe(Number.MIN_SAFE_INTEGER);
    expect(parseMoneyInput("90.071.992.547.409,92")).toBeNull();
    expect(parseMoneyInput("99999999999999999999")).toBeNull();
  });

  it("round-trips formatMoney output", () => {
    const samples = [0, 1, 5, 99, 100, 473000, -473000, 123456789, -5, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER];
    for (let i = 1; i < 500; i++) samples.push(i * 7919 * (i % 2 === 0 ? 1 : -1), i ** 5);
    for (const cents of samples) expect(parseMoneyInput(formatMoney(cents)), String(cents)).toBe(cents);
  });
});

describe("formatMoney con wholeUnits", () => {
  it("quita los céntimos solo si el importe es redondo", () => {
    const nbsp = (v: string) => v.replace(/\u00a0/g, " ");
    expect(nbsp(formatMoney(1_200_000, { wholeUnits: true }))).toBe("12.000 €");
    expect(nbsp(formatMoney(1_200_050, { wholeUnits: true }))).toBe("12.000,50 €");
    expect(nbsp(formatMoney(1_200_000))).toBe("12.000,00 €");
  });
});
