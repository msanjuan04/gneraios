import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { VendorDetail } from "@/components/vendors/vendor-detail";
import { getOrgContext, hasRole } from "@/server/session";
import { getVendorDetail, getVendorName } from "@/server/vendors/queries";

// Tipado a mano: la ruta es nueva y los tipos de rutas de Next se regeneran con `next dev`/`next build`.
type Props = { params: Promise<{ org: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { org: slug, id } = await params;
  const { org } = await getOrgContext(slug);
  const [name, t] = await Promise.all([getVendorName(org.id, id), getTranslations("vendors")]);
  return { title: name ? `${name} · ${t("tab")}` : t("tab") };
}

/** La ficha de un proveedor: sus datos, lo que nos cuesta, para quién ha trabajado y sus gastos. */
export default async function VendorPage({ params }: Props) {
  const { org: slug, id } = await params;
  const { org, member } = await getOrgContext(slug);
  const data = await getVendorDetail(org, id);
  if (!data) notFound();
  return <VendorDetail slug={org.slug} basePath={`/${org.slug}`} data={data} canEdit={hasRole(member.role, "partner")} />;
}
