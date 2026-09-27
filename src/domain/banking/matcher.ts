// Qué es cada movimiento del banco. Para cada movimiento pendiente se proponen, ordenadas, las
// explicaciones posibles con una confianza (alta, media, baja) y los motivos en palabras llanas
// ("importe exacto", "número 2026-0051 en el concepto"). Determinista y explicable: puntos por cada
// señal, sin ML. Nada se concilia solo: un socio confirma (y "confirmar todas las de confianza alta"
// solo toca las que no compiten con otra).
//
// Abonos (entra dinero):
// - Un cobro ya registrado a mano (mismo importe, fecha cercana): solo se enlaza.
// - Una factura con pendiente: importe exacto del pendiente, su número en el concepto, el nombre, el
//   NIF o el IBAN (de sus mandatos) del cliente, o una regla aprendida. Nunca una factura emitida
//   después del movimiento. Un pago menor que el pendiente es un pago parcial (como mucho, media).
// - Varias facturas del mismo cliente cuyo pendiente suma exactamente el movimiento.
// - Una remesa SEPA generada o enviada (o cobrada y aún sin enlazar) por su total exacto.
// Cargos (sale dinero):
// - Un gasto pendiente o vencido, o uno ya pagado (la tarjeta de una suscripción) aún sin enlazar:
//   importe exacto, nombre o NIF del proveedor, su nº de factura en el concepto, fechas y reglas.
// - Si no hay gasto: uno nuevo con la regla aprendida (proveedor y categoría), un proveedor que
//   aparece en el concepto, un pago a la AEAT o a la TGSS (gasto de impuestos) o una comisión.
// Los dos:
// - Un traspaso entre cuentas propias (el movimiento contrario en otra cuenta, su IBAN, "TRASPASO")
//   y el dinero que entra o sale de un socio se proponen como ignorados, con su motivo.
//
// Puntos → confianza: alta ≥ 80, media ≥ 45, baja ≥ 25 (por debajo, no se propone). Alta necesita
// importe exacto y algo que identifique (no basta con que coincida el importe). Si dos propuestas
// quedan a menos de 10 puntos, la mejor baja un nivel ("hay otra parecida").

import { addQuarters, quarterKey, quarterOf } from "../finance/tax";
import { baseFromTotal, type ExpenseGroup, type PaymentMethod } from "../finance/expense";
import { daysBetween, type CivilDate } from "../dates/civil-date";
import { assertCents, type Cents } from "../money";
import {
  findIbans,
  findInvoiceNumber,
  findPhrase,
  findTaxIds,
  matchAnyName,
  matchesPattern,
  matchName,
  normalizeText,
  ruleKey,
  tokenSet,
} from "./text";

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

export type BankTx = {
  id: string;
  accountId: string;
  /** De quién es la cuenta (la SL o un socio autónomo). */
  issuerId: string | null;
  bookedOn: CivilDate;
  /** Con signo: positivo es un abono. */
  amountCents: Cents;
  /** Lo que falta por explicar, en valor absoluto. */
  remainingCents: Cents;
  concept: string;
  counterparty: string | null;
  counterpartyIban: string | null;
  reference: string | null;
  bankCode: string | null;
};

export type OpenInvoice = {
  id: string;
  number: string | null;
  clientId: string;
  issuerId: string;
  issuedOn: CivilDate;
  dueOn: CivilDate | null;
  outstandingCents: Cents;
};

export type ClientIdentity = { id: string; name: string; legalName: string | null; taxId: string | null; ibans: string[] };

/** Un cobro ya registrado (a mano, una devolución SEPA…) que aún no está enlazado del todo. */
export type RegisteredPayment = {
  id: string;
  invoiceId: string;
  invoiceNumber: string | null;
  clientId: string;
  issuerId: string;
  paidOn: CivilDate;
  /** Con signo (negativo en una devolución). */
  amountCents: Cents;
  /** Lo que aún no está enlazado, en valor absoluto. */
  availableCents: Cents;
};

export type OpenRemittance = {
  id: string;
  issuerId: string;
  collectionOn: CivilDate;
  status: "generated" | "sent" | "settled";
  settledOn: CivilDate | null;
  /** Lo que abona el banco (recibos no devueltos) menos lo ya enlazado. */
  availableCents: Cents;
  itemsCount: number;
};

export type OpenExpense = {
  id: string;
  issuerId: string;
  vendorId: string | null;
  categoryId: string;
  description: string;
  vendorInvoiceNumber: string | null;
  issuedOn: CivilDate;
  payableOn: CivilDate;
  paidOn: CivilDate | null;
  /** Con signo (negativo en un abono del proveedor). */
  totalCents: Cents;
  /** Lo que aún no está enlazado, en valor absoluto. */
  availableCents: Cents;
  fromSubscription: boolean;
};

export type VendorIdentity = { id: string; name: string; taxId: string | null; defaultCategoryId: string | null };
export type CategoryRef = { id: string; name: string; group: ExpenseGroup; archived: boolean };

export type BankRule = {
  id: string;
  direction: "credit" | "debit";
  field: "counterparty" | "concept";
  pattern: string;
  vendorId: string | null;
  categoryId: string | null;
  clientId: string | null;
};

export type OwnAccount = { id: string; name: string; iban: string | null };

/** Otro movimiento pendiente de la org (de cualquier cuenta): para encontrar los traspasos. */
export type PendingMovement = { id: string; accountId: string; bookedOn: CivilDate; amountCents: Cents };

/** El último gasto de un proveedor: de él salen el IVA, el IRPF y la descripción de uno nuevo. */
export type ExpenseTemplate = {
  vendorId: string;
  categoryId: string;
  vatBps: number;
  irpfBps: number;
  vatDeductible: boolean;
  description: string;
};

export type MatchContext = {
  invoices: readonly OpenInvoice[];
  clients: readonly ClientIdentity[];
  payments: readonly RegisteredPayment[];
  remittances: readonly OpenRemittance[];
  expenses: readonly OpenExpense[];
  vendors: readonly VendorIdentity[];
  categories: readonly CategoryRef[];
  rules: readonly BankRule[];
  ownAccounts: readonly OwnAccount[];
  /** Nombres de los socios y de los emisores autónomos (su dinero no es un cobro ni un gasto). */
  ownParties: readonly string[];
  pendingMovements: readonly PendingMovement[];
  templates: readonly ExpenseTemplate[];
  /** IVA por defecto de la org (tax_rates) para un gasto nuevo sin plantilla. */
  defaultVatBps: number;
};

// ---------------------------------------------------------------------------
// Salida
// ---------------------------------------------------------------------------

export type Confidence = "alta" | "media" | "baja";
export const CONFIDENCES: readonly Confidence[] = ["alta", "media", "baja"];
const RANK: Record<Confidence, number> = { alta: 3, media: 2, baja: 1 };

export type SuggestionKind = "invoice" | "invoices" | "payment" | "remittance" | "expense" | "new_expense" | "ignore";

export type AllocationKind = "invoice" | "payment" | "expense" | "remittance";
export type Allocation = { kind: AllocationKind; id: string; amountCents: Cents };

/** Motivos en palabras llanas: cada uno es una clave de i18n (banking.reasons.<code>) con sus parámetros. */
export const REASON_CODES = [
  "exactAmount",
  "partialPayment",
  "amountExceeds",
  "invoiceNumber",
  "invoiceNumberLoose",
  "clientName",
  "clientNamePartial",
  "clientTaxId",
  "clientIban",
  "rule",
  "nearDue",
  "otherAccount",
  "combo",
  "registeredPayment",
  "sameDate",
  "nearDate",
  "remittanceTotal",
  "remittanceConcept",
  "remittanceDate",
  "vendorName",
  "vendorNamePartial",
  "vendorTaxId",
  "vendorInvoiceNumber",
  "paidExpense",
  "pendingExpense",
  "subscriptionCharge",
  "taxAuthority",
  "taxModel",
  "bankFee",
  "lastExpense",
  "internalCounterpart",
  "ownAccountIban",
  "transferKeyword",
  "partnerName",
  "ambiguous",
  "competes",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export type Reason = { code: ReasonCode; params?: Record<string, string | number> };

export type TaxDraft = { authority: "aeat" | "tgss"; model: string | null; quarter: string | null };

/** Un gasto nuevo propuesto (el socio lo revisa en el formulario antes de crearlo). */
export type ExpenseDraft = {
  purpose: "rule" | "vendor" | "tax" | "fee";
  issuerId: string | null;
  vendorId: string | null;
  categoryId: string | null;
  /** Lo que se pagó (positivo en un cargo). */
  totalCents: Cents;
  /** La base que da ese total con esos tipos, o null si el redondeo no lo permite (hay que escribirla). */
  baseCents: Cents | null;
  vatBps: number;
  irpfBps: number;
  vatDeductible: boolean;
  /** La del último gasto del proveedor, si lo hay (es un dato, no un texto de la interfaz). */
  description: string | null;
  tax: TaxDraft | null;
};

export type IgnoreSuggestionReason = "internal_transfer" | "partner_movement";

/** La regla que se aprendería al confirmar. */
export type RuleDraft = {
  direction: "credit" | "debit";
  field: "counterparty" | "concept";
  pattern: string;
  vendorId: string | null;
  categoryId: string | null;
  clientId: string | null;
};

export type Suggestion = {
  /** Estable mientras no cambie el estado: sirve para confirmar exactamente esta propuesta. */
  key: string;
  kind: SuggestionKind;
  confidence: Confidence;
  score: number;
  /** Lo que explica (en valor absoluto). */
  amountCents: Cents;
  allocations: Allocation[];
  reasons: Reason[];
  /** De qué habla (para pintarla): ids y nombres, nada de textos de la interfaz. */
  subject: SuggestionSubject;
  draft: ExpenseDraft | null;
  ignoreReason: IgnoreSuggestionReason | null;
  /** Con qué se cobró o se pagó (para el cobro que se crea o el gasto que se da por pagado). */
  method: PaymentMethod;
  /** Días entre el movimiento y lo que se propone (para desempatar). */
  dateDistance: number;
};

export type SuggestionSubject = {
  invoices?: { id: string; number: string | null; outstandingCents: Cents }[];
  clientId?: string;
  clientName?: string;
  paymentId?: string;
  paidOn?: CivilDate;
  remittanceId?: string;
  collectionOn?: CivilDate;
  itemsCount?: number;
  expenseId?: string;
  vendorId?: string | null;
  vendorName?: string | null;
  categoryId?: string | null;
  categoryName?: string | null;
  description?: string | null;
  expenseStatus?: "paid" | "pending";
  accountId?: string;
  accountName?: string;
  partyName?: string;
};

// ---------------------------------------------------------------------------
// Puntos
// ---------------------------------------------------------------------------

export const THRESHOLDS = { alta: 80, media: 45, baja: 25 } as const;
const AMBIGUITY_POINTS = 10;
const MAX_SUGGESTIONS = 5;
const COMBO_MAX_INVOICES = 12;
const COMBO_MAX_SIZE = 4;

const P = {
  exact: 45,
  invoiceNumber: 45,
  invoiceNumberLoose: 25,
  strongIdentity: 35,
  partialName: 15,
  rule: 25,
  identityCap: 60,
  nearDue: 5,
  otherAccount: -15,
  paymentSameDate: 35,
  paymentNearDate: 25,
  paymentWeekDate: 12,
  paymentFarDate: 5,
  paymentIdentityCap: 30,
  remittanceTotal: 50,
  remittanceConcept: 20,
  remittanceDate: 20,
  expenseSameDate: 25,
  expenseNearDate: 18,
  expenseWeekDate: 8,
  expenseFarDate: 3,
  expensePendingDue: 10,
  vendorInvoiceNumber: 40,
  expenseRule: 30,
  subscription: 5,
  newExpenseRule: 60,
  newExpenseVendor: 50,
  newExpenseTax: 55,
  newExpenseFee: 50,
  internalCounterpart: 50,
  ownAccountIban: 40,
  transferKeyword: 15,
  ownAccountName: 20,
  partnerName: 50,
} as const;

function confidenceOf(score: number, cap: Confidence = "alta"): Confidence | null {
  const level: Confidence | null =
    score >= THRESHOLDS.alta ? "alta" : score >= THRESHOLDS.media ? "media" : score >= THRESHOLDS.baja ? "baja" : null;
  if (!level) return null;
  return RANK[level] > RANK[cap] ? cap : level;
}

function lower(confidence: Confidence): Confidence {
  return confidence === "alta" ? "media" : "baja";
}

class Tally {
  score = 0;
  identity = 0;
  strong = false;
  cap: Confidence = "alta";
  readonly reasons: Reason[] = [];

  add(points: number, code: ReasonCode, params?: Record<string, string | number>) {
    this.score += points;
    this.reasons.push(params ? { code, params } : { code });
  }

  /** Una señal de identidad (cuenta hasta el tope de identidad). */
  identify(points: number, code: ReasonCode, params: Record<string, string | number> | undefined, strong: boolean) {
    const room = Math.max(0, P.identityCap - this.identity);
    const counted = Math.min(points, room);
    this.identity += counted;
    this.score += counted;
    if (strong) this.strong = true;
    this.reasons.push(params ? { code, params } : { code });
  }

  limit(cap: Confidence) {
    if (RANK[cap] < RANK[this.cap]) this.cap = cap;
  }
}

// ---------------------------------------------------------------------------
// Palabras clave (en forma normalizada)
// ---------------------------------------------------------------------------

const AEAT_PHRASES = [
  "AEAT", "AGENCIA TRIBUTARIA", "AGENCIA ESTATAL", "ADMINISTRACION TRIBUTARIA", "AG TRIBUTARIA", "HACIENDA",
  "IMPUESTOS", "IMPUESTO", "TRIBUTOS", "AUTOLIQUIDACION", "PAGO IMPUESTOS",
];
const TGSS_PHRASES = [
  "TGSS", "TESORERIA GENERAL", "SEGURIDAD SOCIAL", "SEG SOCIAL", "SEGUROS SOCIALES", "RETA", "REGIMEN ESPECIAL AUTONOMOS",
  "AUTONOMOS", "COTIZACION", "COTIZACIONES", "CUOTA AUTONOMO", "CUOTA AUTONOMOS",
];
const AUTONOMO_PHRASES = ["RETA", "AUTONOMOS", "AUTONOMO", "REGIMEN ESPECIAL AUTONOMOS", "CUOTA AUTONOMO", "CUOTA AUTONOMOS"];
const FEE_PHRASES = [
  "COMISION", "COMISIONES", "COMIS", "MANTENIMIENTO CUENTA", "MANTENIMIENTO CTA", "COM MANTENIMIENTO", "CUOTA TARJETA",
  "CUOTA ANUAL TARJETA", "INTERESES DEUDORES", "INTERESES", "GASTOS CORREO", "COMISION MANTENIMIENTO",
];
const REMITTANCE_PHRASES = ["REMESA", "REMESAS", "ABONO REMESA", "COBRO REMESA", "ADEUDOS", "RECIBOS", "SEPA CORE", "CORE"];
const TRANSFER_PHRASES = ["TRASPASO", "TRASPAS", "TRANSFERENCIA INTERNA", "ENTRE CUENTAS", "CUENTA PROPIA", "CUENTAS PROPIAS", "MISMO TITULAR"];
const TAX_MODELS = ["303", "111", "115", "130", "131", "123", "200", "202", "216", "349", "390", "190", "180"];

// ---------------------------------------------------------------------------
// Preparación
// ---------------------------------------------------------------------------

type TxText = {
  normalized: string;
  tokens: Set<string>;
  counterpartyTokens: Set<string>;
  taxIds: Set<string>;
  ibans: Set<string>;
};

function txText(tx: BankTx): TxText {
  const normalized = normalizeText([tx.concept, tx.counterparty, tx.reference].filter(Boolean).join(" "));
  const ibans = findIbans(normalized);
  if (tx.counterpartyIban) ibans.add(tx.counterpartyIban);
  return {
    normalized,
    tokens: tokenSet(tx.concept, tx.counterparty, tx.reference),
    counterpartyTokens: tokenSet(tx.counterparty),
    taxIds: findTaxIds(normalized),
    ibans,
  };
}

/** Con qué se cobró o pagó, por el concepto común de la Norma 43 o por las palabras del concepto. */
export function methodOf(tx: Pick<BankTx, "bankCode" | "concept">): PaymentMethod {
  const code = tx.bankCode?.slice(0, 2);
  if (code === "12") return "card";
  if (code === "03" || code === "06") return "sepa_debit";
  if (code === "04") return "transfer";
  const text = normalizeText(tx.concept);
  if (findPhrase(text, ["TARJ", "TARJETA", "COMPRA TARJ", "TARGETA", "CARD"])) return "card";
  if (findPhrase(text, ["RECIBO", "ADEUDO", "DOMICILIACION", "REBUT", "ADEUDO SEPA"])) return "sepa_debit";
  if (findPhrase(text, ["BIZUM"])) return "other";
  return "transfer";
}

type Prepared = {
  ctx: MatchContext;
  clients: Map<string, ClientIdentity>;
  vendors: Map<string, VendorIdentity>;
  categories: Map<string, CategoryRef>;
  templates: Map<string, ExpenseTemplate>;
  invoicesByClient: Map<string, OpenInvoice[]>;
  accounts: Map<string, OwnAccount>;
};

function prepare(ctx: MatchContext): Prepared {
  const invoicesByClient = new Map<string, OpenInvoice[]>();
  for (const inv of ctx.invoices) {
    const list = invoicesByClient.get(inv.clientId) ?? [];
    list.push(inv);
    invoicesByClient.set(inv.clientId, list);
  }
  for (const list of invoicesByClient.values()) {
    list.sort((a, b) => (a.dueOn ?? a.issuedOn).localeCompare(b.dueOn ?? b.issuedOn) || a.issuedOn.localeCompare(b.issuedOn) || a.id.localeCompare(b.id));
  }
  return {
    ctx,
    clients: new Map(ctx.clients.map((c) => [c.id, c])),
    vendors: new Map(ctx.vendors.map((v) => [v.id, v])),
    categories: new Map(ctx.categories.map((c) => [c.id, c])),
    templates: new Map(ctx.templates.map((t) => [t.vendorId, t])),
    invoicesByClient,
    accounts: new Map(ctx.ownAccounts.map((a) => [a.id, a])),
  };
}

function normalizedTaxId(value: string | null): string | null {
  return value ? value.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^ES(?=[A-Z0-9]{9}$)/, "") : null;
}

function ruleApplies(rule: BankRule, tx: BankTx, text: TxText): boolean {
  if ((rule.direction === "credit") !== tx.amountCents > 0) return false;
  return matchesPattern(rule.pattern, rule.field === "counterparty" ? text.counterpartyTokens : text.tokens);
}

/** Señales de identidad de un cliente en el texto del movimiento. */
function identifyClient(t: Tally, prep: Prepared, clientId: string, tx: BankTx, text: TxText) {
  const client = prep.clients.get(clientId);
  if (!client) return;
  const taxId = normalizedTaxId(client.taxId);
  if (taxId && text.taxIds.has(taxId)) t.identify(P.strongIdentity, "clientTaxId", { taxId }, true);
  if (client.ibans.some((iban) => text.ibans.has(iban))) t.identify(P.strongIdentity, "clientIban", undefined, true);
  const name = matchAnyName([client.name, client.legalName], text.tokens);
  if (name === "strong") t.identify(P.strongIdentity, "clientName", { name: client.name }, true);
  else if (name === "partial") t.identify(P.partialName, "clientNamePartial", { name: client.name }, false);
  const rule = prep.ctx.rules.find((r) => r.clientId === clientId && ruleApplies(r, tx, text));
  if (rule) t.identify(P.rule, "rule", { pattern: rule.pattern }, true);
}

function absDays(a: CivilDate, b: CivilDate): number {
  return Math.abs(daysBetween(a, b));
}

function make(
  tx: BankTx,
  t: Tally,
  base: Omit<Suggestion, "confidence" | "score" | "reasons" | "method" | "dateDistance"> & { dateDistance?: number },
): Suggestion | null {
  const score = Math.max(0, Math.min(100, Math.round(t.score)));
  const confidence = confidenceOf(score, t.cap);
  if (!confidence) return null;
  return { ...base, confidence, score, reasons: t.reasons, method: methodOf(tx), dateDistance: base.dateDistance ?? 0 };
}

// ---------------------------------------------------------------------------
// Abonos
// ---------------------------------------------------------------------------

function invoiceSuggestions(tx: BankTx, prep: Prepared, text: TxText): Suggestion[] {
  const out: Suggestion[] = [];
  for (const inv of prep.ctx.invoices) {
    if (inv.outstandingCents <= 0 || inv.issuedOn > tx.bookedOn) continue;
    const t = new Tally();
    const number = findInvoiceNumber(inv.number, text.normalized);
    if (number === "exact") t.identify(P.invoiceNumber, "invoiceNumber", { number: inv.number ?? "" }, true);
    else if (number === "loose") t.identify(P.invoiceNumberLoose, "invoiceNumberLoose", { number: inv.number ?? "" }, false);
    identifyClient(t, prep, inv.clientId, tx, text);

    const exact = tx.remainingCents === inv.outstandingCents;
    const amount = Math.min(tx.remainingCents, inv.outstandingCents);
    if (exact) t.add(P.exact, "exactAmount");
    else if (tx.remainingCents < inv.outstandingCents) {
      t.add(0, "partialPayment", { leftCents: inv.outstandingCents - tx.remainingCents });
      t.limit("media");
    } else {
      t.add(0, "amountExceeds", { restCents: tx.remainingCents - inv.outstandingCents });
      t.limit("media");
    }
    if (!exact && t.identity === 0) continue;
    if (!t.strong) t.limit("media");
    if (inv.dueOn && absDays(inv.dueOn, tx.bookedOn) <= 7) t.add(P.nearDue, "nearDue", { date: inv.dueOn });
    if (tx.issuerId && inv.issuerId !== tx.issuerId) {
      t.add(P.otherAccount, "otherAccount");
      t.limit("media");
    }
    const client = prep.clients.get(inv.clientId);
    const suggestion = make(tx, t, {
      key: `invoice:${inv.id}`,
      kind: "invoice",
      amountCents: amount,
      allocations: [{ kind: "invoice", id: inv.id, amountCents: amount }],
      subject: {
        invoices: [{ id: inv.id, number: inv.number, outstandingCents: inv.outstandingCents }],
        clientId: inv.clientId,
        clientName: client?.name,
      },
      draft: null,
      ignoreReason: null,
      dateDistance: absDays(inv.dueOn ?? inv.issuedOn, tx.bookedOn),
    });
    if (suggestion) out.push(suggestion);
  }
  return out;
}

/** Subconjuntos de 2 a 4 facturas (en orden) cuyo pendiente suma exactamente `target`. */
function subsetsSumming(invoices: readonly OpenInvoice[], target: Cents): OpenInvoice[][] {
  const found: OpenInvoice[][] = [];
  const list = invoices.slice(0, COMBO_MAX_INVOICES);
  const walk = (start: number, picked: OpenInvoice[], sum: number) => {
    if (picked.length >= 2 && sum === target) {
      found.push([...picked]);
      return;
    }
    if (picked.length === COMBO_MAX_SIZE || sum >= target) return;
    for (let i = start; i < list.length; i++) {
      picked.push(list[i]!);
      walk(i + 1, picked, sum + list[i]!.outstandingCents);
      picked.pop();
    }
  };
  walk(0, [], 0);
  return found;
}

function comboSuggestions(tx: BankTx, prep: Prepared, text: TxText): Suggestion[] {
  const out: Suggestion[] = [];
  const numbered = new Set(
    prep.ctx.invoices.filter((inv) => findInvoiceNumber(inv.number, text.normalized) === "exact").map((inv) => inv.id),
  );
  for (const [clientId, all] of prep.invoicesByClient) {
    const invoices = all.filter((inv) => inv.outstandingCents > 0 && inv.issuedOn <= tx.bookedOn);
    if (invoices.length < 2) continue;
    const identity = new Tally();
    identifyClient(identity, prep, clientId, tx, text);
    const hasNumbers = invoices.some((inv) => numbered.has(inv.id));
    if (identity.identity === 0 && !hasNumbers) continue;
    const subsets = subsetsSumming(invoices, tx.remainingCents);
    if (subsets.length === 0) continue;
    // La que lleva más números del concepto; a igualdad, la de menos facturas y las más antiguas.
    const best = subsets
      .map((s) => ({ s, numbers: s.filter((inv) => numbered.has(inv.id)).length }))
      .sort((a, b) => b.numbers - a.numbers || a.s.length - b.s.length)[0]!;
    const t = new Tally();
    t.add(P.exact, "exactAmount");
    t.add(0, "combo", { count: best.s.length });
    if (best.numbers === best.s.length) t.identify(P.invoiceNumber, "invoiceNumber", { number: best.s.map((i) => i.number ?? "").join(", ") }, true);
    else if (best.numbers > 0) t.identify(P.invoiceNumberLoose, "invoiceNumberLoose", { number: best.s.filter((i) => numbered.has(i.id)).map((i) => i.number ?? "").join(", ") }, false);
    identifyClient(t, prep, clientId, tx, text);
    if (!t.strong) t.limit("media");
    // Varias combinaciones posibles con los mismos datos: no hay forma de saber cuál.
    if (subsets.length > 1 && best.numbers < best.s.length) t.limit("media");
    if (tx.issuerId && best.s.some((inv) => inv.issuerId !== tx.issuerId)) {
      t.add(P.otherAccount, "otherAccount");
      t.limit("media");
    }
    const client = prep.clients.get(clientId);
    const suggestion = make(tx, t, {
      key: `invoices:${best.s.map((i) => i.id).join("+")}`,
      kind: "invoices",
      amountCents: tx.remainingCents,
      allocations: best.s.map((inv) => ({ kind: "invoice", id: inv.id, amountCents: inv.outstandingCents })),
      subject: {
        invoices: best.s.map((inv) => ({ id: inv.id, number: inv.number, outstandingCents: inv.outstandingCents })),
        clientId,
        clientName: client?.name,
      },
      draft: null,
      ignoreReason: null,
      dateDistance: Math.min(...best.s.map((inv) => absDays(inv.dueOn ?? inv.issuedOn, tx.bookedOn))),
    });
    if (suggestion) out.push(suggestion);
  }
  return out;
}

function paymentSuggestions(tx: BankTx, prep: Prepared, text: TxText): Suggestion[] {
  const out: Suggestion[] = [];
  for (const p of prep.ctx.payments) {
    if (p.availableCents <= 0 || Math.sign(p.amountCents) !== Math.sign(tx.amountCents)) continue;
    if (p.availableCents !== tx.remainingCents) continue;
    const days = absDays(p.paidOn, tx.bookedOn);
    if (days > 10) continue;
    const t = new Tally();
    t.add(P.exact, "exactAmount");
    t.add(0, "registeredPayment", { date: p.paidOn });
    if (days === 0) t.add(P.paymentSameDate, "sameDate");
    else if (days <= 3) t.add(P.paymentNearDate, "nearDate", { days });
    else if (days <= 7) t.add(P.paymentWeekDate, "nearDate", { days });
    else t.add(P.paymentFarDate, "nearDate", { days });
    const identity = new Tally();
    if (findInvoiceNumber(p.invoiceNumber, text.normalized) === "exact") identity.identify(P.invoiceNumber, "invoiceNumber", { number: p.invoiceNumber ?? "" }, true);
    identifyClient(identity, prep, p.clientId, tx, text);
    const counted = Math.min(identity.identity, P.paymentIdentityCap);
    t.score += counted;
    t.reasons.push(...identity.reasons);
    if (tx.issuerId && p.issuerId !== tx.issuerId) {
      t.add(P.otherAccount, "otherAccount");
      t.limit("media");
    }
    const client = prep.clients.get(p.clientId);
    const suggestion = make(tx, t, {
      key: `payment:${p.id}`,
      kind: "payment",
      amountCents: tx.remainingCents,
      allocations: [{ kind: "payment", id: p.id, amountCents: tx.remainingCents }],
      subject: {
        paymentId: p.id,
        paidOn: p.paidOn,
        invoices: [{ id: p.invoiceId, number: p.invoiceNumber, outstandingCents: 0 }],
        clientId: p.clientId,
        clientName: client?.name,
      },
      draft: null,
      ignoreReason: null,
      dateDistance: days,
    });
    if (suggestion) out.push(suggestion);
  }
  return out;
}

function remittanceSuggestions(tx: BankTx, prep: Prepared, text: TxText): Suggestion[] {
  const out: Suggestion[] = [];
  for (const r of prep.ctx.remittances) {
    if (r.availableCents <= 0 || r.availableCents !== tx.remainingCents) continue;
    const t = new Tally();
    let days: number;
    if (r.status === "settled" && r.settledOn) {
      days = absDays(r.settledOn, tx.bookedOn);
      if (days > 10) continue;
      if (days <= 3) t.add(P.remittanceDate, "remittanceDate", { date: r.settledOn });
    } else {
      const offset = daysBetween(r.collectionOn, tx.bookedOn);
      if (offset < -5) continue;
      days = Math.abs(offset);
      if (offset >= -2 && offset <= 7) t.add(P.remittanceDate, "remittanceDate", { date: r.collectionOn });
    }
    t.add(P.remittanceTotal, "remittanceTotal", { count: r.itemsCount });
    if (findPhrase(text.normalized, REMITTANCE_PHRASES) || tx.bankCode?.startsWith("06")) t.add(P.remittanceConcept, "remittanceConcept");
    if (tx.issuerId && r.issuerId !== tx.issuerId) {
      t.add(P.otherAccount, "otherAccount");
      t.limit("media");
    }
    const suggestion = make(tx, t, {
      key: `remittance:${r.id}`,
      kind: "remittance",
      amountCents: tx.remainingCents,
      allocations: [{ kind: "remittance", id: r.id, amountCents: tx.remainingCents }],
      subject: { remittanceId: r.id, collectionOn: r.collectionOn, itemsCount: r.itemsCount },
      draft: null,
      ignoreReason: null,
      dateDistance: days,
    });
    if (suggestion) out.push(suggestion);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cargos
// ---------------------------------------------------------------------------

function identifyVendor(t: Tally, prep: Prepared, vendorId: string | null, tx: BankTx, text: TxText) {
  const vendor = vendorId ? prep.vendors.get(vendorId) : undefined;
  if (vendor) {
    const taxId = normalizedTaxId(vendor.taxId);
    if (taxId && text.taxIds.has(taxId)) t.identify(P.strongIdentity, "vendorTaxId", { taxId }, true);
    const name = matchName(vendor.name, text.tokens);
    if (name === "strong") t.identify(P.strongIdentity, "vendorName", { name: vendor.name }, true);
    else if (name === "partial") t.identify(P.partialName, "vendorNamePartial", { name: vendor.name }, false);
  }
  const rule = prep.ctx.rules.find((r) => ruleApplies(r, tx, text) && r.vendorId !== null && r.vendorId === vendorId);
  if (rule) t.identify(P.expenseRule, "rule", { pattern: rule.pattern }, true);
}

function expenseSuggestions(tx: BankTx, prep: Prepared, text: TxText): Suggestion[] {
  const out: Suggestion[] = [];
  for (const e of prep.ctx.expenses) {
    if (e.availableCents <= 0 || e.totalCents === 0 || Math.sign(e.totalCents) === Math.sign(tx.amountCents)) continue;
    const t = new Tally();
    let days: number;
    if (e.paidOn) {
      days = absDays(e.paidOn, tx.bookedOn);
      if (days > 10) continue;
      t.add(0, "paidExpense", { date: e.paidOn });
      if (days === 0) t.add(P.expenseSameDate, "sameDate");
      else if (days <= 3) t.add(P.expenseNearDate, "nearDate", { days });
      else if (days <= 7) t.add(P.expenseWeekDate, "nearDate", { days });
      else t.add(P.expenseFarDate, "nearDate", { days });
    } else {
      if (daysBetween(e.issuedOn, tx.bookedOn) < -5) continue;
      days = absDays(e.payableOn, tx.bookedOn);
      t.add(0, "pendingExpense", { date: e.payableOn });
      if (days <= 7) t.add(P.expensePendingDue, "nearDue", { date: e.payableOn });
    }
    const number = e.vendorInvoiceNumber ? findInvoiceNumber(e.vendorInvoiceNumber, text.normalized) : null;
    if (number) t.identify(P.vendorInvoiceNumber, "vendorInvoiceNumber", { number: e.vendorInvoiceNumber! }, true);
    identifyVendor(t, prep, e.vendorId, tx, text);

    const exact = tx.remainingCents === e.availableCents;
    const amount = Math.min(tx.remainingCents, e.availableCents);
    if (exact) t.add(P.exact, "exactAmount");
    else if (tx.remainingCents < e.availableCents) {
      t.add(0, "partialPayment", { leftCents: e.availableCents - tx.remainingCents });
      t.limit("media");
    } else {
      t.add(0, "amountExceeds", { restCents: tx.remainingCents - e.availableCents });
      t.limit("media");
    }
    if (!exact && !t.strong) continue;
    if (!t.strong && !(e.paidOn && days <= 3)) t.limit("media");
    if (exact && e.fromSubscription && e.paidOn && days <= 3) t.add(P.subscription, "subscriptionCharge");
    if (tx.issuerId && e.issuerId !== tx.issuerId) {
      t.add(P.otherAccount, "otherAccount");
      t.limit("media");
    }
    const vendor = e.vendorId ? prep.vendors.get(e.vendorId) : undefined;
    const suggestion = make(tx, t, {
      key: `expense:${e.id}`,
      kind: "expense",
      amountCents: amount,
      allocations: [{ kind: "expense", id: e.id, amountCents: amount }],
      subject: {
        expenseId: e.id,
        vendorId: e.vendorId,
        vendorName: vendor?.name ?? null,
        categoryId: e.categoryId,
        categoryName: prep.categories.get(e.categoryId)?.name ?? null,
        description: e.description,
        expenseStatus: e.paidOn ? "paid" : "pending",
      },
      draft: null,
      ignoreReason: null,
      dateDistance: days,
    });
    if (suggestion) out.push(suggestion);
  }
  return out;
}

function activeCategory(prep: Prepared, pick: (c: CategoryRef) => boolean): CategoryRef | null {
  return prep.ctx.categories.find((c) => !c.archived && pick(c)) ?? null;
}

function detectTax(tx: BankTx, text: TxText): TaxDraft | null {
  const aeat = findPhrase(text.normalized, AEAT_PHRASES) ?? (/(?<![0-9A-Z])MOD(?:ELO)? ?(?:303|111|115|130)(?![0-9])/.test(text.normalized) ? "MOD" : null);
  const tgss = findPhrase(text.normalized, TGSS_PHRASES) ?? (tx.bankCode?.startsWith("15") ? "15" : null);
  if (!aeat && !tgss) return null;
  if (aeat) {
    const modelMatch =
      /(?<![0-9A-Z])MOD(?:ELO)? ?([0-9]{3})(?![0-9])/.exec(text.normalized)?.[1] ??
      TAX_MODELS.find((m) => new RegExp(`(?<![0-9])${m}(?![0-9])`).test(text.normalized)) ??
      null;
    const model = modelMatch && TAX_MODELS.includes(modelMatch) ? modelMatch : null;
    const explicit = /(?<![0-9A-Z])([1-4]) ?T(?:RIMESTRE)?(?![A-Z])(?: ?(20[0-9]{2}))?/.exec(text.normalized);
    const booked = quarterOf(tx.bookedOn);
    const quarter = explicit
      ? quarterKey({ year: explicit[2] ? Number(explicit[2]) : booked.quarter === 1 && explicit[1] === "4" ? booked.year - 1 : booked.year, quarter: Number(explicit[1]) as 1 | 2 | 3 | 4 })
      : model && ["303", "111", "115", "130", "131", "123", "216"].includes(model)
        ? quarterKey(addQuarters(booked, -1))
        : null;
    return { authority: "aeat", model, quarter };
  }
  return { authority: "tgss", model: null, quarter: null };
}

function newExpenseSuggestion(tx: BankTx, prep: Prepared, text: TxText): Suggestion | null {
  if (tx.amountCents >= 0) return null;
  const total = tx.remainingCents;
  const draftFor = (
    purpose: ExpenseDraft["purpose"],
    vendorId: string | null,
    categoryId: string | null,
    rates: { vatBps: number; irpfBps: number; vatDeductible: boolean; description: string | null },
    tax: TaxDraft | null = null,
  ): ExpenseDraft => ({
    purpose,
    issuerId: tx.issuerId,
    vendorId,
    categoryId,
    totalCents: total,
    baseCents: baseFromTotal(total, rates.vatBps, rates.irpfBps),
    vatBps: rates.vatBps,
    irpfBps: rates.irpfBps,
    vatDeductible: rates.vatDeductible,
    description: rates.description,
    tax,
  });
  const ratesFor = (vendorId: string | null) => {
    const template = vendorId ? prep.templates.get(vendorId) : undefined;
    return template
      ? { vatBps: template.vatBps, irpfBps: template.irpfBps, vatDeductible: template.vatDeductible, description: template.description, template }
      : { vatBps: prep.ctx.defaultVatBps, irpfBps: 0, vatDeductible: true, description: null, template: undefined };
  };
  const build = (t: Tally, draft: ExpenseDraft) => {
    t.limit("media");
    const vendor = draft.vendorId ? prep.vendors.get(draft.vendorId) : undefined;
    return make(tx, t, {
      key: `new_expense:${draft.purpose}:${draft.vendorId ?? ""}:${draft.categoryId ?? ""}`,
      kind: "new_expense",
      amountCents: total,
      allocations: [],
      subject: {
        vendorId: draft.vendorId,
        vendorName: vendor?.name ?? null,
        categoryId: draft.categoryId,
        categoryName: draft.categoryId ? (prep.categories.get(draft.categoryId)?.name ?? null) : null,
      },
      draft,
      ignoreReason: null,
    });
  };

  // 1. Una regla aprendida (la más concreta).
  const rule = [...prep.ctx.rules]
    .filter((r) => r.direction === "debit" && r.categoryId && ruleApplies(r, tx, text))
    .sort((a, b) => b.pattern.length - a.pattern.length)[0];
  if (rule && prep.categories.get(rule.categoryId!) && !prep.categories.get(rule.categoryId!)!.archived) {
    const rates = ratesFor(rule.vendorId);
    const t = new Tally();
    t.add(P.newExpenseRule, "rule", { pattern: rule.pattern });
    if (rates.template) t.add(0, "lastExpense");
    return build(t, draftFor("rule", rule.vendorId, rule.categoryId, rates));
  }

  // 2. Un pago de impuestos (AEAT) o de la Seguridad Social (TGSS).
  const tax = detectTax(tx, text);
  if (tax) {
    const autonomo = tax.authority === "tgss" && findPhrase(text.normalized, AUTONOMO_PHRASES) !== null;
    const category =
      tax.authority === "aeat"
        ? activeCategory(prep, (c) => c.group === "taxes")
        : ((autonomo ? activeCategory(prep, (c) => c.group === "partner_compensation" && normalizeText(c.name).includes("AUTONOM")) : null) ??
          activeCategory(prep, (c) => c.group === "payroll") ??
          activeCategory(prep, (c) => c.group === "taxes"));
    const vendor = prep.ctx.vendors.find((v) => matchName(v.name, text.tokens) === "strong") ?? null;
    const t = new Tally();
    t.add(P.newExpenseTax, "taxAuthority", { authority: tax.authority });
    if (tax.model) t.add(0, "taxModel", { model: tax.model });
    return build(t, draftFor("tax", vendor?.id ?? null, category?.id ?? null, { vatBps: 0, irpfBps: 0, vatDeductible: true, description: null }, tax));
  }

  // 3. Un proveedor que aparece en el concepto.
  const vendor = prep.ctx.vendors.find((v) => matchName(v.name, text.tokens) === "strong");
  if (vendor) {
    const rates = ratesFor(vendor.id);
    const categoryId = rates.template?.categoryId ?? vendor.defaultCategoryId;
    if (categoryId && !prep.categories.get(categoryId)?.archived) {
      const t = new Tally();
      t.add(P.newExpenseVendor, "vendorName", { name: vendor.name });
      if (rates.template) t.add(0, "lastExpense");
      return build(t, draftFor("vendor", vendor.id, categoryId, rates));
    }
  }

  // 4. Una comisión del banco.
  if (findPhrase(text.normalized, FEE_PHRASES) || tx.bankCode?.startsWith("17")) {
    const category = activeCategory(prep, (c) => c.group === "financial");
    const t = new Tally();
    t.add(P.newExpenseFee, "bankFee");
    return build(t, draftFor("fee", null, category?.id ?? null, { vatBps: 0, irpfBps: 0, vatDeductible: true, description: null }));
  }
  return null;
}

// ---------------------------------------------------------------------------
// Ignorar
// ---------------------------------------------------------------------------

function internalTransferSuggestion(tx: BankTx, prep: Prepared, text: TxText): Suggestion | null {
  const t = new Tally();
  let other: OwnAccount | undefined;
  let distance = 0;
  const counterpart = prep.ctx.pendingMovements
    .filter((m) => m.accountId !== tx.accountId && m.amountCents === -tx.amountCents && absDays(m.bookedOn, tx.bookedOn) <= 3)
    .sort((a, b) => absDays(a.bookedOn, tx.bookedOn) - absDays(b.bookedOn, tx.bookedOn))[0];
  if (counterpart) {
    other = prep.accounts.get(counterpart.accountId);
    distance = absDays(counterpart.bookedOn, tx.bookedOn);
    t.add(P.internalCounterpart, "internalCounterpart", { account: other?.name ?? "", date: counterpart.bookedOn });
  }
  const byIban = prep.ctx.ownAccounts.find((a) => a.id !== tx.accountId && a.iban && text.ibans.has(a.iban));
  if (byIban) {
    other ??= byIban;
    t.add(P.ownAccountIban, "ownAccountIban", { account: byIban.name });
  }
  if (findPhrase(text.normalized, TRANSFER_PHRASES)) t.add(P.transferKeyword, "transferKeyword");
  if (t.score < P.ownAccountIban) return null;
  return make(tx, t, {
    key: "ignore:internal_transfer",
    kind: "ignore",
    amountCents: tx.remainingCents,
    allocations: [],
    subject: { accountId: other?.id, accountName: other?.name },
    draft: null,
    ignoreReason: "internal_transfer",
    dateDistance: distance,
  });
}

function partnerMovementSuggestion(tx: BankTx, prep: Prepared, text: TxText): Suggestion | null {
  const party = prep.ctx.ownParties.find((name) => matchName(name, text.tokens) === "strong");
  if (!party) return null;
  const t = new Tally();
  t.add(P.partnerName, "partnerName", { name: party });
  t.limit("media");
  return make(tx, t, {
    key: "ignore:partner_movement",
    kind: "ignore",
    amountCents: tx.remainingCents,
    allocations: [],
    subject: { partyName: party },
    draft: null,
    ignoreReason: "partner_movement",
  });
}

// ---------------------------------------------------------------------------
// Propuestas
// ---------------------------------------------------------------------------

function compareSuggestions(a: Suggestion, b: Suggestion): number {
  return b.score - a.score || RANK[b.confidence] - RANK[a.confidence] || a.dateDistance - b.dateDistance || a.key.localeCompare(b.key);
}

function suggestWith(tx: BankTx, prep: Prepared): Suggestion[] {
  if (tx.remainingCents <= 0) return [];
  const text = txText(tx);
  const list: Suggestion[] = [];
  if (tx.amountCents > 0) {
    list.push(...paymentSuggestions(tx, prep, text), ...remittanceSuggestions(tx, prep, text), ...comboSuggestions(tx, prep, text));
    list.push(...invoiceSuggestions(tx, prep, text));
    list.push(...expenseSuggestions(tx, prep, text));
  } else {
    list.push(...paymentSuggestions(tx, prep, text), ...expenseSuggestions(tx, prep, text));
  }
  const explained = list.some((s) => RANK[s.confidence] >= RANK.media);
  if (!explained) {
    const created = newExpenseSuggestion(tx, prep, text);
    if (created) list.push(created);
  }
  const transfer = internalTransferSuggestion(tx, prep, text);
  if (transfer) list.push(transfer);
  if (!list.some((s) => RANK[s.confidence] >= RANK.media)) {
    const partner = partnerMovementSuggestion(tx, prep, text);
    if (partner) list.push(partner);
  }

  list.sort(compareSuggestions);
  const top = list.slice(0, MAX_SUGGESTIONS);
  const [first, second] = top;
  if (first && second && first.score - second.score < AMBIGUITY_POINTS && first.key !== second.key) {
    const close = top.filter((s) => first.score - s.score < AMBIGUITY_POINTS).length;
    first.confidence = lower(first.confidence);
    first.reasons = [...first.reasons, { code: "ambiguous", params: { count: close - 1 } }];
  }
  return top;
}

/** Las propuestas de un movimiento, de la mejor a la peor (como mucho 5). */
export function suggestMatches(tx: BankTx, ctx: MatchContext): Suggestion[] {
  return suggestWith(tx, prepare(ctx));
}

/**
 * Las propuestas de varios movimientos. Si dos movimientos proponen con confianza alta lo mismo y no
 * cabe en los dos (la misma factura, el mismo gasto), se queda con el mejor (más puntos, fecha más
 * cercana) y el otro baja a media ("otro movimiento encaja igual").
 */
export function suggestAll(txs: readonly BankTx[], ctx: MatchContext): Map<string, Suggestion[]> {
  const prep = prepare(ctx);
  const result = new Map<string, Suggestion[]>();
  for (const tx of txs) result.set(tx.id, suggestWith(tx, prep));

  const capacity = new Map<string, number>();
  for (const inv of ctx.invoices) capacity.set(`invoice:${inv.id}`, inv.outstandingCents);
  for (const p of ctx.payments) capacity.set(`payment:${p.id}`, p.availableCents);
  for (const e of ctx.expenses) capacity.set(`expense:${e.id}`, e.availableCents);
  for (const r of ctx.remittances) capacity.set(`remittance:${r.id}`, r.availableCents);

  const byId = new Map(txs.map((tx) => [tx.id, tx]));
  const claims = [...result.entries()]
    .flatMap(([txId, list]) => {
      const best = list[0];
      return best && best.confidence === "alta" && best.allocations.length > 0 ? [{ txId, best }] : [];
    })
    .sort(
      (a, b) =>
        b.best.score - a.best.score ||
        a.best.dateDistance - b.best.dateDistance ||
        byId.get(a.txId)!.bookedOn.localeCompare(byId.get(b.txId)!.bookedOn) ||
        a.txId.localeCompare(b.txId),
    );
  for (const { txId, best } of claims) {
    const fits = best.allocations.every((a) => (capacity.get(`${a.kind}:${a.id}`) ?? 0) >= a.amountCents);
    if (fits) {
      for (const a of best.allocations) capacity.set(`${a.kind}:${a.id}`, (capacity.get(`${a.kind}:${a.id}`) ?? 0) - a.amountCents);
      continue;
    }
    best.confidence = "media";
    best.reasons = [...best.reasons, { code: "competes" }];
    result.get(txId)!.sort(compareSuggestions);
  }
  return result;
}

/** La propuesta que se aplicaría con «confirmar» (la mejor), o null. */
export function bestSuggestion(list: readonly Suggestion[] | undefined): Suggestion | null {
  return list?.[0] ?? null;
}

// ---------------------------------------------------------------------------
// Reglas que se aprenden al confirmar
// ---------------------------------------------------------------------------

/**
 * La regla que se aprende al confirmar un movimiento con un cliente (abonos) o con un proveedor y una
 * categoría (cargos). La clave sale de la contrapartida si el extracto la trae y, si no, del concepto.
 */
export function learnRule(
  tx: Pick<BankTx, "amountCents" | "counterparty" | "concept">,
  target: { clientId: string } | { vendorId: string | null; categoryId: string },
): RuleDraft | null {
  const counterparty = ruleKey(tx.counterparty);
  const field: RuleDraft["field"] = counterparty ? "counterparty" : "concept";
  const pattern = counterparty ?? ruleKey(tx.concept);
  if (!pattern) return null;
  if ("clientId" in target) {
    if (tx.amountCents <= 0) return null;
    return { direction: "credit", field, pattern, vendorId: null, categoryId: null, clientId: target.clientId };
  }
  if (tx.amountCents >= 0) return null;
  return { direction: "debit", field, pattern, vendorId: target.vendorId, categoryId: target.categoryId, clientId: null };
}

/** El importe de un conjunto de repartos (comprobación rápida antes de mandarlos a la base de datos). */
export function allocationsTotal(allocations: readonly Pick<Allocation, "amountCents">[]): Cents {
  return allocations.reduce((sum, a) => assertCents(sum + a.amountCents), 0);
}
