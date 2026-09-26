import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { readOrgSettings } from "@/app/[org]/settings/schema";
import { InvoiceEditor } from "@/components/invoices/invoice-editor";
import { nowInZone } from "@/lib/clock";
import { idSchema } from "@/server/action-utils";
import { loadDraftEditor } from "@/server/invoices/detail";
import { getOrgContext, hasRole } from "@/server/session";

const param = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

// Tipado a mano (y no con PageProps) para no depender de los tipos de rutas generados.
type Props = {
  params: Promise<{ org: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: `${t("invoices.editor.titleNew")} · ${t("nav.invoices")}` };
}

/**
 * Factura manual (sin contrato): la vía de escape. Se escribe entera aquí y se crea como
 * borrador al guardar; cada línea lleva su tipo de facturación. `?client=<id>` la prepara para un cliente.
 */
export default async function NewInvoicePage(props: Props) {
  const [{ org: slug }, searchParams] = await Promise.all([props.params, props.searchParams]);
  const { org, member } = await getOrgContext(slug);
  const clientParam = param(searchParams.client);
  const today = nowInZone(org.timezone).date;

  const data = await loadDraftEditor(org, null, {
    today,
    orgPaymentTermsDays: readOrgSettings(org.settings).payment_terms_days,
    clientId: clientParam && idSchema.safeParse(clientParam).success ? clientParam : null,
  });

  return (
    <InvoiceEditor
      key={clientParam ?? "new"}
      slug={org.slug}
      basePath={`/${org.slug}`}
      today={today}
      canEdit={hasRole(member.role, "partner")}
      data={data}
    />
  );
}
