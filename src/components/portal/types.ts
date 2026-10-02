import type { CivilDate } from "@/domain/dates/civil-date";
import type {
  ClientInvoiceStatus,
  PaymentInstruction,
  PhaseProgress,
  PortalLocale,
  PortalSectionKey,
  ProjectPhase,
  PublicQuoteState,
} from "@/domain/portal";
import type { Progress, ProjectKind, ProjectStatus, TaskStatus } from "@/domain/projects";

// ---------------------------------------------------------------------------
// «Tu espacio» (lo que ve el cliente). Lo monta src/server/portal/space.ts con la clave de
// servidor, filtrado por la org y el cliente del enlace. Cada sección llega solo si está encendida.
// ---------------------------------------------------------------------------

/** Un proyecto por fases: los hitos de su contrato. */
export type SpaceProject = { contractId: string; title: string; phases: ProjectPhase[]; progress: PhaseProgress };

export type SpaceWorkTask = { id: string; title: string; status: Exclude<TaskStatus, "done"> };

/**
 * Un proyecto del módulo de proyectos que un socio ha hecho visible (src/server/portal/space-projects.ts).
 * Todo sale de sus tareas visibles para el cliente: nunca horas, notas ni importes.
 */
export type SpaceWorkProject = {
  id: string;
  name: string;
  kind: ProjectKind;
  status: ProjectStatus;
  /** Tareas visibles hechas entre tareas visibles (ratio null si no hay nada que medir). */
  progress: Progress;
  /** La próxima fecha prevista, de hoy en adelante (null si no hay o el proyecto no está en marcha). */
  nextDueOn: CivilDate | null;
  /** Las primeras tareas visibles sin hacer, en el orden del tablero (lo que está en curso, primero). */
  nextTasks: SpaceWorkTask[];
  /** Cuántas tareas visibles sin hacer quedan fuera de `nextTasks`. */
  moreOpen: number;
};

export type SpaceProgress = { projects: SpaceProject[]; workProjects: SpaceWorkProject[]; nextSteps: string | null };

export type SpaceActivityKind = "call" | "meeting" | "email" | "note";

export type SpaceWorkItem = {
  id: string;
  /** Una actividad marcada como visible o una tarea visible terminada ("task"). */
  kind: SpaceActivityKind | "task";
  title: string;
  body: string | null;
  /** Solo las tareas: el nombre de su proyecto. */
  project: string | null;
  /** Día (zona de la org) en que pasó o en que se terminó la tarea. */
  occurredOn: CivilDate;
};

export type SpaceFile = {
  id: string;
  kind: "file" | "link";
  title: string;
  fileName: string | null;
  sizeBytes: number | null;
  url: string | null;
  addedOn: CivilDate;
  contractTitle: string | null;
};

export type SpaceBillingType = "one_off" | "monthly" | "yearly" | "usage";

export type SpaceService = {
  id: string;
  description: string;
  billingType: SpaceBillingType;
  status: "active" | "paused" | "scheduled";
  startsOn: CivilDate | null;
  endsOn: CivilDate | null;
  contractTitle: string;
};

export type SpaceInvoice = {
  id: string;
  number: string;
  status: ClientInvoiceStatus;
  issuedOn: CivilDate | null;
  dueOn: CivilDate | null;
  totalCents: number;
  outstandingCents: number;
  issuerName: string;
  /** Cómo pagarla (null si no hay nada que pagar) y el titular de la cuenta. */
  payment: (PaymentInstruction & { holder: string }) | null;
};

export type SpaceQuote = {
  id: string;
  number: string;
  title: string;
  state: PublicQuoteState;
  validUntil: CivilDate | null;
  acceptedOn: CivilDate | null;
};

export type SpaceContract = {
  id: string;
  title: string;
  signedOn: CivilDate;
  status: "draft" | "scheduled" | "active" | "paused" | "ended";
  /** El presupuesto aceptado del que nació: su copia es el documento firmado. */
  quote: { id: string; number: string } | null;
};

export type SpaceDocuments = { invoices: SpaceInvoice[]; quotes: SpaceQuote[]; contracts: SpaceContract[] };

/** «Datos de tu web»: cifras medidas de los últimos 28 días frente a los 28 anteriores. */
export type PortalWebData = {
  site: string;
  source: "gsc" | "ga4" | "demo" | null;
  range: { from: CivilDate; to: CivilDate };
  clicks: number | null;
  impressions: number | null;
  position: number | null;
  sessions: number | null;
  /** Variación relativa (clics, apariciones, visitas) y posiciones ganadas; null si no hay con qué comparar. */
  change: { clicks: number | null; impressions: number | null; position: number | null; sessions: number | null };
};

export type PortalAdsData = {
  from: CivilDate;
  to: CivilDate;
  currency: string;
  campaigns: { id: string; name: string; impressions: number; clicks: number; spend: number; ctr: number | null }[];
};

export type SpaceData = {
  locale: PortalLocale;
  clientName: string;
  greeting: "morning" | "afternoon" | "evening";
  /** Hoy en la zona de la org. */
  today: CivilDate;
  /** Encendidas, en orden. */
  sections: PortalSectionKey[];
  progress: SpaceProgress | null;
  workLog: SpaceWorkItem[] | null;
  files: SpaceFile[] | null;
  services: SpaceService[] | null;
  documents: SpaceDocuments | null;
  webData: PortalWebData | null;
  adsData: PortalAdsData | null;
  footer: { issuers: string[]; email: string | null };
};

// ---------------------------------------------------------------------------
// Lado del socio: el control de un enlace y la tarjeta «Portal del cliente».
// ---------------------------------------------------------------------------

export type LinkStatus = "active" | "expired" | "revoked";

export type ShareLinkView = {
  id: string;
  kind: "quote" | "client";
  status: LinkStatus;
  createdAt: string;
  expiresAt: string;
  viewCount: number;
  lastViewedAt: string | null;
  /** Iniciales o nombre del socio que lo creó. */
  createdBy: string | null;
};

export type AcceptanceView = {
  signerName: string;
  signerEmail: string;
  signature: string | null;
  acceptedAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  pdfSha256: string;
  /** Hay copia exacta del PDF aceptado. */
  hasPdf: boolean;
};

export type QuoteShareData = {
  quoteId: string;
  /** Solo se comparte un presupuesto enviado y vigente. */
  shareable: boolean;
  blockedReason: "draft" | "expired" | "answered" | null;
  link: ShareLinkView | null;
  acceptance: AcceptanceView | null;
};

export type PortalFileItem = SpaceFile & { uploaded: boolean };

export type PortalActivityItem = { id: string; kind: SpaceActivityKind; title: string; occurredAt: string; visible: boolean };

/** Un proyecto del cliente y lo que ve de él. La visibilidad se cambia en la ficha del proyecto. */
export type PortalProjectItem = { id: string; name: string; visible: boolean; visibleTasks: number };

export type ClientPortalCardData = {
  clientId: string;
  archived: boolean;
  link: ShareLinkView | null;
  sections: Record<PortalSectionKey, boolean>;
  nextSteps: string;
  files: PortalFileItem[];
  activities: PortalActivityItem[];
  contracts: { id: string; title: string }[];
  /** Sus proyectos sin archivar ni cancelar: primero los visibles (en el orden del portal), luego los ocultos. */
  projects: PortalProjectItem[];
  /** Hay web conectada en SEO (si no, «Datos de tu web» no enseñaría nada). */
  hasWebData: boolean;
};
