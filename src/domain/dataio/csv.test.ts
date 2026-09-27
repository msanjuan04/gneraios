import { describe, expect, it } from "vitest";
import { detectDelimiter, parseCsv, protectFormula, toCsv } from "./csv";

describe("parseCsv", () => {
  it("Excel en español: ';', decimales con coma y filas rellenadas con separadores vacíos", () => {
    const csv = "Número;Fecha;Base;IVA;;\r\n2026-0001;05/01/2026;1.234,56;259,26;;\r\n2026-0002;12/01/2026;150,00;31,50;;\r\n";
    const parsed = parseCsv(csv);
    expect(parsed.delimiter).toBe(";");
    expect(parsed.headers).toEqual(["Número", "Fecha", "Base", "IVA"]);
    expect(parsed.rows).toEqual([
      ["2026-0001", "05/01/2026", "1.234,56", "259,26"],
      ["2026-0002", "12/01/2026", "150,00", "31,50"],
    ]);
    expect(parsed.rowNumbers).toEqual([2, 3]);
  });

  it("campos entre comillas con separadores, comillas dobladas y saltos de línea", () => {
    const csv = 'Cliente;Concepto;Importe\n"Port; Mataró SL";"Web ""nueva""\nfase 1";"1.500,00"\nOtro;Simple;10\n';
    const parsed = parseCsv(csv);
    expect(parsed.rows[0]).toEqual(["Port; Mataró SL", 'Web "nueva"\nfase 1', "1.500,00"]);
    // Excel cuenta la fila con un salto dentro como una sola fila.
    expect(parsed.rowNumbers).toEqual([2, 3]);
  });

  it("CSV con comas y decimales con punto (exportaciones en inglés)", () => {
    const csv = "invoice_number,date,total\nA-1,2026-01-05,1234.56\nA-2,2026-01-06,\"1,234.56\"\n";
    const parsed = parseCsv(csv);
    expect(parsed.delimiter).toBe(",");
    expect(parsed.rows[1]).toEqual(["A-2", "2026-01-06", "1,234.56"]);
  });

  it("tabulador (el «Texto Unicode» de Excel) y la línea sep= de Excel", () => {
    expect(parseCsv("a\tb\n1\t2\n").delimiter).toBe("\t");
    const hinted = parseCsv("sep=,\r\nNombre,NIF\r\nPort,B12345674\r\n");
    expect(hinted.delimiter).toBe(",");
    expect(hinted.headers).toEqual(["Nombre", "NIF"]);
    expect(hinted.rowNumbers).toEqual([2]);
  });

  it("salta filas vacías (que cuentan para el número de fila), rellena las cortas y quita la BOM", () => {
    const parsed = parseCsv("﻿Nombre;NIF;Ciudad\n\nPort;B12345674\n;;\nOtro;;Mataró\n");
    expect(parsed.headers).toEqual(["Nombre", "NIF", "Ciudad"]);
    expect(parsed.rows).toEqual([
      ["Port", "B12345674", ""],
      ["Otro", "", "Mataró"],
    ]);
    expect(parsed.rowNumbers).toEqual([3, 5]);
  });

  it("detecta ';' aunque las comas de los decimales sean más", () => {
    expect(detectDelimiter("a;b;c\n1,5;2,25;3,125\n4,5;6,75;7,5\n")).toBe(";");
    // Con celdas vacías al final de las filas, la cabecera (que la coma no divide) manda.
    expect(detectDelimiter("Número;Base;Estado\n1;100,00;\n2;50,00;\n3;7,5;\n")).toBe(";");
    expect(detectDelimiter("solo una columna\nvalor\n")).toBe(";");
  });

  it("un fichero vacío no tiene filas", () => {
    expect(parseCsv("")).toEqual({ delimiter: ";", headers: [], rows: [], rowNumbers: [] });
  });
});

describe("toCsv", () => {
  it("escribe con BOM, ';' y CRLF, y entrecomilla solo lo necesario", () => {
    const out = toCsv(
      [
        ["Nombre", "Importe"],
        ['Port; "Mataró"', "1234,56"],
        ["Dos\nlíneas", ""],
      ],
      { bom: true },
    );
    expect(out).toBe('﻿Nombre;Importe\r\n"Port; ""Mataró""";1234,56\r\n"Dos\nlíneas";\r\n');
    expect(parseCsv(out).rows).toEqual([
      ['Port; "Mataró"', "1234,56"],
      ["Dos\nlíneas", ""],
    ]);
  });

  it("neutraliza fórmulas en los textos (inyección en CSV)", () => {
    expect(protectFormula("=HYPERLINK(\"http://x\")")).toBe("'=HYPERLINK(\"http://x\")");
    expect(protectFormula("+34 600")).toBe("'+34 600");
    expect(protectFormula("@SUM")).toBe("'@SUM");
    expect(protectFormula("Port Mataró")).toBe("Port Mataró");
  });
});
