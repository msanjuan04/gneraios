import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { QuoteEditor } from "@/components/quotes/quote-editor";
import type { QuoteEditorData } from "@/components/quotes/types";
import { nowInZone } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/server/action-utils";
import { getNewQuoteDefaults, getQuoteFormOptions } from "@/server/quotes/queries";
import { getQuoteTemplate, templateDefaults } from "@/server/quotes/templates";
import { getOrgContext, hasRole } from "@/server/session";

// Tipado a mano: la ruta es nueva y los tipos de rutas de Next se regeneran con `next dev`/`next build`.
type Props = {
  params: Promise<{ org: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("quotes");
  return { title: `${t("new")} · ${t("title")}` };
}

const readId = (value: string | string[] | undefined) => {
  const parsed = idSchema.safeParse(Array.isArray(value) ? value[0] : value);
  return parsed.success ? parsed.data : null;
};

/**
 * Presupuesto nuevo. ?deal= parte del deal (su cliente, su título y sus importes estimados como
 * primeras líneas); ?client= parte de ese cliente; ?template= copia una plantilla. Se crea al guardar
 * por primera vez.
 */
export default async function NewQuotePage({ params, searchParams }: Props) {
  const { org: slug } = await params;
  const query = await searchParams;
  const { org, member } = await getOrgContext(slug);
  if (!hasRole(member.role, "partner")) redirect(`/${org.slug}/quotes`);

  const today = nowInZone(org.timezone).date;
  const options = await getQuoteFormOptions(org);
  const supabase = await createClient();
  const defaults = await getNewQuoteDefaults(supabase, org.id, options, { clientId: readId(query.client), dealId: readId(query.deal) }, randomUUID);
  // ?template= arranca de una plantilla: su título, idioma, notas, líneas y plan (el cliente y el deal, de la URL).
  const templateId = readId(query.template);
  const template = templateId ? await getQuoteTemplate(supabase, org.id, templateId) : null;
  if (template) {
    Object.assign(defaults, templateDefaults(template, options, randomUUID));
    if (defaults.client_id) {
      const client = options.clients.find((c) => c.id === defaults.client_id);
      if (client) defaults.language = client.language;
    }
    await supabase.rpc("quote_template_used", { p_template_id: template.id });
  }

  // ?brief= trae lo que pide el cliente (leído de su correo): abre las notas, que son el resumen
  // de la propuesta. Se recorta y va como texto, nunca como HTML.
  const brief = typeof query.brief === "string" ? query.brief.trim().slice(0, 1200) : "";
  if (brief) defaults.notes = [brief, defaults.notes].filter(Boolean).join("\n\n");

  const data: QuoteEditorData = {
    mode: "create",
    quoteId: null,
    updatedAt: null,
    number: null,
    status: "draft",
    state: "draft",
    editable: true,
    canAct: true,
    defaults,
    issuedOn: null,
    validUntil: null,
    acceptedAt: null,
    rejectedAt: null,
    rejectionReason: null,
    contract: null,
    landingUrl: null,
    emails: [],
    manualVersions: [],
    options,
  };
  return <QuoteEditor slug={org.slug} basePath={`/${org.slug}`} today={today} data={data} />;
}
