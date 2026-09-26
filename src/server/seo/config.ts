// Sin "server-only" (lo usa la sincronización, que también corre fuera de Next); solo servidor.
// Configuración de Google: el cliente OAuth de Google Cloud y la clave de cifrado de los tokens.

import { publicEnv } from "@/lib/env";
import { deriveKey, ENCRYPTION_KEY_ENV, parseEncryptionKey } from "./secret-store";

export const GOOGLE_ENV = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", ENCRYPTION_KEY_ENV] as const;
export type GoogleEnvName = (typeof GOOGLE_ENV)[number];

export type GoogleConfig = {
  clientId: string;
  clientSecret: string;
  /** `${NEXT_PUBLIC_APP_URL}/api/auth/callback/google`: el mismo que está dado de alta en Google Cloud. */
  redirectUri: string;
  /** Clave para firmar el `state` de OAuth (derivada de la de cifrado). */
  stateKey: Buffer;
};

export type GoogleSetup = {
  config: GoogleConfig | null;
  /** Variables que faltan o no son válidas, para explicarlo en la pantalla. */
  missing: GoogleEnvName[];
  redirectUri: string;
};

export function googleRedirectUri(appUrl: string = publicEnv.NEXT_PUBLIC_APP_URL): string {
  return `${appUrl.replace(/\/+$/, "")}/api/auth/callback/google`;
}

export function googleSetup(env: Record<string, string | undefined> = process.env): GoogleSetup {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  const master = parseEncryptionKey(env[ENCRYPTION_KEY_ENV]);
  const missing: GoogleEnvName[] = [];
  if (!clientId) missing.push("GOOGLE_CLIENT_ID");
  if (!clientSecret) missing.push("GOOGLE_CLIENT_SECRET");
  if (!master) missing.push(ENCRYPTION_KEY_ENV);
  const redirectUri = googleRedirectUri();
  return {
    config:
      clientId && clientSecret && master
        ? { clientId, clientSecret, redirectUri, stateKey: deriveKey(master, "google/oauth-state") }
        : null,
    missing,
    redirectUri,
  };
}

export function isGoogleConfigured(env?: Record<string, string | undefined>): boolean {
  return googleSetup(env).config !== null;
}
