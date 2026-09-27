import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { loadCatalog } from "@/server/catalog/queries";
import { getOrgContext, hasRole } from "@/server/session";
import { CatalogManager } from "./catalog-manager";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: `${t("tabs.catalog")} · ${t("title")}` };
}

/** Ajustes → Catálogo: los servicios y los packs que se proponen al presupuestar. Los lee cualquier miembro y los cambia un socio. */
export default async function CatalogSettingsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const { org, member } = await getOrgContext(slug);
  const supabase = await createClient();
  const catalog = await loadCatalog(supabase, org.id);
  return <CatalogManager slug={org.slug} catalog={catalog} canEdit={hasRole(member.role, "partner")} />;
}
