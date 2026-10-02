import type { ClientSeoSummary } from "@/server/seo/queries";
import type { ClientHealth } from "@/domain/clients/health";
import type { ClientMandatesData } from "@/components/collections/types";
import type { ClientPortalCardData } from "@/components/portal/types";
import type { ClientProjectsData } from "@/components/projects/types";
import type { ClientSitesData } from "@/components/sites/types";
import type { ClientInvoicesData } from "@/components/invoices/types";
import type { ClientContractItem } from "@/components/contracts/types";
import type { ActivityKind, ClientRow, ClientStatus, ContactRow } from "@/app/[org]/clients/schema";
import type { Enums } from "@/lib/supabase/database.types";
import type { ClientManualStatus } from "@/domain/clients/status";
import type { ClientRebillData } from "@/components/finance/types";
import type { ClientVendorsData } from "@/components/vendors/types";
import type { ClientCollectionsData } from "@/server/clients/collections";
import type { ClientRequestFile, ClientRequestRow } from "./client-requests-panel";

/**
 * Lo que las páginas de clientes (servidor) pasan a sus componentes interactivos.
 * Solo datos serializables: fechas en ISO y dinero en céntimos.
 */

export type StageKind = Enums<"stage_kind">;

/** Un socio de la org (activo o no) tal y como se pinta: iniciales y, si se conoce, el nombre. */
export type MemberRef = { id: string; fullName: string | null; initials: string };

/** Socio activo, para los selectores de responsable. */
export type MemberOption = { id: string; fullName: string; initials: string };

/** Fila del listado (vista `clients_overview` + nombres de la configuración del CRM). */
export type ClientListItem = {
  id: string;
  displayName: string;
  legalName: string | null;
  taxId: string | null;
  status: ClientStatus;
  /** Estado marcado a mano por un socio (src/domain/clients/status.ts); null = el calculado. */
  manualStatus: ClientManualStatus | null;
  owner: MemberRef | null;
  city: string | null;
  sector: string | null;
  dealsCount: number;
  billedCents: number;
  collectedCents: number;
  outstandingCents: number;
  lastActivityAt: string | null;
  sourceName: string | null;
  archived: boolean;
  /** Señales de salud (src/domain/clients/health.ts). */
  health: ClientHealth;
};

/** Un deal del cliente (vista `deals_board`): lo puntual y lo recurrente, siempre por separado. */
export type ClientDeal = {
  id: string;
  title: string;
  stageName: string;
  stageKind: StageKind;
  oneOffCents: number;
  mrrCents: number;
  /** Probabilidad efectiva: la del deal o, si no tiene, la de su etapa. */
  probabilityBps: number;
  daysInStage: number;
  owner: MemberRef | null;
};

export type TimelineEntry =
  | {
      type: "activity";
      id: string;
      kind: ActivityKind;
      title: string;
      body: string | null;
      direction: "incoming" | "outgoing" | "internal" | null;
      channel: "email" | "whatsapp" | "phone" | "linkedin" | "instagram" | "other" | null;
      counterpart: string | null;
      externalReference: string | null;
      at: string;
      author: MemberRef | null;
      deal: { id: string; title: string } | null;
      contactName: string | null;
    }
  | {
      type: "stage";
      id: string;
      kind: "deal_created" | "stage_change";
      at: string;
      author: MemberRef | null;
      /** Solo si el deal sigue en el tablero (no archivado): enlaza a su panel. */
      dealId: string | null;
      dealTitle: string;
      from: string | null;
      to: string;
      toKind: StageKind | null;
    }
  | {
      /** Hechos de facturación que ya existen (contratos, facturas y cobros): la vista los une. */
      type: "billing";
      id: string;
      kind: "contract_signed" | "invoice_issued" | "invoice_rectifying" | "payment";
      at: string;
      author: MemberRef | null;
      /** Título del contrato o número de la factura. */
      title: string;
      /** Ruta dentro de la org a la que enlaza. */
      href: string;
      amountCents: number | null;
    };

export type ClientDetailData = {
  slug: string;
  basePath: string;
  /** Zona horaria de la org: la del formulario de actividad y la de las fechas. */
  timeZone: string;
  /** Instante de la petición (ms), para los tiempos relativos sin desajustes de hidratación. */
  now: number;
  /** Socio u owner: puede escribir (si el cliente no está archivado) y restaurar. */
  isPartner: boolean;
  client: ClientRow;
  status: ClientStatus;
  manualStatus: ClientManualStatus | null;
  /** Cuándo se marcó el estado a mano (ISO). */
  manualStatusAt: string | null;
  owner: MemberRef | null;
  sourceName: string | null;
  countryName: string;
  languageName: string;
  paymentTerms: { days: number; isDefault: boolean };
  /** Cuándo ganó su primer deal (ISO); null mientras sea un lead. */
  clientSince: string | null;
  /** LTV: facturación neta emitida (base sin IVA; las rectificativas restan). */
  billedNetCents: number;
  /** Fecha de la primera factura emitida ("YYYY-MM-DD"). */
  firstInvoiceOn: string | null;
  lastActivityAt: string | null;
  contacts: ContactRow[];
  requests: ClientRequestRow[];
  requestFiles: ClientRequestFile[];
  deals: ClientDeal[];
  timeline: TimelineEntry[];
  timelineTruncated: boolean;
  /** Contratos del cliente (src/server/contracts/queries.ts). */
  contracts: ClientContractItem[];
  /** Facturas del cliente (src/server/invoices/queries.ts). */
  invoices: ClientInvoicesData;
  /** SEO de la web del cliente, si la gestionamos (src/server/seo/queries.ts). */
  seo: ClientSeoSummary | null;
  health: ClientHealth;
  /** Proyectos del cliente, con sus horas y el €/hora (src/server/projects/cards.ts). */
  projects: ClientProjectsData;
  /** Webs vigiladas del cliente: estado, uptime, SSL y dominio (src/server/sites/queries.ts). */
  sites: ClientSitesData;
  /** «Tu espacio GNERAI»: enlace del portal y lo que ve el cliente (src/server/portal/links.ts). */
  portal: ClientPortalCardData;
  /** Mandatos SEPA para cobrar por remesa (src/server/collections/mandates.ts). */
  mandates: ClientMandatesData;
  /** Lo que ha pagado: cobros de facturas y sin factura (src/server/clients/collections.ts). */
  collections: ClientCollectionsData;
  /** Gastos por repercutir y en borrador (src/server/finance/rebill.ts). */
  rebills: ClientRebillData;
  /** Proveedores y freelancers con gastos asignados a este cliente (src/server/vendors/queries.ts). */
  vendors: ClientVendorsData;
  /** Hoy en la zona de la org ("YYYY-MM-DD"): el máximo de la fecha de un cobro. */
  today: string;
  /** Socios activos para el selector de responsable (con el actual aunque ya no tenga acceso). */
  ownerOptions: MemberOption[];
  defaultPaymentTerms: number;
};
