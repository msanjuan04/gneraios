import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { n43Amount, n43Date, n43MatchesIban, parseNorma43, writeNorma43 } from "./norma43";
import { checkBalances, fingerprints } from "./statement";

const FIXTURE = readFileSync(join(import.meta.dirname, "__fixtures__/extracto-caixa.n43"), "latin1");

function parsed() {
  const result = parseNorma43(FIXTURE);
  if (!result.ok) throw new Error(`No se lee el fixture: ${result.reason}`);
  return result;
}

describe("Norma 43", () => {
  it("lee la cabecera de la cuenta: entidad, oficina, cuenta, titular, periodo y saldos", () => {
    const { accounts, issues } = parsed();
    expect(issues).toEqual([]);
    expect(accounts).toHaveLength(1);
    const [account] = accounts;
    expect(account).toMatchObject({
      format: "n43",
      account: { bank: "2100", branch: "0418", number: "0200051332" },
      holder: "LAIA DEMO FERRER",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-25",
      openingBalanceCents: 1_234_567,
      closingBalanceCents: 1_138_218,
      issues: [],
    });
    expect(checkBalances(account!)).toMatchObject({ status: "ok", movementsCents: 1_138_218 - 1_234_567 });
  });

  it("lee cada movimiento con su signo, fechas, conceptos (23), códigos y referencias", () => {
    const [account] = parsed().accounts;
    const movements = account!.movements;
    expect(movements).toHaveLength(8);
    expect(movements[0]).toEqual({
      bookedOn: "2026-09-02",
      valueOn: "2026-09-02",
      amountCents: 95_400,
      concept: "TRANSFERENCIA DE RESTAURANT CAN SORRA SL CONCEPTO FRA 2026-0051",
      counterparty: null,
      counterpartyIban: null,
      reference: "FRA20260051",
      bankCode: "04-105",
      balanceAfterCents: null,
    });
    expect(movements[1]).toMatchObject({ amountCents: -6_049, bankCode: "12-018", concept: "COMPRA TARJ. 5402XXXXXXXX3107 ADOBE *CREATIVE CLD 800-833-6687" });
    // El recibo: fecha valor anterior a la de operación y las dos referencias.
    expect(movements[4]).toMatchObject({
      bookedOn: "2026-09-15",
      valueOn: "2026-09-14",
      amountCents: -29_400,
      bankCode: "03-001",
      reference: "000125874596 · 0926TGSS000001",
      concept: "RECIBO TGSS REGIMEN ESPECIAL AUTONOMOS CUOTA 09/2026",
    });
    // Una comisión sin concepto complementario: el concepto común dice qué es.
    expect(movements[5]).toMatchObject({ amountCents: -800, bankCode: "17", concept: "" });
    // Dos registros 23 (01 y 02) forman un solo concepto.
    expect(movements[7]).toMatchObject({ amountCents: 45_000, bankCode: "02", concept: "TRANSF. DE MARESME FIT GYM SL PAGO A CUENTA FRA 2026-0034" });
  });

  it("dos cargos idénticos el mismo día son dos movimientos con huellas distintas", () => {
    const [account] = parsed().accounts;
    const coffees = account!.movements.filter((m) => m.amountCents === -250);
    expect(coffees).toHaveLength(2);
    expect(fingerprints(account!.movements).filter((f) => f.startsWith("2026-09-10|-250|"))).toEqual(["2026-09-10|-250|1", "2026-09-10|-250|2"]);
  });

  it("la cuenta del fichero se reconoce en el IBAN (entidad, oficina y cuenta)", () => {
    const [account] = parsed().accounts;
    expect(n43MatchesIban(account!.account, "ES91 2100 0418 4502 0005 1332")).toBe(true);
    expect(n43MatchesIban(account!.account, "ES7921000813610123456789")).toBe(false);
  });

  it("avisa si los totales o el saldo del registro 33 no cuadran, o si el 88 no cuenta bien", () => {
    const tampered = FIXTURE.replace(/^33(.{18})00006/m, "33$100005").replace(/^(88.{18})000018/m, "$1000017");
    const result = parseNorma43(tampered);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.accounts[0]!.issues.map((i) => i.code)).toEqual(["totalsMismatch"]);
    expect(result.issues).toMatchObject([{ code: "recordCount", params: { declared: 17, found: 18 } }]);

    const withoutEnd = FIXTURE.split("\r\n").filter((l) => !l.startsWith("88")).join("\r\n");
    const noEnd = parseNorma43(withoutEnd);
    expect(noEnd.ok && noEnd.issues.map((i) => i.code)).toEqual(["missingEnd"]);
  });

  it("rechaza otra divisa, un movimiento antes de la cabecera y lo que no es Norma 43", () => {
    expect(parseNorma43(FIXTURE.replace("12345679783", "12345678403"))).toMatchObject({ ok: false, reason: "currency", line: 1 });
    const lines = FIXTURE.split("\r\n");
    expect(parseNorma43([lines[0], lines[1], lines[0], ...lines.slice(2)].join("\r\n"))).toMatchObject({ ok: false, reason: "malformed", line: 3 });
    expect(parseNorma43("Fecha;Concepto;Importe\n01/09/2026;Algo;12,00")).toMatchObject({ ok: false, reason: "not_n43" });
    expect(parseNorma43("")).toMatchObject({ ok: false, reason: "empty" });
  });

  it("amplía el periodo si algún movimiento cae fuera del declarado (y lo avisa)", () => {
    const shifted = FIXTURE.replace("2609012609252", "2609032609252");
    const result = parseNorma43(shifted);
    expect(result.ok && result.accounts[0]).toMatchObject({ periodStart: "2026-09-02", issues: [{ code: "movementsBeforePeriod" }] });
  });

  it("fechas AAMMDD e importes con clave debe/haber", () => {
    expect(n43Date("260229")).toBeNull();
    expect(n43Date("280229")).toBe("2028-02-29");
    expect(n43Amount("1", "00000000012345")).toBe(-12_345);
    expect(n43Amount("2", "00000000012345")).toBe(12_345);
    expect(n43Amount("3", "00000000012345")).toBeNull();
  });

  it("lo que escribe writeNorma43 se vuelve a leer igual (la demo usa el mismo formato)", () => {
    const [account] = parsed().accounts;
    const text = writeNorma43([
      {
        bank: "2100",
        branch: "0418",
        number: "0200051332",
        holder: "Laia Demo Ferrer",
        periodStart: account!.periodStart,
        periodEnd: account!.periodEnd,
        openingBalanceCents: account!.openingBalanceCents!,
        movements: account!.movements.map((m) => ({
          bookedOn: m.bookedOn,
          valueOn: m.valueOn ?? undefined,
          amountCents: m.amountCents,
          commonConcept: m.bankCode!.slice(0, 2),
          ownConcept: m.bankCode!.slice(3) || undefined,
          concept: m.concept ? [m.concept.slice(0, 38), m.concept.slice(38, 76)] : [],
        })),
      },
    ]);
    expect(text.split("\r\n").filter(Boolean).every((l) => l.length === 80)).toBe(true);
    const again = parseNorma43(text);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.issues).toEqual([]);
    expect(again.accounts[0]!.closingBalanceCents).toBe(account!.closingBalanceCents);
    expect(again.accounts[0]!.movements.map((m) => [m.bookedOn, m.amountCents, m.bankCode])).toEqual(
      account!.movements.map((m) => [m.bookedOn, m.amountCents, m.bankCode]),
    );
  });
});
