import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { readSitesFilter } from "@/components/sites/filters";
import { SitesView } from "@/components/sites/sites-view";
import { idSchema } from "@/server/action-utils";
import { getOrgContext, hasRole } from "@/server/session";
import { getSitesPage } from "@/server/sites/queries";

// Tipado a mano: la ruta es nueva y los tipos de rutas de Next se regeneran con `next dev`/`next build`.
type Props = {
  params: Promise<{ org: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("nav"))("sites") };
}

/** Webs: uptime, certificados SSL y dominios de las webs de los clientes. */
export default async function SitesPage({ params, searchParams }: Props) {
  const [{ org: slug }, query] = await Promise.all([params, searchParams]);
  const { org, member } = await getOrgContext(slug);
  const data = await getSitesPage(org);
  const client = first(query.client);

  return (
    <SitesView
      slug={org.slug}
      basePath={`/${org.slug}`}
      data={data}
      canEdit={hasRole(member.role, "partner")}
      isOwner={hasRole(member.role, "owner")}
      initialFilter={readSitesFilter(first(query.filter))}
      openNew={first(query.new) === "1"}
      newClientId={client && idSchema.safeParse(client).success ? client : null}
    />
  );
}
