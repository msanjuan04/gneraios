import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { QuoteEditor } from "@/components/quotes/quote-editor";
import { QuoteShareCard } from "@/components/quotes/quote-share-card";
import { nowInZone } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/server/action-utils";
import { getQuoteShareData } from "@/server/portal/links";
import { getQuoteEditorData, getQuoteHeading } from "@/server/quotes/queries";
import { getOrgContext, hasRole } from "@/server/session";

// Tipado a mano: la ruta es nueva y los tipos de rutas de Next se regeneran con `next dev`/`next build`.
type Props = { params: Promise<{ org: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { org: slug, id } = await params;
  const t = await getTranslations("nav");
  if (!idSchema.safeParse(id).success) return { title: t("quotes") };
  const { org } = await getOrgContext(slug);
  const quote = await getQuoteHeading(await createClient(), org.id, id);
  return { title: quote ? `${quote.number ?? quote.title} · ${t("quotes")}` : t("quotes") };
}

export default async function QuotePage({ params }: Props) {
  const { org: slug, id } = await params;
  if (!idSchema.safeParse(id).success) notFound();
  const { org, member } = await getOrgContext(slug);
  const supabase = await createClient();
  const canAct = hasRole(member.role, "partner");
  const data = await getQuoteEditorData(supabase, org, id, canAct);
  if (!data) notFound();
  const share = data.quoteId ? await getQuoteShareData(supabase, org.id, { id: data.quoteId, status: data.status, state: data.state }) : null;

  return (
    <QuoteEditor
      slug={org.slug}
      basePath={`/${org.slug}`}
      today={nowInZone(org.timezone).date}
      data={data}
      share={share && <QuoteShareCard key="share" slug={org.slug} data={share} canAct={canAct} />}
    />
  );
}
