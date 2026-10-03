import "server-only";

import { createTransport } from "nodemailer";
import { normalizeAddress, replySubject } from "@/domain/mail";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEmailProvider } from "@/server/email/provider";
import { type MailAccount, openMailPassword } from "./account";

/**
 * Enviar correo desde GNERAI OS con la cuenta de siempre (SMTP). Quien lo recibe ve exactamente lo
 * mismo que si se hubiera escrito desde el webmail, y la copia se guarda en «Enviados» del propio
 * servidor para que la conversación esté completa mire donde mire.
 */

export type OutgoingMail = {
  to: string[];
  cc?: string[];
  subject: string;
  bodyText: string;
  /** Cabeceras de la respuesta: así los clientes de correo lo encadenan al hilo. */
  inReplyTo?: string | null;
  references?: string[];
};

export type SendResult = { messageId: string };

export async function sendMail(account: MailAccount, mail: OutgoingMail): Promise<SendResult> {
  const to = mail.to.map(normalizeAddress).filter(Boolean);
  if (to.length === 0) throw new Error("Hace falta al menos un destinatario.");
  const from = account.displayName ? `${account.displayName} <${account.address}>` : account.address;
  const cc = mail.cc?.map(normalizeAddress).filter(Boolean);
  const threadHeaders: Record<string, string> = {};
  if (mail.inReplyTo) threadHeaders["In-Reply-To"] = mail.inReplyTo;
  if (mail.references?.length) threadHeaders.References = mail.references.join(" ");

  // Por HTTP (Brevo/Resend): los servidores en la nube suelen tener cerrados los puertos de SMTP, y
  // el nuestro también. El remitente es el mismo (info@gnerai.com, dominio ya autenticado) y las
  // respuestas siguen entrando en el buzón de siempre. Sin proveedor configurado, SMTP directo.
  const provider = getEmailProvider();
  let messageId: string | null = null;
  if (provider) {
    const sent = await provider.send({
      from,
      to,
      subject: mail.subject,
      text: mail.bodyText,
      replyTo: account.address,
      headers: Object.keys(threadHeaders).length ? threadHeaders : undefined,
    });
    messageId = sent.id;
  } else {
    const password = await openMailPassword(account);
    const transport = createTransport({
      host: account.smtpHost,
      port: account.smtpPort,
      secure: account.smtpPort === 465,
      auth: { user: account.username, pass: password },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    const info = await transport.sendMail({
      from: account.displayName ? { name: account.displayName, address: account.address } : account.address,
      to,
      cc,
      subject: mail.subject,
      text: mail.bodyText,
      inReplyTo: mail.inReplyTo ?? undefined,
      references: mail.references?.length ? mail.references : undefined,
    });
    transport.close();
    messageId = info.messageId ?? null;
  }

  // Se guarda ya, sin esperar a la siguiente sincronización: quien lo envía quiere verlo al momento.
  // La carpeta «salida» es solo nuestra; cuando IMAP traiga el de verdad, ese lo sustituye.
  await createAdminClient()
    .from("mail_messages")
    .insert({
      org_id: account.orgId,
      account_id: account.id,
      folder: "GNERAI/sent",
      // Un hueco propio: los UID de verdad los pone el servidor de correo.
      uid: Date.now(),
      message_id: messageId,
      in_reply_to: mail.inReplyTo ?? null,
      thread_key: mail.references?.[0] ?? mail.inReplyTo ?? messageId ?? mail.subject.slice(0, 998),
      direction: "outgoing",
      from_address: account.address,
      from_name: account.displayName,
      to_addresses: to,
      cc_addresses: cc ?? [],
      subject: mail.subject.slice(0, 998),
      body_text: mail.bodyText.slice(0, 500_000),
      snippet: mail.bodyText.replace(/\s+/g, " ").trim().slice(0, 200),
      sent_at: new Date().toISOString(),
      seen: true,
    });

  return { messageId: messageId ?? "" };
}

/** Comprueba que el buzón contesta y que la contraseña vale, sin enviar nada. */
export async function verifySmtp(account: MailAccount): Promise<void> {
  const password = await openMailPassword(account);
  const transport = createTransport({
    host: account.smtpHost,
    port: account.smtpPort,
    secure: account.smtpPort === 465,
    auth: { user: account.username, pass: password },
    connectionTimeout: 8_000,
    greetingTimeout: 8_000,
    socketTimeout: 12_000,
  });
  try {
    await transport.verify();
  } finally {
    transport.close();
  }
}

export { replySubject };
