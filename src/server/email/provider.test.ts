import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { getEmailProvider } = await import("./provider");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("proveedor de email", () => {
  it("con BREVO_API_KEY envía por Brevo, con el remitente y los adjuntos en su formato", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("BREVO_API_KEY", "clave-de-prueba");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ messageId: "<abc@brevo>" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = getEmailProvider();
    expect(provider?.id).toBe("brevo");
    const result = await provider!.send({
      from: "GNERAI <facturacion@gnerai.com>",
      to: ["hugo@gnerai.com"],
      replyTo: "marc@gnerai.com",
      subject: "Hola",
      text: "Texto",
      html: "<p>Texto</p>",
      attachments: [{ filename: "f.pdf", content: new Uint8Array([1, 2, 3]), contentType: "application/pdf" }],
    });
    expect(result.id).toBe("<abc@brevo>");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect((init.headers as Record<string, string>)["api-key"]).toBe("clave-de-prueba");
    expect(JSON.parse(String(init.body))).toMatchObject({
      sender: { name: "GNERAI", email: "facturacion@gnerai.com" },
      to: [{ email: "hugo@gnerai.com" }],
      replyTo: { email: "marc@gnerai.com" },
      subject: "Hola",
      textContent: "Texto",
      htmlContent: "<p>Texto</p>",
      attachment: [{ name: "f.pdf", content: "AQID" }],
    });
  });

  it("un error de Brevo no se da por enviado", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("BREVO_API_KEY", "clave-de-prueba");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "Key not found" }), { status: 401 })));
    await expect(getEmailProvider()!.send({ from: "a@b.c", to: ["d@e.f"], subject: "s", text: "t" })).rejects.toThrow(
      /Brevo 401: Key not found/,
    );
  });

  it("Resend tiene preferencia; en producción sin ninguno, no hay proveedor", () => {
    vi.stubEnv("RESEND_API_KEY", "re_x");
    vi.stubEnv("BREVO_API_KEY", "clave");
    expect(getEmailProvider()?.id).toBe("resend");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("BREVO_API_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(getEmailProvider()).toBeNull();
  });
});
