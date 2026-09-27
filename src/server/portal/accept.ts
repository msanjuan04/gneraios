import "server-only";
import type { PostgrestError } from "@supabase/supabase-js";
import type { PortalLocale, RequestEvidence } from "@/domain/portal";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import { renderQuotePdf } from "@/pdf";
import { type Db, DbError } from "@/server/billing/context";
import { pushSoon } from "@/server/push/soon";
import { acceptQuoteFlow } from "@/server/quotes/accept";
import { allowPortalAction, resolvePortalLink, type PortalLink } from "./access";
import { portalCopy } from "./copy";
import { loadPublicQuote, type PublicQuote } from "./quote";
import { sha256Hex } from "./token";

/**
 * Aceptar o rechazar un presupuesto desde un enlace (el suyo o el portal del cliente).
 *
 * Aceptar es el mismo flujo en un clic que «Marcar aceptado» (acceptQuoteFlow: accept_quote y,
 * si el primer pago es a la aceptación, billMilestone), ejecutado en el servidor con la clave
 * secreta y con la autoridad del socio que compartió el enlace: las dos RPC de socio que usa ese
 * flujo pasan por sus gemelas portal_*, que vuelven a validar el enlace, guardan la evidencia en
 * la misma transacción y comprueban el rol del socio como siempre. Antes, el PDF de la versión que
 * vio el cliente se genera, se guarda tal cual en Storage y su SHA-256 va a la evidencia.
 */

export const ACCEPTANCE_BUCKET = "quote-acceptances";

export type PortalFailure = "rate_limited" | "changed" | "expired" | "closed" | "link" | "unavailable" | "generic";

export type AcceptOutcome = { ok: true; signerName: string; already: boolean; link: PortalLink } | { ok: false; error: PortalFailure };
export type RejectOutcome = { ok: true; link: PortalLink } | { ok: false; error: PortalFailure };

/** Qué ve el cliente para cada error esperado de las RPC portal_* (el hint de Postgres). */
function failureOf(error: Pick<PostgrestError, "hint" | "code">): PortalFailure | "accepted" {
  switch (error.hint) {
    case "quote_already_accepted":
      return "accepted";
    case "portal_quote_changed":
      return "changed";
    case "portal_quote_expired":
      return "expired";
    case "portal_quote_closed":
    case "quote_frozen":
    case "quote_not_sent":
      return "closed";
    case "portal_link_invalid":
    case "portal_quote_not_found":
      return "link";
    default:
      // El socio que compartió el enlace ya no es socio, o un dato que impide aceptar
      // (fechas de las líneas, plan de pagos…): lo tiene que resolver el equipo.
      return error.code === "42501" || error.code === "P0001" ? "unavailable" : "generic";
  }
}

/**
 * Db con la clave de servidor para el flujo de aceptación: las lecturas van directas (y el
 * flujo filtra por la org) y las dos RPC de socio que usa se ejecutan a través de sus gemelas
 * portal_*, con el hash del enlace. Cualquier otra RPC está prohibida.
 */
function linkIssuerDb(admin: Db, tokenHash: string, acceptance: { version: string; evidence: Json }): Db {
  const rpc = (fn: string, args?: Record<string, unknown>) => {
    if (fn === "accept_quote") {
      return admin.rpc("portal_accept_quote", {
        p_token_hash: tokenHash,
        p_quote_id: String(args?.p_quote_id ?? ""),
        p_version: acceptance.version,
        p_evidence: acceptance.evidence,
      });
    }
    if (fn === "save_invoice_draft") {
      return admin.rpc("portal_save_invoice_draft", { p_token_hash: tokenHash, p: (args?.p ?? {}) as Json });
    }
    throw new Error(`[portal] RPC no permitida desde un enlace público: ${fn}`);
  };
  return new Proxy(admin, {
    get(target, prop) {
      if (prop === "rpc") return rpc;
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function openQuote(admin: Db, token: string, quoteId: string): Promise<{ link: PortalLink; quote: PublicQuote } | PortalFailure> {
  const resolved = await resolvePortalLink(token, { admin });
  if (resolved.status !== "active") return "link";
  if (!(await allowPortalAction(admin, resolved.link.tokenHash, "quote"))) return "rate_limited";
  const quote = await loadPublicQuote(admin, resolved.link, quoteId);
  if (!quote) return "link";
  return { link: resolved.link, quote };
}

export async function acceptQuoteFromLink(input: {
  token: string;
  quoteId: string;
  version: string;
  signerName: string;
  signerEmail: string;
  signature: string | null;
  request: RequestEvidence;
}): Promise<AcceptOutcome> {
  const admin = createAdminClient();
  const opened = await openQuote(admin, input.token, input.quoteId);
  if (typeof opened === "string") return { ok: false, error: opened };
  const { link, quote } = opened;

  if (quote.state === "accepted") return { ok: true, signerName: quote.acceptance?.signerName ?? input.signerName, already: true, link };
  if (quote.state === "expired") return { ok: false, error: "expired" };
  if (quote.state !== "open") return { ok: false, error: "closed" };
  if (quote.version !== input.version) return { ok: false, error: "changed" };

  // El PDF exacto que se acepta: su huella va a la evidencia y la copia, a Storage.
  const pdf = await renderQuotePdf(quote.loaded.document);
  const pdfSha256 = sha256Hex(pdf);
  const pdfPath = `${link.orgId}/${quote.quoteId}/${pdfSha256}.pdf`;
  const upload = await admin.storage.from(ACCEPTANCE_BUCKET).upload(pdfPath, pdf, { contentType: "application/pdf", upsert: true });
  if (upload.error) console.error("[portal] copia del presupuesto aceptado", upload.error);

  const locale: PortalLocale = quote.locale;
  const evidence: Json = {
    signer_name: input.signerName,
    signer_email: input.signerEmail,
    signature: input.signature,
    consent_text: portalCopy(locale)("quote.accept.consent", { number: quote.number }),
    locale,
    ip_address: input.request.ipAddress,
    forwarded_for: input.request.forwardedFor,
    user_agent: input.request.userAgent,
    pdf_sha256: pdfSha256,
    pdf_path: upload.error ? null : pdfPath,
  };

  try {
    const result = await acceptQuoteFlow(linkIssuerDb(admin, link.tokenHash, { version: quote.version, evidence }), link.orgId, quote.quoteId, quote.loaded.today);
    // El contrato ya existe: si el borrador del primer hito no se ha podido preparar, el cron
    // del día siguiente lo completa (el hito nace automático y con fecha de hoy).
    if (result.billingErrorKey) console.warn(`[portal] borrador del primer hito pendiente (${result.billingErrorKey})`, quote.quoteId);
    // El aviso a los socios sale ya al móvil.
    pushSoon(link.orgId);
    return { ok: true, signerName: input.signerName, already: false, link };
  } catch (error) {
    if (!upload.error) await admin.storage.from(ACCEPTANCE_BUCKET).remove([pdfPath]);
    if (error instanceof DbError) {
      const failure = failureOf(error.error);
      if (failure === "accepted") {
        // Doble envío (o lo aceptó otra persona a la vez): el aceptado ya está, con su evidencia.
        const again = await loadPublicQuote(admin, link, quote.quoteId);
        return { ok: true, signerName: again?.acceptance?.signerName ?? input.signerName, already: true, link };
      }
      if (failure === "generic" || failure === "unavailable") console.error(`[portal] ${error.where}`, error.error);
      return { ok: false, error: failure };
    }
    console.error("[portal] aceptar", error);
    return { ok: false, error: "generic" };
  }
}

export async function rejectQuoteFromLink(input: { token: string; quoteId: string; reason: string | null }): Promise<RejectOutcome> {
  const admin = createAdminClient();
  const opened = await openQuote(admin, input.token, input.quoteId);
  if (typeof opened === "string") return { ok: false, error: opened };
  const { link, quote } = opened;
  if (quote.state === "rejected") return { ok: true, link };
  if (quote.state === "expired") return { ok: false, error: "expired" };
  if (quote.state !== "open") return { ok: false, error: "closed" };

  const { error } = await admin.rpc("portal_reject_quote", { p_token_hash: link.tokenHash, p_quote_id: quote.quoteId, p_reason: input.reason ?? undefined });
  if (!error) {
    pushSoon(link.orgId);
    return { ok: true, link };
  }
  const failure = failureOf(error);
  if (failure === "accepted") return { ok: false, error: "closed" };
  if (failure === "generic" || failure === "unavailable") console.error("[portal] rechazar", error);
  return { ok: false, error: failure };
}
