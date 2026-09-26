import { cookies } from "next/headers";
import { AppShell } from "@/components/app-shell/app-shell";
import { getOrgContext } from "@/server/session";

export default async function OrgLayout({ children, params }: LayoutProps<"/[org]">) {
  const { org: slug } = await params;
  const { org, member, orgs } = await getOrgContext(slug);
  const sidebarOpen = (await cookies()).get("sidebar_state")?.value !== "false";

  return (
    <AppShell
      org={{ id: org.id, slug: org.slug, name: org.name }}
      member={{ fullName: member.fullName, initials: member.initials, role: member.role }}
      orgs={orgs.map((o) => ({ slug: o.slug, name: o.name }))}
      basePath={`/${org.slug}`}
      sidebarOpen={sidebarOpen}
    >
      {children}
    </AppShell>
  );
}
