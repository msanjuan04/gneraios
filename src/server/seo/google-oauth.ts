// Sin "server-only": la sincronización refresca el token con este módulo. Solo servidor.
//
// OAuth 2.0 de Google para servidores web: código de autorización con PKCE, acceso offline (token
// de refresco) y `state` firmado con HMAC que ata la vuelta al usuario, a la org y a una cookie de
// un solo uso (así nadie puede colar su cuenta de Google en la org de otro).

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { GoogleConfig } from "./config";

export const GOOGLE_SCOPES = {
  searchConsole: "https://www.googleapis.com/auth/webmasters.readonly",
  analytics: "https://www.googleapis.com/auth/analytics.readonly",
} as const;

/** Lo que se pide al conectar: leer Search Console y Analytics, y el email de la cuenta. */
export const GOOGLE_OAUTH_SCOPES = ["openid", "email", GOOGLE_SCOPES.searchConsole, GOOGLE_SCOPES.analytics] as const;

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

/** Cookie de un solo uso con el nonce y el verificador PKCE del intento de conexión en curso. */
export const OAUTH_COOKIE = "gnerai_google_oauth";
// Cubre el inicio (/api/integrations/google/start) y la vuelta (/api/auth/callback/google).
export const OAUTH_COOKIE_PATH = "/api";
export const OAUTH_TTL_SECONDS = 10 * 60;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type OAuthState = { orgId: string; slug: string; userId: string; nonce: string; expiresAt: number };

export class GoogleAuthError extends Error {
  /** `invalid_grant`: el token de refresco ya no vale (revocado, caducado o sin acceso): hay que reconectar. */
  constructor(
    readonly code: string,
    message?: string,
  ) {
    super(message ? `${code}: ${message}` : code);
    this.name = "GoogleAuthError";
  }
}

const b64url = (bytes: Buffer) => bytes.toString("base64url");

export function newNonce(): string {
  return b64url(randomBytes(18));
}

/** PKCE (RFC 7636, S256): el verificador se queda en la cookie y el reto viaja a Google. */
export function createPkce(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()) };
}

export function signState(state: OAuthState, key: Buffer): string {
  const payload = b64url(Buffer.from(JSON.stringify(state), "utf8"));
  return `${payload}.${b64url(createHmac("sha256", key).update(payload).digest())}`;
}

/** El state si la firma es buena y no ha caducado; null en cualquier otro caso. */
export function verifyState(token: string | null | undefined, key: Buffer, now = Date.now()): OAuthState | null {
  if (!token) return null;
  const [payload, signature, ...rest] = token.split(".");
  if (!payload || !signature || rest.length > 0) return null;
  const expected = createHmac("sha256", key).update(payload).digest();
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const state = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<OAuthState>;
    const valid =
      typeof state.orgId === "string" &&
      typeof state.slug === "string" &&
      typeof state.userId === "string" &&
      typeof state.nonce === "string" &&
      typeof state.expiresAt === "number" &&
      state.expiresAt > now;
    return valid ? (state as OAuthState) : null;
  } catch {
    return null;
  }
}

/** Pantalla de consentimiento: offline para recibir el token de refresco y `consent` para recibirlo siempre. */
export function authorizationUrl(opts: {
  config: Pick<GoogleConfig, "clientId" | "redirectUri">;
  state: string;
  challenge: string;
  loginHint?: string | null;
}): string {
  const params = new URLSearchParams({
    client_id: opts.config.clientId,
    redirect_uri: opts.config.redirectUri,
    response_type: "code",
    scope: GOOGLE_OAUTH_SCOPES.join(" "),
    access_type: "offline",
    // Siempre el selector de cuenta: la de Google que ve las propiedades (p. ej. info@) no tiene
    // por qué ser la del socio que conecta. «consent» asegura el refresh token.
    prompt: "consent select_account",
    include_granted_scopes: "true",
    state: opts.state,
    code_challenge: opts.challenge,
    code_challenge_method: "S256",
  });
  if (opts.loginHint) params.set("login_hint", opts.loginHint);
  return `${AUTH_URL}?${params.toString()}`;
}

export type TokenGrant = {
  accessToken: string;
  refreshToken: string | null;
  /** Segundos de vida del token de acceso. */
  expiresIn: number;
  scopes: string[];
  idToken: string | null;
};

async function tokenRequest(fetchImpl: FetchLike, body: URLSearchParams): Promise<TokenGrant> {
  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: body.toString(),
    cache: "no-store",
  });
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || typeof json.access_token !== "string") {
    throw new GoogleAuthError(
      typeof json.error === "string" ? json.error : `http_${response.status}`,
      typeof json.error_description === "string" ? json.error_description : undefined,
    );
  }
  return {
    accessToken: json.access_token,
    refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : null,
    expiresIn: typeof json.expires_in === "number" ? json.expires_in : 3600,
    scopes: typeof json.scope === "string" ? json.scope.split(/\s+/).filter(Boolean) : [],
    idToken: typeof json.id_token === "string" ? json.id_token : null,
  };
}

/** Cambia el código de la vuelta por los tokens. */
export function exchangeCode(
  fetchImpl: FetchLike,
  opts: { code: string; verifier: string; config: GoogleConfig },
): Promise<TokenGrant> {
  return tokenRequest(
    fetchImpl,
    new URLSearchParams({
      grant_type: "authorization_code",
      code: opts.code,
      code_verifier: opts.verifier,
      client_id: opts.config.clientId,
      client_secret: opts.config.clientSecret,
      redirect_uri: opts.config.redirectUri,
    }),
  );
}

/** Un token de acceso nuevo (dura una hora). Lanza `invalid_grant` si hay que reconectar. */
export function refreshAccessToken(
  fetchImpl: FetchLike,
  opts: { refreshToken: string; config: Pick<GoogleConfig, "clientId" | "clientSecret"> },
): Promise<TokenGrant> {
  return tokenRequest(
    fetchImpl,
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: opts.refreshToken,
      client_id: opts.config.clientId,
      client_secret: opts.config.clientSecret,
    }),
  );
}

/** Revoca el acceso en Google (al desconectar). No lanza: si falla, el token se borra igual. */
export async function revokeToken(fetchImpl: FetchLike, token: string): Promise<boolean> {
  try {
    const response = await fetchImpl(REVOKE_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * El email del id_token. Llega directamente del endpoint de tokens de Google por TLS, así que no
 * hace falta verificar la firma (lo dice la propia documentación de OpenID de Google).
 */
export function emailFromIdToken(idToken: string | null): string | null {
  const payload = idToken?.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { email?: unknown; email_verified?: unknown };
    return typeof claims.email === "string" && claims.email_verified !== false ? claims.email.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Qué permite lo concedido (con el consentimiento granular, el usuario puede desmarcar uno). */
export function grantedFeatures(scopes: readonly string[]): { searchConsole: boolean; analytics: boolean } {
  return { searchConsole: scopes.includes(GOOGLE_SCOPES.searchConsole), analytics: scopes.includes(GOOGLE_SCOPES.analytics) };
}
