import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CouncilNav } from "@/components/council/council-nav";
import { PageHeader } from "@/components/page-header";
import { readOrgModules } from "@/domain/org";
import { getOrgContext, hasRole } from "@/server/session";

export default async function CouncilLayout({ children, params }: LayoutProps<"/[org]/council">) {
  const { org: slug } = await params;
  const { org, member } = await getOrgContext(slug);
  // Módulo apagado (orgs.settings.modules.council): la ruta no existe. Lo guardado sigue ahí.
  if (!readOrgModules(org.settings).council) notFound();
  const t = await getTranslations("council");
  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader title={t("title")} description={t("description")} />
      <CouncilNav basePath={`/${org.slug}`} isOwner={hasRole(member.role, "owner")} />
      {children}
    </div>
  );
}
