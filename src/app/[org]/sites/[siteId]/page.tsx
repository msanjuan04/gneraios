import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { SiteDetail } from "@/components/sites/site-detail";
import { getOrgContext, hasRole } from "@/server/session";
import { getSiteDetail, getSiteName } from "@/server/sites/queries";

// Tipado a mano: la ruta es nueva y los tipos de rutas de Next se regeneran con `next dev`/`next build`.
type Props = { params: Promise<{ org: string; siteId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { org: slug, siteId } = await params;
  const { org } = await getOrgContext(slug);
  const [name, t] = await Promise.all([getSiteName(org.id, siteId), getTranslations("nav")]);
  return { title: name ? `${name} · ${t("sites")}` : t("sites") };
}

/** La ficha de una web (a la que llevan los avisos: /sites/<id>). */
export default async function SitePage({ params }: Props) {
  const { org: slug, siteId } = await params;
  const { org, member } = await getOrgContext(slug);
  const data = await getSiteDetail(org, siteId);
  if (!data) notFound();
  return <SiteDetail slug={org.slug} basePath={`/${org.slug}`} data={data} canEdit={hasRole(member.role, "partner")} />;
}
