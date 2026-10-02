import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { QuoteTemplates } from "@/components/quotes/quote-templates";
import { createClient } from "@/lib/supabase/server";
import { listQuoteTemplates } from "@/server/quotes/templates";
import { getOrgContext, hasRole } from "@/server/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("quotes.templates");
  return { title: t("title") };
}

/** Las plantillas de presupuesto de la org: los presupuestos genéricos de los que se parte. */
export default async function QuoteTemplatesPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const { org, member } = await getOrgContext(slug);
  const templates = await listQuoteTemplates(await createClient(), org.id);
  return <QuoteTemplates slug={org.slug} basePath={`/${org.slug}`} templates={templates} canEdit={hasRole(member.role, "partner")} />;
}
