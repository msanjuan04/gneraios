import type {
  CreditorConfig,
  CreditorIdSource,
  CreditorIssue,
  ItemIssue,
  MandateForCheck,
  RemittanceIssue,
  RemittanceWarning,
} from "@/domain/collections";
import type { Enums } from "@/lib/supabase/database.types";

/**
 * Lo que las páginas de cobros (servidor) pasan a sus componentes interactivos. Solo datos
 * serializables: fechas civiles `YYYY-MM-DD`, instantes en ISO y dinero en céntimos.
 */

export type SequenceType = Enums<"sepa_sequence_type">;
export type RemittanceStatus = Enums<"sepa_remittance_status">;
export type RemittanceItemState = Enums<"sepa_item_state">;
export type InvoiceStatus = Enums<"invoice_status">;
export type PaymentMethod = Enums<"payment_method">;
export type { CreditorIdSource, CreditorIssue, ItemIssue, RemittanceIssue, RemittanceWarning };

// ---------------------------------------------------------------------------
// Datos de acreedor de cada emisor
// ---------------------------------------------------------------------------

export type CreditorSummary = {
  issuerId: string;
  issuerName: string;
  issuerLegalName: string;
  issuerTaxId: string | null;
  issuerIban: string | null;
  /** El owner ya ha guardado datos de acreedor para este emisor. */
  saved: boolean;
  /** Lo guardado (null = se usa lo del emisor o, en el ICS, la propuesta). */
  stored: { creditorId: string | null; confirmedAt: string | null; name: string | null; iban: string | null; bic: string | null };
  /** El ICS que sale del NIF del emisor con el sufijo 000 (o null si no hay NIF válido). */
  proposedCreditorId: string | null;
  /** Lo que usaría una remesa: lo guardado o, si falta, lo del emisor. */
  config: CreditorConfig;
  /** El ICS con el que se generaría y de dónde sale. */
  creditorId: string | null;
  source: CreditorIdSource | null;
  issues: CreditorIssue[];
};

// ---------------------------------------------------------------------------
// Listado de remesas
// ---------------------------------------------------------------------------

export type RemittanceListItem = {
  id: string;
  issuerId: string;
  issuerName: string;
  collectionOn: string;
  status: RemittanceStatus;
  itemsCount: number;
  totalCents: number;
  returnedCount: number;
  returnedCents: number;
  messageId: string | null;
  generatedAt: string | null;
  sentAt: string | null;
  settledOn: string | null;
  createdAt: string;
};

// ---------------------------------------------------------------------------
// Borrador (selección de facturas) y vista previa
// ---------------------------------------------------------------------------

export type DraftMandate = MandateForCheck & { id: string; nextSequence: SequenceType };

/** Una factura que se puede domiciliar con este emisor, o que ya está en el borrador. */
export type DraftRow = {
  invoiceId: string;
  number: string | null;
  clientId: string;
  clientName: string;
  issuedOn: string | null;
  dueOn: string | null;
  /** Lo que se cobraría: el pendiente de hoy (con IVA). */
  outstandingCents: number;
  invoiceStatus: InvoiceStatus;
  paymentMethod: PaymentMethod;
  /** El mandato activo del cliente con este acreedor. */
  mandate: DraftMandate | null;
  /** Ya va en otra remesa sin cobrar: no se puede seleccionar. */
  otherRemittance: { id: string; collectionOn: string; status: RemittanceStatus } | null;
  /** Está en este borrador (o, en uno nuevo, preseleccionada). */
  selected: boolean;
};

export type RemittanceEditorData = {
  mode: "create" | "edit";
  /** En una remesa nueva, el id ya reservado: repetir el alta no duplica nada. */
  remittanceId: string;
  updatedAt: string | null;
  issuer: { id: string; name: string };
  collectionOn: string;
  notes: string;
  creditor: CreditorSummary;
  rows: DraftRow[];
  today: string;
};

/** Resultado de la vista previa del fichero (no se guarda nada). */
export type RemittancePreview = {
  xml: string;
  /** El ICS aún no está confirmado: el fichero no sirve para el banco. */
  creditorIdSource: CreditorIdSource;
  included: number;
  excluded: number;
  totalCents: number;
};

// ---------------------------------------------------------------------------
// Remesa generada, enviada o cobrada
// ---------------------------------------------------------------------------

export type RemittanceViewItem = {
  id: string;
  invoiceId: string;
  invoiceNumber: string | null;
  clientId: string;
  clientName: string;
  amountCents: number;
  sequenceType: SequenceType | null;
  endToEndId: string | null;
  mandateReference: string | null;
  debtorName: string | null;
  debtorIban: string | null;
  state: RemittanceItemState;
  returnedOn: string | null;
  returnCode: string | null;
  returnReason: string | null;
  /** La factura hoy: su estado y lo que falta por cobrar. */
  invoiceStatus: InvoiceStatus;
  outstandingCents: number;
};

export type RemittanceViewData = {
  id: string;
  status: RemittanceStatus;
  issuer: { id: string; name: string };
  collectionOn: string;
  notes: string | null;
  messageId: string | null;
  generatedAt: string | null;
  sentAt: string | null;
  settledOn: string | null;
  settledAt: string | null;
  hasFile: boolean;
  creditor: { creditorId: string; name: string; iban: string; bic: string | null } | null;
  items: RemittanceViewItem[];
  totals: { count: number; totalCents: number; returnedCount: number; returnedCents: number };
  today: string;
};

// ---------------------------------------------------------------------------
// Ficha del cliente: mandatos
// ---------------------------------------------------------------------------

export type ClientMandateItem = {
  id: string;
  issuerId: string;
  issuerName: string;
  reference: string;
  debtorName: string;
  iban: string;
  bic: string | null;
  signedOn: string;
  revokedAt: string | null;
  revokeReason: string | null;
  notes: string | null;
  isActive: boolean;
  nextSequence: SequenceType;
  collectionsCount: number;
  lastCollectionOn: string | null;
  /** Ya va en algún fichero: sus datos no cambian (se revoca y se firma otro). */
  inUse: boolean;
};

/** Lo que devuelve `getClientMandates` (src/server/collections/mandates.ts) para `ClientMandateCard`. */
export type ClientMandatesData = {
  mandates: ClientMandateItem[];
  /** Emisores que pueden cobrar (acreedores posibles), con si ya tienen el ICS confirmado. */
  issuers: { id: string; name: string; creditorReady: boolean }[];
  /** Titular propuesto para un mandato nuevo (razón social del cliente). */
  defaultDebtorName: string;
  clientName: string;
  today: string;
};

// ---------------------------------------------------------------------------
// Factura: cómo se cobra
// ---------------------------------------------------------------------------

export type InvoiceRemittanceEntry = {
  itemId: string;
  remittanceId: string;
  collectionOn: string;
  status: RemittanceStatus;
  state: RemittanceItemState;
  amountCents: number;
  sequenceType: SequenceType | null;
  returnedOn: string | null;
  returnCode: string | null;
  returnReason: string | null;
};

/** Lo que devuelve `getInvoiceCollections` (src/server/collections/queries.ts) para la vista de una factura. */
export type InvoiceCollectionsData = {
  /** Emisor de la factura: el acreedor de sus adeudos. */
  issuerId: string;
  /** Mandato activo del cliente con el emisor de la factura. */
  mandate: { id: string; reference: string; iban: string; nextSequence: SequenceType } | null;
  /** Sus recibos en remesas, del más reciente al más antiguo. */
  entries: InvoiceRemittanceEntry[];
  /** Cobros que vienen de una remesa (se deshacen con una devolución, no borrándolos) → id de la remesa. */
  remittancePayments: Record<string, string>;
  /** Se cobra por domiciliación: tiene mandato, forma de pago SEPA o ya ha ido en una remesa. */
  sepa: boolean;
};
