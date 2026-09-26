import { z } from "zod";
import {
  bpsToPercentInput,
  centsToMoneyInput,
  discountToBps,
  isCivilDate,
  moneyInputToCents,
  parseBillingDay,
  parseQuantity,
  percentInputToBps,
  quantityToInput,
} from "@/app/[org]/contracts/schema";
import type { CivilDate } from "@/domain/dates/civil-date";
import { locales } from "@/i18n/config";
import type { Enums } from "@/lib/supabase/database.types";
import { emptyToNull, requiredText, text } from "@/lib/validation/fiscal";
import { getPdfLabels } from "@/pdf/labels";
import {
  MAX_PLAN_ITEMS,
  PLAN_PRESETS,
  PLAN_WHEN,
  type PlanPreset,
  type PlanError,
  type PlanItem,
  type PlanWhen,
  paymentPlanError,
  QUOTE_BILLING_TYPES,
  type QuoteBillingType,
  quoteLineBaseCents,
} from "./summary";

/**
 * Formulario del presupuesto (cabecera, líneas y plan de pagos), compartido por el editor
 * (cliente) y las acciones (servidor). Todo llega como texto, escrito a la española, y se
 * convierte aquí a céntimos, puntos básicos y fechas civiles con los mismos lectores que los
 * contratos (las líneas son las mismas). Los mensajes son claves de `quotes.validation.*` o,
 * si no están ahí, de `validation.*`.
 */

export type QuoteStatus = Enums<"quote_status">;
export type QuoteState = Enums<"quote_state">;
export type AppLocale = Enums<"app_locale">;

/** En el orden de los filtros del listado. */
export const QUOTE_STATES = ["draft", "sent", "expired", "accepted", "rejected"] as const satisfies readonly QuoteState[];

const optionalDate = z
  .string()
  .trim()
  .refine((v) => v === "" || isCivilDate(v), "date");
const optionalId = z.union([z.literal(""), z.guid()]);

type Issues = { addIssue: (issue: { code: "custom"; path: (string | number)[]; message: string }) => void };
const issue = (ctx: Issues, path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });

// ---------------------------------------------------------------------------
// Líneas
// ---------------------------------------------------------------------------

export const quoteLineFormSchema = z
  .object({
    /** Id estable: el de la línea guardada o uno nuevo generado al añadirla. */
    id: z.guid(),
    billing_type: z.enum(QUOTE_BILLING_TYPES),
    description: requiredText(500),
    quantity: z.string(),
    unit_price: z.string(),
    discount: z.string(),
    tax_rate_id: z.guid("vatRate"),
    irpf_applies: z.boolean(),
    /** Vacío: empieza con el contrato, el día que se acepte. */
    starts_on: optionalDate,
    ends_on: optionalDate,
    /** Solo mensuales. Vacío: el día de facturación de la org. */
    billing_day: z.string(),
  })
  .superRefine((line, ctx) => {
    if (parseQuantity(line.quantity) === null) issue(ctx, ["quantity"], "quantity");
    if (moneyInputToCents(line.unit_price) === null) issue(ctx, ["unit_price"], line.unit_price.trim() === "" ? "required" : "money");
    if (discountToBps(line.discount) === null) issue(ctx, ["discount"], "discount");
    if (line.billing_type !== "one_off" && isCivilDate(line.starts_on) && isCivilDate(line.ends_on) && line.ends_on < line.starts_on) {
      issue(ctx, ["ends_on"], "endsBeforeStart");
    }
    if (line.billing_type === "monthly" && line.billing_day.trim() !== "" && parseBillingDay(line.billing_day) === null) {
      issue(ctx, ["billing_day"], "billingDay");
    }
  });

export type QuoteLineInput = z.input<typeof quoteLineFormSchema>;

// ---------------------------------------------------------------------------
// Plan de pagos
// ---------------------------------------------------------------------------

export const planItemFormSchema = z
  .object({
    label: requiredText(120),
    when: z.enum(PLAN_WHEN),
    planned_on: optionalDate,
    percent: z.string(),
  })
  .superRefine((item, ctx) => {
    if ((percentInputToBps(item.percent) ?? 0) <= 0) issue(ctx, ["percent"], "percent");
    if (item.when === "date" && item.planned_on === "") issue(ctx, ["planned_on"], "planDateRequired");
  });

export type PlanItemInput = z.input<typeof planItemFormSchema>;

/** Un pago escrito en el formulario, como lo guarda la base de datos; null si algo no se entiende. */
function toPlanItem(item: PlanItemInput): PlanItem | null {
  const percentBps = percentInputToBps(item.percent);
  if (percentBps === null || percentBps === 0) return null;
  return {
    label: item.label.trim(),
    percentBps,
    when: item.when,
    plannedOn: item.when === "date" ? emptyToNull(item.planned_on) : null,
  };
}

/**
 * Error del plan completo (vacío, desordenado o que no suma el 100 %), o null. Si un
 * porcentaje no se entiende, el error ya sale en su fila y aquí no se repite.
 */
export function planFormError(plan: readonly PlanItemInput[]): PlanError | null {
  const items = plan.map(toPlanItem);
  if (items.some((item) => item === null)) return null;
  const error = paymentPlanError(items as PlanItem[], true);
  // Una fecha que falta ya sale en su campo.
  return error === "planInvalid" && plan.some((item) => item.when === "date" && item.planned_on === "") ? null : error;
}

/** Suma de lo que se entiende (para el marcador en vivo). */
export function planTotalBps(plan: readonly PlanItemInput[]): number {
  return plan.reduce((sum, item) => sum + (percentInputToBps(item.percent) ?? 0), 0);
}

/**
 * Pagos de un plan habitual (100 %, 50/50, 40/30/30) con las etiquetas en el idioma del
 * presupuesto: salen tal cual en su PDF y en los hitos del contrato.
 */
export function presetPlan(preset: PlanPreset, language: AppLocale): PlanItemInput[] {
  const labels = getPdfLabels(language).quote.plan.presets;
  return PLAN_PRESETS[preset].map((item) => ({
    label: labels[item.label],
    when: item.when,
    planned_on: "",
    percent: bpsToPercentInput(item.percentBps),
  }));
}

/** Pagos del formulario → plan de la base de datos (los que no se entienden se quedan fuera). */
export function planItemsFromForm(plan: readonly PlanItemInput[]): PlanItem[] {
  return plan.flatMap((item) => toPlanItem(item) ?? []);
}

// ---------------------------------------------------------------------------
// Presupuesto
// ---------------------------------------------------------------------------

/** `today`: hoy en la zona de la org (un presupuesto no lleva fecha futura). */
export function quoteFormSchema(today: CivilDate) {
  return z
    .object({
      // Cliente existente o, si está vacío, uno nuevo con este nombre.
      client_id: optionalId,
      new_client_name: text(200),
      deal_id: optionalId,
      issuer_id: z.guid("issuerRequired"),
      title: requiredText(200),
      /** Vacías: al enviarlo, hoy y la validez de la org. */
      issued_on: optionalDate.refine((v) => v === "" || v <= today, "futureDate"),
      valid_until: optionalDate,
      language: z.enum(locales),
      notes: text(4000),
      lines: z.array(quoteLineFormSchema).max(200, "tooManyLines"),
      plan: z.array(planItemFormSchema).max(MAX_PLAN_ITEMS, "planInvalid"),
    })
    .superRefine((v, ctx) => {
      if (!v.client_id && !v.new_client_name.trim()) issue(ctx, ["client_id"], "clientRequired");
      if (isCivilDate(v.issued_on) && isCivilDate(v.valid_until) && v.valid_until < v.issued_on) {
        issue(ctx, ["valid_until"], "validBeforeIssue");
      }
      if (hasOneOff(v.lines)) {
        const error = planFormError(v.plan);
        if (error) issue(ctx, ["plan"], error);
      }
    });
}

export type QuoteFormInput = z.input<ReturnType<typeof quoteFormSchema>>;
export type QuoteFormValues = z.output<ReturnType<typeof quoteFormSchema>>;

export function hasOneOff(lines: readonly { billing_type: QuoteBillingType | string }[]): boolean {
  return lines.some((line) => line.billing_type === "one_off");
}

/** Línea de quote_lines tal y como la recibe save_quote. */
export type QuoteLinePayload = {
  id: string;
  position: number;
  description: string;
  billing_type: QuoteBillingType;
  /** Texto para no perder decimales ("2.5"). */
  quantity: string;
  unit_price_cents: number;
  discount_bps: number;
  tax_rate_id: string;
  irpf_applies: boolean;
  starts_on: string | null;
  ends_on: string | null;
  billing_day: number | null;
  prorate_first: boolean;
  base_cents: number;
};

export type PlanItemPayload = { label: string; percent_bps: number; when: PlanWhen; planned_on: string | null };

export type SaveQuotePayload = {
  quote_id: string | null;
  expected_updated_at: string | null;
  header: {
    client_id: string;
    deal_id: string | null;
    issuer_id: string;
    title: string;
    issued_on: string | null;
    valid_until: string | null;
    language: AppLocale;
    notes: string | null;
    payment_plan: PlanItemPayload[];
  };
  lines: QuoteLinePayload[];
};

function valid<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Formulario sin validar");
  return value;
}

/** Línea validada → fila. Una puntual no lleva fechas; el día de facturación solo en las mensuales. */
export function toLinePayload(line: z.output<typeof quoteLineFormSchema>, position: number): QuoteLinePayload {
  const oneOff = line.billing_type === "one_off";
  const quantity = valid(parseQuantity(line.quantity));
  const unitPriceCents = valid(moneyInputToCents(line.unit_price));
  const discountBps = valid(discountToBps(line.discount));
  return {
    id: line.id,
    position,
    description: line.description.trim(),
    billing_type: line.billing_type,
    quantity,
    unit_price_cents: unitPriceCents,
    discount_bps: discountBps,
    tax_rate_id: line.tax_rate_id,
    irpf_applies: line.irpf_applies,
    starts_on: oneOff ? null : emptyToNull(line.starts_on),
    ends_on: oneOff ? null : emptyToNull(line.ends_on),
    billing_day: line.billing_type === "monthly" ? parseBillingDay(line.billing_day) : null,
    prorate_first: true,
    base_cents: quoteLineBaseCents({ quantity, unitPriceCents, discountBps }),
  };
}

/**
 * JSON de save_quote. Las líneas se ordenan por sección (puntual, mensual, anual, por uso) y,
 * dentro de cada una, como están en el formulario. Sin nada puntual, el plan no viaja.
 */
export function toSaveQuotePayload(
  values: QuoteFormValues,
  opts: { quoteId: string | null; expectedUpdatedAt: string | null; clientId: string },
): SaveQuotePayload {
  const ordered = QUOTE_BILLING_TYPES.flatMap((type) => values.lines.filter((line) => line.billing_type === type));
  const plan = hasOneOff(values.lines) ? planItemsFromForm(values.plan) : [];
  return {
    quote_id: opts.quoteId,
    expected_updated_at: opts.expectedUpdatedAt,
    header: {
      client_id: opts.clientId,
      deal_id: emptyToNull(values.deal_id),
      issuer_id: values.issuer_id,
      title: values.title.trim(),
      issued_on: emptyToNull(values.issued_on),
      valid_until: emptyToNull(values.valid_until),
      language: values.language,
      notes: emptyToNull(values.notes),
      payment_plan: plan.map((item) => ({
        label: item.label,
        percent_bps: item.percentBps,
        when: item.when,
        planned_on: item.plannedOn,
      })),
    },
    lines: ordered.map((line, position) => toLinePayload(line, position)),
  };
}

// ---------------------------------------------------------------------------
// De lo guardado al formulario
// ---------------------------------------------------------------------------

/** Lo que hace falta de una línea guardada para editarla. */
export type StoredQuoteLine = {
  id: string;
  billingType: QuoteBillingType;
  description: string;
  quantity: number | string;
  unitPriceCents: number;
  discountBps: number;
  taxRateId: string;
  irpfApplies: boolean;
  startsOn: string | null;
  endsOn: string | null;
  billingDay: number | null;
};

export function lineFormDefaults(line: StoredQuoteLine): QuoteLineInput {
  return {
    id: line.id,
    billing_type: line.billingType,
    description: line.description,
    quantity: quantityToInput(line.quantity),
    unit_price: centsToMoneyInput(line.unitPriceCents),
    discount: line.discountBps === 0 ? "" : bpsToPercentInput(line.discountBps),
    tax_rate_id: line.taxRateId,
    irpf_applies: line.irpfApplies,
    starts_on: line.startsOn ?? "",
    ends_on: line.endsOn ?? "",
    billing_day: line.billingDay === null ? "" : String(line.billingDay),
  };
}

export function planFormDefaults(plan: readonly PlanItem[]): PlanItemInput[] {
  return plan.map((item) => ({
    label: item.label,
    when: item.when,
    planned_on: item.plannedOn ?? "",
    percent: bpsToPercentInput(item.percentBps),
  }));
}

/** Línea nueva vacía de un tipo, con el IVA por defecto. */
export function newLineDefaults(billingType: QuoteBillingType, id: string, vatRateId: string | null): QuoteLineInput {
  return {
    id,
    billing_type: billingType,
    description: "",
    quantity: "1",
    unit_price: "",
    discount: "",
    tax_rate_id: vatRateId ?? "",
    irpf_applies: true,
    starts_on: "",
    ends_on: "",
    billing_day: "",
  };
}

/** Plan guardado en la base de datos (jsonb) → pagos. Lo que no tenga la forma esperada se descarta. */
export function readStoredPlan(value: unknown): PlanItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): PlanItem[] => {
    if (typeof raw !== "object" || raw === null) return [];
    const item = raw as Record<string, unknown>;
    const when = PLAN_WHEN.find((w) => w === item.when);
    if (!when || typeof item.label !== "string" || typeof item.percent_bps !== "number") return [];
    return [
      {
        label: item.label,
        percentBps: item.percent_bps,
        when,
        plannedOn: when === "date" && typeof item.planned_on === "string" ? item.planned_on : null,
      },
    ];
  });
}

// ---------------------------------------------------------------------------
// Rechazo, email y listado
// ---------------------------------------------------------------------------

export const rejectFormSchema = z.object({ reason: text(500) });
export type RejectFormInput = z.input<typeof rejectFormSchema>;

const emailSchema = z.email();

/** "a@x.com, b@y.es; c@z.com" → lista sin repetidos, en minúsculas. null si alguna no vale o no hay 1-10. */
export function parseEmailList(input: string): string[] | null {
  const parts = input
    .split(/[\s,;]+/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  const unique = [...new Set(parts)];
  if (unique.length === 0 || unique.length > 10) return null;
  return unique.every((email) => emailSchema.safeParse(email).success) ? unique : null;
}

export const quoteEmailFormSchema = z.object({
  to: z.string().refine((v) => parseEmailList(v) !== null, "emails"),
  subject: requiredText(300),
  body: requiredText(20_000),
});
export type QuoteEmailFormInput = z.input<typeof quoteEmailFormSchema>;

/** Filtro del listado (?state=). Sin parámetro: todos. */
export function readStateFilter(value: unknown): QuoteState | "" {
  return QUOTE_STATES.find((state) => state === value) ?? "";
}
