import type { Metadata } from "next";
import { brand } from "@/brand";
import { LinkStatePage } from "@/components/portal/public/link-state";
import { PublicQuotePage } from "@/components/portal/public/quote-page";
import { portalCopy } from "@/server/portal/copy";
import { getQuoteLinkPage } from "@/server/portal/pages";

// Tipado a mano: la ruta es nueva y los tipos de rutas de Next se regeneran con `next dev`/`next build`.
type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string | string[] }> };

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const page = await getQuoteLinkPage(token);
  if (page.status !== "ok") return { title: { absolute: brand.name } };
  const t = portalCopy(page.quote.locale);
  return { title: { absolute: `${t("quote.eyebrow", { number: page.quote.number })} · ${brand.name}` } };
}

/** /p/q/<token>: un presupuesto para verlo, descargarlo y aceptarlo (o rechazarlo) online. */
export default async function QuoteLinkPage({ params, searchParams }: Props) {
  const { token } = await params;
  const page = await getQuoteLinkPage(token);
  if (page.status !== "ok") return <LinkStatePage locale={page.locale} state={page.status} />;
  const { done } = await searchParams;
  return (
    <PublicQuotePage
      token={token}
      quote={page.quote}
      done={done === "accepted" || done === "rejected" ? done : null}
      pdfHref={`/api/public/q/${token}/pdf`}
      footer={page.footer}
    />
  );
}
