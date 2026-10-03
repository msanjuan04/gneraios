import "server-only";

import { createTransport } from "nodemailer";
import { normalizeAddress, replySubject } from "@/domain/mail";
import { createAdminClient } from "@/lib/supabase/admin";
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
  const password = await openMailPassword(account);

  const transport = createTransport({
    host: account.smtpHost,
    port: account.smtpPort,
    secure: account.smtpPort === 465,
    auth: { user: account.username, pass: password },
  });

  const info = await transport.sendMail({
    from: account.displayName ? { name: account.displayName, address: account.address } : account.address,
    to,
    cc: mail.cc?.map(normalizeAddress).filter(Boolean),
    subject: mail.subject,
    text: mail.bodyText,
    inReplyTo: mail.inReplyTo ?? undefined,
    references: mail.references?.length ? mail.references : undefined,
  });
  transport.close();

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
      message_id: info.messageId ?? null,
      in_reply_to: mail.inReplyTo ?? null,
      thread_key: mail.references?.[0] ?? mail.inReplyTo ?? info.messageId ?? mail.subject.slice(0, 998),
      direction: "outgoing",
      from_address: account.address,
      from_name: account.displayName,
      to_addresses: to,
      cc_addresses: mail.cc?.map(normalizeAddress).filter(Boolean) ?? [],
      subject: mail.subject.slice(0, 998),
      body_text: mail.bodyText.slice(0, 500_000),
      snippet: mail.bodyText.replace(/\s+/g, " ").trim().slice(0, 200),
      sent_at: new Date().toISOString(),
      seen: true,
    });

  return { messageId: info.messageId ?? "" };
}

/** Comprueba que el buzón contesta y que la contraseña vale, sin enviar nada. */
export async function verifySmtp(account: MailAccount): Promise<void> {
  const password = await openMailPassword(account);
  const transport = createTransport({
    host: account.smtpHost,
    port: account.smtpPort,
    secure: account.smtpPort === 465,
    auth: { user: account.username, pass: password },
  });
  try {
    await transport.verify();
  } finally {
    transport.close();
  }
}

export { replySubject };
