import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ProjectsView } from "@/components/projects/projects-view";
import { weekStart } from "@/domain/projects";
import { nowInZone } from "@/lib/clock";
import { getMemberHours, getProjectFormOptions, getProjectsList, targetHourlyRateCents } from "@/server/projects/queries";
import { getOrgContext, hasRole } from "@/server/session";

type Props = { params: Promise<{ org: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("nav"))("projects") };
}

export default async function ProjectsPage({ params }: Props) {
  const { org: slug } = await params;
  const { org, member } = await getOrgContext(slug);
  const today = nowInZone(org.timezone).date;

  const [projects, options, weekHours] = await Promise.all([
    getProjectsList(org, member.id),
    getProjectFormOptions(org.id),
    getMemberHours(org.id, weekStart(today), today),
  ]);

  return (
    <ProjectsView
      slug={org.slug}
      basePath={`/${org.slug}`}
      projects={projects}
      options={options}
      weekHours={weekHours}
      targetCents={targetHourlyRateCents(org)}
      currentMemberId={member.id}
      canEdit={hasRole(member.role, "partner")}
      today={today}
    />
  );
}
