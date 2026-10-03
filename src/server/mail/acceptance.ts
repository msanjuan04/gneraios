import "server-only";

import { readMailIntent } from "@/domain/mail";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ¿Este correo acepta un presupuesto que tenemos enviado? Solo si el cliente tiene uno en estado
 * «enviado» y el correo lo dice con claridad. Devuelve lo necesario para el aviso, o null.
 */
export async function loadAcceptanceCheck(
  orgId: string,
  mail: { clientId: string; subject: string; bodyText: string },
): Promise<{ clientName: string; quoteNumber: string } | null> {
  if (readMailIntent({ subject: mail.subject, bodyText: mail.bodyText }).intent !== "accepted") return null;
  const admin = createAdminClient();
  const [quote, client] = await Promise.all([
    admin.from("quotes_overview").select("number").eq("org_id", orgId).eq("client_id", mail.clientId).eq("state", "sent").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("clients").select("display_name").eq("org_id", orgId).eq("id", mail.clientId).maybeSingle(),
  ]);
  if (quote.error) throw quote.error;
  if (client.error) throw client.error;
  if (!quote.data || !client.data) return null;
  return { clientName: client.data.display_name, quoteNumber: quote.data.number ?? "" };
}
