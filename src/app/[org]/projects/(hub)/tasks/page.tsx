import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { MyTasks } from "@/components/projects/my-tasks";
import { nowInZone } from "@/lib/clock";
import { getMyTasks, getOpenProjectOptions } from "@/server/projects/queries";
import { getOrgContext, hasRole } from "@/server/session";

type Props = { params: Promise<{ org: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: `${t("projects.myTasks.title")} · ${t("nav.projects")}` };
}

export default async function MyTasksPage({ params }: Props) {
  const { org: slug } = await params;
  const { org, member } = await getOrgContext(slug);
  const [tasks, projects] = await Promise.all([getMyTasks(org.id, member.id), getOpenProjectOptions(org.id)]);

  return (
    <MyTasks
      slug={org.slug}
      basePath={`/${org.slug}`}
      tasks={tasks}
      projects={projects}
      today={nowInZone(org.timezone).date}
      canEdit={hasRole(member.role, "partner")}
    />
  );
}
