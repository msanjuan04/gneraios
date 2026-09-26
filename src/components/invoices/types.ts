import type { BillingType, DraftFormInput, InvoiceKind, InvoiceStatus, PaymentMethod } from "@/app/[org]/invoices/schema";
import type { Enums } from "@/lib/supabase/database.types";

/**
 * Lo que las páginas de facturas (servidor) pasan a sus componentes interactivos.
 * Solo datos serializables: fechas civiles `YYYY-MM-DD`, instantes en ISO y dinero en céntimos.
 */

export type VatRegime = Enums<"vat_regime">;
export type AppLocale = Enums<"app_locale">;
export type EmailStatus = Enums<"email_status">;
export type EmailTemplate = Enums<"email_template">;
export type JobStatus = Enums<"job_status">;
export type BillableSource = Enums<"billable_source">;
export type { BillingType, InvoiceKind, InvoiceStatus, PaymentMethod };

/** Fila del listado (vista `invoices_overview`). */
export type InvoiceListItem = {
  id: string;
  number: string | null;
  kind: InvoiceKind;
  status: InvoiceStatus;
  clientId: string;
  clientName: string;
  issuerId: string;
  issuerName: string;
  seriesCode: string | null;
  issuedOn: string | null;
  dueOn: string | null;
  /** Base imponible (sin IVA). */
  subtotalCents: number;
  /** Total a cobrar (con IVA y neto de IRPF). */
  totalCents: number;
  /** Lo que falta por cobrar de una emitida ordinaria (con IVA, neto de rectificativas y cobros). */
  outstandingCents: number;
  linesCount: number;
  createdAt: string;
};

/** Cifras de cabecera del listado: lo que hay que cobrar y lo que hay que emitir. */
export type InvoicesSummary = {
  pendingCents: number;
  pendingCount: number;
  overdueCents: number;
  overdueCount: number;
  draftsCount: number;
  draftsTotalCents: number;
  counts: Record<"draft" | "issued" | "overdue" | "paid" | "all", number>;
};

/** Última ejecución del cron de facturación de la org. */
export type LastBillingRun = {
  status: JobStatus;
  startedAt: string;
  /** Día de la ejecución respecto a hoy en la zona de la org. */
  day: "today" | "yesterday" | "earlier";
  runOn: string;
  error: string | null;
};

/** Resultado de emitir una factura (en bloque o de una en una). */
export type IssueResult = { invoiceId: string; ok: true; number: string } | { invoiceId: string; ok: false; error: string };

// ---------------------------------------------------------------------------
// Editor de borradores
// ---------------------------------------------------------------------------

export type EditorIssuer = {
  id: string;
  name: string;
  kind: "company" | "self_employed";
  defaultIrpfBps: number;
  verifactuFrom: string;
  fiscalProvider: string;
  /** Puede emitir hoy: dado de alta (la SL, constituida) y sin fecha de baja pasada. */
  activeToday: boolean;
  /** Datos fiscales que faltan para emitir (claves de billing.fiscalFields). */
  missing: string[];
};

export type EditorSeries = {
  id: string;
  issuerId: string;
  code: string;
  name: string;
  kind: InvoiceKind;
  isDefault: boolean;
  format: string;
  resetYearly: boolean;
  /** Último número usado por año (0 si la serie no se reinicia), para prever el siguiente. */
  lastByYear: Record<number, number>;
};

export type EditorTaxRate = {
  id: string;
  name: string;
  rateBps: number;
  regime: VatRegime;
  legalNote: string | null;
  isDefault: boolean;
  archived: boolean;
};

export type EditorClient = {
  id: string;
  name: string;
  isBusiness: boolean;
  taxIdKind: "es" | "eu_vat" | "foreign";
  countryCode: string;
  language: AppLocale;
  paymentTermsDays: number | null;
  /** Datos fiscales que faltan para emitir (claves de billing.fiscalFields). */
  missing: string[];
};

/** Lo que una línea guardada trae del contrato (no se edita desde el formulario). */
export type LineOrigin = {
  contractLineId: string | null;
  /** El pendiente de facturar que la originó: al quitarla se pregunta si vuelve a pendiente o se condona. */
  itemSource: BillableSource | null;
};

export type EditorContext = {
  mode: "create" | "edit";
  invoiceId: string | null;
  kind: InvoiceKind;
  /** updated_at al abrir, para el bloqueo optimista (texto tal cual). */
  updatedAt: string | null;
  /** Viene de un contrato o es rectificativa: emisor y cliente no se cambian aquí. */
  lockParties: boolean;
  lockReason: "contract" | "rectifying" | null;
  rectifies: { id: string; number: string } | null;
  lineOrigins: Record<string, LineOrigin>;
};

/** Lo que carga la página de un borrador (o de una factura manual nueva) para el editor. */
export type DraftEditorData = {
  context: EditorContext;
  defaults: DraftFormInput;
  issuers: EditorIssuer[];
  series: EditorSeries[];
  vatRates: EditorTaxRate[];
  irpfRates: { bps: number; name: string }[];
  clients: EditorClient[];
  orgPaymentTermsDays: number;
};

// ---------------------------------------------------------------------------
// Factura emitida
// ---------------------------------------------------------------------------

/** Datos congelados al emitir (issuer_snapshot / client_snapshot). */
export type PartySnapshot = {
  legalName: string;
  tradeName: string | null;
  taxId: string | null;
  addressLine: string | null;
  postalCode: string | null;
  city: string | null;
  province: string | null;
  countryCode: string | null;
  email: string | null;
  iban: string | null;
  registryInfo: string | null;
};

export type ViewLine = {
  id: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  discountBps: number;
  baseCents: number;
  vatBps: number;
  vatRegime: VatRegime;
  vatCents: number;
  irpfCents: number;
  legalNote: string | null;
  billingType: BillingType;
  periodStart: string | null;
  periodEnd: string | null;
};

export type PaymentItem = {
  id: string;
  amountCents: number;
  paidOn: string;
  method: PaymentMethod;
  reference: string | null;
};

export type EmailItem = {
  id: string;
  template: EmailTemplate;
  status: EmailStatus;
  to: string[];
  subject: string;
  sentAt: string | null;
  createdAt: string;
  error: string | null;
};

export type RelatedInvoice = {
  id: string;
  number: string | null;
  lifecycle: Enums<"invoice_lifecycle">;
  status: InvoiceStatus;
  issuedOn: string | null;
  totalCents: number;
  reason: string | null;
};

export type InvoiceViewData = {
  id: string;
  number: string | null;
  kind: InvoiceKind;
  lifecycle: Enums<"invoice_lifecycle">;
  status: InvoiceStatus;
  issuedOn: string | null;
  operationOn: string | null;
  dueOn: string | null;
  language: AppLocale;
  paymentMethod: PaymentMethod;
  notes: string | null;
  irpfBps: number;
  subtotalCents: number;
  vatCents: number;
  irpfCents: number;
  totalCents: number;
  paidCents: number;
  outstandingCents: number;
  rectifiedCents: number;
  netTotalCents: number;
  lastPaidOn: string | null;
  rectificationReason: string | null;
  clientId: string;
  clientName: string;
  issuerName: string;
  seriesCode: string | null;
  issuer: PartySnapshot;
  client: PartySnapshot;
  lines: ViewLine[];
  payments: PaymentItem[];
  emails: EmailItem[];
  rectifies: RelatedInvoice | null;
  rectifications: RelatedInvoice[];
  /** Conceptos del contrato aún enlazados a sus líneas (para volver a facturarlos o condonarlos si se anula). */
  linkedItemsCount: number;
  pendingReminders: number;
};

// ---------------------------------------------------------------------------
// Bandeja «Por enviar»
// ---------------------------------------------------------------------------

export type OutboxItem = {
  id: string;
  template: EmailTemplate;
  status: EmailStatus;
  language: AppLocale;
  to: string[];
  subject: string;
  body: string;
  createdAt: string;
  sentAt: string | null;
  error: string | null;
  invoice: {
    id: string;
    number: string | null;
    clientId: string;
    clientName: string;
    dueOn: string | null;
    outstandingCents: number;
    status: InvoiceStatus;
  } | null;
  /** Días que lleva vencida la factura hoy (null si no lo está). */
  daysOverdue: number | null;
};

// ---------------------------------------------------------------------------
// Ficha 360 del cliente
// ---------------------------------------------------------------------------

export type ClientInvoiceItem = {
  id: string;
  number: string | null;
  kind: InvoiceKind;
  status: InvoiceStatus;
  issuedOn: string | null;
  dueOn: string | null;
  subtotalCents: number;
  totalCents: number;
  outstandingCents: number;
};

/** Lo que devuelve `getClientInvoices` (src/server/invoices/queries.ts) para `ClientInvoicesCard`. */
export type ClientInvoicesData = {
  /** Las más recientes (borradores primero). */
  invoices: ClientInvoiceItem[];
  totalCount: number;
  /** Pendiente de cobro de sus emitidas (con IVA). */
  outstandingCents: number;
  overdueCents: number;
  overdueCount: number;
  draftsCount: number;
  /** Facturación neta emitida (base, sin IVA): la suma de sus facturas y rectificativas. */
  billedNetCents: number;
};
