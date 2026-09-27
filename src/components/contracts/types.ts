import type { BillingType, ContractStatus, InvoiceGrouping, PaymentMethod } from "@/app/[org]/contracts/schema";
import type { Enums } from "@/lib/supabase/database.types";

/**
 * Lo que las páginas de contratos (servidor) pasan a sus componentes interactivos. Solo
 * datos serializables: fechas civiles "YYYY-MM-DD", instantes en ISO y dinero en céntimos.
 * Todo lo que se deriva (MRR, estados, próxima facturación) llega ya calculado.
 */

export type { BillingType, ContractStatus, InvoiceGrouping, PaymentMethod };
export type LineStatus = Enums<"line_status">;
export type BillableState = Enums<"billable_state">;
export type BillableSource = Enums<"billable_source">;
export type InvoiceStatus = Enums<"invoice_status">;

/** `language`: el idioma de sus documentos (las líneas del catálogo salen en él). */
export type ClientOption = { id: string; name: string; language?: "es" | "ca" | "en" };
/** `pendingConstitution`: una SL sin fecha de alta, que aún no puede emitir. */
export type IssuerOption = { id: string; name: string; isPrimary: boolean; pendingConstitution: boolean };
export type VatRateOption = { id: string; name: string; rateBps: number; isDefault: boolean };

/** Lo que necesitan los paneles de alta y edición: opciones y valores por defecto de la org. */
export type ContractFormOptions = {
  clients: ClientOption[];
  issuers: IssuerOption[];
  vatRates: VatRateOption[];
  defaultIssuerId: string | null;
  defaultVatRateId: string | null;
  /** `orgs.settings.billing_day`. */
  billingDay: number;
  /** `orgs.settings.payment_terms_days`. */
  paymentTermsDays: number;
};

export type UpcomingMrr = { cents: number; from: string } | null;

/** Fila del listado de contratos. */
export type ContractListItem = {
  id: string;
  title: string;
  clientId: string;
  clientName: string;
  status: ContractStatus;
  signedOn: string | null;
  archived: boolean;
  linesCount: number;
  mrrCents: number;
  upcomingMrr: UpcomingMrr;
  oneOffCents: number;
  nextBillingOn: string | null;
  issuerName: string | null;
};

/** Contrato en la ficha 360 del cliente. */
export type ClientContractItem = {
  id: string;
  title: string;
  status: ContractStatus;
  signedOn: string | null;
  mrrCents: number;
  upcomingMrr: UpcomingMrr;
  oneOffCents: number;
  nextBillingOn: string | null;
};

export type PauseView = { id: string; startsOn: string; endsOn: string | null; reason: string | null };

export type ContractLineView = {
  id: string;
  position: number;
  description: string;
  billingType: BillingType;
  quantity: number;
  unitPriceCents: number;
  discountBps: number;
  taxRateId: string;
  taxRateName: string;
  irpfApplies: boolean;
  startsOn: string | null;
  endsOn: string | null;
  billingDay: number | null;
  prorateFirst: boolean;
  cancelledOn: string | null;
  cancelReason: string | null;
  /** Versión anterior de esta línea (cambio de condiciones desde una fecha). */
  replacesLineId: string | null;
  /** Versión que la sustituye, si la hay. */
  replacedByLineId: string | null;
  status: LineStatus;
  /** Último día de los periodos facturados (o condonados). */
  billedUntil: string | null;
  /** Conceptos ya facturados, en borrador o condonados: con alguno, las condiciones no se tocan. */
  billedItemsCount: number;
  /** Base de un ciclo (cantidad × precio − descuento), sin IVA. */
  baseCents: number;
  nextBillingOn: string | null;
  pauses: PauseView[];
  currentPause: PauseView | null;
  upcomingPause: PauseView | null;
  /** Fin de periodo que se propone al dar de baja. */
  recommendedEndOn: string | null;
  /** Fecha que se propone para una versión nueva. */
  defaultVersionFrom: string;
};

export type MilestoneView = {
  id: string;
  position: number;
  label: string;
  percentBps: number;
  plannedOn: string | null;
  auto: boolean;
  /** Lo que factura (el último, el resto); null si el contrato no tiene nada puntual. */
  amountCents: number | null;
  /** null: aún sin facturar. */
  state: BillableState | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
};

export type BillableItemView = {
  id: string;
  contractLineId: string;
  source: BillableSource;
  description: string;
  periodStart: string | null;
  periodEnd: string | null;
  billableOn: string;
  quantity: number;
  amountCents: number;
  state: BillableState;
  invoiceId: string | null;
  invoiceNumber: string | null;
  waivedAt: string | null;
  waiveReason: string | null;
};

export type ContractInvoiceView = {
  id: string;
  number: string | null;
  kind: Enums<"series_kind">;
  issuedOn: string | null;
  createdAt: string;
  totalCents: number;
  status: InvoiceStatus;
};

export type IssuerAssignmentView = {
  id: string;
  issuerId: string;
  issuerName: string;
  validFrom: string;
  /** El que emite hoy. */
  current: boolean;
  /** Empieza después de hoy (se puede quitar). */
  scheduled: boolean;
};

export type ContractKpis = {
  mrrCents: number;
  upcomingMrr: UpcomingMrr;
  oneOffCents: number;
  /** Lo puntual que aún no ha pasado a ningún hito facturado. */
  oneOffPendingCents: number;
  /** Σ de los conceptos ya en facturas emitidas (base, sin IVA). */
  billedCents: number;
  /** Σ de los conceptos pendientes y en borrador. */
  pendingCents: number;
  draftedCents: number;
  issuedInvoices: number;
};

export type ContractDetailData = {
  slug: string;
  basePath: string;
  /** Hoy en la zona de la org. */
  today: string;
  /** Socio u owner y contrato no archivado. */
  canEdit: boolean;
  contract: {
    id: string;
    title: string;
    clientId: string;
    clientName: string;
    signedOn: string | null;
    paymentTermsDays: number | null;
    paymentMethod: PaymentMethod;
    invoiceGrouping: InvoiceGrouping;
    notes: string | null;
    archived: boolean;
    status: ContractStatus;
  };
  /** Plazo que se aplica: el del contrato, el del cliente o el de la org. */
  paymentTerms: { days: number; source: "contract" | "client" | "org"; clientDays: number | null };
  issuer: { id: string; name: string } | null;
  issuerHistory: IssuerAssignmentView[];
  lines: ContractLineView[];
  milestones: MilestoneView[];
  /** El siguiente hito sin facturar (se facturan en orden). */
  nextMilestoneId: string | null;
  items: BillableItemView[];
  invoices: ContractInvoiceView[];
  kpis: ContractKpis;
  options: ContractFormOptions;
};
