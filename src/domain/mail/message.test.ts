import { describe, expect, it } from "vitest";
import {
  baseSubject,
  counterpartAddresses,
  directionOf,
  domainOf,
  isPublicDomain,
  quoteForReply,
  replySubject,
  snippetOf,
  threadKeyOf,
} from "./message";

const OURS = ["info@gnerai.com", "msanjuan@gnerai.com"];

describe("hilos", () => {
  it("agrupa por la cadena de referencias cuando la hay", () => {
    expect(threadKeyOf({ messageId: "<c@x>", inReplyTo: "<b@x>", references: ["<a@x>", "<b@x>"], subject: "Re: Hola" })).toBe("<a@x>");
    expect(threadKeyOf({ messageId: "<b@x>", inReplyTo: "<a@x>", references: [], subject: "Re: Hola" })).toBe("<a@x>");
  });

  it("el primer mensaje de un hilo se agrupa por su propio id", () => {
    expect(threadKeyOf({ messageId: "<a@x>", inReplyTo: null, references: [], subject: "Hola" })).toBe("<a@x>");
  });

  it("sin cabeceras, por el asunto sin los Re: ni los Fwd:", () => {
    const key = (subject: string) => threadKeyOf({ messageId: null, inReplyTo: null, references: [], subject });
    expect(key("Re: Fwd: Propuesta")).toBe("Propuesta");
    expect(key("RV: Propuesta")).toBe("Propuesta");
    expect(key("   ")).toBe("(sin asunto)");
  });

  it("quita los prefijos encadenados, no solo el primero", () => {
    expect(baseSubject("Re: Re: RE: Fwd: Reunión")).toBe("Reunión");
    expect(baseSubject("Re[2]: Reunión")).toBe("Reunión");
    expect(baseSubject("Presupuesto")).toBe("Presupuesto");
  });

  it("al responder, el asunto no encadena Re: Re:", () => {
    expect(replySubject("Re: Propuesta")).toBe("Re: Propuesta");
    expect(replySubject("Propuesta")).toBe("Re: Propuesta");
    expect(replySubject("   ")).toBe("Re:");
  });
});

describe("de quién es un mensaje", () => {
  it("lo que sale de una de nuestras direcciones es saliente", () => {
    expect(directionOf("info@gnerai.com", OURS)).toBe("outgoing");
    expect(directionOf("INFO@GNERAI.COM", OURS)).toBe("outgoing");
    expect(directionOf("karina2692@gmail.com", OURS)).toBe("incoming");
    expect(directionOf("Equipo GNERAI <info@gnerai.com>", OURS)).toBe("outgoing");
  });

  it("el otro lado de la conversación son las direcciones de fuera, sin repetir", () => {
    // Las cabeceras traen «Nombre <correo>»: se queda con el correo y no repite.
    expect(
      counterpartAddresses({ from: "info@gnerai.com", to: ["Karina Rosales <karina2692@gmail.com>", "info@gnerai.com"], cc: ["karina2692@gmail.com"] }, OURS),
    ).toEqual(["karina2692@gmail.com"]);
    expect(counterpartAddresses({ from: "jaume@metrickal.com", to: ["info@gnerai.com"], cc: [] }, OURS)).toEqual(["jaume@metrickal.com"]);
  });

  it("el dominio sirve para reconocer una empresa, salvo los de toda la vida", () => {
    expect(domainOf("jaume@metrickal.com")).toBe("metrickal.com");
    expect(domainOf("sin-arroba")).toBeNull();
    expect(isPublicDomain("gmail.com")).toBe(true);
    expect(isPublicDomain("metrickal.com")).toBe(false);
  });
});

describe("resumen y respuesta", () => {
  it("el resumen deja fuera lo citado y la firma", () => {
    const body = "Buenos días,\nadjunto la propuesta.\n\n-- \nMarc · GNERAI\n> Lo que escribiste antes";
    expect(snippetOf(body)).toBe("Buenos días, adjunto la propuesta.");
  });

  it("el resumen corta por longitud y avisa con puntos suspensivos", () => {
    expect(snippetOf("a".repeat(300), 50)).toHaveLength(50);
    expect(snippetOf("a".repeat(300), 50).endsWith("…")).toBe(true);
    expect(snippetOf("corto", 50)).toBe("corto");
  });

  it("la cita de la respuesta lleva quién y cuándo", () => {
    const quote = quoteForReply(
      { fromName: "Karina Rosales", fromAddress: "karina2692@gmail.com", sentAt: new Date("2026-09-30T09:05:00Z"), bodyText: "Hola\nQué tal" },
      "es-ES",
    );
    expect(quote).toContain("Karina Rosales <karina2692@gmail.com> escribió:");
    expect(quote).toContain("> Hola");
    expect(quote).toContain("> Qué tal");
  });
});
