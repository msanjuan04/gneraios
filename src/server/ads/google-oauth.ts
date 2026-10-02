import "server-only";

import { publicEnv } from "@/lib/env";
import { googleSetup } from "@/server/seo/config";

/** Cookie de un solo uso del intento de conexión de una cuenta de Google Ads: `nonce.verifier.accountId`. */
export const ADS_GOOGLE_OAUTH_COOKIE = "gnerai_ads_google_oauth";

/** El cliente OAuth de siempre con la vuelta propia de Ads (hay que darla de alta en Google Cloud). */
export function adsGoogleConfig() {
  const base = googleSetup().config;
  return base ? { ...base, redirectUri: adsGoogleRedirectUri() } : null;
}

export function adsGoogleRedirectUri(): string {
  return `${publicEnv.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "")}/api/auth/callback/ads-google`;
}
