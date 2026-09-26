import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ContractsList } from "@/components/contracts/contracts-list";
import { getContractFormOptions, getContractsList, orgToday } from "@/server/contracts/queries";
import { getOrgContext, hasRole } from "@/server/session";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("nav"))("contracts") };
}

export default async function ContractsPage({ params }: PageProps<"/[org]/contracts">) {
  const { org: slug } = await params;
  const { org, member } = await getOrgContext(slug);
  const today = orgToday(org.timezone);
  const canEdit = hasRole(member.role, "partner");

  const [contracts, options] = await Promise.all([getContractsList(org.id, today), getContractFormOptions(org)]);

  return (
    <ContractsList basePath={`/${org.slug}`} slug={org.slug} contracts={contracts} options={options} canEdit={canEdit} today={today} />
  );
}
