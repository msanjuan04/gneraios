import { describe, expect, it } from "vitest";
import { layoutLines, layoutPages } from "./layout";
import { labelBefore, wholeLabel } from "./labels";
import { collapseLetterSpacing, foldSameLength, splitCells, squash } from "./text";
import { amountToCents, findDates, findIbans, findMoney, findPercents, findTaxIds, percentToBps, quantityOf } from "./tokens";

describe("texto", () => {
  it("las etiquetas con espaciado de letras se juntan sin mover lo que sigue", () => {
    const line = "F E C H A D E E M I S I Ó N      V E N C I M I E N T O";
    const collapsed = collapseLetterSpacing(line);
    expect(collapsed).toHaveLength(line.length);
    expect(collapsed.trim().split(/\s{2,}/)).toEqual(["FECHADEEMISIÓN", "VENCIMIENTO"]);
    expect(collapsed.indexOf("VENCIMIENTO")).toBe(line.indexOf("V E N"));
    expect(collapseLetterSpacing("Plan A B de marketing")).toBe("Plan A B de marketing");
  });

  it("plegar sin acentos no cambia las posiciones", () => {
    expect(foldSameLength("Nº Fàctura CIÓ ª")).toBe("no factura cio a");
    expect(squash("% IVA")).toBe("pctiva");
    expect(squash("Importe (€)")).toBe("importeeur");
    expect(squash("D'EMISSIÓ")).toBe("demissio");
  });

  it("celdas: separadas por dos espacios o más", () => {
    expect(splitCells("  Base imponible     900,00 €").map((c) => [c.text, c.start])).toEqual([
      ["Base imponible", 2],
      ["900,00 €", 21],
    ]);
  });

  it("etiquetas: palabra entera, la más larga y la más cercana al valor", () => {
    expect(wholeLabel("F E C H A D E V E N C I M I E N T O")?.kind).toBe("dueDate");
    expect(wholeLabel("IVA 21 %")?.kind).toBe("vat");
    expect(wholeLabel("Total (EUR)")?.kind).toBe("total");
    expect(wholeLabel("Fechas de entrega")).toBeNull();
    const text = "Total sin IVA: ";
    expect(labelBefore(text, text.length)?.kind).toBe("base");
    const iva = "IBAN ES00 0000    IVA 21 %   ";
    expect(labelBefore(iva, iva.length)?.kind).toBe("vat");
    const far = "IVA sobre el importe   ";
    expect(labelBefore(far, far.length)).toBeNull();
  });
});

describe("fechas", () => {
  it.each([
    ["Fecha: 15/03/2025", "2025-03-15"],
    ["15-03-2025", "2025-03-15"],
    ["15.03.2025", "2025-03-15"],
    ["15/03/25", "2025-03-15"],
    ["2025-03-15", "2025-03-15"],
    ["15 de marzo de 2025", "2025-03-15"],
    ["3 de març de 2024", "2024-03-03"],
    ["2 d'abril de 2024", "2024-04-02"],
    ["1 de gener del 2025", "2025-01-01"],
    ["15 mar. 2025", "2025-03-15"],
    ["June 12, 2025", "2025-06-12"],
    ["12 June 2025", "2025-06-12"],
  ])("«%s» → %s", (text, date) => {
    expect(findDates(text).map((d) => d.value)).toEqual([date]);
  });

  it("no son fechas: un número de factura, un día imposible, una fracción, un teléfono", () => {
    expect(findDates("Factura 2025-0042")).toEqual([]);
    expect(findDates("31/02/2025")).toEqual([]);
    expect(findDates("prorrata 17/31 días")).toEqual([]);
    expect(findDates("Tel. 93.123.45.67")).toEqual([]);
  });

  it("dos fechas en la línea, con su posición", () => {
    const line = "Periodo 01/09/2026 - 30/09/2026";
    expect(findDates(line).map((d) => [d.value, line.slice(d.start, d.end)])).toEqual([
      ["2026-09-01", "01/09/2026"],
      ["2026-09-30", "30/09/2026"],
    ]);
  });
});

describe("importes y porcentajes", () => {
  it.each([
    ["1.234,56 €", 123_456],
    ["1234,56", 123_456],
    ["€ 12,00", 1200],
    ["EUR 3,740.00", 374_000],
    ["3,500.00", 350_000],
    ["240.00", 24_000],
    ["-135,00 €", -13_500],
    ["- 180,00 €", -18_000],
    ["(90,00)", -9000],
    ["150 €", 15_000],
    ["1.500 €", 150_000],
  ])("«%s» → %i céntimos", (text, cents) => {
    expect(findMoney(text).map((m) => m.cents)).toEqual([cents]);
  });

  it("no son importes: cantidades sin decimales, porcentajes, códigos y lo que está enmascarado", () => {
    expect(findMoney("Cantidad 3,5 horas")).toEqual([]);
    expect(findMoney("IVA 21,00 %")).toEqual([]);
    expect(findMoney("F2025-12,50")).toEqual([]);
    expect(findMoney("15.03.2025", findDates("15.03.2025"))).toEqual([]);
    expect(findMoney("12 unidades")).toEqual([]);
  });

  it("céntimos de un número a la española o a la inglesa", () => {
    expect(amountToCents("1.234.567,89", false)).toBe(123_456_789);
    expect(amountToCents("1,234,567.89", false)).toBe(123_456_789);
    expect(amountToCents("1.234", false)).toBeNull();
    expect(amountToCents("1.234", true)).toBe(123_400);
    expect(amountToCents("12,345", false)).toBeNull();
  });

  it("porcentajes a puntos básicos", () => {
    expect(findPercents("IVA 21 % · IRPF (-15%) · 10,5%").map((p) => p.bps)).toEqual([2100, 1500, 1050]);
    expect(percentToBps("21,00")).toBe(2100);
    expect(percentToBps("101")).toBeNull();
  });

  it("cantidades", () => {
    expect(quantityOf("3,5")).toBe("3.5");
    expect(quantityOf("2,000")).toBe("2");
    expect(quantityOf("1.000")).toBe("1000");
    expect(quantityOf("0")).toBeNull();
    expect(quantityOf("1,2345")).toBeNull();
  });
});

describe("NIF e IBAN", () => {
  it("DNI, NIE y CIF válidos, con separadores y con el prefijo ES", () => {
    const text = "NIF 12.345.678-Z · CIF: B-12345674 · NIE X1234567L · ESB09876541 · CIF B12345670";
    expect(findTaxIds(text).map((t) => t.value)).toEqual(["12345678Z", "B12345674", "X1234567L", "B09876541"]);
  });

  it("IVA de otros países de la UE, solo detrás de su etiqueta", () => {
    expect(findTaxIds("VAT number: FR12345678901").map((t) => [t.value, t.kind])).toEqual([["FR12345678901", "eu_vat"]]);
    expect(findTaxIds("Ref FR12345678901")).toEqual([]);
  });

  it("un IBAN no es un NIF ni un importe", () => {
    const line = "IBAN: ES91 2100 0418 4502 0005 1332";
    expect(findIbans(line)).toHaveLength(1);
    expect(findTaxIds(line)).toEqual([]);
    expect(findMoney(line, findIbans(line))).toEqual([]);
  });
});

describe("maquetar el texto del PDF", () => {
  const item = (str: string, x: number, y: number, size = 10) => ({ str, x, y, width: str.length * size * 0.5, height: size });

  it("lo que está a la misma altura va en la misma línea, cada cosa en su columna", () => {
    const lines = layoutLines([
      item("FECHA", 50, 700, 7),
      item("VENCIMIENTO", 200, 700, 7),
      item("15/03/2025", 50, 686),
      item("14/04/2025", 200, 686),
      // El importe en grande, un poco más abajo que su etiqueta: la misma línea.
      item("TOTAL", 300, 600, 8),
      item("954,00 €", 400, 597, 15),
    ]);
    expect(lines).toHaveLength(3);
    const [labels, values] = lines as [string, string, string];
    expect(values.indexOf("14/04/2025")).toBe(labels.indexOf("VENCIMIENTO"));
    expect(lines[2]!.trim().split(/\s{2,}/)).toEqual(["TOTAL", "954,00 €"]);
  });

  it("trozos pegados se juntan; separados, con un espacio o como otra columna", () => {
    const [line] = layoutLines([item("Fecha:", 50, 700), item("15/03/2025", 83, 700), item("Nº", 200, 700), item("42", 213, 700), item("€", 223, 700)]);
    expect(line!.trim().split(/\s{2,}/)).toEqual(["Fecha: 15/03/2025", "Nº 42€"]);
  });

  it("las páginas van seguidas, separadas por una línea en blanco", () => {
    expect(layoutPages([[item("Uno", 0, 10)], [item("Dos", 0, 10)]])).toBe("Uno\n\nDos");
    expect(layoutLines([item("   ", 0, 0)])).toEqual([]);
  });
});
