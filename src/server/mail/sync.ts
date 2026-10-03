import "server-only";

import { ImapFlow } from "imapflow";
import { type ParsedMail, type Source, simpleParser } from "mailparser";
import { counterpartAddresses, directionOf, domainOf, isAutomatedSender, isPublicDomain, normalizeAddress, snippetOf, threadKeyOf } from "@/domain/mail";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TablesInsert } from "@/lib/supabase/database.types";
import { type MailAccount, markMailSync, openMailPassword } from "./account";
import { createLeadFromMail } from "./leads";
import { notifyPartners } from "./notify";
import { loadAcceptanceCheck } from "./acceptance";

/**
 * Trae el correo nuevo del buzón y lo guarda enlazado a su cliente o lead.
 *
 * Se sincronizan dos carpetas: la bandeja de entrada y los enviados, porque una conversación son las
 * dos cosas. De cada carpeta se piden solo los mensajes con UID mayor que el último guardado, así
 * que la segunda vuelta es barata. El original se queda en el servidor de correo: esto es una copia
 * para poder buscar, enlazar y responder desde aquí.
 */

/** Cuántos mensajes se traen como mucho por carpeta y vuelta (para no bloquear el cron). */
const MAX_PER_FOLDER = 200;
/** Leads nuevos que una sola vuelta puede abrir: un tope por si llega una avalancha de correos. */
const MAX_NEW_LEADS_PER_RUN = 10;
/** Solo se abre un lead por un correo reciente: uno de hace meses ya no es una oportunidad nueva. */
const NEW_LEAD_MAX_AGE_DAYS = 14;
/** La primera vez no se trae el buzón entero: solo lo de los últimos meses. */
const FIRST_SYNC_DAYS = 120;

export type SyncResult = { fetched: number; linked: number; error: string | null };

type FolderKind = "inbox" | "sent";

export async function syncMailAccount(account: MailAccount, opts: { folders?: FolderKind[] } = {}): Promise<SyncResult> {
  const admin = createAdminClient();
  let password: string;
  try {
    password = await openMailPassword(account);
  } catch (error) {
    const message = describe(error);
    await markMailSync(account, message);
    return { fetched: 0, linked: 0, error: message };
  }

  const client = new ImapFlow({
    host: account.imapHost,
    port: account.imapPort,
    secure: account.imapPort === 993,
    auth: { user: account.username, pass: password },
    logger: false,
    // Un buzón que no contesta no puede dejar el cron colgado.
    socketTimeout: 60_000,
  });

  let fetched = 0;
  let linked = 0;
  let newLeads = 0;
  // Correos de clientes con presupuesto enviado que podrían ser una aceptación (se avisa al final).
  const toCheck: { clientId: string; uid: number; subject: string; bodyText: string }[] = [];
  try {
    await client.connect();
    // Quién es «nosotros» para saber qué entra y qué sale, y a quién enlazar.
    const ours = [normalizeAddress(account.address), normalizeAddress(account.username)];
    const directory = await contactIndex(account.orgId);

    for (const kind of opts.folders ?? (["inbox", "sent"] as FolderKind[])) {
      const path = await folderPath(client, kind);
      if (!path) continue;
      const lock = await client.getMailboxLock(path);
      try {
        const { data: last } = await admin
          .from("mail_messages")
          .select("uid")
          .eq("account_id", account.id)
          .eq("folder", path)
          .order("uid", { ascending: false })
          .limit(1)
          .maybeSingle();

        const since = new Date();
        since.setDate(since.getDate() - FIRST_SYNC_DAYS);
        const range = last?.uid ? `${Number(last.uid) + 1}:*` : "1:*";
        const search = last?.uid ? { uid: range } : { since };

        const rows: TablesInsert<"mail_messages">[] = [];
        for await (const message of client.fetch(search, { uid: true, source: true, flags: true }, { uid: Boolean(last?.uid) })) {
          if (rows.length >= MAX_PER_FOLDER) break;
          // Un mensaje que no se puede leer no corta la sincronización del resto.
          if (!message.source) continue;
          try {
            const parsed = await parse(message.source);
            const from = parsed.from?.value[0];
            const fromAddress = normalizeAddress(from?.address ?? "");
            if (!fromAddress) continue;
            const to = addressesOf(parsed.to);
            const cc = addressesOf(parsed.cc);
            const bodyText = (parsed.text ?? "").slice(0, 500_000);
            const direction = directionOf(fromAddress, ours);
            let clientId = matchClient(directory, counterpartAddresses({ from: fromAddress, to, cc }, ours));
            const sentAt = parsed.date ?? new Date();

            // Alguien desconocido nos escribe: si parece una persona, se abre su lead. Nunca en la
            // primera vuelta (el histórico no son oportunidades nuevas) ni por correos viejos.
            if (
              !clientId &&
              direction === "incoming" &&
              Boolean(last?.uid) &&
              newLeads < MAX_NEW_LEADS_PER_RUN &&
              Date.now() - sentAt.getTime() < NEW_LEAD_MAX_AGE_DAYS * 86_400_000 &&
              !isAutomatedSender({ from: fromAddress, headers: headersOf(parsed.headers), subject: parsed.subject })
            ) {
              clientId = await createLeadFromMail(account.orgId, { name: from?.name, address: fromAddress, subject: parsed.subject ?? "" });
              if (clientId) {
                newLeads += 1;
                // Avisa a los socios: un lead que ha escrito hay que mirarlo cuanto antes.
                await notifyPartners(account.orgId, {
                  kind: "mail_new_lead",
                  params: { name: from?.name || fromAddress, subject: (parsed.subject ?? "").slice(0, 120) },
                  href: `/leads/${clientId}`,
                  dedupe: `mail_new_lead:${account.id}:${path}:${message.uid}`,
                }).catch((noticeError) => console.error("[mail] aviso de lead nuevo", noticeError));
                // Los siguientes correos de esta misma persona, en esta vuelta, ya cuelgan de su ficha.
                directory.byAddress.set(fromAddress, clientId);
              }
            }
            if (clientId) linked += 1;
            if (clientId && direction === "incoming" && Boolean(last?.uid)) {
              toCheck.push({ clientId, uid: Number(message.uid), subject: parsed.subject ?? "", bodyText });
            }

            rows.push({
              org_id: account.orgId,
              account_id: account.id,
              folder: path,
              uid: Number(message.uid),
              message_id: parsed.messageId ?? null,
              in_reply_to: parsed.inReplyTo ?? null,
              thread_key: threadKeyOf({
                messageId: parsed.messageId ?? null,
                inReplyTo: parsed.inReplyTo ?? null,
                references: referencesOf(parsed.references),
                subject: parsed.subject ?? "",
              }),
              direction,
              from_address: fromAddress.slice(0, 320),
              from_name: (from?.name ?? "").slice(0, 320),
              to_addresses: to.slice(0, 50),
              cc_addresses: cc.slice(0, 50),
              subject: (parsed.subject ?? "").slice(0, 998),
              body_text: bodyText,
              body_html: typeof parsed.html === "string" ? parsed.html.slice(0, 2_000_000) : null,
              snippet: snippetOf(bodyText),
              sent_at: sentAt.toISOString(),
              seen: Array.isArray(message.flags) ? message.flags.includes("\\Seen") : Boolean(message.flags?.has?.("\\Seen")),
              has_attachments: (parsed.attachments ?? []).some((attachment) => attachment.contentDisposition !== "inline"),
              client_id: clientId,
            });
          } catch (parseError) {
            console.error("[mail] no se pudo leer un mensaje", account.id, path, message.uid, parseError);
          }
        }

        if (rows.length > 0) {
          const { error } = await admin.from("mail_messages").upsert(rows, { onConflict: "account_id,folder,uid", ignoreDuplicates: true });
          if (error) throw error;
          fetched += rows.length;
        }

        // Un correo que acepta un presupuesto enviado avisa a los socios. No cambia nada solo.
        for (const item of toCheck.splice(0)) {
          const check = await loadAcceptanceCheck(account.orgId, item).catch((checkError) => {
            console.error("[mail] lectura de aceptación", checkError);
            return null;
          });
          if (!check) continue;
          await notifyPartners(account.orgId, {
            kind: "mail_accepted",
            params: { client: check.clientName, number: check.quoteNumber, subject: item.subject.slice(0, 120) },
            href: `/leads/${item.clientId}`,
            dedupe: `mail_accepted:${account.id}:${path}:${item.uid}`,
          }).catch((noticeError) => console.error("[mail] aviso de aceptación", noticeError));
        }
      } finally {
        lock.release();
      }
    }
    await markMailSync(account, null);
    return { fetched, linked, error: null };
  } catch (error) {
    const message = describe(error);
    console.error("[mail] sync", account.id, error);
    await markMailSync(account, message);
    return { fetched, linked, error: message };
  } finally {
    await client.logout().catch(() => client.close());
  }
}

/**
 * `simpleParser` declara una sobrecarga con callback, y TypeScript elige esa: se fija aquí la que
 * devuelve el mensaje ya leído.
 */
const parse = simpleParser as (source: Source) => Promise<ParsedMail>;

/** La carpeta real de la bandeja o de los enviados: cada proveedor la llama a su manera. */
async function folderPath(client: ImapFlow, kind: FolderKind): Promise<string | null> {
  if (kind === "inbox") return "INBOX";
  const list = await client.list();
  // Lo normal es que el servidor la marque con \Sent; si no, se busca por nombre.
  const flagged = list.find((box) => box.specialUse === "\\Sent");
  if (flagged) return flagged.path;
  const named = list.find((box) => /^(sent|enviados|enviats|sent items|elementos enviados)$/i.test(box.name));
  return named?.path ?? null;
}

/** Las cabeceras que delatan un envío automático, en un objeto plano y en minúsculas. */
const AUTOMATION_HEADERS = ["list-unsubscribe", "list-id", "precedence", "auto-submitted", "x-auto-response-suppress"];
const headersOf = (headers: Map<string, unknown>): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const name of AUTOMATION_HEADERS) {
    const value = headers.get(name);
    if (value !== undefined && value !== null) result[name] = typeof value === "string" ? value : String(value);
  }
  return result;
};

const addressesOf = (value: unknown): string[] => {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list.flatMap((entry) => {
    const addresses = (entry as { value?: { address?: string }[] }).value ?? [];
    return addresses.flatMap((item) => (item.address ? [normalizeAddress(item.address)] : []));
  });
};

const referencesOf = (value: unknown): string[] =>
  typeof value === "string" ? value.split(/\s+/).filter(Boolean) : Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

/** Direcciones y dominios conocidos → a qué ficha pertenece un correo. */
type ContactIndex = { byAddress: Map<string, string>; byDomain: Map<string, string> };

async function contactIndex(orgId: string): Promise<ContactIndex> {
  const admin = createAdminClient();
  const [contacts, clients] = await Promise.all([
    admin.from("contacts").select("client_id, email").eq("org_id", orgId).not("email", "is", null).is("archived_at", null),
    admin.from("clients").select("id, website").eq("org_id", orgId).is("archived_at", null),
  ]);
  if (contacts.error) throw contacts.error;
  if (clients.error) throw clients.error;

  const byAddress = new Map<string, string>();
  for (const contact of contacts.data ?? []) if (contact.email) byAddress.set(normalizeAddress(contact.email), contact.client_id);

  // El dominio de la web del cliente: reconoce a alguien de la empresa aunque no esté apuntado.
  const byDomain = new Map<string, string>();
  for (const client of clients.data ?? []) {
    const host = client.website?.replace(/^https?:\/\//, "").split("/")[0]?.replace(/^www\./, "").toLowerCase();
    if (host && host.includes(".") && !isPublicDomain(host)) byDomain.set(host, client.id);
  }
  // Y el dominio de los correos ya apuntados, que es la señal más fiable de todas.
  for (const [address, clientId] of byAddress) {
    const domain = domainOf(address);
    if (domain && !isPublicDomain(domain) && !byDomain.has(domain)) byDomain.set(domain, clientId);
  }
  return { byAddress, byDomain };
}

function matchClient(index: ContactIndex, addresses: readonly string[]): string | null {
  for (const address of addresses) {
    const direct = index.byAddress.get(address);
    if (direct) return direct;
  }
  for (const address of addresses) {
    const domain = domainOf(address);
    const byDomain = domain ? index.byDomain.get(domain) : undefined;
    if (byDomain) return byDomain;
  }
  return null;
}

const describe = (error: unknown): string => (error instanceof Error ? error.message.slice(0, 300) : "error desconocido");
