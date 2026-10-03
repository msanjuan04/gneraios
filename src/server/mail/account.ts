import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { secretStoreFromEnv } from "@/server/seo/secret-store";

/**
 * El buzón conectado de una org. La contraseña se guarda cifrada con la clave del servidor y solo
 * se abre aquí, para conectarse por IMAP o SMTP: nunca sale hacia el navegador.
 */

export type MailAccount = {
  id: string;
  orgId: string;
  address: string;
  displayName: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  username: string;
  lastSyncAt: string | null;
  lastError: string | null;
};

/** Las columnas que puede leer un socio (la contraseña cifrada no está entre ellas). */
const COLUMNS = "id, org_id, address, display_name, imap_host, imap_port, smtp_host, smtp_port, username, last_sync_at, last_error";

/** Contexto de cifrado: la contraseña de un buzón no se abre con la de otro ni en otra org. */
export const mailSecretContext = (orgId: string, accountId: string): string => `mail/${orgId}/${accountId}`;

type Row = {
  id: string;
  org_id: string;
  address: string;
  display_name: string;
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
  username: string;
  last_sync_at: string | null;
  last_error: string | null;
};

const toAccount = (row: Row): MailAccount => ({
  id: row.id,
  orgId: row.org_id,
  address: row.address,
  displayName: row.display_name,
  imapHost: row.imap_host,
  imapPort: row.imap_port,
  smtpHost: row.smtp_host,
  smtpPort: row.smtp_port,
  username: row.username,
  lastSyncAt: row.last_sync_at,
  lastError: row.last_error,
});

/** El buzón de la org, con la sesión del miembro (RLS). null si todavía no hay ninguno. */
export async function getMailAccount(orgId: string): Promise<MailAccount | null> {
  const db = await createClient();
  const { data, error } = await db.from("mail_accounts").select(COLUMNS).eq("org_id", orgId).is("archived_at", null).maybeSingle();
  if (error) throw error;
  return data ? toAccount(data as Row) : null;
}

/** Lo mismo, pero con la clave del servidor: para el cron, que no tiene sesión. */
export async function getMailAccountAsServer(orgId: string): Promise<MailAccount | null> {
  const { data, error } = await createAdminClient().from("mail_accounts").select(COLUMNS).eq("org_id", orgId).is("archived_at", null).maybeSingle();
  if (error) throw error;
  return data ? toAccount(data as Row) : null;
}

/** Todos los buzones conectados (el cron los recorre). */
export async function listMailAccounts(): Promise<MailAccount[]> {
  const { data, error } = await createAdminClient().from("mail_accounts").select(COLUMNS).is("archived_at", null);
  if (error) throw error;
  return (data ?? []).map((row) => toAccount(row as Row));
}

/** La contraseña en claro del buzón. Solo el servidor; no se registra en ningún sitio. */
export async function openMailPassword(account: Pick<MailAccount, "id" | "orgId">): Promise<string> {
  const { data, error } = await createAdminClient()
    .from("mail_accounts")
    .select("password_ciphertext")
    .eq("org_id", account.orgId)
    .eq("id", account.id)
    .maybeSingle();
  if (error) throw error;
  if (!data?.password_ciphertext) throw new Error("El buzón no tiene contraseña guardada.");
  return secretStoreFromEnv().open(data.password_ciphertext, mailSecretContext(account.orgId, account.id));
}

/** Apunta cómo fue la última sincronización (y qué falló, si falló). */
export async function markMailSync(account: Pick<MailAccount, "id" | "orgId">, error: string | null): Promise<void> {
  await createAdminClient()
    .from("mail_accounts")
    .update({ last_sync_at: new Date().toISOString(), last_error: error })
    .eq("org_id", account.orgId)
    .eq("id", account.id);
}
