import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { RemittanceEditor } from "@/components/collections/remittance-editor";
import { nowInZone } from "@/lib/clock";
import { idSchema } from "@/server/action-utils";
import { getRemittanceRecord, loadRemittanceEditor } from "@/server/collections/queries";
import { getOrgContext, hasRole } from "@/server/session";
import { newRemittanceParamsSchema } from "../schema";

// Tipado a mano (y no con PageProps) para no depender de los tipos de rutas generados.
type Props = {
  params: Promise<{ org: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: `${t("collections.editor.titleNew")} · ${t("collections.title")}` };
}

/**
 * Remesa nueva de un emisor para una fecha de cobro: sus facturas domiciliables, con las vencidas
 * preseleccionadas. El id se reserva aquí (y va en la URL), así que guardar dos veces no crea dos remesas.
 */
export default async function NewRemittancePage(props: Props) {
  const [{ org: slug }, searchParams] = await Promise.all([props.params, props.searchParams]);
  const { org, member } = await getOrgContext(slug);
  const base = `/${org.slug}/invoices/remittances`;
  const parsed = newRemittanceParamsSchema.safeParse({ issuer: searchParams.issuer, on: searchParams.on });
  if (!parsed.success) redirect(base);

  // El id de la remesa va en la URL: recargar la página o volver atrás no reserva otro.
  const rid = typeof searchParams.rid === "string" && idSchema.safeParse(searchParams.rid).success ? searchParams.rid : null;
  if (!rid) redirect(`${base}/new?issuer=${parsed.data.issuer}&on=${parsed.data.on}&rid=${randomUUID()}`);
  // Ya guardada: se sigue en su página.
  if (await getRemittanceRecord(org.id, rid)) redirect(`${base}/${rid}`);

  const data = await loadRemittanceEditor(
    org,
    { mode: "create", remittanceId: rid, issuerId: parsed.data.issuer, collectionOn: parsed.data.on },
    nowInZone(org.timezone).date,
  );
  if (!data) notFound();
  return <RemittanceEditor slug={org.slug} basePath={`/${org.slug}`} data={data} canEdit={hasRole(member.role, "partner")} />;
}
