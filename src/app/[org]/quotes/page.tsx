import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { QuotesList } from "@/components/quotes/quotes-list";
import { createClient } from "@/lib/supabase/server";
import { listQuotes } from "@/server/quotes/queries";
import { getOrgContext, hasRole } from "@/server/session";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("nav"))("quotes") };
}

export default async function QuotesPage({ params }: PageProps<"/[org]/quotes">) {
  const { org: slug } = await params;
  const { org, member } = await getOrgContext(slug);
  const quotes = await listQuotes(await createClient(), org.id);
  return <QuotesList basePath={`/${org.slug}`} quotes={quotes} canEdit={hasRole(member.role, "partner")} />;
}
