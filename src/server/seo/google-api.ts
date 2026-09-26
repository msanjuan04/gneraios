// Sin "server-only" (lo usa la sincronización); solo servidor.
//
// Cliente mínimo de las APIs de Google con fetch: token de acceso (se refresca solo si caduca),
// un ritmo mínimo entre peticiones y reintentos con espera exponencial ante 429 y 5xx (respetando
// Retry-After), que es lo que piden las cuotas de Search Console y GA4.

import { type FetchLike, GoogleAuthError } from "./google-oauth";

export class GoogleApiError extends Error {
  constructor(
    readonly status: number,
    /** El motivo que da Google (PERMISSION_DENIED, quotaExceeded…), si lo da. */
    readonly reason: string,
    message: string,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

/** Da el token de acceso vigente y sabe pedir otro. */
export interface AccessTokenSource {
  get(): Promise<string>;
  refresh(): Promise<string>;
}

export type GoogleClientOptions = {
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  /** Reintentos ante 429/5xx o fallos de red. */
  maxRetries?: number;
  /** Milisegundos mínimos entre el inicio de dos peticiones. */
  minIntervalMs?: number;
};

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const QUOTA_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded", "RESOURCE_EXHAUSTED"]);
const MAX_WAIT_MS = 30_000;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function errorDetails(body: unknown): { reason: string; message: string } {
  const error = (body as { error?: { status?: unknown; message?: unknown; errors?: { reason?: unknown }[] } } | null)?.error;
  const reason = error?.errors?.[0]?.reason ?? error?.status;
  return {
    reason: typeof reason === "string" ? reason : "",
    message: typeof error?.message === "string" ? error.message : "",
  };
}

function retryAfterMs(response: Response): number | null {
  const header = response.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}

export class GoogleClient {
  readonly #tokens: AccessTokenSource;
  readonly #fetch: FetchLike;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #maxRetries: number;
  readonly #minIntervalMs: number;
  #lastStart = 0;

  constructor(tokens: AccessTokenSource, opts: GoogleClientOptions = {}) {
    this.#tokens = tokens;
    this.#fetch = opts.fetch ?? ((input, init) => fetch(input, init));
    this.#sleep = opts.sleep ?? defaultSleep;
    this.#maxRetries = opts.maxRetries ?? 4;
    this.#minIntervalMs = opts.minIntervalMs ?? 120;
  }

  async #throttle() {
    const wait = this.#lastStart + this.#minIntervalMs - Date.now();
    if (wait > 0) await this.#sleep(wait);
    this.#lastStart = Date.now();
  }

  /** Petición JSON autenticada. Reintenta lo transitorio y refresca el token una vez si caduca. */
  async request(method: "GET" | "POST", url: string, body?: unknown): Promise<unknown> {
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      await this.#throttle();
      let response: Response;
      try {
        response = await this.#fetch(url, {
          method,
          headers: {
            authorization: `Bearer ${await this.#tokens.get()}`,
            accept: "application/json",
            ...(body === undefined ? {} : { "content-type": "application/json" }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          cache: "no-store",
        });
      } catch (error) {
        if (error instanceof GoogleAuthError) throw error;
        if (attempt >= this.#maxRetries) throw error;
        await this.#sleep(this.#backoff(attempt));
        continue;
      }

      if (response.ok) return response.json().catch(() => ({}));
      const json = await response.json().catch(() => null);
      const { reason, message } = errorDetails(json);

      if (response.status === 401 && !refreshed) {
        refreshed = true;
        await this.#tokens.refresh();
        continue;
      }
      const retryable = RETRYABLE_STATUS.has(response.status) || (response.status === 403 && QUOTA_REASONS.has(reason));
      if (retryable && attempt < this.#maxRetries) {
        await this.#sleep(Math.min(MAX_WAIT_MS, retryAfterMs(response) ?? this.#backoff(attempt)));
        continue;
      }
      throw new GoogleApiError(response.status, reason, message || `Google respondió ${response.status}`);
    }
  }

  #backoff(attempt: number): number {
    return Math.min(MAX_WAIT_MS, 1000 * 2 ** attempt + Math.floor(Math.random() * 250));
  }
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

const SEARCH_CONSOLE = "https://www.googleapis.com/webmasters/v3";
const ANALYTICS_ADMIN = "https://analyticsadmin.googleapis.com/v1beta";
const ANALYTICS_DATA = "https://analyticsdata.googleapis.com/v1beta";

export type SearchConsoleSite = { siteUrl: string; permissionLevel: string };
export type Ga4PropertyOption = { propertyId: string; displayName: string; account: string };

/** Las propiedades de Search Console de la cuenta (sin las que no tiene verificadas). */
export async function listSearchConsoleSites(client: GoogleClient): Promise<SearchConsoleSite[]> {
  const json = (await client.request("GET", `${SEARCH_CONSOLE}/sites`)) as { siteEntry?: { siteUrl?: unknown; permissionLevel?: unknown }[] };
  return (json.siteEntry ?? [])
    .flatMap((s) =>
      typeof s.siteUrl === "string" && s.permissionLevel !== "siteUnverifiedUser"
        ? [{ siteUrl: s.siteUrl, permissionLevel: typeof s.permissionLevel === "string" ? s.permissionLevel : "" }]
        : [],
    )
    .sort((a, b) => a.siteUrl.localeCompare(b.siteUrl));
}

/** Las propiedades de GA4 a las que llega la cuenta, con el nombre de su cuenta de Analytics. */
export async function listGa4Properties(client: GoogleClient): Promise<Ga4PropertyOption[]> {
  const out: Ga4PropertyOption[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 20; page++) {
    const params = new URLSearchParams({ pageSize: "200" });
    if (pageToken) params.set("pageToken", pageToken);
    const json = (await client.request("GET", `${ANALYTICS_ADMIN}/accountSummaries?${params.toString()}`)) as {
      accountSummaries?: { displayName?: unknown; propertySummaries?: { property?: unknown; displayName?: unknown }[] }[];
      nextPageToken?: unknown;
    };
    for (const account of json.accountSummaries ?? []) {
      for (const property of account.propertySummaries ?? []) {
        const id = typeof property.property === "string" ? property.property.replace(/^properties\//, "") : "";
        if (/^\d+$/.test(id)) {
          out.push({
            propertyId: id,
            displayName: typeof property.displayName === "string" ? property.displayName : id,
            account: typeof account.displayName === "string" ? account.displayName : "",
          });
        }
      }
    }
    pageToken = typeof json.nextPageToken === "string" && json.nextPageToken ? json.nextPageToken : undefined;
    if (!pageToken) break;
  }
  return out.sort((a, b) => a.account.localeCompare(b.account) || a.displayName.localeCompare(b.displayName));
}

/** searchAnalytics.query de Search Console. */
export function searchAnalyticsQuery(client: GoogleClient, siteUrl: string, body: Record<string, unknown>): Promise<unknown> {
  return client.request("POST", `${SEARCH_CONSOLE}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, body);
}

/** runReport de la API de datos de GA4. */
export function runGa4Report(client: GoogleClient, propertyId: string, body: Record<string, unknown>): Promise<unknown> {
  return client.request("POST", `${ANALYTICS_DATA}/properties/${encodeURIComponent(propertyId)}:runReport`, body);
}
