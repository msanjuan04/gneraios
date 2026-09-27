import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { RemittanceEditor } from "@/components/collections/remittance-editor";
import { RemittanceView } from "@/components/collections/remittance-view";
import { nowInZone } from "@/lib/clock";
import { getRemittanceRecord, loadRemittanceEditor, loadRemittanceView } from "@/server/collections/queries";
import { getOrgContext, hasRole } from "@/server/session";

// Tipado a mano (y no con PageProps) para no depender de los tipos de rutas generados.
type Props = { params: Promise<{ org: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { org: slug, id } = await params;
  const { org } = await getOrgContext(slug);
  const record = await getRemittanceRecord(org.id, id);
  const t = await getTranslations();
  if (!record) return { title: t("collections.title") };
  const format = await getFormatter();
  const day = format.dateTime(new Date(`${record.collection_on}T12:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });
  return { title: `${t("collections.view.title", { date: day })} · ${t("collections.title")}` };
}

/** Una remesa: la selección de facturas mientras es borrador; con su fichero, el envío, el cobro y las devoluciones. */
export default async function RemittancePage({ params }: Props) {
  const { org: slug, id } = await params;
  const { org, member } = await getOrgContext(slug);
  const record = await getRemittanceRecord(org.id, id);
  if (!record) notFound();

  const today = nowInZone(org.timezone).date;
  const canEdit = hasRole(member.role, "partner");
  const basePath = `/${org.slug}`;

  if (record.status === "draft") {
    const data = await loadRemittanceEditor(org, { mode: "edit", remittance: record }, today);
    if (!data) notFound();
    return <RemittanceEditor key={`${record.id}:${record.updated_at}`} slug={org.slug} basePath={basePath} data={data} canEdit={canEdit} />;
  }

  const data = await loadRemittanceView(org, record, today);
  return <RemittanceView key={record.id} slug={org.slug} basePath={basePath} timeZone={org.timezone} data={data} canEdit={canEdit} />;
}
