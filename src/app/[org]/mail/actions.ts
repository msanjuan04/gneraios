"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import type { ActionResult } from "@/lib/action-result";
import { normalizeAddress, quoteForReply, replySubject } from "@/domain/mail";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { failure, forbidden, idSchema, invalidInput, partnerContext } from "@/server/action-utils";
import { getMailAccount, mailSecretContext } from "@/server/mail/account";
import { MailSendUnavailableError, sendMail } from "@/server/mail/send";
import { syncMailAccount, verifyImapLogin } from "@/server/mail/sync";
import { secretStoreFromEnv } from "@/server/seo/secret-store";
import { connectMailSchema, sendMailSchema, splitAddresses } from "./schema";

// Conectar el buzón, traer el correo y responder. La contraseña entra aquí una vez, se cifra y no
// vuelve a salir: ni a la página, ni a un log, ni a esta función.

const mailPath = (slug: string) => `/${slug}/mail`;

/**
 * Conecta el buzón de la org. Antes de guardar nada se prueba SMTP: si la contraseña está mal, el
 * error se ve al momento en vez de descubrirlo al primer envío.
 */
export async function connectMailAccount(slug: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const parsed = connectMailSchema.safeParse(input);
  if (!parsed.success) return invalidInput();
  const v = parsed.data;

  const existing = await getMailAccount(ctx.org.id);
  if (existing) return failure("mail.errors.alreadyConnected");

  // Antes de guardar nada: ¿acepta el servidor ese usuario y esa contraseña? Se comprueba la
  // lectura (IMAP), que es lo que hace falta para tener el correo. Enviar no se comprueba aquí: si
  // el servidor no puede abrir SMTP, no se tira el alta por eso (las respuestas salen por HTTP).
  try {
    await verifyImapLogin({ host: v.imap_host, port: v.imap_port, username: v.username, password: v.password });
  } catch {
    return failure("mail.errors.credentials");
  }

  const id = randomUUID();
  const ciphertext = await secretStoreFromEnv().seal(v.password, mailSecretContext(ctx.org.id, id));
  const admin = createAdminClient();
  const { error } = await admin.from("mail_accounts").insert({
    id,
    org_id: ctx.org.id,
    address: v.address,
    display_name: v.display_name,
    imap_host: v.imap_host,
    imap_port: v.imap_port,
    smtp_host: v.smtp_host,
    smtp_port: v.smtp_port,
    username: v.username,
    password_ciphertext: ciphertext,
  });
  if (error) {
    if (error.code === "23505") return failure("mail.errors.alreadyConnected");
    return failure("mail.errors.connect");
  }

  const account = {
    id,
    orgId: ctx.org.id,
    address: v.address,
    displayName: v.display_name,
    imapHost: v.imap_host,
    imapPort: v.imap_port,
    smtpHost: v.smtp_host,
    smtpPort: v.smtp_port,
    username: v.username,
    lastSyncAt: null,
    lastError: null,
    createdAt: new Date().toISOString(),
  };
  // La primera descarga (120 días) tarda minutos: se hace DESPUÉS de contestar, para que el botón
  // responda al momento. La bandeja se va llenando y el cron la completa cada 5 minutos.
  after(async () => {
    await syncMailAccount(account).catch((syncError) => console.error("[mail] primera descarga", syncError));
  });
  revalidatePath(mailPath(ctx.org.slug));
  return { ok: true, id };
}

/** Trae el correo nuevo ahora, sin esperar al cron. */
export async function syncMailNow(slug: string): Promise<ActionResult<{ fetched: number }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const account = await getMailAccount(ctx.org.id);
  if (!account) return failure("mail.errors.notConnected");
  const result = await syncMailAccount(account);
  revalidatePath(mailPath(ctx.org.slug));
  if (result.error) return failure("mail.errors.sync");
  return { ok: true, fetched: result.fetched };
}

/** Desconecta el buzón: se borra la contraseña cifrada y la copia de los mensajes. */
export async function disconnectMailAccount(slug: string): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const db = await createClient();
  const { error } = await db.from("mail_accounts").delete().eq("org_id", ctx.org.id);
  if (error) return failure("mail.errors.connect");
  revalidatePath(mailPath(ctx.org.slug));
  return { ok: true };
}

/** Marca como leído un hilo entero (la copia; en el servidor de correo sigue como estaba). */
export async function markThreadSeen(slug: string, threadKey: string): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  if (typeof threadKey !== "string" || threadKey.length === 0 || threadKey.length > 998) return invalidInput();
  const { error } = await createAdminClient()
    .from("mail_messages")
    .update({ seen: true })
    .eq("org_id", ctx.org.id)
    .eq("thread_key", threadKey)
    .eq("seen", false);
  if (error) return failure("mail.errors.generic");
  revalidatePath(mailPath(ctx.org.slug));
  return { ok: true };
}

/** Enlaza (o desenlaza) un hilo con un cliente, cuando la dirección no basta para reconocerlo. */
export async function linkThreadToClient(slug: string, threadKey: string, clientId: string | null): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  if (typeof threadKey !== "string" || threadKey.length === 0) return invalidInput();
  if (clientId !== null && !idSchema.safeParse(clientId).success) return invalidInput();
  if (clientId) {
    const db = await createClient();
    const { data } = await db.from("clients").select("id").eq("org_id", ctx.org.id).eq("id", clientId).maybeSingle();
    if (!data) return invalidInput();
  }
  const { error } = await createAdminClient()
    .from("mail_messages")
    .update({ client_id: clientId })
    .eq("org_id", ctx.org.id)
    .eq("thread_key", threadKey);
  if (error) return failure("mail.errors.generic");
  revalidatePath(mailPath(ctx.org.slug));
  return { ok: true };
}

/**
 * Envía un correo (nuevo o respuesta) con la cuenta de la org. Si es respuesta, se encadena al hilo
 * con las cabeceras de siempre y se cita el mensaje original, como haría cualquier cliente de correo.
 */
export async function sendMailMessage(slug: string, input: unknown): Promise<ActionResult<{ threadKey: string }>> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const parsed = sendMailSchema.safeParse(input);
  if (!parsed.success) return invalidInput();
  const v = parsed.data;
  const account = await getMailAccount(ctx.org.id);
  if (!account) return failure("mail.errors.notConnected");

  const to = splitAddresses(v.to);
  const cc = splitAddresses(v.cc);
  // Solo direcciones con forma de correo y un máximo razonable: un campo mal pegado no sale por la puerta.
  const looksLikeEmail = (address: string) => /^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/.test(normalizeAddress(address));
  if (to.length === 0 || to.length + cc.length > 10 || ![...to, ...cc].every(looksLikeEmail)) return failure("mail.errors.badAddress");

  const db = await createClient();
  let inReplyTo: string | null = null;
  let references: string[] = [];
  let subject = v.subject;
  let body = v.body;
  let clientId: string | null = v.client_id || null;

  if (v.reply_to_id) {
    const { data: original } = await db
      .from("mail_messages")
      .select("message_id, thread_key, subject, from_address, from_name, sent_at, body_text, client_id")
      .eq("org_id", ctx.org.id)
      .eq("id", v.reply_to_id)
      .maybeSingle();
    if (!original) return invalidInput();
    inReplyTo = original.message_id;
    references = original.message_id ? [original.thread_key, original.message_id] : [original.thread_key];
    subject = replySubject(original.subject);
    body = `${v.body}${quoteForReply(
      {
        fromName: original.from_name,
        fromAddress: original.from_address,
        sentAt: new Date(original.sent_at),
        bodyText: original.body_text,
      },
      ctx.org.locale,
    )}`;
    clientId = clientId ?? original.client_id;
  }

  try {
    const sent = await sendMail(account, { to, cc, subject, bodyText: body, inReplyTo, references });
    // El hilo del mensaje guardado: el de la respuesta, o el propio Message-ID si es nuevo.
    const threadKey = references[0] ?? inReplyTo ?? sent.messageId ?? subject;
    if (clientId) {
      await createAdminClient()
        .from("mail_messages")
        .update({ client_id: clientId })
        .eq("org_id", ctx.org.id)
        .eq("thread_key", threadKey)
        .is("client_id", null);
    }
    revalidatePath(mailPath(ctx.org.slug));
    return { ok: true, threadKey };
  } catch (error) {
    if (error instanceof MailSendUnavailableError) return failure("mail.errors.notConfigured");
    console.error("[mail] send", error);
    return failure("mail.errors.send");
  }
}
