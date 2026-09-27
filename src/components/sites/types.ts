import type { CheckBucket, CheckError, ExpiryInfo, ExpirySeverity, Incident, SiteCheck, SiteStatus, SiteThresholds, Uptime } from "@/domain/sites";

/** Lo que caduca (certificado o dominio) con su gravedad según los días de aviso de la org. */
export type SiteExpiry = ExpiryInfo & { severity: ExpirySeverity };

/** Una web en las listas (Webs, ficha del cliente), con todo lo derivado ya calculado en el servidor. */
export type SiteListItem = {
  id: string;
  url: string;
  /** La URL sin "https://". */
  displayUrl: string;
  label: string | null;
  /** La etiqueta o, sin ella, la URL. */
  name: string;
  clientId: string | null;
  clientName: string | null;
  hostedByUs: boolean;
  isActive: boolean;
  notes: string | null;
  domainExpiresOn: string | null;
  status: SiteStatus;
  lastCheckedAt: string | null;
  lastStatusCode: number | null;
  lastResponseMs: number | null;
  lastError: CheckError | null;
  /** Fallos seguidos (la caída en curso) y desde cuándo. */
  failures: number;
  failingSince: string | null;
  /** La caída ya tiene los fallos seguidos que pide la org (se ha avisado). */
  confirmed: boolean;
  uptime: Uptime;
  ssl: SiteExpiry | null;
  domain: SiteExpiry | null;
  /** Caída, lenta o con algo a punto de caducar. */
  problem: boolean;
};

export type SiteClientOption = { id: string; name: string; website: string | null };

export type SitesPageData = {
  sites: SiteListItem[];
  clients: SiteClientOption[];
  thresholds: SiteThresholds;
};

/** Una caída en la ficha de una web. */
export type SiteIncidentView = Incident & { minutes: number; confirmed: boolean };

export type SiteDetailData = {
  site: SiteListItem;
  clients: SiteClientOption[];
  thresholds: SiteThresholds;
  /** Los últimos 7 días, por horas. */
  buckets: CheckBucket[];
  /** Las caídas confirmadas de los últimos 7 días, de la más reciente a la más antigua. */
  incidents: SiteIncidentView[];
  /** Fallos sueltos (sin llegar a caída) de los últimos 7 días. */
  blips: number;
  /** Las últimas comprobaciones, de la más reciente a la más antigua. */
  recentChecks: SiteCheck[];
  /** Media de respuesta de las últimas 24 h. */
  avgResponseMs24h: number | null;
};

/** Las webs de un cliente para su ficha 360. */
export type ClientSitesData = { sites: SiteListItem[] };
