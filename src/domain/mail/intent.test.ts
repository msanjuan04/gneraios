import { describe, expect, it } from "vitest";
import { ownText, readMailIntent, suggestTemplate, summarizeRequest } from "./intent";

const mail = (bodyText: string, subject = "Propuesta") => ({ subject, bodyText });

describe("leer qué dice un correo", () => {
  it("reconoce que aceptan, con o sin acentos", () => {
    expect(readMailIntent(mail("Hola, aceptamos el presupuesto. ¿Cuándo empezamos?")).intent).toBe("accepted");
    expect(readMailIntent(mail("Adelante con la propuesta, podeis empezar")).intent).toBe("accepted");
    expect(readMailIntent(mail("Endavant amb la proposta")).intent).toBe("accepted");
  });

  it("reconoce que no siguen adelante", () => {
    expect(readMailIntent(mail("Gracias, pero hemos decidido no seguir por ahora")).intent).toBe("rejected");
    expect(readMailIntent(mail("Nos parece demasiado caro")).intent).toBe("rejected");
  });

  it("aceptar manda sobre pedir reunión o precio en el mismo correo", () => {
    expect(readMailIntent(mail("Aceptamos el presupuesto. ¿Podemos hacer una llamada el lunes?")).intent).toBe("accepted");
  });

  it("distingue pedir precio de preguntar y de pedir reunión", () => {
    expect(readMailIntent(mail("¿Cuánto costaría una web como la vuestra?")).intent).toBe("pricing");
    expect(readMailIntent(mail("¿Podéis explicarme cómo funciona el mantenimiento?")).intent).toBe("question");
    expect(readMailIntent(mail("Nos vemos la semana que viene para verlo")).intent).toBe("meeting");
  });

  it("un correo sin nada de eso no se fuerza a nada", () => {
    expect(readMailIntent(mail("Os reenvío la factura firmada.")).intent).toBe("other");
  });

  it("no lee nuestro propio presupuesto citado como si lo dijera el cliente", () => {
    const body = ["Gracias, lo miro y te digo.", "", "El 3 de octubre, GNERAI escribió:", "> Adelante con la propuesta y firmamos", "> Un saludo"].join("\n");
    expect(readMailIntent(mail(body, "Re: Propuesta")).intent).not.toBe("accepted");
  });

  it("el asunto también cuenta", () => {
    expect(readMailIntent(mail("Te lo confirmo por aquí.", "Aceptamos el presupuesto")).intent).toBe("accepted");
  });
});

describe("el texto propio del correo", () => {
  it("quita lo citado y la firma", () => {
    const body = ["Perfecto, seguimos.", "", "-- ", "Nadia · Dirección", "> antes dijimos otra cosa"].join("\n");
    expect(ownText(body)).toBe("Perfecto, seguimos.");
  });
});

describe("la cabecera de la cita", () => {
  it("«El día X escribió:» se quita aunque sea lo último una vez retirada la cita", () => {
    const body = ["Nos encaja la opción A.", "", "El 3 de octubre, GNERAI escribió:", "> Hola Nadia"].join("\n");
    expect(ownText(body)).toBe("Nos encaja la opción A.");
  });
});

describe("el resumen de lo que piden", () => {
  it("se salta saludos y despedidas y deja lo que importa", () => {
    const body = [
      "Hola Marc,",
      "Necesitamos medir bien las campañas de Google Ads del último trimestre.",
      "También queremos un panel para ver el coste por lead cada semana.",
      "Un saludo",
    ].join("\n");
    expect(summarizeRequest(body)).toEqual([
      "Necesitamos medir bien las campañas de Google Ads del último trimestre.",
      "También queremos un panel para ver el coste por lead cada semana.",
    ]);
  });

  it("corta las frases kilométricas", () => {
    const [line] = summarizeRequest(`Necesitamos ${"mucho ".repeat(80)}`);
    expect(line!.length).toBeLessThanOrEqual(220);
    expect(line!.endsWith("…")).toBe(true);
  });
});

describe("la plantilla que encaja", () => {
  const templates = [
    { id: "ads", name: "Medición de Google Ads", summary: "Campañas, conversiones y panel semanal" },
    { id: "web", name: "Web corporativa", summary: "Diseño y desarrollo de la web" },
  ];

  it("elige la que comparte palabras con el correo", () => {
    expect(suggestTemplate("Queremos medir las campañas de Google Ads", templates)?.template.id).toBe("ads");
    expect(suggestTemplate("Nos hace falta una web nueva, diseño incluido", templates)?.template.id).toBe("web");
  });

  it("si no encaja ninguna, no se inventa una", () => {
    expect(suggestTemplate("Os paso la factura firmada", templates)).toBeNull();
  });
});
