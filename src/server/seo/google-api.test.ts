import { describe, expect, it } from "vitest";
import { GoogleClient, listGa4Properties, listSearchConsoleSites, searchAnalyticsQuery } from "./google-api";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function tokens() {
  let n = 0;
  return {
    refreshed: () => n,
    source: {
      get: async () => `token-${n}`,
      refresh: async () => `token-${++n}`,
    },
  };
}

describe("cliente de Google", () => {
  it("reintenta 429 y 5xx con espera (respetando Retry-After) y luego responde", async () => {
    const waits: number[] = [];
    const responses = [
      jsonResponse({ error: { status: "RESOURCE_EXHAUSTED" } }, 429, { "retry-after": "2" }),
      jsonResponse({}, 503),
      jsonResponse({ rows: [] }),
    ];
    const client = new GoogleClient(tokens().source, {
      fetch: async () => responses.shift()!,
      sleep: async (ms) => void waits.push(ms),
      minIntervalMs: 0,
    });
    expect(await client.request("GET", "https://example.test")).toEqual({ rows: [] });
    expect(waits[0]).toBe(2000);
    expect(waits[1]).toBeGreaterThanOrEqual(2000);
  });

  it("con el token caducado, lo refresca una vez; un 403 de permisos no se reintenta", async () => {
    const t = tokens();
    const seen: string[] = [];
    const responses = [jsonResponse({}, 401), jsonResponse({ ok: 1 }), jsonResponse({ error: { status: "PERMISSION_DENIED", message: "No access" } }, 403)];
    const client = new GoogleClient(t.source, {
      fetch: async (_url, init) => {
        seen.push(String((init?.headers as Record<string, string>).authorization));
        return responses.shift()!;
      },
      sleep: async () => {},
      minIntervalMs: 0,
    });
    expect(await client.request("GET", "https://example.test")).toEqual({ ok: 1 });
    expect(t.refreshed()).toBe(1);
    expect(seen).toEqual(["Bearer token-0", "Bearer token-1"]);
    await expect(client.request("GET", "https://example.test")).rejects.toMatchObject({ status: 403, reason: "PERMISSION_DENIED" });
  });

  it("lista webs de Search Console (sin las no verificadas) y propiedades de GA4 paginando", async () => {
    const urls: string[] = [];
    const responses: Record<string, unknown[]> = {
      sites: [
        {
          siteEntry: [
            { siteUrl: "sc-domain:gnerai.com", permissionLevel: "siteOwner" },
            { siteUrl: "https://ajeno.com/", permissionLevel: "siteUnverifiedUser" },
          ],
        },
      ],
      accountSummaries: [
        { accountSummaries: [{ displayName: "GNERAI", propertySummaries: [{ property: "properties/123", displayName: "gnerai.com" }] }], nextPageToken: "p2" },
        { accountSummaries: [{ displayName: "Clínica", propertySummaries: [{ property: "properties/456", displayName: "Web clínica" }] }] },
      ],
    };
    const client = new GoogleClient(tokens().source, {
      fetch: async (url) => {
        urls.push(url);
        const key = url.includes("accountSummaries") ? "accountSummaries" : "sites";
        return jsonResponse(responses[key]!.shift());
      },
      sleep: async () => {},
      minIntervalMs: 0,
    });
    expect(await listSearchConsoleSites(client)).toEqual([{ siteUrl: "sc-domain:gnerai.com", permissionLevel: "siteOwner" }]);
    expect(await listGa4Properties(client)).toEqual([
      { propertyId: "456", displayName: "Web clínica", account: "Clínica" },
      { propertyId: "123", displayName: "gnerai.com", account: "GNERAI" },
    ]);
    expect(urls[2]).toContain("pageToken=p2");
  });

  it("codifica la URL de la propiedad de Search Console", async () => {
    let called = "";
    const client = new GoogleClient(tokens().source, {
      fetch: async (url) => {
        called = url;
        return jsonResponse({});
      },
      minIntervalMs: 0,
    });
    await searchAnalyticsQuery(client, "sc-domain:gnerai.com", {});
    expect(called).toBe("https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Agnerai.com/searchAnalytics/query");
  });
});
