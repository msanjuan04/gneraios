import { describe, expect, it } from "vitest";
import { type BankTx, learnRule, type MatchContext, methodOf, suggestAll, suggestMatches } from "./matcher";

const LAIA = "iss-laia";
const SL = "iss-sl";
const ACCOUNT = "acc-laia";
const SL_ACCOUNT = "acc-sl";

function context(overrides: Partial<MatchContext> = {}): MatchContext {
  return {
    clients: [
      { id: "c-sorra", name: "Restaurant Can Sorra", legalName: "Restaurant Can Sorra SL", taxId: "B12345674", ibans: ["ES6000491500051234567892"] },
      { id: "c-fit", name: "Maresme Fit Gym", legalName: "Maresme Fit Gym SL", taxId: null, ibans: [] },
      { id: "c-hotel", name: "Hotel Llevant Calella", legalName: "Hotel Llevant Calella SL", taxId: null, ibans: [] },
      { id: "c-babel", name: "Acadèmia Babel", legalName: "Acadèmia Babel SL", taxId: null, ibans: [] },
    ],
    invoices: [
      { id: "i-51", number: "2026-0051", clientId: "c-sorra", issuerId: LAIA, issuedOn: "2026-08-02", dueOn: "2026-09-01", outstandingCents: 95_400 },
      { id: "i-34", number: "2026-0034", clientId: "c-fit", issuerId: LAIA, issuedOn: "2026-06-02", dueOn: "2026-07-02", outstandingCents: 60_500 },
      { id: "i-40", number: "2026-0040", clientId: "c-fit", issuerId: LAIA, issuedOn: "2026-07-02", dueOn: "2026-08-01", outstandingCents: 60_500 },
      { id: "i-h1", number: "2026-0045", clientId: "c-hotel", issuerId: LAIA, issuedOn: "2026-08-02", dueOn: "2026-09-01", outstandingCents: 30_000 },
      { id: "i-h2", number: "2026-0046", clientId: "c-hotel", issuerId: LAIA, issuedOn: "2026-08-10", dueOn: "2026-09-09", outstandingCents: 45_000 },
      { id: "i-future", number: "2026-0060", clientId: "c-sorra", issuerId: LAIA, issuedOn: "2026-09-20", dueOn: "2026-10-20", outstandingCents: 12_000 },
      { id: "i-babel", number: "GS2026-0002", clientId: "c-babel", issuerId: SL, issuedOn: "2026-09-02", dueOn: "2026-10-02", outstandingCents: 30_250 },
    ],
    payments: [
      {
        id: "p-1",
        invoiceId: "i-20",
        invoiceNumber: "2026-0020",
        clientId: "c-sorra",
        issuerId: LAIA,
        paidOn: "2026-09-08",
        amountCents: 121_000,
        availableCents: 121_000,
      },
    ],
    remittances: [{ id: "r-sep", issuerId: LAIA, collectionOn: "2026-09-18", status: "sent", settledOn: null, availableCents: 181_500, itemsCount: 3 }],
    expenses: [
      {
        id: "e-adobe",
        issuerId: LAIA,
        vendorId: "v-adobe",
        categoryId: "cat-software",
        description: "Adobe Creative Cloud",
        vendorInvoiceNumber: null,
        issuedOn: "2026-09-05",
        payableOn: "2026-09-05",
        paidOn: "2026-09-05",
        totalCents: 6_049,
        availableCents: 6_049,
        fromSubscription: true,
      },
      {
        id: "e-oriol",
        issuerId: LAIA,
        vendorId: "v-oriol",
        categoryId: "cat-freelance",
        description: "Landing de captación",
        vendorInvoiceNumber: "2026/030",
        issuedOn: "2026-09-10",
        payableOn: "2026-10-10",
        paidOn: null,
        totalCents: 132_500,
        availableCents: 132_500,
        fromSubscription: false,
      },
    ],
    vendors: [
      { id: "v-adobe", name: "Adobe Systems Software Ireland", taxId: null, defaultCategoryId: "cat-software" },
      { id: "v-gads", name: "Google Ireland Ltd", taxId: null, defaultCategoryId: "cat-ads" },
      { id: "v-oriol", name: "Oriol Pons Dev", taxId: "12345678Z", defaultCategoryId: "cat-freelance" },
      { id: "v-tgss", name: "Tesorería General de la Seguridad Social", taxId: null, defaultCategoryId: "cat-autonomos" },
    ],
    categories: [
      { id: "cat-software", name: "Software y suscripciones", group: "operating", archived: false },
      { id: "cat-ads", name: "Publicidad propia", group: "operating", archived: false },
      { id: "cat-freelance", name: "Freelances y colaboradores", group: "cost_of_sales", archived: false },
      { id: "cat-payroll", name: "Nóminas y Seguridad Social", group: "payroll", archived: false },
      { id: "cat-autonomos", name: "Cuotas de autónomos", group: "partner_compensation", archived: false },
      { id: "cat-taxes", name: "Impuestos y tasas", group: "taxes", archived: false },
      { id: "cat-bank", name: "Bancos y comisiones", group: "financial", archived: false },
    ],
    rules: [{ id: "rule-gads", direction: "debit", field: "concept", pattern: "GOOGLE ADS", vendorId: "v-gads", categoryId: "cat-ads", clientId: null }],
    ownAccounts: [
      { id: ACCOUNT, name: "Cuenta de la actividad · Laia", iban: "ES9121000418450200051332" },
      { id: SL_ACCOUNT, name: "Cuenta de GNERAI Demo SL", iban: "ES7921000813610123456789" },
    ],
    ownParties: ["Laia Demo Ferrer", "Pau Demo Soler"],
    pendingMovements: [{ id: "t-sl-in", accountId: SL_ACCOUNT, bookedOn: "2026-09-22", amountCents: 200_000 }],
    templates: [
      { vendorId: "v-gads", categoryId: "cat-ads", vatBps: 0, irpfBps: 0, vatDeductible: true, description: "Google Ads · búsqueda de marca" },
    ],
    defaultVatBps: 2100,
    ...overrides,
  };
}

let counter = 0;
function tx(amountCents: number, concept: string, extra: Partial<BankTx> = {}): BankTx {
  return {
    id: `t-${++counter}`,
    accountId: ACCOUNT,
    issuerId: LAIA,
    bookedOn: "2026-09-02",
    amountCents,
    remainingCents: Math.abs(amountCents),
    concept,
    counterparty: null,
    counterpartyIban: null,
    reference: null,
    bankCode: null,
    ...extra,
  };
}

const codes = (s: { reasons: { code: string }[] } | undefined) => s?.reasons.map((r) => r.code) ?? [];

describe("abonos: facturas y cobros", () => {
  it("importe exacto y el número en el concepto: la factura, con confianza alta y los motivos", () => {
    const [best] = suggestMatches(tx(95_400, "TRANSFERENCIA DE RESTAURANT CAN SORRA SL CONCEPTO FRA 2026-0051"), context());
    expect(best).toMatchObject({
      key: "invoice:i-51",
      kind: "invoice",
      confidence: "alta",
      amountCents: 95_400,
      allocations: [{ kind: "invoice", id: "i-51", amountCents: 95_400 }],
      subject: { clientName: "Restaurant Can Sorra", invoices: [{ number: "2026-0051" }] },
      method: "transfer",
    });
    expect(codes(best)).toEqual(expect.arrayContaining(["invoiceNumber", "clientName", "exactAmount", "nearDue"]));
    expect(best!.reasons.find((r) => r.code === "invoiceNumber")!.params).toEqual({ number: "2026-0051" });
  });

  it("sin número pero con el NIF o el IBAN del cliente (sus mandatos) también es alta", () => {
    expect(suggestMatches(tx(95_400, "ABONO TRANSF ORD B12345674"), context())[0]).toMatchObject({ key: "invoice:i-51", confidence: "alta" });
    const byIban = suggestMatches(tx(95_400, "ABONO TRANSFERENCIA", { counterpartyIban: "ES6000491500051234567892" }), context())[0];
    expect(byIban).toMatchObject({ key: "invoice:i-51", confidence: "alta" });
    expect(codes(byIban)).toContain("clientIban");
  });

  it("solo el importe no basta para la alta; y si dos facturas pendientes tienen el mismo, baja", () => {
    const [only] = suggestMatches(tx(95_400, "ABONO TRANSFERENCIA"), context());
    expect(only).toMatchObject({ key: "invoice:i-51", confidence: "media" });
    // A igualdad de puntos, primero la de vencimiento más cercano al movimiento.
    const tied = suggestMatches(tx(60_500, "ABONO TRANSFERENCIA"), context());
    expect(tied.map((s) => s.key)).toEqual(["invoice:i-40", "invoice:i-34"]);
    expect(tied[0]).toMatchObject({ confidence: "baja" });
    expect(codes(tied[0])).toContain("ambiguous");
  });

  it("nunca propone una factura emitida después del movimiento", () => {
    const list = suggestMatches(tx(12_000, "TRANSF RESTAURANT CAN SORRA FRA 2026-0060", { bookedOn: "2026-09-10" }), context());
    expect(list.map((s) => s.key)).not.toContain("invoice:i-future");
  });

  it("un pago menor que el pendiente es parcial (como mucho media) y dice cuánto queda", () => {
    const [best] = suggestMatches(tx(30_000, "TRANSF. DE MARESME FIT GYM SL PAGO A CUENTA FRA 2026-0034"), context());
    expect(best).toMatchObject({ key: "invoice:i-34", confidence: "media", amountCents: 30_000 });
    expect(best!.reasons).toContainEqual({ code: "partialPayment", params: { leftCents: 30_500 } });
  });

  it("un movimiento que paga dos facturas del mismo cliente (suman exacto)", () => {
    const [best] = suggestMatches(tx(75_000, "TRANSFERENCIA DE HOTEL LLEVANT CALELLA SL FRAS AGOSTO", { bookedOn: "2026-09-12" }), context());
    expect(best).toMatchObject({
      key: "invoices:i-h1+i-h2",
      kind: "invoices",
      confidence: "alta",
      allocations: [
        { kind: "invoice", id: "i-h1", amountCents: 30_000 },
        { kind: "invoice", id: "i-h2", amountCents: 45_000 },
      ],
    });
    expect(best!.reasons).toContainEqual({ code: "combo", params: { count: 2 } });
  });

  it("un cobro ya registrado a mano con el mismo importe y fecha se enlaza (no se crea otro)", () => {
    const [best] = suggestMatches(tx(121_000, "TRANSF RESTAURANT CAN SORRA", { bookedOn: "2026-09-08" }), context());
    expect(best).toMatchObject({ key: "payment:p-1", kind: "payment", confidence: "alta", allocations: [{ kind: "payment", id: "p-1" }] });
    expect(codes(best)).toEqual(expect.arrayContaining(["exactAmount", "registeredPayment", "sameDate", "clientName"]));
  });

  it("una remesa enviada por su total exacto, con «remesa» en el concepto y en su fecha", () => {
    const [best] = suggestMatches(tx(181_500, "ABONO REMESA RECIBOS SEPA CORE", { bookedOn: "2026-09-18", bankCode: "06" }), context());
    expect(best).toMatchObject({ key: "remittance:r-sep", kind: "remittance", confidence: "alta" });
    expect(codes(best)).toEqual(expect.arrayContaining(["remittanceTotal", "remittanceConcept", "remittanceDate"]));
  });

  it("una factura de otro emisor (la SL) cobrada en la cuenta de la autónoma: se propone, pero como mucho media", () => {
    const [best] = suggestMatches(tx(30_250, "TRANSF ACADEMIA BABEL FRA GS2026-0002", { bookedOn: "2026-09-20" }), context());
    expect(best).toMatchObject({ key: "invoice:i-babel", confidence: "media" });
    expect(codes(best)).toContain("otherAccount");
  });
});

describe("cargos: gastos", () => {
  it("el cargo de la tarjeta de una suscripción ya pagada: se enlaza ese gasto", () => {
    const charge = tx(-6_049, "COMPRA TARJ. 5402XXXXXXXX3107 ADOBE *CREATIVE CLD 800-833-6687", { bookedOn: "2026-09-05", bankCode: "12-018" });
    const [best] = suggestMatches(charge, context());
    expect(best).toMatchObject({ key: "expense:e-adobe", kind: "expense", confidence: "alta", method: "card", subject: { expenseStatus: "paid" } });
    expect(codes(best)).toEqual(expect.arrayContaining(["paidExpense", "sameDate", "vendorNamePartial", "exactAmount", "subscriptionCharge"]));
    expect(methodOf(charge)).toBe("card");
  });

  it("una transferencia a un proveedor con su nº de factura: el gasto pendiente, que quedará pagado", () => {
    const [best] = suggestMatches(tx(-132_500, "TRANSFERENCIA A ORIOL PONS DEV FACTURA 2026/030", { bookedOn: "2026-09-20" }), context());
    expect(best).toMatchObject({ key: "expense:e-oriol", confidence: "alta", subject: { expenseStatus: "pending", vendorName: "Oriol Pons Dev" } });
    expect(codes(best)).toEqual(expect.arrayContaining(["vendorInvoiceNumber", "vendorName", "exactAmount", "pendingExpense"]));
  });

  it("un cargo de Google Ads sin gasto: gasto nuevo con la regla aprendida y el último gasto del proveedor", () => {
    const [best] = suggestMatches(tx(-8_640, "COMPRA TARJ. 5402XXXXXXXX3107 GOOGLE *ADS8246910 G.CO/HELPPAY#", { bankCode: "12" }), context());
    expect(best).toMatchObject({
      kind: "new_expense",
      confidence: "media",
      subject: { vendorName: "Google Ireland Ltd", categoryName: "Publicidad propia" },
      draft: { purpose: "rule", vendorId: "v-gads", categoryId: "cat-ads", totalCents: 8_640, baseCents: 8_640, vatBps: 0, description: "Google Ads · búsqueda de marca" },
      allocations: [],
    });
    expect(best!.reasons).toContainEqual({ code: "rule", params: { pattern: "GOOGLE ADS" } });
  });

  it("un pago a la AEAT: gasto de impuestos (modelo y trimestre), nunca alta", () => {
    const [best] = suggestMatches(tx(-184_320, "PAGO IMPUESTOS AEAT MODELO 303 NRC 3032026XXXX", { bookedOn: "2026-07-20" }), context());
    expect(best).toMatchObject({
      kind: "new_expense",
      confidence: "media",
      draft: { purpose: "tax", categoryId: "cat-taxes", vatBps: 0, irpfBps: 0, baseCents: 184_320, tax: { authority: "aeat", model: "303", quarter: "2026-Q2" } },
    });
    expect(codes(best)).toEqual(["taxAuthority", "taxModel"]);
  });

  it("una cuota de autónomos de la TGSS sin gasto registrado: a «Cuotas de autónomos», con el proveedor TGSS", () => {
    const [best] = suggestMatches(tx(-29_400, "RECIBO TGSS REGIMEN ESPECIAL AUTONOMOS CUOTA 09/2026", { bankCode: "03" }), context());
    expect(best).toMatchObject({ kind: "new_expense", draft: { purpose: "tax", categoryId: "cat-autonomos", vendorId: "v-tgss", tax: { authority: "tgss" } } });
  });

  it("una comisión del banco (concepto común 17): gasto en la categoría financiera", () => {
    const [best] = suggestMatches(tx(-800, "", { bankCode: "17" }), context());
    expect(best).toMatchObject({ kind: "new_expense", draft: { purpose: "fee", categoryId: "cat-bank", vatBps: 0 } });
  });
});

describe("ignorar", () => {
  it("un traspaso a otra cuenta propia (su IBAN y el movimiento contrario): ignorar, alta", () => {
    const [best] = suggestMatches(
      tx(-200_000, "TRASPASO A CUENTA PROPIA GNERAI DEMO ES79 2100 0813 6101 2345 6789", { bookedOn: "2026-09-22" }),
      context(),
    );
    expect(best).toMatchObject({ kind: "ignore", ignoreReason: "internal_transfer", confidence: "alta", subject: { accountId: SL_ACCOUNT } });
    expect(codes(best)).toEqual(["internalCounterpart", "ownAccountIban", "transferKeyword"]);
  });

  it("dinero que un socio saca para él: ignorar como movimiento de un socio (media)", () => {
    const [best] = suggestMatches(tx(-15_000, "TRANSFERENCIA A FAVOR DE LAIA DEMO FERRER", { bookedOn: "2026-09-05" }), context());
    expect(best).toMatchObject({ kind: "ignore", ignoreReason: "partner_movement", confidence: "media", subject: { partyName: "Laia Demo Ferrer" } });
  });

  it("un movimiento desconocido no tiene propuesta", () => {
    expect(suggestMatches(tx(-4_599, "COMPRA TARJ. 5402XXXXXXXX3107 AMZN MKTP ES"), context())).toEqual([]);
  });
});

describe("varios movimientos a la vez", () => {
  it("si dos movimientos proponen con confianza alta la misma factura, la alta es del más cercano y el otro baja a media", () => {
    const first = tx(95_400, "TRANSF RESTAURANT CAN SORRA FRA 2026-0051", { bookedOn: "2026-09-02" });
    const second = tx(95_400, "TRANSF RESTAURANT CAN SORRA FRA 2026-0051", { bookedOn: "2026-09-25" });
    const result = suggestAll([second, first], context());
    expect(result.get(first.id)![0]).toMatchObject({ key: "invoice:i-51", confidence: "alta" });
    expect(result.get(second.id)![0]).toMatchObject({ key: "invoice:i-51", confidence: "media" });
    expect(codes(result.get(second.id)![0])).toContain("competes");
  });

  it("lo ya conciliado en parte solo propone lo que falta", () => {
    const partial = tx(100_000, "TRANSF RESTAURANT CAN SORRA FRA 2026-0051", { remainingCents: 4_600 });
    const list = suggestMatches(partial, context());
    expect(list.every((s) => s.amountCents <= 4_600)).toBe(true);
  });
});

describe("reglas que se aprenden", () => {
  it("de la contrapartida si la hay; si no, del concepto; con el cliente o el proveedor y la categoría", () => {
    expect(learnRule({ amountCents: 95_400, counterparty: "RESTAURANT CAN SORRA SL", concept: "FRA 2026-0051" }, { clientId: "c-sorra" })).toEqual({
      direction: "credit",
      field: "counterparty",
      pattern: "RESTAURANT CAN SORRA",
      vendorId: null,
      categoryId: null,
      clientId: "c-sorra",
    });
    expect(
      learnRule({ amountCents: -8_640, counterparty: null, concept: "COMPRA TARJ. 5402XXXXXXXX3107 GOOGLE *ADS8246910" }, { vendorId: "v-gads", categoryId: "cat-ads" }),
    ).toMatchObject({ direction: "debit", field: "concept", pattern: "GOOGLE ADS", vendorId: "v-gads", categoryId: "cat-ads" });
    expect(learnRule({ amountCents: -100, counterparty: null, concept: "TRANSFERENCIA 2026" }, { vendorId: null, categoryId: "cat-bank" })).toBeNull();
  });
});
