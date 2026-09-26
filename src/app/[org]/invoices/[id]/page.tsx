import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { readOrgSettings } from "@/app/[org]/settings/schema";
import { InvoiceEditor } from "@/components/invoices/invoice-editor";
import { InvoiceView } from "@/components/invoices/invoice-view";
import { nowInZone } from "@/lib/clock";
import { getInvoiceRecord, loadDraftEditor, loadInvoiceView } from "@/server/invoices/detail";
import { getOrgContext, hasRole } from "@/server/session";

// Tipado a mano (y no con PageProps) para no depender de los tipos de rutas generados.
type Props = { params: Promise<{ org: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { org: slug, id } = await params;
  const { org } = await getOrgContext(slug);
  const record = await getInvoiceRecord(org.id, id);
  const t = await getTranslations();
  if (!record) return { title: t("nav.invoices") };
  const name = record.row.number ?? t("invoices.editor.titleDraft");
  const client = record.overview.client_name;
  return { title: [name, client, t("nav.invoices")].filter(Boolean).join(" · ") };
}

/** Una factura: el editor mientras es borrador; lo emitido, de solo lectura con cobros, emails y rectificativas. */
export default async function InvoicePage({ params }: Props) {
  const { org: slug, id } = await params;
  const { org, member } = await getOrgContext(slug);
  const record = await getInvoiceRecord(org.id, id);
  if (!record) notFound();

  const today = nowInZone(org.timezone).date;
  const canEdit = hasRole(member.role, "partner");
  const basePath = `/${org.slug}`;

  if (record.row.lifecycle === "draft") {
    const data = await loadDraftEditor(org, record, {
      today,
      orgPaymentTermsDays: readOrgSettings(org.settings).payment_terms_days,
    });
    return <InvoiceEditor key={record.row.id} slug={org.slug} basePath={basePath} today={today} canEdit={canEdit} data={data} />;
  }

  const invoice = await loadInvoiceView(record);
  return (
    <InvoiceView
      key={record.row.id}
      slug={org.slug}
      basePath={basePath}
      today={today}
      timeZone={org.timezone}
      canEdit={canEdit}
      invoice={invoice}
    />
  );
}
