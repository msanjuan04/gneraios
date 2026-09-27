import { describe, expect, it } from "vitest";
import { parseMoneyInput } from "../money";
import {
  bpsToInput,
  centsToInput,
  discountToInput,
  parseDiscountInput,
  parsePercentInput,
  parseQuantityInput,
  quantityText,
  quantityToInput,
} from "./input";

describe("valores escritos como en un formulario", () => {
  it("importes con coma decimal y sin miles, que parseMoneyInput lee igual", () => {
    for (const [cents, text] of [
      [180_000, "1800"],
      [150_050, "1500,50"],
      [5, "0,05"],
      [0, "0"],
      [123_456_789, "1234567,89"],
    ] as const) {
      expect(centsToInput(cents)).toBe(text);
      expect(parseMoneyInput(text)).toBe(cents);
    }
  });

  it("porcentajes y descuentos (vacío si no hay)", () => {
    expect(bpsToInput(1_000)).toBe("10");
    expect(bpsToInput(1_250)).toBe("12,5");
    expect(bpsToInput(3_333)).toBe("33,33");
    expect(discountToInput(0)).toBe("");
    expect(discountToInput(1_500)).toBe("15");
    for (const bps of [0, 5, 1_000, 1_250, 3_333, 10_000]) expect(parsePercentInput(bpsToInput(bps))).toBe(bps);
    expect(parsePercentInput("12.5 %")).toBe(1_250);
    expect(parsePercentInput("100,01")).toBeNull();
    expect(parsePercentInput("abc")).toBeNull();
    expect(parseDiscountInput("")).toBe(0);
  });

  it("cantidades: numeric → texto canónico → coma decimal, y de vuelta", () => {
    expect(quantityText(2)).toBe("2");
    expect(quantityText(2.5)).toBe("2.5");
    expect(quantityText("2.500")).toBe("2.5");
    expect(quantityText("0.125")).toBe("0.125");
    expect(() => quantityText("0")).toThrow();
    expect(() => quantityText("1.2345")).toThrow();
    expect(quantityToInput("2.5")).toBe("2,5");
    expect(parseQuantityInput("2,5")).toBe("2.5");
    expect(parseQuantityInput("2.50")).toBe("2.5");
    expect(parseQuantityInput("010")).toBe("10");
    expect(parseQuantityInput("0")).toBeNull();
    expect(parseQuantityInput("1.000,5")).toBeNull();
    expect(parseQuantityInput("")).toBeNull();
  });
});
