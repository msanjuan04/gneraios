import { describe, expect, it } from "vitest";
import { resolveSearchConsoleSite, siteHost, suggestClientForSite } from "./site-url";

const sites = ["https://www.gnerai.com/", "sc-domain:gnerai.com", "sc-domain:welcome.gnerai.com", "https://clinica.example/"];

describe("propiedad de Search Console", () => {
  it("prefiere la exacta y, si no, la de dominio", () => {
    expect(resolveSearchConsoleSite("https://www.gnerai.com/", sites)).toBe("https://www.gnerai.com/");
    expect(resolveSearchConsoleSite("https://gnerai.com", sites)).toBe("sc-domain:gnerai.com");
    expect(resolveSearchConsoleSite("gnerai.com", sites)).toBe("sc-domain:gnerai.com");
    expect(resolveSearchConsoleSite("https://www.gnerai.com/blog", sites)).toBe("sc-domain:gnerai.com");
  });

  it("usa el prefijo de URL con barra final cuando no hay propiedad de dominio", () => {
    expect(resolveSearchConsoleSite("http://clinica.example", sites)).toBe("https://clinica.example/");
  });

  it("no inventa: si la cuenta no tiene esa web, null", () => {
    expect(resolveSearchConsoleSite("https://otra.example", sites)).toBeNull();
    expect(resolveSearchConsoleSite("no es una url", sites)).toBeNull();
  });
});

describe("webs detectadas", () => {
  it("saca el dominio de cualquier forma de propiedad", () => {
    expect(siteHost("sc-domain:gnerai.com")).toBe("gnerai.com");
    expect(siteHost("https://www.gnerai.com/")).toBe("gnerai.com");
  });

  it("propone el cliente cuya web tiene ese dominio, solo si es uno", () => {
    const clients = [
      { id: "a", website: "https://www.clinicamarblau.es" },
      { id: "b", website: null },
      { id: "c", website: "hotel.example" },
    ];
    expect(suggestClientForSite("sc-domain:clinicamarblau.es", clients)).toBe("a");
    expect(suggestClientForSite("https://hotel.example/", clients)).toBe("c");
    expect(suggestClientForSite("sc-domain:gnerai.com", clients)).toBeNull();
    expect(suggestClientForSite("sc-domain:x.com", [...clients, { id: "d", website: "x.com" }, { id: "e", website: "www.x.com" }])).toBeNull();
  });
});
