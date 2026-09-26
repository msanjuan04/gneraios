import type { ClientSeoSummary } from "@/server/seo/queries";
import type { ClientInvoicesData } from "@/components/invoices/types";
import type { ClientContractItem } from "@/components/contracts/types";
import type { ActivityKind, ClientRow, ClientStatus, ContactRow } from "@/app/[org]/clients/schema";
import type { Enums } from "@/lib/supabase/database.types";

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
  owner: MemberRef | null;
  city: string | null;
  sector: string | null;
  dealsCount: number;
  lastActivityAt: string | null;
  sourceName: string | null;
  archived: boolean;
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
  deals: ClientDeal[];
  timeline: TimelineEntry[];
  timelineTruncated: boolean;
  /** Contratos del cliente (src/server/contracts/queries.ts). */
  contracts: ClientContractItem[];
  /** Facturas del cliente (src/server/invoices/queries.ts). */
  invoices: ClientInvoicesData;
  /** SEO de la web del cliente, si la gestionamos (src/server/seo/queries.ts). */
  seo: ClientSeoSummary | null;
  /** Socios activos para el selector de responsable (con el actual aunque ya no tenga acceso). */
  ownerOptions: MemberOption[];
  defaultPaymentTerms: number;
};
