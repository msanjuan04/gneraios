import { z } from "zod";
import { bpsToInput, centsToInput, parsePercentInput } from "@/app/[org]/invoices/schema";
import {
  type CostAssignment,
  type CostAssignmentIssue,
  costAssignmentIssues,
  MAX_REBILL_MARKUP_BPS,
  normalizeCostAssignment,
} from "@/domain/finance/allocation";
import { computeExpenseAmounts, type ExpenseAmounts } from "@/domain/finance/expense";
import { parseMoneyInput } from "@/domain/money";
import { validateIban } from "@/domain/tax-id";
import { Constants, type Enums } from "@/lib/supabase/database.types";
import { requiredText, text } from "@/lib/validation/fiscal";

/**
 * Formularios de Finanzas (gasto, suscripción, cuenta, saldo, participaciones), compartidos por
 * los paneles (cliente) y las acciones (servidor). Los importes se escriben a la española y viajan
 * como texto hasta el servidor, que los convierte a céntimos y puntos básicos con el dominio.
 * Los mensajes son claves de `finance.validation.*` o, si no están ahí, de `validation.*`.
 */

export type ExpenseGroup = Enums<"expense_group">;
export type ExpenseStatus = Enums<"expense_status">;
export type PaymentMethod = Enums<"payment_method">;
export type SubscriptionInterval = Enums<"subscription_interval">;
export type CostAllocation = Enums<"cost_allocation">;

export const EXPENSE_GROUPS = Constants.public.Enums.expense_group;
export const COST_ALLOCATIONS = Constants.public.Enums.cost_allocation;
export const EXPENSE_STATUSES = Constants.public.Enums.expense_status;
export const PAYMENT_METHODS = Constants.public.Enums.payment_method;
export const SUBSCRIPTION_INTERVALS = Constants.public.Enums.subscription_interval;

const optionalId = z.union([z.literal(""), z.guid()]);
const requiredId = z.string().trim().pipe(z.guid("required"));
const date = z.iso.date("date");
const dateOrEmpty = z.union([z.literal(""), z.iso.date("date")]);

/** Importe a la española ("1.234,56"); con `allowNegative`, también un abono ("-50"). */
const money = (opts: { allowNegative?: boolean } = {}) =>
  z
    .string()
    .trim()
    .min(1, "required")
    .refine((v) => {
      const cents = parseMoneyInput(v);
      return cents !== null && (opts.allowNegative || cents >= 0);
    }, "money");

/** Porcentaje ("21", "15,5"); vacío es 0 %. */
const percent = z
  .string()
  .trim()
  .refine((v) => v === "" || parsePercentInput(v) !== null, "percent");

const DAY = /^\d{1,2}$/;

/**
 * Margen de una repercusión ("10", "12,5", "150 %") → puntos básicos; vacío es 0 %. Admite del
 * 0 al 1.000 % con hasta dos decimales (lo que admite la base de datos). null si no es válido.
 */
export function parseMarkupInput(input: string): number | null {
  const s = input.replace(/\s+/g, "").replace(/%$/, "");
  if (s === "") return 0;
  const m = /^(\d{1,4})(?:[.,](\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return bps <= MAX_REBILL_MARKUP_BPS ? bps : null;
}

const markup = z
  .string()
  .trim()
  .refine((v) => parseMarkupInput(v) !== null, "markup");

/**
 * «¿A quién sirve?», igual en gastos y suscripciones. Con valor por defecto (de la empresa, sin
 * repercutir): lo que no lo trae (p. ej. un gasto creado desde el banco) sigue siendo válido.
 */
const assignmentFields = {
  allocation: z.enum(COST_ALLOCATIONS).default("company"),
  client_id: optionalId.default(""),
  rebill: z.boolean().default(false),
  rebill_markup: markup.default(""),
};

type AssignmentInput = { allocation: CostAllocation; client_id: string; rebill: boolean; rebill_markup: string };

const ASSIGNMENT_PATHS: Record<CostAssignmentIssue, keyof AssignmentInput> = {
  clientRequired: "client_id",
  clientNotAllowed: "client_id",
  rebillClientOnly: "rebill",
  markupRange: "rebill_markup",
};

function assignmentOf(v: AssignmentInput): CostAssignment {
  return { allocation: v.allocation, clientId: v.client_id || null, rebill: v.rebill, rebillMarkupBps: parseMarkupInput(v.rebill_markup) ?? 0 };
}

/** Los mismos checks que la base de datos (src/domain/finance/allocation.ts), en su campo. */
function refineAssignment(v: AssignmentInput, ctx: z.RefinementCtx) {
  for (const issue of costAssignmentIssues(assignmentOf(v))) {
    ctx.addIssue({ code: "custom", path: [ASSIGNMENT_PATHS[issue]], message: issue });
  }
}

/** Las columnas de «¿A quién sirve?» ya validadas (sin cliente fuera de «un cliente», sin margen si no se repercute). */
export function assignmentColumns(v: AssignmentInput) {
  const a = normalizeCostAssignment(assignmentOf(v));
  return { allocation: a.allocation, client_id: a.clientId, rebill: a.rebill, rebill_markup_bps: a.rebillMarkupBps };
}

/** Importe ya validado → céntimos. */
export const moneyToCents = (value: string): number => parseMoneyInput(value) ?? 0;
/** Porcentaje ya validado → puntos básicos (vacío = 0). */
export const percentToBps = (value: string): number => (value.trim() === "" ? 0 : (parsePercentInput(value) ?? 0));

export { bpsToInput, centsToInput };

/** Importes de un gasto con lo que se ha escrito, o null si algo no es un número válido. */
export function expenseAmountsFromInput(input: { base: string; vat: string; irpf: string }): ExpenseAmounts | null {
  const base = parseMoneyInput(input.base.trim());
  const vat = input.vat.trim() === "" ? 0 : parsePercentInput(input.vat);
  const irpf = input.irpf.trim() === "" ? 0 : parsePercentInput(input.irpf);
  if (base === null || vat === null || irpf === null) return null;
  return computeExpenseAmounts({ baseCents: base, vatBps: vat, irpfBps: irpf });
}

// ---------------------------------------------------------------------------
// Gasto
// ---------------------------------------------------------------------------

export const expenseFormSchema = z
  .object({
    issuer_id: requiredId,
    vendor_id: optionalId,
    /** Proveedor nuevo escrito al vuelo (se crea con el gasto). */
    new_vendor_name: text(200),
    category_id: requiredId,
    description: requiredText(500),
    vendor_invoice_number: text(60),
    issued_on: date,
    due_on: dateOrEmpty,
    base: money({ allowNegative: true }),
    vat: percent,
    vat_deductible: z.boolean(),
    irpf: percent,
    paid: z.boolean(),
    paid_on: dateOrEmpty,
    payment_method: z.union([z.literal(""), z.enum(PAYMENT_METHODS)]),
    member_id: optionalId,
    notes: text(2000),
    ...assignmentFields,
  })
  .superRefine((v, ctx) => {
    if (v.due_on && v.due_on < v.issued_on) ctx.addIssue({ code: "custom", path: ["due_on"], message: "dueBeforeIssue" });
    if (v.paid && !v.paid_on) ctx.addIssue({ code: "custom", path: ["paid_on"], message: "required" });
    refineAssignment(v, ctx);
  });

export type ExpenseFormInput = z.input<typeof expenseFormSchema>;
export type ExpenseFormValues = z.output<typeof expenseFormSchema>;

// ---------------------------------------------------------------------------
// Pago
// ---------------------------------------------------------------------------

export const paymentFormSchema = z.object({
  paid_on: date,
  payment_method: z.enum(PAYMENT_METHODS),
});
export type PaymentFormInput = z.input<typeof paymentFormSchema>;

// ---------------------------------------------------------------------------
// Proveedor
// ---------------------------------------------------------------------------

export const vendorFormSchema = z.object({
  name: requiredText(200),
  tax_id: text(40).refine((v) => v === "" || /^[A-Z0-9]{2,20}$/.test(v.replace(/[^A-Za-z0-9]/g, "").toUpperCase()), "taxIdVendor"),
  country_code: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "countryCode"),
  default_category_id: optionalId,
});
export type VendorFormInput = z.input<typeof vendorFormSchema>;

// ---------------------------------------------------------------------------
// Suscripción
// ---------------------------------------------------------------------------

export const subscriptionFormSchema = z
  .object({
    issuer_id: requiredId,
    vendor_id: optionalId,
    new_vendor_name: text(200),
    category_id: requiredId,
    member_id: optionalId,
    description: requiredText(500),
    base: money(),
    vat: percent,
    vat_deductible: z.boolean(),
    irpf: percent,
    interval: z.enum(SUBSCRIPTION_INTERVALS),
    starts_on: date,
    ends_on: dateOrEmpty,
    billing_day: z.string().trim(),
    payment_method: z.enum(PAYMENT_METHODS),
    is_active: z.boolean(),
    notes: text(2000),
    ...assignmentFields,
  })
  .superRefine((v, ctx) => {
    if (v.ends_on && v.ends_on < v.starts_on) ctx.addIssue({ code: "custom", path: ["ends_on"], message: "endBeforeStart" });
    refineAssignment(v, ctx);
    if (v.interval === "monthly" && (!DAY.test(v.billing_day) || Number(v.billing_day) < 1 || Number(v.billing_day) > 31)) {
      ctx.addIssue({ code: "custom", path: ["billing_day"], message: "billingDay" });
    }
  });

export type SubscriptionFormInput = z.input<typeof subscriptionFormSchema>;
export type SubscriptionFormValues = z.output<typeof subscriptionFormSchema>;

// ---------------------------------------------------------------------------
// Caja
// ---------------------------------------------------------------------------

export const cashAccountFormSchema = z.object({
  issuer_id: requiredId,
  name: requiredText(80),
  iban: text(40).refine((v) => v === "" || validateIban(v), "iban"),
  is_active: z.boolean(),
});
export type CashAccountFormInput = z.input<typeof cashAccountFormSchema>;

export const cashBalanceFormSchema = z.object({
  account_id: requiredId,
  balance_on: date,
  balance: money({ allowNegative: true }),
  note: text(500),
});
export type CashBalanceFormInput = z.input<typeof cashBalanceFormSchema>;

// ---------------------------------------------------------------------------
// Participaciones
// ---------------------------------------------------------------------------

export const shareholdingsFormSchema = z
  .object({
    valid_from: date,
    rows: z
      .array(z.object({ member_id: requiredId, percent: z.string().trim().refine((v) => (parsePercentInput(v) ?? 0) > 0, "percentPositive") }))
      .min(1, "shareholdersRequired")
      .max(30),
  })
  .superRefine((v, ctx) => {
    const members = v.rows.map((r) => r.member_id);
    if (new Set(members).size !== members.length) ctx.addIssue({ code: "custom", path: ["rows"], message: "shareholderRepeated" });
    const total = v.rows.reduce((sum, r) => sum + (parsePercentInput(r.percent) ?? 0), 0);
    if (total !== 10_000) ctx.addIssue({ code: "custom", path: ["rows"], message: "sharesTotal" });
  });
export type ShareholdingsFormInput = z.input<typeof shareholdingsFormSchema>;

// ---------------------------------------------------------------------------
// Filtros del listado de gastos (en la URL)
// ---------------------------------------------------------------------------

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const GUID = z.guid();

export function readExpenseFilters(params: Record<string, string | string[] | undefined>) {
  const one = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : "");
  const month = one("month");
  const category = one("category");
  const issuer = one("issuer");
  const status = one("status");
  const vendor = one("vendor");
  const client = one("client");
  return {
    month: MONTH.test(month) ? month : "",
    category: GUID.safeParse(category).success ? category : "",
    issuer: GUID.safeParse(issuer).success ? issuer : "",
    status: EXPENSE_STATUSES.find((s) => s === status) ?? ("" as const),
    vendor: GUID.safeParse(vendor).success ? vendor : "",
    client: GUID.safeParse(client).success ? client : "",
    rebill: one("rebill") === "pending" ? ("pending" as const) : ("" as const),
    q: one("q").trim().slice(0, 80),
  };
}
