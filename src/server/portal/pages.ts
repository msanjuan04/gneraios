import "server-only";
import { headers } from "next/headers";
import { cache } from "react";
import type { SpaceData } from "@/components/portal/types";
import { isPortalLocale, negotiatePortalLocale, type PortalLocale } from "@/domain/portal";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Db } from "@/server/billing/context";
import { type PortalLink, resolvePortalLink } from "./access";
import { loadPublicQuote, type PublicQuote } from "./quote";
import { loadClientSpace } from "./space";

/**
 * Lo que cargan las páginas públicas, una vez por petición (los metadatos y la página comparten
 * el resultado con `cache`, así que una visita cuenta una sola vez).
 */

export type Unavailable = { status: "unknown" | "expired" | "revoked"; locale: PortalLocale };
export type QuotePageData = { status: "ok"; link: PortalLink; quote: PublicQuote; footer: { issuers: string[]; email: string | null } };
export type SpacePageData = { status: "ok"; link: PortalLink; space: SpaceData };

/** El idioma de quien llega sin un enlace válido: el de su navegador. */
async function browserLocale(): Promise<PortalLocale> {
  return negotiatePortalLocale((await headers()).get("accept-language"));
}

/** El idioma del destino de un enlace que ya no sirve (sin enseñar nada más de él). */
async function targetLocale(admin: Db, link: PortalLink): Promise<PortalLocale> {
  if (link.kind === "quote" && link.quoteId) {
    const { data } = await admin.from("quotes").select("language").eq("org_id", link.orgId).eq("id", link.quoteId).maybeSingle();
    if (isPortalLocale(data?.language)) return data.language;
  }
  if (link.clientId) {
    const { data } = await admin.from("clients").select("preferred_language").eq("org_id", link.orgId).eq("id", link.clientId).maybeSingle();
    if (isPortalLocale(data?.preferred_language)) return data.preferred_language;
  }
  return browserLocale();
}

function quoteFooter(quote: PublicQuote): QuotePageData["footer"] {
  return { issuers: [quote.view.issuer.name], email: quote.issuerEmail };
}

/** /p/q/<token>: el presupuesto de un enlace de presupuesto (cuenta la visita). */
export const getQuoteLinkPage = cache(async (token: string): Promise<QuotePageData | Unavailable> => {
  const admin = createAdminClient();
  const resolved = await resolvePortalLink(token, { track: true, admin });
  if (resolved.status === "unknown") return { status: "unknown", locale: await browserLocale() };
  if (resolved.status !== "active") return { status: resolved.status, locale: await targetLocale(admin, resolved.link) };
  const { link } = resolved;
  if (link.kind !== "quote" || !link.quoteId) return { status: "unknown", locale: await browserLocale() };
  const quote = await loadPublicQuote(admin, link, link.quoteId);
  if (!quote) return { status: "unknown", locale: await targetLocale(admin, link) };
  return { status: "ok", link, quote, footer: quoteFooter(quote) };
});

/** /p/c/<token>: «Tu espacio» (cuenta la visita). */
export const getSpacePage = cache(async (token: string): Promise<SpacePageData | Unavailable> => {
  const admin = createAdminClient();
  const resolved = await resolvePortalLink(token, { track: true, admin });
  if (resolved.status === "unknown") return { status: "unknown", locale: await browserLocale() };
  if (resolved.status !== "active") return { status: resolved.status, locale: await targetLocale(admin, resolved.link) };
  const { link } = resolved;
  if (link.kind !== "client") return { status: "unknown", locale: await browserLocale() };
  const space = await loadClientSpace(admin, link);
  if (!space) return { status: "unknown", locale: await browserLocale() };
  return { status: "ok", link, space };
});

/** /p/c/<token>/q/<id>: un presupuesto del cliente desde su portal (no cuenta como visita). */
export const getSpaceQuotePage = cache(async (token: string, quoteId: string): Promise<QuotePageData | Unavailable> => {
  const admin = createAdminClient();
  const resolved = await resolvePortalLink(token, { admin });
  if (resolved.status === "unknown") return { status: "unknown", locale: await browserLocale() };
  if (resolved.status !== "active") return { status: resolved.status, locale: await targetLocale(admin, resolved.link) };
  const { link } = resolved;
  if (link.kind !== "client") return { status: "unknown", locale: await browserLocale() };
  const quote = await loadPublicQuote(admin, link, quoteId);
  if (!quote) return { status: "unknown", locale: await targetLocale(admin, link) };
  return { status: "ok", link, quote, footer: quoteFooter(quote) };
});
