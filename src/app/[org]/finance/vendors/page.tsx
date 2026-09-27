import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { VendorsView } from "@/components/vendors/vendors-view";
import { getOrgContext, hasRole } from "@/server/session";
import { getVendorsPage } from "@/server/vendors/queries";
import { readVendorListParams } from "./schema";

// Tipado a mano: la ruta es nueva y los tipos de rutas de Next se regeneran con `next dev`/`next build`.
type Props = {
  params: Promise<{ org: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  const [t, tFinance] = await Promise.all([getTranslations("vendors"), getTranslations("finance")]);
  return { title: `${t("tab")} · ${tFinance("title")}` };
}

/** Finanzas → Proveedores: empresas y freelancers, lo que nos cuestan y para cuántos clientes trabajan. */
export default async function VendorsPage({ params, searchParams }: Props) {
  const [{ org: slug }, query] = await Promise.all([params, searchParams]);
  const { org, member } = await getOrgContext(slug);
  const data = await getVendorsPage(org);
  return (
    <VendorsView
      slug={org.slug}
      basePath={`/${org.slug}`}
      data={data}
      canEdit={hasRole(member.role, "partner")}
      initial={readVendorListParams(query)}
    />
  );
}
