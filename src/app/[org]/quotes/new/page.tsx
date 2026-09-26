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
 * primeras líneas); ?client= parte de ese cliente. Se crea al guardar por primera vez.
 */
export default async function NewQuotePage({ params, searchParams }: Props) {
  const { org: slug } = await params;
  const query = await searchParams;
  const { org, member } = await getOrgContext(slug);
  if (!hasRole(member.role, "partner")) redirect(`/${org.slug}/quotes`);

  const today = nowInZone(org.timezone).date;
  const options = await getQuoteFormOptions(org);
  const defaults = await getNewQuoteDefaults(
    await createClient(),
    org.id,
    options,
    { clientId: readId(query.client), dealId: readId(query.deal) },
    randomUUID,
  );

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
    emails: [],
    options,
  };
  return <QuoteEditor slug={org.slug} basePath={`/${org.slug}`} today={today} data={data} />;
}
