import "server-only";

import { type MailIntent, readMailIntent, suggestTemplate, summarizeRequest } from "@/domain/mail";
import { createClient } from "@/lib/supabase/server";

/**
 * Qué nos está pidiendo el último correo de un lead y qué se puede hacer con un clic.
 *
 * Lo que decide lo hace una persona: aquí solo se lee el correo, se resume y se deja preparado el
 * siguiente paso (la plantilla que encaja, el presupuesto que ya está enviado). Marcar aceptado
 * crea contrato y borrador de factura, así que eso nunca se dispara solo.
 */

export type LeadMailSignal = {
  messageId: string;
  subject: string;
  from: string;
  sentAt: string;
  intent: MailIntent;
  evidence: string[];
  /** Lo que piden, en sus palabras (las frases con sustancia del correo). */
  summary: string[];
  /** Plantilla de presupuesto que encaja con lo que piden, si alguna. */
  template: { id: string; name: string } | null;
  /** Presupuesto ya enviado al que se refiere la conversación, si hay. */
  sentQuote: { id: string; number: string | null; state: string } | null;
  /** Si ya hay propuesta enviada o no: cambia lo que toca hacer. */
  hasQuote: boolean;
};

export async function loadLeadMailSignal(orgId: string, clientId: string): Promise<LeadMailSignal | null> {
  const db = await createClient();
  const { data: last, error } = await db
    .from("mail_messages")
    .select("id, subject, from_address, from_name, body_text, sent_at, direction")
    .eq("org_id", orgId)
    .eq("client_id", clientId)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  // Solo se lee el último mensaje si lo escribieron ellos: si el último es nuestro, la pelota no es nuestra.
  if (!last || last.direction !== "incoming") return null;

  const reading = readMailIntent({ subject: last.subject, bodyText: last.body_text });
  const [templates, quotes] = await Promise.all([
    db.from("quote_templates").select("id, name, summary").eq("org_id", orgId).is("archived_at", null),
    db
      .from("quotes_overview")
      .select("id, number, state")
      .eq("org_id", orgId)
      .eq("client_id", clientId)
      .order("created_at", { ascending: false }),
  ]);
  if (templates.error) throw templates.error;
  if (quotes.error) throw quotes.error;

  const match = suggestTemplate(`${last.subject}\n${last.body_text}`, templates.data ?? []);
  const sent = (quotes.data ?? []).find((quote) => quote.state === "sent") ?? null;

  return {
    messageId: last.id,
    subject: last.subject,
    from: last.from_name || last.from_address,
    sentAt: last.sent_at,
    intent: reading.intent,
    evidence: reading.evidence,
    summary: summarizeRequest(last.body_text),
    template: match ? { id: match.template.id, name: match.template.name } : null,
    sentQuote: sent && sent.id ? { id: sent.id, number: sent.number, state: sent.state ?? "sent" } : null,
    hasQuote: (quotes.data ?? []).length > 0,
  };
}
