import { describe, expect, it } from "vitest";
import { checkMandate, isSepaIban, suggestMandateReference } from "./mandate";
import { checkCreditor, checkItem, checkRemittance, type CreditorConfig, type ItemCheckInput } from "./validation";

const creditor: CreditorConfig = {
  creditorId: "ES11000B12345674",
  creditorIdConfirmed: true,
  issuerTaxId: "B12345674",
  name: "GNERAI SL",
  iban: "ES9121000418450200051332",
  bic: null,
};

const mandate = {
  reference: "PORT-20260115",
  debtorName: "Port Mataró SL",
  iban: "ES7921000813610123456789",
  bic: null,
  signedOn: "2026-01-15",
};

const item = (id: string, patch: Partial<ItemCheckInput> = {}): ItemCheckInput => ({
  id,
  invoiceNumber: "2026-0038",
  amountCents: 95_400,
  mandate,
  ...patch,
});

const TODAY = "2026-09-26";

describe("datos del acreedor", () => {
  it("con el ICS confirmado no falta nada", () => {
    expect(checkCreditor(creditor)).toEqual({ creditorId: "ES11000B12345674", source: "confirmed", issues: [] });
  });

  it("sin ICS guardado propone el del NIF, pero hay que confirmarlo", () => {
    expect(checkCreditor({ ...creditor, creditorId: null, creditorIdConfirmed: false })).toEqual({
      creditorId: "ES11000B12345674",
      source: "proposed",
      issues: ["creditorIdUnconfirmed"],
    });
    expect(checkCreditor({ ...creditor, creditorIdConfirmed: false }).source).toBe("unconfirmed");
  });

  it("sin ICS ni NIF no hay identificador; uno guardado mal, tampoco", () => {
    expect(checkCreditor({ ...creditor, creditorId: null, issuerTaxId: null })).toMatchObject({
      creditorId: null,
      issues: ["creditorIdMissing"],
    });
    expect(checkCreditor({ ...creditor, creditorId: "ES12000B12345674" })).toMatchObject({
      creditorId: null,
      issues: ["creditorIdInvalid"],
    });
  });

  it("exige nombre e IBAN SEPA válidos, y un BIC válido si lo hay", () => {
    expect(checkCreditor({ ...creditor, name: " ", iban: null, bic: "XX" }).issues).toEqual([
      "creditorNameMissing",
      "creditorIbanMissing",
      "creditorBicInvalid",
    ]);
    expect(checkCreditor({ ...creditor, iban: "ES9121000418450200051333" }).issues).toEqual(["creditorIbanInvalid"]);
  });
});

describe("recibos", () => {
  it("un recibo correcto no tiene problemas", () => {
    expect(checkItem(item("a"), "2026-10-05")).toEqual([]);
  });

  it("sin mandato, con pendiente cero o negativo o sin número", () => {
    expect(checkItem(item("a", { mandate: null }), "2026-10-05")).toEqual(["mandateMissing"]);
    expect(checkItem(item("a", { amountCents: 0 }), "2026-10-05")).toEqual(["amountNotPositive"]);
    expect(checkItem(item("a", { amountCents: -500 }), "2026-10-05")).toEqual(["amountNotPositive"]);
    expect(checkItem(item("a", { invoiceNumber: null }), "2026-10-05")).toEqual(["invoiceNumberMissing"]);
  });

  it("mandato firmado después del cobro, con IBAN no válido o de fuera de SEPA", () => {
    expect(checkItem(item("a", { mandate: { ...mandate, signedOn: "2026-10-06" } }), "2026-10-05")).toEqual(["mandateNotYetSigned"]);
    expect(checkItem(item("a", { mandate: { ...mandate, iban: "ES7921000813610123456780" } }), "2026-10-05")).toEqual([
      "debtorIbanInvalid",
    ]);
    // IBAN de Emiratos: formato y control correctos, pero no es un país SEPA.
    expect(checkItem(item("a", { mandate: { ...mandate, iban: "AE070331234567890123456" } }), "2026-10-05")).toEqual([
      "debtorIbanNotSepa",
    ]);
    expect(checkItem(item("a", { mandate: { ...mandate, reference: "CON ESPACIO", debtorName: "🙂", bic: "X" } }), "2026-10-05")).toEqual([
      "mandateReferenceInvalid",
      "debtorNameMissing",
      "debtorBicInvalid",
    ]);
  });
});

describe("checkRemittance", () => {
  it("con todo correcto se puede generar", () => {
    const check = checkRemittance({ today: TODAY, collectionOn: "2026-10-05", creditor, items: [item("a"), item("b")] });
    expect(check).toMatchObject({ issues: [], warnings: [], items: {}, canPreview: true, canGenerate: true });
  });

  it("sin el ICS confirmado se previsualiza pero no se genera", () => {
    const check = checkRemittance({
      today: TODAY,
      collectionOn: "2026-10-05",
      creditor: { ...creditor, creditorId: null, creditorIdConfirmed: false },
      items: [item("a")],
    });
    expect(check.creditor.issues).toEqual(["creditorIdUnconfirmed"]);
    expect(check).toMatchObject({ canPreview: true, canGenerate: false });
  });

  it("los recibos con problemas impiden generar, y se listan por id", () => {
    const check = checkRemittance({
      today: TODAY,
      collectionOn: "2026-10-05",
      creditor,
      items: [item("a"), item("b", { mandate: null }), item("c", { amountCents: 0 })],
    });
    expect(check.items).toEqual({ b: ["mandateMissing"], c: ["amountNotPositive"] });
    // La vista previa sale con los recibos correctos.
    expect(check).toMatchObject({ canPreview: true, canGenerate: false });
  });

  it("la fecha de cobro tiene que ser posterior a hoy; si no es hábil, solo avisa", () => {
    const past = checkRemittance({ today: TODAY, collectionOn: TODAY, creditor, items: [item("a")] });
    expect(past).toMatchObject({ issues: ["collectionDatePast"], canPreview: true, canGenerate: false });
    const saturday = checkRemittance({ today: TODAY, collectionOn: "2026-10-03", creditor, items: [item("a")] });
    expect(saturday).toMatchObject({ warnings: ["collectionDateNotBusinessDay"], canGenerate: true });
  });

  it("sin recibos o sin identificador de acreedor no hay ni vista previa", () => {
    expect(checkRemittance({ today: TODAY, collectionOn: "2026-10-05", creditor, items: [] })).toMatchObject({
      issues: ["noItems"],
      canPreview: false,
      canGenerate: false,
    });
    const noId = checkRemittance({
      today: TODAY,
      collectionOn: "2026-10-05",
      creditor: { ...creditor, creditorId: null, issuerTaxId: null },
      items: [item("a")],
    });
    expect(noId).toMatchObject({ canPreview: false, canGenerate: false });
  });
});

describe("mandatos", () => {
  it("propone una referencia con el nombre del cliente y la fecha de firma", () => {
    expect(suggestMandateReference("Restaurant del Port", "2026-09-26")).toBe("RESTAURANT-DEL-PORT-20260926");
    expect(suggestMandateReference("Cafè l'Àvia, S.L.", "2026-01-05")).toBe("CAFE-L-AVIA-S-L-20260105");
    expect(suggestMandateReference("***", "2026-01-05")).toBe("M-20260105");
    expect(suggestMandateReference("Una razón social larguísima de verdad", "2026-01-05").length).toBeLessThanOrEqual(35);
  });

  it("comprueba referencia, titular, IBAN SEPA, BIC y fecha de firma", () => {
    expect(checkMandate(mandate, TODAY)).toEqual([]);
    expect(checkMandate({ ...mandate, reference: "", debtorName: "", iban: "ES00", bic: "??", signedOn: "2026-09-27" }, TODAY)).toEqual([
      "referenceInvalid",
      "debtorNameMissing",
      "ibanInvalid",
      "bicInvalid",
      "signedInFuture",
    ]);
    expect(isSepaIban("DE89 3704 0044 0532 0130 00")).toBe(true);
    expect(isSepaIban("AE070331234567890123456")).toBe(false);
  });
});
