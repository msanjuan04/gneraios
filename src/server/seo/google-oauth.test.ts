import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  authorizationUrl,
  createPkce,
  emailFromIdToken,
  exchangeCode,
  GOOGLE_SCOPES,
  grantedFeatures,
  refreshAccessToken,
  signState,
  verifyState,
} from "./google-oauth";

const key = randomBytes(32);
const config = { clientId: "id.apps.googleusercontent.com", clientSecret: "secret", redirectUri: "http://localhost:3100/api/auth/callback/google", stateKey: key };
const state = { orgId: "org-1", slug: "gnerai", userId: "user-1", nonce: "nonce-1", expiresAt: 2_000_000 };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("state firmado", () => {
  it("vuelve intacto si la firma es buena y no ha caducado", () => {
    const token = signState(state, key);
    expect(verifyState(token, key, 1_000_000)).toEqual(state);
    expect(verifyState(token, key, 2_000_001)).toBeNull();
    expect(verifyState(token, randomBytes(32), 1_000_000)).toBeNull();
  });

  it("rechaza un state retocado o mal formado", () => {
    const [payload, signature] = signState(state, key).split(".");
    const forged = Buffer.from(JSON.stringify({ ...state, orgId: "org-2" })).toString("base64url");
    expect(verifyState(`${forged}.${signature}`, key, 0)).toBeNull();
    expect(verifyState(`${payload}.`, key, 0)).toBeNull();
    expect(verifyState(`${payload}.${signature}.x`, key, 0)).toBeNull();
    expect(verifyState(null, key, 0)).toBeNull();
    const notJson = Buffer.from("{").toString("base64url");
    expect(verifyState(`${notJson}.${signState(state, key).split(".")[1]}`, key, 0)).toBeNull();
  });
});

describe("pantalla de consentimiento", () => {
  it("pide acceso offline, solo lectura y PKCE", () => {
    const { verifier, challenge } = createPkce();
    expect(verifier).toMatch(/^[\w-]{43}$/);
    const url = new URL(authorizationUrl({ config, state: "s", challenge, loginHint: "marc@gnerai.com" }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      state: "s",
      code_challenge: challenge,
      code_challenge_method: "S256",
      login_hint: "marc@gnerai.com",
    });
    expect(url.searchParams.get("scope")!.split(" ")).toEqual(["openid", "email", GOOGLE_SCOPES.searchConsole, GOOGLE_SCOPES.analytics]);
  });
});

describe("tokens", () => {
  it("cambia el código por los tokens y lee lo concedido", async () => {
    const calls: { url: string; body: string }[] = [];
    const idToken = `x.${Buffer.from(JSON.stringify({ email: "Marc@Gnerai.com", email_verified: true })).toString("base64url")}.y`;
    const grant = await exchangeCode(
      async (url, init) => {
        calls.push({ url, body: String(init?.body) });
        return jsonResponse({ access_token: "ya29", refresh_token: "1//r", expires_in: 3599, scope: `openid ${GOOGLE_SCOPES.searchConsole}`, id_token: idToken });
      },
      { code: "c0de", verifier: "v", config },
    );
    expect(calls[0]!.url).toBe("https://oauth2.googleapis.com/token");
    expect(Object.fromEntries(new URLSearchParams(calls[0]!.body))).toMatchObject({
      grant_type: "authorization_code",
      code: "c0de",
      code_verifier: "v",
      redirect_uri: config.redirectUri,
    });
    expect(grant).toMatchObject({ accessToken: "ya29", refreshToken: "1//r", expiresIn: 3599 });
    expect(grantedFeatures(grant.scopes)).toEqual({ searchConsole: true, analytics: false });
    expect(emailFromIdToken(grant.idToken)).toBe("marc@gnerai.com");
    expect(emailFromIdToken("roto")).toBeNull();
  });

  it("un token de refresco revocado es invalid_grant: hay que reconectar", async () => {
    await expect(
      refreshAccessToken(async () => jsonResponse({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400), {
        refreshToken: "1//r",
        config,
      }),
    ).rejects.toMatchObject({ code: "invalid_grant" });
  });
});
