// Datos de Finanzas tal como los pinta la UI (serializables: pasan de servidor a cliente). Los
// cargan src/server/finance/queries.ts con la sesión del usuario (RLS).

import type { ExpenseGroup, ExpenseStatus, PaymentMethod, SubscriptionInterval } from "@/domain/finance";
import type { CostAllocation } from "@/domain/finance/allocation";
import type { Enums } from "@/lib/supabase/database.types";

export type { CostAllocation, ExpenseGroup, ExpenseStatus, PaymentMethod, SubscriptionInterval };

/** En qué punto está la repercusión de un gasto (derivado en expenses_overview, nunca guardado). */
export type RebillState = Enums<"expense_rebill_state">;

export type MoneyFormat = { locale: string; currency: string };

export type IssuerOption = { id: string; name: string; kind: "company" | "self_employed"; archived: boolean };
export type CategoryOption = {
  id: string;
  name: string;
  expenseGroup: ExpenseGroup;
  isFixed: boolean;
  /** Servidores, bases de datos, dominios…: la agrupa Finanzas → Infraestructura. */
  isInfrastructure: boolean;
  archived: boolean;
};
export type VendorOption = {
  id: string;
  name: string;
  taxId: string | null;
  countryCode: string;
  defaultCategoryId: string | null;
  archived: boolean;
};
export type MemberOption = { id: string; fullName: string; initials: string };
/** Un cliente para «¿A quién sirve?» (los archivados solo se enseñan si ya estaban elegidos). */
export type ClientOption = { id: string; name: string; archived: boolean };
export type RateOption = { id: string; name: string; rateBps: number; isDefault: boolean };

/** Listas para los formularios (solo lo activo se ofrece; los nombres de lo archivado siguen ahí). */
export type FinanceConfig = {
  issuers: IssuerOption[];
  categories: CategoryOption[];
  vendors: VendorOption[];
  members: MemberOption[];
  /** Todos los clientes de la org, por nombre (el selector de «Un cliente» y los nombres de las listas). */
  clients: ClientOption[];
  vatRates: RateOption[];
  irpfRates: RateOption[];
  /** El emisor principal (la SL), que se propone en los gastos nuevos. */
  defaultIssuerId: string | null;
  /** El IVA por defecto de la org (tax_rates), que se propone en los gastos nuevos. */
  defaultVatBps: number;
};

export type ExpenseListItem = {
  id: string;
  issuerId: string;
  issuerName: string;
  vendorId: string | null;
  vendorName: string | null;
  categoryId: string;
  categoryName: string;
  expenseGroup: ExpenseGroup;
  isFixed: boolean;
  description: string;
  vendorInvoiceNumber: string | null;
  issuedOn: string;
  dueOn: string | null;
  payableOn: string;
  baseCents: number;
  vatBps: number;
  vatCents: number;
  vatDeductible: boolean;
  irpfBps: number;
  irpfCents: number;
  totalCents: number;
  costCents: number;
  paidOn: string | null;
  paymentMethod: PaymentMethod | null;
  memberId: string | null;
  memberName: string | null;
  subscriptionId: string | null;
  periodStart: string | null;
  hasAttachment: boolean;
  source: "manual" | "import" | "subscription";
  notes: string | null;
  status: ExpenseStatus;
  /** Lo genera una suscripción activa que lo volvería a generar: no se puede borrar. */
  locked: boolean;
  /** A quién sirve: la empresa, un cliente o las webs que alojamos. */
  allocation: CostAllocation;
  clientId: string | null;
  clientName: string | null;
  /** Se le repercute al cliente (con `rebillMarkupBps` de margen). */
  rebill: boolean;
  rebillMarkupBps: number;
  /** null si no se repercute. */
  rebillState: RebillState | null;
  /** La factura (borrador o emitida) con la que se repercutió. */
  rebillInvoiceId: string | null;
  rebillInvoiceNumber: string | null;
};

export type ExpenseFilters = {
  /** YYYY-MM o vacío (todos). */
  month: string;
  category: string;
  issuer: string;
  status: ExpenseStatus | "";
  /** Proveedor (id) o vacío. */
  vendor: string;
  /** Cliente (id) o vacío: los gastos que son de ese cliente. */
  client: string;
  /** "pending": solo lo que falta repercutir. */
  rebill: "pending" | "";
  q: string;
};

export type ExpensesSummary = {
  count: number;
  baseCents: number;
  vatCents: number;
  totalCents: number;
  costCents: number;
  pendingCents: number;
  pendingCount: number;
  overdueCents: number;
  overdueCount: number;
};

export type SubscriptionListItem = {
  id: string;
  issuerId: string;
  issuerName: string;
  vendorId: string | null;
  vendorName: string | null;
  categoryId: string;
  categoryName: string;
  memberId: string | null;
  memberName: string | null;
  description: string;
  baseCents: number;
  vatBps: number;
  vatDeductible: boolean;
  irpfBps: number;
  /** Lo que se paga en cada cargo: base + IVA − IRPF. */
  chargeTotalCents: number;
  interval: SubscriptionInterval;
  startsOn: string;
  endsOn: string | null;
  billingDay: number | null;
  paymentMethod: PaymentMethod;
  isActive: boolean;
  notes: string | null;
  nextChargeOn: string | null;
  /** Coste mensual equivalente (base + IVA no deducible; las anuales, /12). */
  monthlyCostCents: number;
  generatedCount: number;
  lastPeriodStart: string | null;
  allocation: CostAllocation;
  clientId: string | null;
  clientName: string | null;
  rebill: boolean;
  rebillMarkupBps: number;
};

/** Un gasto por repercutir, con lo que se le facturará al cliente (sin IVA). */
export type RebillItem = {
  id: string;
  description: string;
  vendorName: string | null;
  issuedOn: string;
  periodStart: string | null;
  baseCents: number;
  markupBps: number;
  /** Base + margen. */
  amountCents: number;
  fromSubscription: boolean;
};

export type RebillTotalsView = { count: number; baseCents: number; markupCents: number; amountCents: number };

/** Los pendientes de un cliente, para «Añadir a factura». */
export type RebillClientGroup = RebillTotalsView & { clientId: string; clientName: string; items: RebillItem[] };

/**
 * La tarjeta de la ficha del cliente: lo pendiente de repercutirle y lo que ya está en un
 * borrador suyo. Lo carga `getClientRebills(orgId, clientId)` (src/server/finance/rebill.ts).
 */
export type ClientRebillData = {
  pending: RebillItem[];
  totals: RebillTotalsView;
  /** Gastos ya en un borrador suyo, por emitir. */
  drafted: { count: number; amountCents: number; invoiceId: string | null };
};

export type CashBalanceItem = { id: string; balanceOn: string; balanceCents: number; source: "manual" | "import"; note: string | null };

export type CashAccountItem = {
  id: string;
  issuerId: string;
  issuerName: string;
  name: string;
  iban: string | null;
  isActive: boolean;
  balanceOn: string | null;
  balanceCents: number | null;
  /** Del más reciente al más antiguo. */
  balances: CashBalanceItem[];
};

export type ShareholdingSet = { validFrom: string; rows: { memberId: string; percentBps: number }[] };

export type PartnersData = {
  members: MemberOption[];
  /** Del reparto más reciente al más antiguo. */
  sets: ShareholdingSet[];
  /** El vigente hoy (fecha más reciente que no supera hoy). */
  currentValidFrom: string | null;
  months: string[];
  /** Retribución de socios (grupo partner_compensation) por socio y mes; memberId null = sin asignar. */
  compensation: { memberId: string | null; month: string; costCents: number }[];
};
