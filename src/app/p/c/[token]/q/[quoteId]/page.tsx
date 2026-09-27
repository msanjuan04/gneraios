import type { Metadata } from "next";
import { headers } from "next/headers";
import { brand } from "@/brand";
import { LinkStatePage } from "@/components/portal/public/link-state";
import { negotiatePortalLocale } from "@/domain/portal";
import { PublicQuotePage } from "@/components/portal/public/quote-page";
import { idSchema } from "@/server/action-utils";
import { portalCopy } from "@/server/portal/copy";
import { getSpaceQuotePage } from "@/server/portal/pages";

// Tipado a mano: la ruta es nueva y los tipos de rutas de Next se regeneran con `next dev`/`next build`.
type Props = { params: Promise<{ token: string; quoteId: string }>; searchParams: Promise<{ done?: string | string[] }> };

export const dynamic = "force-dynamic";

async function load(params: Props["params"]) {
  const { token, quoteId } = await params;
  if (!idSchema.safeParse(quoteId).success) return { token, quoteId, page: null };
  return { token, quoteId, page: await getSpaceQuotePage(token, quoteId) };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { page } = await load(params);
  if (page?.status !== "ok") return { title: { absolute: brand.name } };
  const t = portalCopy(page.quote.locale);
  return { title: { absolute: `${t("quote.eyebrow", { number: page.quote.number })} · ${brand.name}` } };
}

/** /p/c/<token>/q/<id>: un presupuesto del cliente, abierto desde «Tu espacio». */
export default async function SpaceQuotePage({ params, searchParams }: Props) {
  const { token, quoteId, page } = await load(params);
  if (!page) return <LinkStatePage locale={negotiatePortalLocale((await headers()).get("accept-language"))} state="unknown" />;
  if (page.status !== "ok") return <LinkStatePage locale={page.locale} state={page.status} />;
  const { done } = await searchParams;
  return (
    <PublicQuotePage
      token={token}
      quote={page.quote}
      done={done === "accepted" || done === "rejected" ? done : null}
      pdfHref={`/api/public/c/${token}/quotes/${quoteId}`}
      backHref={`/p/c/${token}#documents`}
      footer={page.footer}
    />
  );
}
