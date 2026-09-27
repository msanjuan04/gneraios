import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { readDetailTab } from "@/components/projects/constants";
import { ProjectDetail } from "@/components/projects/project-detail";
import { nowInZone } from "@/lib/clock";
import { getProjectDetail, getProjectFormOptions, getProjectName } from "@/server/projects/queries";
import { getOrgContext, hasRole } from "@/server/session";

// Tipado a mano: la ruta es nueva y los tipos de rutas de Next se regeneran con `next dev`/`next build`.
type Props = {
  params: Promise<{ org: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const param = (value: string | string[] | undefined) => (typeof value === "string" && value ? value : undefined);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { org: slug, id } = await params;
  const { org } = await getOrgContext(slug);
  const [name, t] = await Promise.all([getProjectName(org.id, id), getTranslations("nav")]);
  return { title: name ? `${name} · ${t("projects")}` : t("projects") };
}

export default async function ProjectPage({ params, searchParams }: Props) {
  const [{ org: slug, id }, query] = await Promise.all([params, searchParams]);
  const { org, member } = await getOrgContext(slug);
  const today = nowInZone(org.timezone).date;
  const [data, options] = await Promise.all([getProjectDetail(org, id, member.id, today), getProjectFormOptions(org.id)]);
  if (!data) notFound();

  const taskId = param(query.task);
  return (
    <ProjectDetail
      data={data}
      options={options}
      viewer={{
        slug: org.slug,
        basePath: `/${org.slug}`,
        memberId: member.id,
        canEdit: hasRole(member.role, "partner"),
        isOwner: hasRole(member.role, "owner"),
        today,
      }}
      initial={{ tab: taskId ? "tasks" : readDetailTab(param(query.tab)), taskId }}
    />
  );
}
