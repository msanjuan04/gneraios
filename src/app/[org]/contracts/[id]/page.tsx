import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ContractDetail } from "@/components/contracts/contract-detail";
import { getContractDetail, getContractRow, orgToday } from "@/server/contracts/queries";
import { getOrgContext, hasRole } from "@/server/session";

// Tipado a mano: la ruta es nueva y los tipos de rutas de Next se regeneran con `next dev`/`next build`.
type Props = { params: Promise<{ org: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { org: slug, id } = await params;
  const { org } = await getOrgContext(slug);
  const contract = await getContractRow(org.id, id);
  const t = await getTranslations("nav");
  return { title: contract ? `${contract.title} · ${t("contracts")}` : t("contracts") };
}

export default async function ContractPage({ params }: Props) {
  const { org: slug, id } = await params;
  const { org, member } = await getOrgContext(slug);
  const detail = await getContractDetail(org, id, orgToday(org.timezone));
  if (!detail) notFound();

  return (
    <ContractDetail
      data={{
        ...detail,
        slug: org.slug,
        basePath: `/${org.slug}`,
        canEdit: hasRole(member.role, "partner") && !detail.contract.archived,
      }}
    />
  );
}
