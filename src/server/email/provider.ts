import "server-only";

export type EmailMessage = {
  from: string;
  to: string[];
  subject: string;
  text: string;
  /** Versión HTML opcional (el resumen semanal); el texto plano va siempre. */
  html?: string;
  replyTo?: string | null;
  attachments?: { filename: string; content: Uint8Array; contentType: string }[];
};

export interface EmailProvider {
  readonly id: "resend" | "brevo" | "mailpit";
  send(message: EmailMessage): Promise<{ id: string }>;
}

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

/** Resend por HTTP, sin SDK (ARCHITECTURE §10). */
function resend(apiKey: string): EmailProvider {
  return {
    id: "resend",
    async send(m) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: m.from,
          to: m.to,
          subject: m.subject,
          text: m.text,
          html: m.html,
          reply_to: m.replyTo ?? undefined,
          attachments: m.attachments?.map((a) => ({ filename: a.filename, content: toBase64(a.content) })),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!res.ok || !body.id) throw new Error(`Resend ${res.status}: ${body.message ?? "sin respuesta"}`);
      return { id: body.id };
    },
  };
}

/** "GNERAI <facturacion@gnerai.com>" → { name, email }. */
function parseAddress(value: string): { name?: string; email: string } {
  const m = /^(.*)<([^>]+)>$/.exec(value.trim());
  const name = m?.[1]?.trim().replace(/^"|"$/g, "");
  return m ? { ...(name ? { name } : {}), email: m[2]!.trim() } : { email: value.trim() };
}

/** Brevo por HTTP, sin SDK: gnerai.com ya está autenticado ahí (DKIM en brevo1._domainkey). */
function brevo(apiKey: string): EmailProvider {
  return {
    id: "brevo",
    async send(m) {
      const res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          sender: parseAddress(m.from),
          to: m.to.map(parseAddress),
          replyTo: m.replyTo ? parseAddress(m.replyTo) : undefined,
          subject: m.subject,
          textContent: m.text,
          htmlContent: m.html,
          attachment: m.attachments?.map((a) => ({ name: a.filename, content: toBase64(a.content) })),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { messageId?: string; message?: string };
      if (!res.ok || !body.messageId) throw new Error(`Brevo ${res.status}: ${body.message ?? "sin respuesta"}`);
      return { id: body.messageId };
    },
  };
}

/** Mailpit (el buzón local de Supabase): en desarrollo nada sale a Internet. */
function mailpit(baseUrl: string): EmailProvider {
  const address = (value: string) => {
    const m = /^(.*)<([^>]+)>$/.exec(value.trim());
    return m ? { Name: m[1]!.trim(), Email: m[2]!.trim() } : { Email: value.trim() };
  };
  return {
    id: "mailpit",
    async send(m) {
      const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/v1/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          From: address(m.from),
          To: m.to.map(address),
          ReplyTo: m.replyTo ? [address(m.replyTo)] : undefined,
          Subject: m.subject,
          Text: m.text,
          HTML: m.html,
          Attachments: m.attachments?.map((a) => ({ Content: toBase64(a.content), Filename: a.filename, ContentType: a.contentType })),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { ID?: string };
      if (!res.ok) throw new Error(`Mailpit ${res.status}`);
      return { id: body.ID ?? "mailpit" };
    },
  };
}

/**
 * Proveedor de email según el entorno: Resend si hay RESEND_API_KEY, Brevo si hay BREVO_API_KEY;
 * en desarrollo, Mailpit (MAILPIT_URL, por defecto el de `supabase start`). Sin ninguno, null: la
 * app lo explica.
 */
export function getEmailProvider(): EmailProvider | null {
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) return resend(resendKey);
  const brevoKey = process.env.BREVO_API_KEY;
  if (brevoKey) return brevo(brevoKey);
  if (process.env.NODE_ENV !== "production") return mailpit(process.env.MAILPIT_URL || "http://127.0.0.1:54324");
  return null;
}

/** Remitente de facturación (EMAIL_FROM), p. ej. "GNERAI <facturacion@gnerai.com>". */
export function emailFrom(fallbackName: string): string {
  return process.env.EMAIL_FROM || `${fallbackName} <facturacion@example.com>`;
}
