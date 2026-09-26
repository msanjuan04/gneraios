import { describe, expect, it } from "vitest";
import { formatIban, normalizeIban, normalizeTaxId, validateIban, validateSpanishTaxId } from "./tax-id";

// Only public documentation examples and synthetic values computed with the algorithms.

describe("normalizeTaxId", () => {
  it("uppercases and strips spaces, dots and dashes", () => {
    expect(normalizeTaxId(" 12.345.678-z ")).toBe("12345678Z");
    expect(normalizeTaxId("x 1234567 l")).toBe("X1234567L");
    expect(normalizeTaxId("b–1234567‑4 ")).toBe("B12345674");
    expect(normalizeTaxId("")).toBe("");
  });
});

describe("validateSpanishTaxId", () => {
  it("accepts DNIs with the right control letter", () => {
    for (const dni of ["12345678Z", "00000000T", "99999999R"]) {
      expect(validateSpanishTaxId(dni)).toEqual({ valid: true, kind: "dni", normalized: dni });
    }
    expect(validateSpanishTaxId("12.345.678-z")).toEqual({ valid: true, kind: "dni", normalized: "12345678Z" });
  });

  it("rejects DNIs with a wrong control letter but still recognises them", () => {
    expect(validateSpanishTaxId("12345678A")).toEqual({ valid: false, kind: "dni", normalized: "12345678A" });
    expect(validateSpanishTaxId("00000000R")).toMatchObject({ valid: false, kind: "dni" });
  });

  it("accepts NIEs, mapping X/Y/Z to 0/1/2", () => {
    for (const nie of ["X1234567L", "Y1234567X", "Z1234567R"]) {
      expect(validateSpanishTaxId(nie)).toEqual({ valid: true, kind: "nie", normalized: nie });
    }
    expect(validateSpanishTaxId("x-1234567-l")).toEqual({ valid: true, kind: "nie", normalized: "X1234567L" });
  });

  it("rejects NIEs with a wrong control letter", () => {
    expect(validateSpanishTaxId("X1234567T")).toEqual({ valid: false, kind: "nie", normalized: "X1234567T" });
    expect(validateSpanishTaxId("Y1234567L")).toMatchObject({ valid: false, kind: "nie" });
  });

  // [7 digits, control digit, control letter], computed by hand; covers every control value.
  const cifControls: [string, string, string][] = [
    ["0000000", "0", "J"], ["5555555", "1", "A"], ["0000004", "2", "B"], ["0000008", "3", "C"],
    ["1234567", "4", "D"], ["0000007", "5", "E"], ["4444444", "6", "F"], ["9999999", "7", "G"],
    ["2222222", "8", "H"], ["1111111", "9", "I"],
  ];

  it("requires a control digit for CIFs starting with A, B, E or H", () => {
    for (const letter of "ABEH") {
      for (const [digits, digit, controlLetter] of cifControls) {
        const offByOne = String((Number(digit) + 1) % 10);
        expect(validateSpanishTaxId(letter + digits + digit), letter + digits + digit).toMatchObject({ valid: true, kind: "cif" });
        expect(validateSpanishTaxId(letter + digits + controlLetter).valid, letter + digits + controlLetter).toBe(false);
        expect(validateSpanishTaxId(letter + digits + offByOne).valid, letter + digits + offByOne).toBe(false);
      }
    }
  });

  it("requires a control letter for CIFs starting with K, P, Q, S, N or W", () => {
    for (const letter of "KPQSNW") {
      for (const [digits, digit, controlLetter] of cifControls) {
        const offByOne = "JABCDEFGHI"[(Number(digit) + 1) % 10];
        expect(validateSpanishTaxId(letter + digits + controlLetter), letter + digits + controlLetter).toMatchObject({ valid: true, kind: "cif" });
        expect(validateSpanishTaxId(letter + digits + digit).valid, letter + digits + digit).toBe(false);
        expect(validateSpanishTaxId(letter + digits + offByOne).valid, letter + digits + offByOne).toBe(false);
      }
    }
  });

  it("accepts either a digit or a letter for the other organisation letters", () => {
    for (const letter of "CDFGJRUV") {
      for (const [digits, digit, controlLetter] of cifControls) {
        const offByOne = String((Number(digit) + 9) % 10);
        expect(validateSpanishTaxId(letter + digits + digit).valid, letter + digits + digit).toBe(true);
        expect(validateSpanishTaxId(letter + digits + controlLetter).valid, letter + digits + controlLetter).toBe(true);
        expect(validateSpanishTaxId(letter + digits + offByOne).valid, letter + digits + offByOne).toBe(false);
      }
    }
  });

  it("normalizes CIFs and flags wrong control characters", () => {
    expect(validateSpanishTaxId("b-1234567-4")).toEqual({ valid: true, kind: "cif", normalized: "B12345674" });
    expect(validateSpanishTaxId("B12345675")).toEqual({ valid: false, kind: "cif", normalized: "B12345675" });
    expect(validateSpanishTaxId("G1234567K")).toMatchObject({ valid: false, kind: "cif" });
  });

  it("returns kind null for unknown formats", () => {
    const unknown = [
      "", "1234567Z", "123456789", "123456789Z", "X12345678L", "X123456L", "W1234567", "B123456744",
      "I12345674", "O12345674", "L1234567D", "ES12345678Z", "12345678Ñ",
    ];
    for (const input of unknown) {
      expect(validateSpanishTaxId(input), input).toEqual({ valid: false, kind: null, normalized: normalizeTaxId(input) });
    }
  });
});

describe("IBAN", () => {
  const example = "ES91 2100 0418 4502 0005 1332";

  it("normalizes to the electronic format", () => {
    expect(normalizeIban(` ${example.toLowerCase()} `)).toBe("ES9121000418450200051332");
    expect(normalizeIban("ES91-2100-0418")).toBe("ES9121000418");
  });

  it("accepts valid IBANs in print or electronic format", () => {
    expect(validateIban(example)).toBe(true);
    expect(validateIban("ES9121000418450200051332")).toBe(true);
    expect(validateIban(example.toLowerCase())).toBe(true);
    expect(validateIban("GB82 WEST 1234 5698 7654 32")).toBe(true);
    expect(validateIban("DE89 3704 0044 0532 0130 00")).toBe(true);
  });

  it("rejects wrong check digits or a single mistyped character", () => {
    expect(validateIban("ES92 2100 0418 4502 0005 1332")).toBe(false);
    expect(validateIban("ES91 2100 0418 4502 0005 1333")).toBe(false);
    expect(validateIban("ES91 2100 0418 4502 0005 3132")).toBe(false);
    expect(validateIban("GB82 WEST 1234 5698 7654 33")).toBe(false);
  });

  it("enforces the Spanish length of 24 and a numeric BBAN", () => {
    expect(validateIban("ES91 2100 0418 4502 0005 133")).toBe(false);
    expect(validateIban("ES91 2100 0418 4502 0005 13320")).toBe(false);
    expect(validateIban("ES91 2100 0418 4502 0005 13A2")).toBe(false);
  });

  it("rejects check digits outside 02–98 even when mod 97 passes", () => {
    // Synthetic all-zero accounts: each pair differs only in 98↔01, 97↔00 and 02↔99, which are
    // congruent mod 97, so only the range rule tells them apart.
    expect(validateIban("ES98 0000 0000 0000 0000 0003")).toBe(true);
    expect(validateIban("ES01 0000 0000 0000 0000 0003")).toBe(false);
    expect(validateIban("ES97 0000 0000 0000 0000 0021")).toBe(true);
    expect(validateIban("ES00 0000 0000 0000 0000 0021")).toBe(false);
    expect(validateIban("ES02 0000 0000 0000 0000 0082")).toBe(true);
    expect(validateIban("ES99 0000 0000 0000 0000 0082")).toBe(false);
  });

  it("rejects malformed input", () => {
    for (const input of ["", "ES", "ES91", "1291 2100 0418 4502 0005 1332", "ESAB 2100 0418 4502 0005 1332", "ES91 2100 0418 4502 0005 1332!"]) {
      expect(validateIban(input), input).toBe(false);
    }
  });

  it("formats in groups of four", () => {
    expect(formatIban("ES9121000418450200051332")).toBe(example);
    expect(formatIban(" es91-2100 0418 4502 0005 1332")).toBe(example);
    expect(formatIban("GB82WEST12345698765432")).toBe("GB82 WEST 1234 5698 7654 32");
    expect(formatIban("ES91")).toBe("ES91");
    expect(formatIban("")).toBe("");
  });
});
