import { z } from "zod";
import { type MilestonePlanError, validateMilestones } from "@/domain/billing/milestones";
import { parseCivilDate } from "@/domain/dates/civil-date";
import { parseMoneyInput } from "@/domain/money";
import type { Enums } from "@/lib/supabase/database.types";
import { emptyToNull, requiredText, text } from "@/lib/validation/fiscal";

/**
 * Formularios de contratos (alta, condiciones, líneas, versiones, pausas, bajas, usos e
 * hitos), compartidos por los paneles (cliente) y las acciones (servidor). Todo llega como
 * texto, tal y como se escribe a la española, y se convierte aquí a céntimos, puntos básicos
 * y fechas civiles. Los mensajes son claves de `contracts.validation.*` o de `validation.*`.
 */

export type BillingType = Enums<"billing_type">;
export type PaymentMethod = Enums<"payment_method">;
export type InvoiceGrouping = Enums<"invoice_grouping">;
export type ContractStatus = Enums<"contract_status">;

/** En el orden en que se ofrecen al añadir una línea. */
export const BILLING_TYPES = ["monthly", "yearly", "usage", "one_off"] as const satisfies readonly BillingType[];
export const PAYMENT_METHODS = ["transfer", "sepa_debit", "card", "cash", "other"] as const satisfies readonly PaymentMethod[];
export const INVOICE_GROUPINGS = ["client", "contract"] as const satisfies readonly InvoiceGrouping[];
export const CONTRACT_STATUSES = ["active", "paused", "scheduled", "draft", "ended"] as const satisfies readonly ContractStatus[];

export function isRecurring(type: BillingType): type is "monthly" | "yearly" {
  return type === "monthly" || type === "yearly";
}

// ---------------------------------------------------------------------------
// Lo que escribe el usuario → valores de la base de datos
// ---------------------------------------------------------------------------

/** Importe a la española ("1.500", "450,50", "99 €") a céntimos. Vacío o negativo: null. */
export function moneyInputToCents(value: string): number | null {
  if (value.trim() === "") return null;
  const cents = parseMoneyInput(value);
  return cents !== null && cents >= 0 ? cents : null;
}

/** 150050 → "1500,50"; 150000 → "1500". Exacto: sin pasar por decimales binarios. */
export function centsToMoneyInput(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const units = Math.floor(abs / 100);
  const rest = abs % 100;
  return rest === 0 ? `${sign}${units}` : `${sign}${units},${String(rest).padStart(2, "0")}`;
}

const PERCENT = /^(\d{1,3})(?:[.,](\d{1,2}))?$/;

/** "21" → 2100, "12,5" → 1250, "33,33 %" → 3333. Entre 0 y 100, con 2 decimales como mucho. */
export function percentInputToBps(value: string): number | null {
  const match = PERCENT.exec(value.trim().replace(/\s*%$/, ""));
  if (!match) return null;
  const bps = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return bps <= 10_000 ? bps : null;
}

/** 1250 → "12,5"; 3333 → "33,33"; 5000 → "50". */
export function bpsToPercentInput(bps: number): string {
  const units = Math.floor(bps / 100);
  const rest = bps % 100;
  if (rest === 0) return String(units);
  return `${units},${String(rest).padStart(2, "0").replace(/0$/, "")}`;
}

/** Descuento: vacío es 0. */
export function discountToBps(value: string): number | null {
  return value.trim() === "" ? 0 : percentInputToBps(value);
}

const QUANTITY = /^(\d{1,9})(?:[.,](\d{1,3}))?$/;

/**
 * Cantidad mayor que 0 con 3 decimales como mucho (numeric(12,3)), con coma o punto
 * decimal y sin separador de miles: "2,5" → "2.5". Sale como texto para no perder decimales.
 */
export function parseQuantity(value: string): string | null {
  const match = QUANTITY.exec(value.trim());
  if (!match) return null;
  const integer = match[1].replace(/^0+(?=\d)/, "");
  const fraction = (match[2] ?? "").replace(/0+$/, "");
  if (integer === "0" && fraction === "") return null;
  return fraction ? `${integer}.${fraction}` : integer;
}

/** 1.5 → "1,5"; 2 → "2". */
export function quantityToInput(quantity: number | string): string {
  return String(quantity).replace(".", ",");
}

/** Plazo de pago: "" → null (el del cliente o la org); días de 0 a 365; undefined si no vale. */
export function parseDays(value: string): number | null | undefined {
  const v = value.trim();
  if (v === "") return null;
  return /^\d{1,3}$/.test(v) && Number(v) <= 365 ? Number(v) : undefined;
}

/** Día de facturación de 1 a 31, o null. */
export function parseBillingDay(value: string): number | null {
  const v = value.trim();
  return /^\d{1,2}$/.test(v) && Number(v) >= 1 && Number(v) <= 31 ? Number(v) : null;
}

/** "YYYY-MM-DD" y una fecha que existe (nada de 30 de febrero). */
export function isCivilDate(value: string): boolean {
  try {
    parseCivilDate(value);
    return true;
  } catch {
    return false;
  }
}

const optionalDate = z
  .string()
  .trim()
  .refine((v) => v === "" || isCivilDate(v), "date");
const requiredDate = z.string().trim().min(1, "required").refine(isCivilDate, "date");
const optionalId = z.union([z.literal(""), z.guid()]);

type Issues = { addIssue: (issue: { code: "custom"; path: (string | number)[]; message: string }) => void };
const issue = (ctx: Issues, path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });

/** Lo que valida cualquier formulario con condiciones económicas: cantidad, precio y descuento. */
function checkEconomics(v: { quantity: string; unit_price: string; discount: string }, ctx: Issues) {
  if (parseQuantity(v.quantity) === null) issue(ctx, ["quantity"], "quantity");
  if (moneyInputToCents(v.unit_price) === null) issue(ctx, ["unit_price"], v.unit_price.trim() === "" ? "required" : "money");
  if (discountToBps(v.discount) === null) issue(ctx, ["discount"], "discount");
}

// ---------------------------------------------------------------------------
// Línea de contrato
// ---------------------------------------------------------------------------

export const lineFormSchema = z
  .object({
    billing_type: z.enum(BILLING_TYPES),
    description: requiredText(500),
    quantity: z.string(),
    unit_price: z.string(),
    discount: z.string(),
    tax_rate_id: z.guid("vatRate"),
    irpf_applies: z.boolean(),
    starts_on: optionalDate,
    ends_on: optionalDate,
    billing_day: z.string(),
    prorate_first: z.boolean(),
  })
  .superRefine((line, ctx) => {
    checkEconomics(line, ctx);
    if (isRecurring(line.billing_type) && line.starts_on === "") issue(ctx, ["starts_on"], "startsOnRequired");
    if (
      line.billing_type !== "one_off" &&
      isCivilDate(line.starts_on) &&
      isCivilDate(line.ends_on) &&
      line.ends_on < line.starts_on
    ) {
      issue(ctx, ["ends_on"], "endsBeforeStart");
    }
    if (line.billing_type === "monthly" && parseBillingDay(line.billing_day) === null) {
      issue(ctx, ["billing_day"], "billingDay");
    }
  });

export type LineFormInput = z.input<typeof lineFormSchema>;
export type LineFormValues = z.output<typeof lineFormSchema>;

/** Una fila de contract_lines tal y como la reciben create_contract o un insert/update. */
export type LinePayload = {
  position: number;
  description: string;
  billing_type: BillingType;
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
};

function valid<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Formulario sin validar");
  return value;
}

/**
 * Valores ya validados → fila. Un one-off no lleva fechas (se factura por hitos), el día de
 * facturación y el prorrateo solo existen en las mensuales.
 */
export function toLinePayload(line: LineFormValues, position: number): LinePayload {
  const oneOff = line.billing_type === "one_off";
  const monthly = line.billing_type === "monthly";
  return {
    position,
    description: line.description.trim(),
    billing_type: line.billing_type,
    quantity: valid(parseQuantity(line.quantity)),
    unit_price_cents: valid(moneyInputToCents(line.unit_price)),
    discount_bps: valid(discountToBps(line.discount)),
    tax_rate_id: line.tax_rate_id,
    irpf_applies: line.irpf_applies,
    starts_on: oneOff ? null : emptyToNull(line.starts_on),
    ends_on: oneOff ? null : emptyToNull(line.ends_on),
    billing_day: monthly ? valid(parseBillingDay(line.billing_day)) : null,
    prorate_first: monthly ? line.prorate_first : true,
  };
}

/** Línea nueva del tipo pedido, con el IVA por defecto de la org y su día de facturación. */
export function newLineDefaults(
  billingType: BillingType,
  opts: { vatRateId: string | null; billingDay: number; today: string },
): LineFormInput {
  return {
    billing_type: billingType,
    description: "",
    quantity: "1",
    unit_price: "",
    discount: "",
    tax_rate_id: opts.vatRateId ?? "",
    irpf_applies: true,
    starts_on: isRecurring(billingType) ? opts.today : "",
    ends_on: "",
    billing_day: String(opts.billingDay),
    prorate_first: true,
  };
}

/** Lo que hace falta de una línea guardada para editarla. */
export type StoredLine = {
  billingType: BillingType;
  description: string;
  quantity: number | string;
  unitPriceCents: number;
  discountBps: number;
  taxRateId: string;
  irpfApplies: boolean;
  startsOn: string | null;
  endsOn: string | null;
  billingDay: number | null;
  prorateFirst: boolean;
};

export function lineFormDefaults(line: StoredLine, fallbackBillingDay: number): LineFormInput {
  return {
    billing_type: line.billingType,
    description: line.description,
    quantity: quantityToInput(line.quantity),
    unit_price: centsToMoneyInput(line.unitPriceCents),
    discount: line.discountBps === 0 ? "" : bpsToPercentInput(line.discountBps),
    tax_rate_id: line.taxRateId,
    irpf_applies: line.irpfApplies,
    starts_on: line.startsOn ?? "",
    ends_on: line.endsOn ?? "",
    billing_day: String(line.billingDay ?? fallbackBillingDay),
    prorate_first: line.prorateFirst,
  };
}

/**
 * Panel de una línea: siempre una sola línea en `lines` (así comparte campos con el alta del
 * contrato). `from` solo se usa al crear una versión nueva.
 */
export const lineSheetSchema = z.object({
  from: optionalDate,
  lines: z.array(lineFormSchema).length(1),
});
export const lineVersionSheetSchema = z.object({
  from: requiredDate,
  lines: z.array(lineFormSchema).length(1),
});
export type LineSheetInput = z.input<typeof lineSheetSchema>;

/** Condiciones de la versión nueva (new_line_version): las que se pueden cambiar. */
export function toVersionPayload(line: LineFormValues) {
  const row = toLinePayload(line, 0);
  return {
    description: row.description,
    quantity: row.quantity,
    unit_price_cents: row.unit_price_cents,
    discount_bps: row.discount_bps,
    tax_rate_id: row.tax_rate_id,
    irpf_applies: row.irpf_applies,
  };
}

// ---------------------------------------------------------------------------
// Hitos
// ---------------------------------------------------------------------------

/** La forma de un hito, sin validar su contenido (el alta solo lo valida si hay algo puntual). */
const milestoneShape = z.object({
  /** Vacío en los hitos nuevos. */
  id: optionalId,
  label: z.string(),
  percent: z.string(),
  planned_on: z.string(),
  auto: z.boolean(),
});

export const milestoneFormSchema = milestoneShape
  .extend({
    label: requiredText(120),
    percent: z.string().refine((v) => (percentInputToBps(v) ?? 0) > 0, "percent"),
    planned_on: optionalDate,
  })
  .superRefine((m, ctx) => {
    if (m.auto && m.planned_on === "") issue(ctx, ["planned_on"], "autoNeedsDate");
  });

export type MilestoneFormInput = z.input<typeof milestoneFormSchema>;
export type MilestoneFormValues = z.output<typeof milestoneFormSchema>;

/**
 * Error del plan completo (vacío o que no suma el 100 %), o null. Si algún porcentaje no se
 * entiende, el error ya sale en su fila: aquí no se repite.
 */
export function milestonePlanError(
  milestones: readonly { percent: string }[],
  required: boolean,
): MilestonePlanError | null {
  if (milestones.length === 0) return required ? "milestonesEmpty" : null;
  const percents = milestones.map((m) => percentInputToBps(m.percent));
  if (percents.some((bps) => bps === null || bps === 0)) return null;
  return validateMilestones(percents as number[]);
}

/** Suma de los porcentajes que se entienden (para el marcador en vivo). */
export function milestonesTotalBps(milestones: readonly { percent: string }[]): number {
  return milestones.reduce((sum, m) => sum + (percentInputToBps(m.percent) ?? 0), 0);
}

export type MilestonePayload = {
  id: string | null;
  position: number;
  label: string;
  percent_bps: number;
  planned_on: string | null;
  auto: boolean;
};

/**
 * Hitos validados → filas, en su orden. Los ya facturados conservan su posición (el trigger
 * no deja cambiarla); los demás van detrás, en el orden de la lista.
 */
export function toMilestonesPayload(
  milestones: readonly MilestoneFormValues[],
  lockedPositions: ReadonlyMap<string, number> = new Map(),
): MilestonePayload[] {
  let next = Math.max(-1, ...lockedPositions.values()) + 1;
  return milestones.map((m) => {
    const locked = m.id ? lockedPositions.get(m.id) : undefined;
    return {
      id: m.id === "" ? null : m.id,
      position: locked ?? next++,
      label: m.label.trim(),
      percent_bps: valid(percentInputToBps(m.percent)),
      planned_on: emptyToNull(m.planned_on),
      auto: m.auto && m.planned_on !== "",
    };
  });
}

/** Editor de hitos de un contrato ya creado. Con líneas puntuales, al menos un hito. */
export function milestonesSheetSchema(required: boolean) {
  return z.object({ milestones: z.array(milestoneFormSchema) }).superRefine((v, ctx) => {
    const error = milestonePlanError(v.milestones, required);
    if (error) issue(ctx, ["milestones"], error);
  });
}
export type MilestonesSheetInput = { milestones: MilestoneFormInput[] };

export type MilestonePresetLabel = "signature" | "midway" | "delivery";
/** Planes habituales: 100 % a la firma, 50/50 y 40/30/30. */
export const MILESTONE_PRESETS: Record<"full" | "half" | "thirds", { label: MilestonePresetLabel; percent: string }[]> = {
  full: [{ label: "signature", percent: "100" }],
  half: [
    { label: "signature", percent: "50" },
    { label: "delivery", percent: "50" },
  ],
  thirds: [
    { label: "signature", percent: "40" },
    { label: "midway", percent: "30" },
    { label: "delivery", percent: "30" },
  ],
};

// ---------------------------------------------------------------------------
// Alta del contrato
// ---------------------------------------------------------------------------

export const contractFormSchema = z
  .object({
    // Cliente existente o, si está vacío, uno nuevo con este nombre.
    client_id: optionalId,
    new_client_name: text(200),
    title: requiredText(200),
    issuer_id: z.guid("issuerRequired"),
    // Vacío: el contrato queda sin firmar y no factura.
    signed_on: optionalDate,
    payment_terms_days: z.string(),
    payment_method: z.enum(PAYMENT_METHODS),
    invoice_grouping: z.enum(INVOICE_GROUPINGS),
    lines: z.array(lineFormSchema).min(1, "linesEmpty"),
    // Se validan solo si hay alguna línea puntual: sin ella, el bloque de hitos ni se ve.
    milestones: z.array(milestoneShape),
  })
  .superRefine((v, ctx) => {
    if (!v.client_id && !v.new_client_name.trim()) issue(ctx, ["client_id"], "clientRequired");
    if (parseDays(v.payment_terms_days) === undefined) issue(ctx, ["payment_terms_days"], "days");
    if (v.lines.some((l) => l.billing_type === "one_off")) {
      v.milestones.forEach((m, index) => {
        const row = milestoneFormSchema.safeParse(m);
        for (const rowIssue of row.error?.issues ?? []) {
          issue(ctx, ["milestones", index, ...(rowIssue.path as (string | number)[])], rowIssue.message);
        }
      });
      const error = milestonePlanError(v.milestones, true);
      if (error) issue(ctx, ["milestones"], error);
    }
  });

export type ContractFormInput = z.input<typeof contractFormSchema>;
export type ContractFormValues = z.output<typeof contractFormSchema>;

/**
 * JSON de create_contract. Los hitos solo viajan si hay algo puntual que repartir (su `id`,
 * vacío en el alta, la RPC lo ignora).
 */
export function toCreateContractPayload(values: ContractFormValues, clientId: string) {
  const lines = values.lines.map((line, position) => toLinePayload(line, position));
  const hasOneOff = lines.some((l) => l.billing_type === "one_off");
  return {
    client_id: clientId,
    issuer_id: values.issuer_id,
    title: values.title.trim(),
    signed_on: emptyToNull(values.signed_on),
    payment_terms_days: parseDays(values.payment_terms_days) ?? null,
    payment_method: values.payment_method,
    invoice_grouping: values.invoice_grouping,
    lines,
    milestones: hasOneOff ? toMilestonesPayload(values.milestones) : [],
  };
}

// ---------------------------------------------------------------------------
// Resto de acciones del contrato
// ---------------------------------------------------------------------------

export const termsFormSchema = z.object({
  title: requiredText(200),
  // Solo si ya estaba firmado: corregir la fecha o, vacío, quitar la firma.
  signed_on: optionalDate,
  payment_terms_days: z.string().refine((v) => parseDays(v) !== undefined, "days"),
  payment_method: z.enum(PAYMENT_METHODS),
  invoice_grouping: z.enum(INVOICE_GROUPINGS),
  notes: text(2000),
});
export type TermsFormInput = z.input<typeof termsFormSchema>;

export const signFormSchema = z.object({ signed_on: requiredDate });
export type SignFormInput = z.input<typeof signFormSchema>;

export const issuerChangeSchema = z.object({
  issuer_id: z.guid("issuerRequired"),
  valid_from: requiredDate,
});
export type IssuerChangeInput = z.input<typeof issuerChangeSchema>;

export const pauseFormSchema = z
  .object({
    starts_on: requiredDate,
    // Vacío: hasta que se reanude.
    ends_on: optionalDate,
    reason: text(300),
  })
  .superRefine((v, ctx) => {
    if (isCivilDate(v.starts_on) && isCivilDate(v.ends_on) && v.ends_on < v.starts_on) {
      issue(ctx, ["ends_on"], "endsBeforeStart");
    }
  });
export type PauseFormInput = z.input<typeof pauseFormSchema>;

export const cancelFormSchema = z.object({
  ends_on: requiredDate,
  reason: text(500),
});
export type CancelFormInput = z.input<typeof cancelFormSchema>;

export const usageFormSchema = z
  .object({
    quantity: z.string(),
    billable_on: requiredDate,
    description: text(500),
  })
  .superRefine((v, ctx) => {
    if (parseQuantity(v.quantity) === null) issue(ctx, ["quantity"], "quantity");
  });
export type UsageFormInput = z.input<typeof usageFormSchema>;

export const waiveFormSchema = z.object({ reason: text(300) });
export type WaiveFormInput = z.input<typeof waiveFormSchema>;
