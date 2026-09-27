import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { getMyOrgs, getSessionUser } from "@/server/session";

// Accesos directos de la app instalada (manifest.ts): `/?go=calendar` abre esa sección de la última
// org usada. Solo secciones conocidas: nada de rutas arbitrarias.
const SHORTCUTS = new Set(["calendar", "pipeline", "invoices/new", "quotes/new", "projects/tasks"]);

/** Entrada: acepta invitaciones pendientes y lleva a la última org usada (o al onboarding). */
export default async function Home({ searchParams }: PageProps<"/">) {
  if (!isSupabaseConfigured()) redirect("/login");
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  await supabase.rpc("accept_pending_invitations");

  const orgs = await getMyOrgs();
  if (orgs.length === 0) redirect("/onboarding");

  const last = (await cookies()).get("last_org")?.value;
  const target = orgs.find((o) => o.slug === last) ?? orgs[0]!;
  const { go } = await searchParams;
  const section = typeof go === "string" && SHORTCUTS.has(go) ? `/${go}` : "";
  redirect(`/${target.slug}${section}`);
}
