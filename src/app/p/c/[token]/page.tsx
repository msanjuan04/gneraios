import type { Metadata } from "next";
import { brand } from "@/brand";
import { LinkStatePage } from "@/components/portal/public/link-state";
import { PortalShell } from "@/components/portal/public/shell";
import { SpaceHero, SpaceNav } from "@/components/portal/public/space/hero";
import { SpaceSections } from "@/components/portal/public/space/sections";
import { portalCopy } from "@/server/portal/copy";
import { getSpacePage } from "@/server/portal/pages";

// Tipado a mano: la ruta es nueva y los tipos de rutas de Next se regeneran con `next dev`/`next build`.
type Props = { params: Promise<{ token: string }> };

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const page = await getSpacePage(token);
  if (page.status !== "ok") return { title: { absolute: brand.name } };
  return { title: { absolute: `${portalCopy(page.space.locale)("brand.space", { brand: brand.name })} · ${page.space.clientName}` } };
}

/** /p/c/<token>: «Tu espacio GNERAI», el portal del cliente. */
export default async function ClientSpacePage({ params }: Props) {
  const { token } = await params;
  const page = await getSpacePage(token);
  if (page.status !== "ok") return <LinkStatePage locale={page.locale} state={page.status} />;
  const { space } = page;
  return (
    <PortalShell locale={space.locale} footer={space.footer} hero={<SpaceHero data={space} />}>
      <SpaceNav data={space} />
      <SpaceSections data={space} token={token} />
    </PortalShell>
  );
}
