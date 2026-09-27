// Proveedores de datos SEO (ARCHITECTURE.md §10). La sincronización no sabe de Google: pide a cada
// proveedor un tramo de fechas y guarda lo que le entrega. Hoy hay dos (Search Console y GA4, en
// src/server/seo/providers.ts); Semrush o Ahrefs serían otro `SeoProvider` con su propio tipo de
// hecho (posiciones por palabra clave, enlaces…) y su método en el `FactSink`.

import type { CivilDate } from "../dates/civil-date";
import type { DayRange } from "./period";

export type SeoProviderId = "gsc" | "ga4";

/** La propiedad tal y como la necesita un proveedor. */
export type SyncProperty = {
  id: string;
  orgId: string;
  gscSiteUrl: string | null;
  ga4PropertyId: string | null;
};

/** Totales de un día de Search Console. */
export type SearchDailyFact = { metricOn: CivilDate; clicks: number; impressions: number; position: number | null };

/** Consulta × página × día de Search Console. */
export type QueryDailyFact = {
  metricOn: CivilDate;
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  position: number | null;
};

/**
 * "all" es el total del día; el resto, los canales de GA4 agrupados (ver GA4_CHANNEL_GROUPS en
 * google-rows.ts). La suma de canales da el total de sesiones; los usuarios no se suman (la misma
 * persona llega por varios canales).
 */
export const WEB_CHANNELS = [
  "organic_search",
  "paid_search",
  "organic_social",
  "paid_social",
  "direct",
  "referral",
  "email",
  "other",
] as const;
export type WebChannel = "all" | (typeof WEB_CHANNELS)[number];

/** Un día de GA4 en un canal. */
export type WebDailyFact = {
  metricOn: CivilDate;
  channel: WebChannel;
  sessions: number;
  users: number;
  engagedSessions: number;
  conversions: number;
};

/** Dónde deja el proveedor lo que descarga (la sincronización lo guarda con upserts idempotentes). */
export interface FactSink {
  searchDaily(rows: readonly SearchDailyFact[]): Promise<void>;
  queryDaily(rows: readonly QueryDailyFact[]): Promise<void>;
  webDaily(rows: readonly WebDailyFact[]): Promise<void>;
}

export interface SeoProvider {
  readonly id: SeoProviderId;
  /** Días por petición (cuanto más grande, menos peticiones; lo limita lo que devuelve cada una). */
  readonly windowDays: number;
  /** Días del final que se vuelven a pedir en cada ejecución (el proveedor los consolida con retraso). */
  readonly resyncDays: number;
  /** ¿Esta propiedad tiene datos en el proveedor? */
  appliesTo(property: SyncProperty): boolean;
  /** Días que el proveedor puede dar hoy: desde `earliest` hasta `latest`, ambos incluidos. */
  availability(today: CivilDate): DayRange;
  /** Descarga un tramo (fechas incluidas) y lo entrega al sink. Devuelve cuántas filas ha entregado. */
  fetchRange(property: SyncProperty, range: DayRange, sink: FactSink): Promise<number>;
}
