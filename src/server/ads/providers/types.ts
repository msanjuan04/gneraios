// Contrato que cumple cada plataforma publicitaria. Solo servidor (las credenciales van en claro aquí).

import type { AdsCampaign } from "@/domain/ads/types";

export type ProviderCredentials = {
  /** Clave de API (OpenAI, Meta, LinkedIn) o token de refresco (Google). */
  credential: string;
  /** Cuenta en la plataforma; en OpenAI puede ir vacía y la fija la propia API. */
  externalAccountId: string;
  /** Google: developer token de la API de Google Ads. */
  developerToken?: string | null;
  /** Google: cuenta administradora (MCC) con la que se accede. */
  loginCustomerId?: string | null;
};

export type AccountInfo = {
  /** Identificador definitivo de la cuenta en la plataforma (normalizado). */
  externalAccountId: string;
  name: string;
  currency: string;
  timezone: string;
  email: string | null;
};

export type AdsProviderErrorCode = "unauthorized" | "not_found" | "invalid" | "http" | "pagination" | "not_connected";

export class AdsProviderError extends Error {
  constructor(
    readonly code: AdsProviderErrorCode,
    readonly status?: number,
    message?: string,
  ) {
    super(message ?? (status ? `${code} (HTTP ${status})` : code));
    this.name = "AdsProviderError";
  }
}

export interface AdsProviderClient {
  /** Comprueba la credencial y devuelve la cuenta a la que da acceso. */
  account(creds: ProviderCredentials): Promise<AccountInfo>;
  /** Campañas con sus métricas entre `from` y `to` (fechas civiles YYYY-MM-DD en la zona de la cuenta). */
  campaigns(creds: ProviderCredentials, from: string, to: string): Promise<AdsCampaign[]>;
}

/** Fetch con tiempo límite y sin caché; traduce 401/403 y 404 a errores con nombre. */
export async function providerFetch(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const { timeoutMs = 20_000, ...rest } = init;
  const response = await fetch(url, { ...rest, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  if (response.status === 401 || response.status === 403) throw new AdsProviderError("unauthorized", response.status);
  if (response.status === 404) throw new AdsProviderError("not_found", response.status);
  if (!response.ok) throw new AdsProviderError("http", response.status);
  return response;
}

export async function providerJson<T>(url: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const response = await providerFetch(url, init);
  return (await response.json()) as T;
}

/** Mensaje corto para guardar en `last_error` y enseñar en pantalla; nunca incluye la credencial. */
export function describeProviderError(error: unknown): string {
  if (error instanceof AdsProviderError) return error.message;
  if (error instanceof Error && error.name === "TimeoutError") return "timeout";
  if (error instanceof Error) return error.message.slice(0, 200);
  return "unknown";
}
