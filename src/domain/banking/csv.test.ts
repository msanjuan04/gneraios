import { describe, expect, it } from "vitest";
import { encodeUtf8 } from "../dataio/text";
import { autoMapBankColumns, detectBankDelimiter, parseBankCsv, proposeBankCsvMapping, readBankCsvTable, roleOfHeader } from "./csv";
import { readBankStatement } from "./read";
import { checkBalances, fingerprints } from "./statement";

/** Como lo exporta una banca online: título y cuenta encima, del más reciente al más antiguo, con saldo. */
const NEWEST_FIRST = [
  "Movimientos de la cuenta",
  "Cuenta:;ES91 2100 0418 4502 0005 1332",
  "Titular:;GNERAI DEMO SL",
  "",
  "Fecha;Fecha valor;Concepto;Más datos;Importe;Saldo",
  "25/09/2026;25/09/2026;TRASPASO DE LAIA DEMO FERRER;Cuenta propia;2.000,00;10.452,37",
  "20/09/2026;20/09/2026;COMPRA TARJ. 5402XXXXXXXX1234 FIGMA;FIGMA.COM;-15,00;8.452,37",
  "20/09/2026;20/09/2026;COMPRA TARJ. 5402XXXXXXXX1234 FIGMA;FIGMA.COM;-15,00;8.467,37",
  "12/09/2026;12/09/2026;TRANSFERENCIA DE HOTEL LLEVANT CALELLA SL;FRA GS2026-0002;1.234,56;8.482,37",
  "01/09/2026;01/09/2026;APORTACION CAPITAL SOCIAL;;7.247,81;7.247,81",
  "",
  "Saldo final;;;;;10.452,37",
].join("\r\n");

describe("CSV del banco", () => {
  it("reconoce los títulos de columna en castellano, catalán e inglés", () => {
    expect(roleOfHeader("F. Operación")).toBe("booked_on");
    expect(roleOfHeader("Data valor")).toBe("value_on");
    expect(roleOfHeader("Importe (EUR)")).toBe("amount");
    expect(roleOfHeader("Concepte")).toBe("concept");
    expect(roleOfHeader("Beneficiario/Ordenante")).toBe("counterparty");
    expect(roleOfHeader("Saldo disponible")).toBe("balance");
    expect(roleOfHeader("Cargo")).toBe("debit");
    expect(roleOfHeader("Abono")).toBe("credit");
    expect(roleOfHeader("Oficina")).toBeNull();
    expect(autoMapBankColumns(["Fecha", "Fecha valor", "Concepto", "Importe", "Saldo"])).toEqual({
      booked_on: 0,
      value_on: 1,
      concept: 2,
      amount: 3,
      balance: 4,
    });
  });

  it("encuentra la cabecera debajo de los datos de la cuenta y el separador aunque la primera línea no lo tenga", () => {
    expect(detectBankDelimiter(NEWEST_FIRST)).toBe(";");
    const table = readBankCsvTable(NEWEST_FIRST);
    const mapping = proposeBankCsvMapping(table);
    expect(mapping).toMatchObject({ headerRow: 3, decimal: ",", dateOrder: "dmy" });
    expect(mapping!.columns).toMatchObject({ booked_on: 0, value_on: 1, concept: 2, extra: 3, amount: 4, balance: 5 });
  });

  it("lee los movimientos en orden cronológico, con los saldos inicial y final y el IBAN de la cuenta", () => {
    const table = readBankCsvTable(NEWEST_FIRST);
    const result = parseBankCsv(table, proposeBankCsvMapping(table)!);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { statement } = result;
    expect(statement.account.iban).toBe("ES9121000418450200051332");
    expect(statement).toMatchObject({ format: "csv", periodStart: "2026-09-01", periodEnd: "2026-09-25", openingBalanceCents: 0, closingBalanceCents: 1_045_237 });
    expect(statement.movements.map((m) => m.amountCents)).toEqual([724_781, 123_456, -1_500, -1_500, 200_000]);
    expect(statement.movements[1]).toMatchObject({ concept: "TRANSFERENCIA DE HOTEL LLEVANT CALELLA SL · FRA GS2026-0002", balanceAfterCents: 848_237 });
    expect(statement.issues).toEqual([]);
    // La fila de «Saldo final» (sin fecha) se salta sin avisar.
    expect(result.skipped).toBe(1);
    expect(checkBalances(statement)).toMatchObject({ status: "ok" });
    // Los dos cargos de Figma del mismo día: dos huellas.
    expect(fingerprints(statement.movements).slice(2, 4)).toEqual(["2026-09-20|-1500|1", "2026-09-20|-1500|2"]);
  });

  it("con columnas de cargo y abono, separador coma y punto decimal", () => {
    const csv = [
      "Date,Description,Debit,Credit,Balance",
      "2026-09-01,Opening transfer,,500.00,500.00",
      '2026-09-03,"ADOBE *CREATIVE CLD, IE",60.49,,439.51',
      "2026-09-04,Refund,,10.00,449.51",
    ].join("\n");
    const table = readBankCsvTable(csv);
    const mapping = proposeBankCsvMapping(table)!;
    expect(mapping).toMatchObject({ headerRow: 0, decimal: ".", columns: { booked_on: 0, concept: 1, debit: 2, credit: 3, balance: 4 } });
    const result = parseBankCsv(table, mapping);
    expect(result.ok && result.statement.movements.map((m) => [m.bookedOn, m.amountCents, m.concept])).toEqual([
      ["2026-09-01", 50_000, "Opening transfer"],
      ["2026-09-03", -6_049, "ADOBE *CREATIVE CLD, IE"],
      ["2026-09-04", 1_000, "Refund"],
    ]);
  });

  it("con una columna D/H que da el signo, y avisa si los saldos no encadenan", () => {
    const csv = ["Fecha;Concepto;Importe;D/H;Saldo", "01/09/2026;Recibo luz;45,10;D;954,90", "02/09/2026;Cobro;100,00;H;1.100,00"].join("\n");
    const table = readBankCsvTable(csv);
    const result = parseBankCsv(table, proposeBankCsvMapping(table)!);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.statement.movements.map((m) => m.amountCents)).toEqual([-4_510, 10_000]);
    expect(result.statement.issues).toMatchObject([{ code: "balanceChain", params: { count: 1 } }]);
  });

  it("un CSV sin cabecera reconocible devuelve sus primeras filas para mapearlo a mano", () => {
    const bytes = encodeUtf8(["A;B;C", "01/09/2026;Algo;12,00"].join("\n"));
    const result = readBankStatement(bytes);
    expect(result).toMatchObject({ ok: false, reason: "csv_no_header" });
    if (result.ok) return;
    expect(result.csv!.records).toEqual([
      ["A", "B", "C"],
      ["01/09/2026", "Algo", "12,00"],
    ]);
    // Con el mapeo que elige el socio, ya se lee.
    const mapped = readBankStatement(bytes, {
      mapping: { headerRow: 0, columns: { booked_on: 0, concept: 1, amount: 2 }, decimal: ",", dateOrder: "dmy" },
    });
    expect(mapped.ok && mapped.statements[0].movements).toMatchObject([{ bookedOn: "2026-09-01", amountCents: 1_200, concept: "Algo" }]);
  });

  it("lee un CSV en Windows-1252 (como lo guarda Excel en español) y rechaza un XLSX", () => {
    const text = "Fecha;Concepto;Importe\n01/09/2026;Cafè l'Àvia;-3,50\n";
    const bytes = Uint8Array.from([...text].map((c) => c.charCodeAt(0)));
    const result = readBankStatement(bytes);
    expect(result).toMatchObject({ ok: true, format: "csv", encoding: "windows-1252" });
    expect(result.ok && result.statements[0].movements[0]!.concept).toBe("Cafè l'Àvia");
    expect(readBankStatement(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 1, 2]))).toMatchObject({ ok: false, reason: "xlsx" });
  });
});
