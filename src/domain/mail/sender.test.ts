import { describe, expect, it } from "vitest";
import { isAutomatedSender, leadNameFor, leadTitleFor } from "./sender";

describe("quién es una máquina", () => {
  it("una persona con correo propio no lo es", () => {
    expect(isAutomatedSender({ from: "Nadia Pérez <nadia@metrickal.com>" })).toBe(false);
    expect(isAutomatedSender({ from: "maria.lopez@gmail.com" })).toBe(false);
  });

  it("los remitentes de sistema se descartan", () => {
    for (const from of ["noreply@empresa.com", "no-reply@x.es", "Notificaciones <notifications@algo.com>", "MAILER-DAEMON@x.com", "newsletter@tienda.es"]) {
      expect(isAutomatedSender({ from })).toBe(true);
    }
  });

  it("los proveedores y entidades se descartan, también con subdominio", () => {
    expect(isAutomatedSender({ from: "alguien@ionos.es" })).toBe(true);
    expect(isAutomatedSender({ from: "messages-noreply@mail.linkedin.com" })).toBe(true);
    expect(isAutomatedSender({ from: "notificaciones@agenciatributaria.gob.es" })).toBe(true);
  });

  it("un dominio que solo se parece no cuenta como proveedor", () => {
    expect(isAutomatedSender({ from: "ana@mygoogle-consulting.com" })).toBe(false);
    expect(isAutomatedSender({ from: "ana@notgoogle.com.es" })).toBe(false);
  });

  it("las cabeceras de listas y envíos automáticos bastan", () => {
    expect(isAutomatedSender({ from: "ana@empresa.com", headers: { "list-unsubscribe": "<mailto:x@y.com>" } })).toBe(true);
    expect(isAutomatedSender({ from: "ana@empresa.com", headers: { precedence: "bulk" } })).toBe(true);
    expect(isAutomatedSender({ from: "ana@empresa.com", headers: { "auto-submitted": "auto-generated" } })).toBe(true);
    expect(isAutomatedSender({ from: "ana@empresa.com", headers: { "auto-submitted": "no" } })).toBe(false);
  });

  it("una dirección rota se descarta", () => {
    expect(isAutomatedSender({ from: "" })).toBe(true);
    expect(isAutomatedSender({ from: "sin-arroba" })).toBe(true);
  });
});

describe("lo que se coló el primer día", () => {
  it("Semrush y los avisos oficiales no son clientes nuevos", () => {
    expect(isAutomatedSender({ from: "mail@semrush.com" })).toBe(true);
    expect(isAutomatedSender({ from: "seo-ideas@semrush.com" })).toBe(true);
    expect(isAutomatedSender({ from: "registroelectronico@serviciosmin.gob.es" })).toBe(true);
  });

  it("las newsletters se reconocen por su pie, aunque las firme una persona", () => {
    expect(isAutomatedSender({ from: "ana@empresa.com", bodyText: "Novedades del mes…\nSi no desea recibir más correos, pulse aquí para darse de baja." })).toBe(true);
    expect(isAutomatedSender({ from: "ana@empresa.com", bodyText: "Click to unsubscribe" })).toBe(true);
  });

  it("los buzones de ventas en frío no abren lead", () => {
    expect(isAutomatedSender({ from: "comercial3@edicionsmic.cat" })).toBe(true);
    expect(isAutomatedSender({ from: "marketing@agencia.com" })).toBe(true);
  });

  it("una persona que escribe de verdad sigue pasando", () => {
    expect(isAutomatedSender({ from: "Nadia Pérez <nadia@metrickal.com>", bodyText: "Hola Marc, nos encaja la opción A. ¿Hablamos mañana?" })).toBe(false);
  });
});

describe("el nombre de la ficha", () => {
  it("usa el nombre de la cabecera", () => {
    expect(leadNameFor({ name: "Nadia Pérez", address: "nadia@x.com" })).toBe("Nadia Pérez");
    expect(leadNameFor({ name: '"Little Forest"', address: "hola@littleforest.es" })).toBe("Little Forest");
  });

  it("si no hay, lo saca de la dirección", () => {
    expect(leadNameFor({ address: "nadia.perez@x.com" })).toBe("Nadia Perez");
    expect(leadNameFor({ name: "nadia@x.com", address: "nadia@x.com" })).toBe("Nadia");
  });
});

describe("el título de la oportunidad", () => {
  it("quita los prefijos de respuesta", () => {
    expect(leadTitleFor("Re: RE: Presupuesto web", "Correo")).toBe("Presupuesto web");
  });
  it("si no hay asunto, usa el genérico", () => {
    expect(leadTitleFor("  ", "Correo recibido")).toBe("Correo recibido");
  });
});
