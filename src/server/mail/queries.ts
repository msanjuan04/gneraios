import "server-only";

import { baseSubject } from "@/domain/mail";
import { createClient } from "@/lib/supabase/server";

/**
 * Lo que lee la bandeja: conversaciones (una fila por hilo, con el último mensaje) y el hilo entero
 * cuando se abre. Se pagina siempre: el buzón crece sin parar y la página no puede crecer con él.
 */

export type ThreadSummary = {
  threadKey: string;
  subject: string;
  snippet: string;
  lastAt: string;
  lastDirection: "incoming" | "outgoing";
  counterpart: string;
  counterpartName: string;
  messages: number;
  unread: number;
  clientId: string | null;
  clientName: string | null;
};

export type MailMessage = {
  id: string;
  folder: string;
  direction: "incoming" | "outgoing";
  fromAddress: string;
  fromName: string;
  toAddresses: string[];
  ccAddresses: string[];
  subject: string;
  bodyText: string;
  sentAt: string;
  seen: boolean;
  hasAttachments: boolean;
  messageId: string | null;
  clientId: string | null;
};

export const THREADS_PER_PAGE = 25;

/** Cuántos mensajes se miran para armar la lista de hilos (los más recientes). */
const SCAN = 600;

export type ThreadFilter = { clientId?: string | null; query?: string; unreadOnly?: boolean };

export type ThreadPage = { threads: ThreadSummary[]; page: number; pages: number; total: number };

/**
 * Las conversaciones más recientes. Se agrupan aquí y no en SQL a propósito: la clave de hilo ya
 * viene calculada en cada mensaje, así que agrupar es contar, y así la consulta sigue siendo una.
 */
export async function listThreads(orgId: string, filter: ThreadFilter = {}, page = 1): Promise<ThreadPage> {
  const db = await createClient();
  let query = db
    .from("mail_messages")
    .select("thread_key, subject, snippet, sent_at, direction, from_address, from_name, to_addresses, seen, client_id")
    .eq("org_id", orgId)
    .order("sent_at", { ascending: false })
    .limit(SCAN);
  if (filter.clientId) query = query.eq("client_id", filter.clientId);
  if (filter.unreadOnly) query = query.eq("seen", false).eq("direction", "incoming");
  const term = filter.query?.trim();
  if (term) query = query.or(`subject.ilike.%${term}%,from_address.ilike.%${term}%,body_text.ilike.%${term}%`);

  const { data, error } = await query;
  if (error) throw error;

  const byThread = new Map<string, ThreadSummary>();
  for (const row of data ?? []) {
    const existing = byThread.get(row.thread_key);
    if (existing) {
      existing.messages += 1;
      if (!row.seen && row.direction === "incoming") existing.unread += 1;
      // Lo que falte en el último mensaje (cliente enlazado) lo completa cualquiera del hilo.
      if (!existing.clientId && row.client_id) existing.clientId = row.client_id;
      continue;
    }
    byThread.set(row.thread_key, {
      threadKey: row.thread_key,
      subject: baseSubject(row.subject) || "(sin asunto)",
      snippet: row.snippet,
      lastAt: row.sent_at,
      lastDirection: row.direction,
      // Con quién se habla: si lo enviamos nosotros, el destinatario; si no, el remitente.
      counterpart: row.direction === "outgoing" ? (row.to_addresses[0] ?? "") : row.from_address,
      counterpartName: row.direction === "outgoing" ? "" : row.from_name,
      messages: 1,
      unread: !row.seen && row.direction === "incoming" ? 1 : 0,
      clientId: row.client_id,
      clientName: null,
    });
  }

  const all = [...byThread.values()];
  const total = all.length;
  const pages = Math.max(1, Math.ceil(total / THREADS_PER_PAGE));
  const current = Math.min(Math.max(1, page), pages);
  const threads = all.slice((current - 1) * THREADS_PER_PAGE, current * THREADS_PER_PAGE);

  await nameClients(orgId, threads);
  return { threads, page: current, pages, total };
}

/** Los nombres de los clientes enlazados, de una vez (la lista solo tiene sus ids). */
async function nameClients(orgId: string, threads: ThreadSummary[]): Promise<void> {
  const ids = [...new Set(threads.flatMap((thread) => (thread.clientId ? [thread.clientId] : [])))];
  if (ids.length === 0) return;
  const db = await createClient();
  const { data, error } = await db.from("clients").select("id, display_name").eq("org_id", orgId).in("id", ids);
  if (error) throw error;
  const names = new Map((data ?? []).map((client) => [client.id, client.display_name]));
  for (const thread of threads) thread.clientName = thread.clientId ? (names.get(thread.clientId) ?? null) : null;
}

/** Un hilo entero, de lo más viejo a lo más nuevo (como se lee una conversación). */
export async function loadThread(orgId: string, threadKey: string): Promise<MailMessage[]> {
  const db = await createClient();
  const { data, error } = await db
    .from("mail_messages")
    .select(
      "id, folder, direction, from_address, from_name, to_addresses, cc_addresses, subject, body_text, sent_at, seen, has_attachments, message_id, client_id",
    )
    .eq("org_id", orgId)
    .eq("thread_key", threadKey)
    .order("sent_at", { ascending: true })
    .limit(200);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    folder: row.folder,
    direction: row.direction,
    fromAddress: row.from_address,
    fromName: row.from_name,
    toAddresses: row.to_addresses,
    ccAddresses: row.cc_addresses,
    subject: row.subject,
    bodyText: row.body_text,
    sentAt: row.sent_at,
    seen: row.seen,
    hasAttachments: row.has_attachments,
    messageId: row.message_id,
    clientId: row.client_id,
  }));
}

/** Los últimos correos de un cliente o lead, para su ficha. */
export async function listClientMail(orgId: string, clientId: string, limit = 20): Promise<MailMessage[]> {
  const db = await createClient();
  const { data, error } = await db
    .from("mail_messages")
    .select(
      "id, folder, direction, from_address, from_name, to_addresses, cc_addresses, subject, body_text, sent_at, seen, has_attachments, message_id, client_id",
    )
    .eq("org_id", orgId)
    .eq("client_id", clientId)
    .order("sent_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    folder: row.folder,
    direction: row.direction,
    fromAddress: row.from_address,
    fromName: row.from_name,
    toAddresses: row.to_addresses,
    ccAddresses: row.cc_addresses,
    subject: row.subject,
    bodyText: row.body_text,
    sentAt: row.sent_at,
    seen: row.seen,
    hasAttachments: row.has_attachments,
    messageId: row.message_id,
    clientId: row.client_id,
  }));
}
