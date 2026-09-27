import { describe, expect, it } from "vitest";
import { isNormalizedSiteUrl, normalizeSiteUrl, parseSiteList, siteDisplayUrl, siteHostname, siteName } from "./url";

describe("normalizeSiteUrl", () => {
  it("un dominio suelto es https, sin barra en la raíz", () => {
    expect(normalizeSiteUrl("clinicamarblau.com")).toBe("https://clinicamarblau.com");
    expect(normalizeSiteUrl("  www.gnerai.com/  ")).toBe("https://www.gnerai.com");
    expect(normalizeSiteUrl("//hotel-llevant.cat")).toBe("https://hotel-llevant.cat");
  });

  it("http pasa a https; el host va en minúsculas y la ruta se respeta", () => {
    expect(normalizeSiteUrl("http://Gnerai.COM/Blog/")).toBe("https://gnerai.com/Blog/");
    expect(normalizeSiteUrl("HTTPS://WWW.GNERAI.COM/es")).toBe("https://www.gnerai.com/es");
  });

  it("quita el puerto por defecto, el fragmento y el punto final del dominio; conserva la consulta", () => {
    expect(normalizeSiteUrl("https://gnerai.com:443/")).toBe("https://gnerai.com");
    expect(normalizeSiteUrl("https://gnerai.com:8443/estado")).toBe("https://gnerai.com:8443/estado");
    expect(normalizeSiteUrl("https://gnerai.com/#contacto")).toBe("https://gnerai.com");
    expect(normalizeSiteUrl("https://gnerai.com./")).toBe("https://gnerai.com");
    expect(normalizeSiteUrl("https://gnerai.com/?lang=ca")).toBe("https://gnerai.com?lang=ca");
  });

  it("los dominios con acentos van en punycode", () => {
    expect(normalizeSiteUrl("https://xn--caf-dma.com")).toBe("https://xn--caf-dma.com");
    expect(normalizeSiteUrl("Mataró.cat")).toMatch(/^https:\/\/xn--[a-z0-9-]+\.cat$/);
    expect(normalizeSiteUrl("café.com")).toBe("https://xn--caf-dma.com");
  });

  it("no valen otros protocolos, credenciales, IPs, nombres sin dominio ni basura", () => {
    for (const input of [
      "",
      "   ",
      "ftp://gnerai.com",
      "mailto:hola@gnerai.com",
      "https://usuario:clave@gnerai.com",
      "https://127.0.0.1",
      "192.168.1.10",
      "https://[::1]/",
      "localhost:3000",
      "https://intranet",
      "gnerai",
      "gne rai.com",
      "https://gne_rai.com",
      "https://-gnerai.com",
      "https://gnerai.123",
      `https://gnerai.com/${"a".repeat(2100)}`,
    ]) {
      expect(normalizeSiteUrl(input), input).toBeNull();
    }
  });

  it("lo normalizado ya tiene la forma que exige la base de datos", () => {
    for (const input of ["gnerai.com", "http://www.x.es/a?b=1", "café.com/menú", "https://a.b.c.d.example.co.uk:8080"]) {
      const url = normalizeSiteUrl(input)!;
      expect(isNormalizedSiteUrl(url), url).toBe(true);
      expect(normalizeSiteUrl(url)).toBe(url);
    }
    expect(isNormalizedSiteUrl("https://gnerai.com/")).toBe(false);
    expect(isNormalizedSiteUrl("http://gnerai.com")).toBe(false);
    expect(isNormalizedSiteUrl("https://Gnerai.com")).toBe(false);
  });
});

describe("nombres y hosts", () => {
  it("el nombre es la etiqueta o, si no, la URL sin https", () => {
    expect(siteName({ label: " Clínica Mar Blau ", url: "https://clinicamarblau.com" })).toBe("Clínica Mar Blau");
    expect(siteName({ label: null, url: "https://www.clinicamarblau.com/es" })).toBe("www.clinicamarblau.com/es");
    expect(siteName({ label: "  ", url: "https://x.com" })).toBe("x.com");
    expect(siteDisplayUrl("https://x.com:8443/a")).toBe("x.com:8443/a");
    expect(siteHostname("https://www.x.com:8443/a")).toBe("www.x.com");
  });
});

describe("parseSiteList", () => {
  it("una por línea (o separadas por comas y espacios), sin repetir y en orden", () => {
    const parsed = parseSiteList(
      [
        "clinicamarblau.com",
        "",
        "# las del Maresme",
        "https://hotel-llevant.cat/, www.gnerai.com",
        "CLINICAMARBLAU.COM",
        "no es una web",
        "http://hotel-llevant.cat",
      ].join("\r\n"),
    );
    expect(parsed.urls).toEqual(["https://clinicamarblau.com", "https://hotel-llevant.cat", "https://www.gnerai.com"]);
    expect(parsed.invalid).toEqual(["no", "es", "una", "web"]);
    expect(parsed.repeated).toBe(2);
  });

  it("vacío no da nada", () => {
    expect(parseSiteList("  \n\n")).toEqual({ urls: [], invalid: [], repeated: 0 });
  });
});
