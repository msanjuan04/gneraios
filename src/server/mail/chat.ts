import "server-only";

import { normalizeAddress } from "@/domain/mail";
import { createClient } from "@/lib/supabase/server";
import { getMailAccount } from "./account";
import { listClientMail, type MailMessage } from "./queries";

/**
 * Todo lo que necesita el chat de correo de una ficha (lead o cliente): los mensajes en orden de
 * lectura (el más viejo arriba, como en una conversación), a quién se puede escribir y desde qué
 * buzón. null si la org no tiene buzón conectado: no hay chat que enseñar.
 */

export type MailChatData = {
  account: { address: string };
  messages: MailMessage[];
  /** A quién se puede escribir: los contactos de la ficha y quien nos haya escrito. El primero es el sugerido. */
  recipients: { address: string; name: string }[];
};

const MAX_MESSAGES = 300;

export async function loadMailChat(orgId: string, clientId: string): Promise<MailChatData | null> {
  const account = await getMailAccount(orgId);
  if (!account) return null;
  const db = await createClient();
  const [recent, contacts] = await Promise.all([
    listClientMail(orgId, clientId, MAX_MESSAGES),
    db.from("contacts").select("full_name, email, is_primary").eq("org_id", orgId).eq("client_id", clientId).is("archived_at", null).not("email", "is", null).order("is_primary", { ascending: false }),
  ]);
  if (contacts.error) throw contacts.error;

  // Quien nos escribió por última vez es lo más probable a quien se contesta.
  const lastIncoming = recent.find((message) => message.direction === "incoming");
  const seen = new Set<string>();
  const recipients: { address: string; name: string }[] = [];
  const add = (address: string | null | undefined, name: string) => {
    const normalized = normalizeAddress(address ?? "");
    if (!normalized || seen.has(normalized) || normalized === normalizeAddress(account.address)) return;
    seen.add(normalized);
    recipients.push({ address: normalized, name });
  };
  if (lastIncoming) add(lastIncoming.fromAddress, lastIncoming.fromName);
  for (const contact of contacts.data ?? []) add(contact.email, contact.full_name);
  for (const message of recent) if (message.direction === "incoming") add(message.fromAddress, message.fromName);

  return { account: { address: account.address }, messages: [...recent].reverse(), recipients };
}
