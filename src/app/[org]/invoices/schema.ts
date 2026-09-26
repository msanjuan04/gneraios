import { z } from "zod";
import type { CivilDate } from "@/domain/dates/civil-date";
import { parseMoneyInput } from "@/domain/money";
import { locales } from "@/i18n/config";
import type { Enums } from "@/lib/supabase/database.types";
import { requiredText, text } from "@/lib/validation/fiscal";

/**
 * Formularios de facturación (borrador, cobro, email, rectificativa), compartidos por los
 * componentes (cliente) y las acciones (servidor). Los importes se escriben a la española y
 * viajan como texto hasta el servidor, que los convierte a céntimos y puntos básicos.
 * Los mensajes son claves de `invoices.validation.*` o, si no están ahí, de `validation.*`.
 */

export type BillingType = Enums<"billing_type">;
export type PaymentMethod = Enums<"payment_method">;
export type InvoiceKind = Enums<"series_kind">;
export type InvoiceStatus = Enums<"invoice_status">;

export const BILLING_TYPES = ["one_off", "monthly", "yearly", "usage"] as const satisfies readonly BillingType[];
export const PAYMENT_METHODS = ["transfer", "sepa_debit", "card", "cash", "other"] as const satisfies readonly PaymentMethod[];

// ---------------------------------------------------------------------------
// Lectura de lo que escribe el usuario
// ---------------------------------------------------------------------------

const MAX_QUANTITY_DIGITS = 9; // numeric(12,3)

/**
 * Cantidad escrita a la española, normalizada con punto decimal para la base de datos:
 * "1,5" → "1.5", "0,125" → "0.125", "2" → "2". Igual que los importes: la coma es el decimal
 * (hasta 3 cifras) y el punto separa miles ("1.500" son mil quinientas), salvo un punto con 1-2
 * cifras detrás ("1.5"). null si no es un número mayor que 0.
 */
export function parseQuantityInput(input: string): string | null {
  const s = input.replace(/\s+/g, "");
  if (s === "") return null;
  let integer: string;
  let fraction = "";
  const comma = s.indexOf(",");
  if (comma !== -1) {
    integer = s.slice(0, comma);
    fraction = s.slice(comma + 1);
    if (!/^\d{1,3}$/.test(fraction)) return null;
  } else {
    const dotDecimal = /^(\d*)\.(\d{1,2})$/.exec(s);
    if (dotDecimal) [, integer = "", fraction = ""] = dotDecimal;
    else integer = s;
  }
  if (integer.includes(".")) {
    if (!/^\d{1,3}(?:\.\d{3})+$/.test(integer)) return null;
    integer = integer.replace(/\./g, "");
  }
  if (!/^\d*$/.test(integer) || (integer === "" && fraction === "")) return null;
  const whole = integer.replace(/^0+(?=\d)/, "") || "0";
  if (whole.length > MAX_QUANTITY_DIGITS) return null;
  const decimals = fraction.replace(/0+$/, "");
  if (whole === "0" && decimals === "") return null;
  return decimals ? `${whole}.${decimals}` : whole;
}

/** Porcentaje a puntos básicos: "21" → 2100, "12,5" → 1250, "7.25" → 725. null si no está entre 0 y 100. */
export function parsePercentInput(input: string): number | null {
  const m = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(input.replace(/\s+/g, "").replace(/%$/, ""));
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return bps <= 10_000 ? bps : null;
}

/** Descuento opcional: vacío es 0 %. */
export function parseDiscountInput(input: string): number | null {
  return input.trim() === "" ? 0 : parsePercentInput(input);
}

/** Céntimos → texto editable que `parseMoneyInput` vuelve a leer igual: 123456 → "1234,56". */
export function centsToInput(cents: number): string {
  const abs = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}${Math.trunc(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

/** Puntos básicos → texto editable: 1250 → "12,5", 2100 → "21", 0 → "0". */
export function bpsToInput(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const fraction = String(bps % 100).padStart(2, "0").replace(/0+$/, "");
  return fraction ? `${whole},${fraction}` : String(whole);
}

/** Cantidad guardada (numeric) → texto editable: 1.5 → "1,5". */
export function quantityToInput(quantity: number | string): string {
  return String(quantity).replace(".", ",");
}

const emailSchema = z.email();

/** "a@x.com, b@y.es; c@z.com" → lista sin repetidos y en minúsculas. null si alguna no es válida o no hay 1-10. */
export function parseEmailList(input: string): string[] | null {
  const parts = input
    .split(/[\s,;]+/)
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  const unique = [...new Set(parts)];
  if (unique.length === 0 || unique.length > 10) return null;
  return unique.every((e) => emailSchema.safeParse(e).success) ? unique : null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isIsoDate = (value: string) => ISO_DATE.test(value);

// ---------------------------------------------------------------------------
// Borrador (editor y factura manual)
// ---------------------------------------------------------------------------

const optionalId = z.union([z.literal(""), z.guid()]);
const dateOrEmpty = z.union([z.literal(""), z.iso.date("date")]);
const DAYS = /^\d{1,3}$/;

export type DraftSchemaOptions = {
  /** Las rectificativas admiten precios negativos; las ordinarias, no. */
  kind: InvoiceKind;
  /** Hoy en la zona de la org: una factura no puede llevar fecha futura. */
  today: CivilDate;
  /** Líneas mínimas (una al crear una factura manual; un borrador guardado puede quedarse vacío). */
  minLines?: number;
};

function draftLineSchema(kind: InvoiceKind) {
  return z
    .object({
      /** Id estable: el de la línea guardada o uno nuevo generado al añadirla. */
      id: z.guid(),
      description: requiredText(500),
      quantity: z.string().refine((v) => parseQuantityInput(v) !== null, "quantity"),
      unit_price: z.string().superRefine((value, ctx) => {
        const cents = parseMoneyInput(value);
        if (cents === null) ctx.addIssue({ code: "custom", message: value.trim() === "" ? "required" : "money" });
        else if (cents < 0 && kind !== "rectifying") ctx.addIssue({ code: "custom", message: "negativePrice" });
      }),
      discount: z.string().refine((v) => parseDiscountInput(v) !== null, "rate"),
      tax_rate_id: z.guid("vatRequired"),
      irpf_applies: z.boolean(),
      // Obligatorio también en las facturas manuales: recurrente, uso y puntual nunca se mezclan.
      billing_type: z.union([z.literal(""), z.enum(BILLING_TYPES)]).pipe(z.enum(BILLING_TYPES, "billingTypeRequired")),
      period_start: dateOrEmpty,
      period_end: dateOrEmpty,
    })
    .superRefine((line, ctx) => {
      if ((line.period_start === "") !== (line.period_end === "")) {
        ctx.addIssue({ code: "custom", path: [line.period_start ? "period_end" : "period_start"], message: "periodBoth" });
      } else if (line.period_start && line.period_end < line.period_start) {
        ctx.addIssue({ code: "custom", path: ["period_end"], message: "periodOrder" });
      }
    });
}

export function draftFormSchema({ kind, today, minLines = 0 }: DraftSchemaOptions) {
  return z
    .object({
      issuer_id: z.guid("issuerRequired"),
      client_id: z.guid("clientRequired"),
      /** Vacío: la serie por defecto del emisor para este tipo de factura. */
      series_id: optionalId,
      /** Vacío: el día que se emita. */
      issued_on: dateOrEmpty.refine((v) => v === "" || v <= today, "futureDate"),
      operation_on: dateOrEmpty,
      /** Vencimiento por plazo (días desde la emisión) o en una fecha concreta. */
      due_mode: z.enum(["terms", "date"]),
      due_on: dateOrEmpty,
      /** Vacío: el plazo del cliente o, si no tiene, el de la org. */
      payment_terms_days: z
        .string()
        .trim()
        .refine((v) => v === "" || (DAYS.test(v) && Number(v) <= 365), "days"),
      language: z.enum(locales),
      irpf_bps: z.string().refine((v) => /^\d{1,5}$/.test(v) && Number(v) <= 10_000, "rate"),
      payment_method: z.enum(PAYMENT_METHODS),
      notes: text(2000),
      rectification_reason: kind === "rectifying" ? requiredText(500) : text(500),
      lines: z
        .array(draftLineSchema(kind))
        .max(200, "tooManyLines")
        .refine((lines) => lines.length >= minLines, "linesRequired"),
    })
    .superRefine((v, ctx) => {
      if (v.due_mode !== "date") return;
      if (v.due_on === "") ctx.addIssue({ code: "custom", path: ["due_on"], message: "required" });
      else if (v.issued_on !== "" && v.due_on < v.issued_on) {
        ctx.addIssue({ code: "custom", path: ["due_on"], message: "dueBeforeIssue" });
      }
    });
}

export type DraftFormInput = z.input<ReturnType<typeof draftFormSchema>>;
export type DraftFormValues = z.output<ReturnType<typeof draftFormSchema>>;
export type DraftLineInput = DraftFormInput["lines"][number];

/** Lo que acompaña al formulario al guardar: bloqueo optimista y qué hacer con lo que se quita. */
export const saveDraftOptionsSchema = z.object({
  /** updated_at del borrador al abrirlo (texto tal cual, con sus microsegundos). */
  expectedUpdatedAt: z.string().min(1).max(64).nullable(),
  /** Líneas quitadas que venían del contrato y no se deben volver a facturar (se condonan). */
  waiveLineIds: z.array(z.guid()).max(200),
});
export type SaveDraftOptions = z.input<typeof saveDraftOptionsSchema>;

// ---------------------------------------------------------------------------
// Cobros
// ---------------------------------------------------------------------------

export function paymentFormSchema(today: CivilDate) {
  return z.object({
    amount: z.string().superRefine((value, ctx) => {
      const cents = parseMoneyInput(value);
      if (cents === null) ctx.addIssue({ code: "custom", message: value.trim() === "" ? "required" : "money" });
      else if (cents === 0) ctx.addIssue({ code: "custom", message: "amountZero" });
    }),
    paid_on: z.iso.date("date").refine((v) => v <= today, "paidInFuture"),
    method: z.enum(PAYMENT_METHODS),
    reference: text(200),
  });
}

export type PaymentFormInput = z.input<ReturnType<typeof paymentFormSchema>>;

// ---------------------------------------------------------------------------
// Emails (factura y recordatorios por aprobar)
// ---------------------------------------------------------------------------

export const emailFormSchema = z.object({
  to: z.string().refine((v) => parseEmailList(v) !== null, "emails"),
  subject: requiredText(300),
  body: requiredText(20_000),
});

export type EmailFormInput = z.input<typeof emailFormSchema>;

// ---------------------------------------------------------------------------
// Rectificativas y conceptos de una factura anulada
// ---------------------------------------------------------------------------

export const rectifyFormSchema = z.object({
  /** full: anular (todas las líneas en negativo); partial: por diferencias (se añaden a mano). */
  mode: z.enum(["full", "partial"]),
  reason: requiredText(500),
});

export type RectifyFormInput = z.input<typeof rectifyFormSchema>;

export const releaseItemsSchema = z.object({
  /** true: condonar; false: volver a facturar (vuelven a pendiente). */
  waive: z.boolean(),
  reason: text(500),
});

export type ReleaseItemsInput = z.input<typeof releaseItemsSchema>;

// ---------------------------------------------------------------------------
// Listado
// ---------------------------------------------------------------------------

/** Pestañas del listado (?status=). Sin parámetro: todas. */
export const LIST_FILTERS = ["draft", "issued", "overdue", "paid"] as const;
export type ListFilter = (typeof LIST_FILTERS)[number] | "all";

export function readListFilter(value: unknown): ListFilter {
  return LIST_FILTERS.find((f) => f === value) ?? "all";
}

/** Estados derivados que entran en cada pestaña. Borradores incluye los que se quedaron emitiendo. */
export function statusesFor(filter: ListFilter): InvoiceStatus[] | null {
  switch (filter) {
    case "draft":
      return ["draft", "issuing"];
    case "issued":
      return ["issued"];
    case "overdue":
      return ["overdue"];
    case "paid":
      return ["paid"];
    default:
      return null;
  }
}

/**
 * Texto de búsqueda apto para un filtro `or` de PostgREST: sin los caracteres que tienen
 * significado en su sintaxis (comas, paréntesis, comodines, comillas…) y como mucho 60 letras.
 */
export function sanitizeSearch(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[,()*%\\:"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

/** ¿Es una fecha civil válida en formato ISO? (para parámetros de URL y props). */
export function isCivilDate(value: unknown): value is CivilDate {
  return typeof value === "string" && isIsoDate(value) && z.iso.date().safeParse(value).success;
}
