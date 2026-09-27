import { cookies } from "next/headers";
import { AppShell } from "@/components/app-shell/app-shell";
import { WelcomeVeil } from "@/components/brand/welcome";
import { WELCOME_COOKIE, WELCOME_NAME_MAX } from "@/lib/welcome";
import { getOrgContext } from "@/server/session";

export default async function OrgLayout({ children, params }: LayoutProps<"/[org]">) {
  const { org: slug } = await params;
  const { org, member, orgs } = await getOrgContext(slug);
  const store = await cookies();
  const sidebarOpen = store.get("sidebar_state")?.value !== "false";
  // Recién entrado con el código: la bienvenida de /login se disuelve sobre la app.
  const welcome = store.get(WELCOME_COOKIE)?.value;
  const welcomeName = welcome ? decodeURIComponent(welcome).slice(0, WELCOME_NAME_MAX) : null;

  return (
    <AppShell
      org={{ id: org.id, slug: org.slug, name: org.name }}
      member={{ fullName: member.fullName, initials: member.initials, role: member.role }}
      orgs={orgs.map((o) => ({ slug: o.slug, name: o.name }))}
      basePath={`/${org.slug}`}
      sidebarOpen={sidebarOpen}
    >
      {children}
      {welcomeName && <WelcomeVeil name={welcomeName} />}
    </AppShell>
  );
}
