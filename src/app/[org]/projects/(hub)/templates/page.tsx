import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { TemplatesManager } from "@/components/projects/templates-manager";
import { getTemplates } from "@/server/projects/queries";
import { getOrgContext, hasRole } from "@/server/session";

type Props = { params: Promise<{ org: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: `${t("projects.templates.title")} · ${t("nav.projects")}` };
}

export default async function TemplatesPage({ params }: Props) {
  const { org: slug } = await params;
  const { org, member } = await getOrgContext(slug);
  const templates = await getTemplates(org.id);
  return <TemplatesManager slug={org.slug} basePath={`/${org.slug}`} templates={templates} canEdit={hasRole(member.role, "partner")} />;
}
