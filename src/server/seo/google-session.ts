// Sin "server-only" (lo usan la sincronización y el cron); solo servidor, con la clave secreta.
//
// Abre la conexión con Google de una org: lee el token de refresco cifrado (solo service_role
// puede), lo descifra y da un cliente que pide y renueva tokens de acceso según los necesita. Si
// Google dice que el token ya no vale, la integración queda en error para que un owner reconecte.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { type GoogleConfig, googleSetup } from "./config";
import { type AccessTokenSource, GoogleClient, type GoogleClientOptions } from "./google-api";
import { type FetchLike, GoogleAuthError, refreshAccessToken } from "./google-oauth";
import { integrationSecretContext, type SecretStore, SecretStoreError, secretStoreFromEnv } from "./secret-store";

export type AdminDb = SupabaseClient<Database>;

export class SeoConnectionError extends Error {
  /** not_configured: faltan variables de entorno · not_connected: nadie ha conectado · reconnect: el token ya no vale. */
  constructor(readonly code: "not_configured" | "not_connected" | "reconnect") {
    super(`google_${code}`);
    this.name = "SeoConnectionError";
  }
}

export type GoogleSessionOptions = {
  fetch?: FetchLike;
  secrets?: SecretStore;
  config?: GoogleConfig;
  client?: Omit<GoogleClientOptions, "fetch">;
};

export type GoogleSession = {
  client: GoogleClient;
  integrationId: string;
  scopes: string[];
  /** El token de refresco en claro (para revocarlo al desconectar). No sale del servidor. */
  refreshToken: string;
};

/** Marca la integración como caducada: hay que volver a conectar. */
export async function markReconnectNeeded(admin: AdminDb, integrationId: string, detail: string): Promise<void> {
  await admin
    .from("integrations")
    .update({ status: "error", last_error: detail.slice(0, 500) })
    .eq("id", integrationId)
    .neq("status", "disconnected");
}

export async function openGoogleSession(admin: AdminDb, orgId: string, opts: GoogleSessionOptions = {}): Promise<GoogleSession> {
  const config = opts.config ?? googleSetup().config;
  if (!config) throw new SeoConnectionError("not_configured");
  const fetchImpl: FetchLike = opts.fetch ?? ((input, init) => fetch(input, init));

  const { data: integration, error } = await admin
    .from("integrations")
    .select("id, status, scopes, refresh_token_encrypted")
    .eq("org_id", orgId)
    .eq("provider", "google")
    .maybeSingle();
  if (error) throw error;
  if (!integration || integration.status === "disconnected" || !integration.refresh_token_encrypted) {
    throw new SeoConnectionError("not_connected");
  }

  const secrets = opts.secrets ?? secretStoreFromEnv();
  let refreshToken: string;
  try {
    refreshToken = await secrets.open(integration.refresh_token_encrypted, integrationSecretContext(orgId, "google"));
  } catch (error) {
    // Un token guardado con una clave que ya no existe (p. ej. antes de mover el servidor) no se
    // puede recuperar: pide reconectar Google en vez de fallar con un error técnico. Los datos de SEO
    // ya descargados se quedan.
    if (error instanceof SecretStoreError && (error.code === "secret_invalid" || error.code === "secret_format")) {
      await markReconnectNeeded(admin, integration.id, "secret_unreadable");
      throw new SeoConnectionError("reconnect");
    }
    throw error;
  }

  let current: { token: string; expiresAt: number } | null = null;
  const source: AccessTokenSource = {
    async refresh() {
      try {
        const grant = await refreshAccessToken(fetchImpl, { refreshToken, config });
        current = { token: grant.accessToken, expiresAt: Date.now() + (grant.expiresIn - 60) * 1000 };
        return grant.accessToken;
      } catch (e) {
        if (e instanceof GoogleAuthError && (e.code === "invalid_grant" || e.code === "unauthorized_client")) {
          await markReconnectNeeded(admin, integration.id, e.message);
          throw new SeoConnectionError("reconnect");
        }
        throw e;
      }
    },
    async get() {
      return current && current.expiresAt > Date.now() ? current.token : this.refresh();
    },
  };

  return {
    client: new GoogleClient(source, { ...opts.client, fetch: fetchImpl }),
    integrationId: integration.id,
    scopes: integration.scopes,
    refreshToken,
  };
}
