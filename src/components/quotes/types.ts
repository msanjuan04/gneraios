import type { AppLocale, QuoteFormInput, QuoteState, QuoteStatus } from "@/app/[org]/quotes/schema";
import type { PlanItem } from "@/app/[org]/quotes/summary";
import type { CatalogCategory, TemplateAmounts, TemplateLine } from "@/app/[org]/quotes/template-schema";
import type { Enums } from "@/lib/supabase/database.types";

/**
 * Lo que las páginas de presupuestos (servidor) pasan a sus componentes interactivos. Solo datos
 * serializables: fechas civiles "YYYY-MM-DD", instantes en ISO y dinero en céntimos.
 */

export type { AppLocale, QuoteState, QuoteStatus };
export type VatRegime = Enums<"vat_regime">;
export type EmailStatus = Enums<"email_status">;

/** Fila del listado (vista quotes_overview): los totales por tipo, nunca sumados. */
export type QuoteListItem = {
  id: string;
  number: string | null;
  title: string;
  clientId: string;
  clientName: string;
  dealTitle: string | null;
  state: QuoteState;
  issuedOn: string | null;
  validUntil: string | null;
  createdAt: string;
  /** Bases sin IVA. */
  oneOffCents: number;
  monthlyCents: number;
  yearlyCents: number;
  usageCount: number;
  linesCount: number;
  contractId: string | null;
};

export type QuoteClientOption = { id: string; name: string; language: AppLocale };
/** `pendingConstitution`: una SL sin fecha de alta, que aún no puede facturar. */
export type QuoteIssuerOption = { id: string; name: string; isPrimary: boolean; pendingConstitution: boolean };
export type QuoteVatRate = {
  id: string;
  name: string;
  rateBps: number;
  regime: VatRegime;
  legalNote: string | null;
  isDefault: boolean;
  archived: boolean;
};
export type QuoteDealOption = { id: string; title: string; clientId: string };

/** Opciones y valores por defecto de la org para el editor. */
export type QuoteFormOptions = {
  clients: QuoteClientOption[];
  issuers: QuoteIssuerOption[];
  vatRates: QuoteVatRate[];
  deals: QuoteDealOption[];
  defaultIssuerId: string | null;
  defaultVatRateId: string | null;
  /** `orgs.settings.quote_validity_days` (30 por defecto). */
  validityDays: number;
  /** `orgs.settings.billing_day`: el día de cobro de las mensuales que no digan otro. */
  billingDay: number;
};

export type QuoteEmailItem = {
  id: string;
  status: EmailStatus;
  to: string[];
  subject: string;
  sentAt: string | null;
  createdAt: string;
  hasSnapshot: boolean;
};
export type QuoteManualVersion = { id: string; method: Enums<"quote_send_method">; recipient: string | null; note: string | null; sentAt: string; sha256: string };

export type QuoteEditorData = {
  mode: "create" | "edit";
  quoteId: string | null;
  /** updated_at al abrirlo (bloqueo optimista). */
  updatedAt: string | null;
  number: string | null;
  status: QuoteStatus;
  state: QuoteState;
  /** Borrador o enviado, y socio u owner. */
  editable: boolean;
  /** Socio u owner (aceptar, rechazar, duplicar…). */
  canAct: boolean;
  defaults: QuoteFormInput;
  /** Fechas guardadas (vacías en un borrador: se fijan al enviarlo). */
  issuedOn: string | null;
  validUntil: string | null;
  acceptedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  contract: { id: string; title: string } | null;
  emails: QuoteEmailItem[];
  manualVersions: QuoteManualVersion[];
  options: QuoteFormOptions;
};

/** Una plantilla de presupuesto (quote_templates), con sus líneas ya validadas y los totales por tipo. */
export type QuoteTemplateItem = {
  id: string;
  name: string;
  category: CatalogCategory;
  summary: string | null;
  title: string | null;
  language: AppLocale;
  notes: string | null;
  lines: TemplateLine[];
  plan: PlanItem[];
  usesCount: number;
  updatedAt: string;
  amounts: TemplateAmounts;
};

/** Propuesta de email (en el idioma del presupuesto), editable antes de enviar. */
export type QuoteEmailDraft = {
  to: string;
  subject: string;
  body: string;
  language: AppLocale;
  /** Nombre del PDF adjunto; null en un borrador (se llamará como el número que reciba). */
  attachment: string | null;
};

/** Lo que fija el primer envío: el número y las fechas (hoy y la validez, si no las tenía). */
export type FinalizedQuote = { number: string; issuedOn: string | null; validUntil: string | null };
