import { describe, expect, it } from "vitest";
import { renderCodeChangedEmail, renderDeviceEmail, securityLocale } from "./security-email";

const device = {
  name: "Hugo",
  device: "iPhone · Safari",
  at: new Date("2026-09-26T17:05:00Z"),
  timeZone: "Europe/Madrid",
  url: "https://gneraios.gnerai.com/auth/device?token=abc",
  minutes: 20,
};

describe("emails de seguridad", () => {
  it("el de dispositivo nuevo lleva el enlace, la hora local y qué hacer si no eres tú", () => {
    const es = renderDeviceEmail("es", device);
    expect(es.subject).toBe("¿Eres tú? Confirma tu nuevo dispositivo en GNERAI OS (iPhone · Safari)");
    expect(es.text).toContain("Hola, Hugo:");
    expect(es.text).toContain("19:05");
    expect(es.text).toContain(device.url);
    expect(es.text).toContain("20 minutos");
    expect(es.html).toContain(`href="${device.url}"`);
    expect(es.html).toContain("Sí, soy yo");
  });

  it("sale en el idioma del socio, y en español si no se sabe", () => {
    expect(renderDeviceEmail("ca", device).subject).toMatch(/^Ets tu\?/);
    expect(renderDeviceEmail("en", device).subject).toMatch(/^Is this you\?/);
    expect(securityLocale("fr")).toBe("es");
    expect(securityLocale(null)).toBe("es");
  });

  it("el de código cambiado dice quién lo ha hecho", () => {
    expect(renderCodeChangedEmail("es", { name: "Hugo", by: "Marc Sanjuan", hadCode: false }).text).toContain(
      "Marc Sanjuan te ha creado un código de acceso a GNERAI OS",
    );
    expect(renderCodeChangedEmail("es", { name: "Hugo", by: null, hadCode: true }).text).toContain("El anterior ya no funciona");
    expect(renderCodeChangedEmail("en", { name: "Hugo", by: "Marc", hadCode: true }).subject).toBe("Your GNERAI OS access code has changed");
  });

  it("escapa lo que viene de fuera en el HTML", () => {
    const html = renderCodeChangedEmail("es", { name: "<b>Hugo</b>", by: null, hadCode: false }).html;
    expect(html).not.toContain("<b>Hugo</b>");
    expect(html).toContain("&lt;b&gt;Hugo&lt;/b&gt;");
  });
});
