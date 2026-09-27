"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { isPortalLocale, normalizeEmail, normalizeName, type PortalLocale, requestEvidence } from "@/domain/portal";
import { idSchema } from "@/server/action-utils";
import { acceptQuoteFromLink, type PortalFailure, rejectQuoteFromLink } from "./accept";
import type { PortalLink } from "./access";
import { portalCopy } from "./copy";
import { createPortalRequest } from "./requests";
import { isPortalToken } from "./token";

/**
 * Acciones de las páginas públicas (/p/**). No hay sesión: cada una vuelve a validar el token
 * desde cero (hash → enlace vivo en la base de datos), cuenta el intento para el límite y solo
 * actúa sobre lo que ese enlace cubre. Los mensajes salen en el idioma del cliente. Funcionan
 * también sin JavaScript (formularios con acción de servidor).
 */

export type AcceptField = "name" | "email" | "consent" | "signature";

export type AcceptFormState =
  | { status: "idle" }
  | { status: "error"; message: string | null; fields: Partial<Record<AcceptField, string>>; values: { name: string; email: string; signature: string } };

export type RejectFormState = { status: "idle" } | { status: "error"; message: string; reason: string };

export type RequestFormState =
  | { status: "idle" }
  | { status: "sent" }
  | { status: "error"; message: string | null; fields: Partial<Record<"subject" | "description", string>>; values: { subject: string; description: string; urgent: boolean } };

const text = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
};

function localeOf(form: FormData): PortalLocale {
  const value = text(form, "locale");
  return isPortalLocale(value) ? value : "es";
}

const FAILURE_KEYS = {
  rate_limited: "quote.errors.rateLimited",
  changed: "quote.errors.changed",
  expired: "quote.errors.expired",
  closed: "quote.errors.closed",
  link: "quote.errors.link",
  unavailable: "quote.errors.unavailable",
  generic: "quote.errors.generic",
} as const satisfies Record<PortalFailure, string>;

/** Adónde vuelve el cliente: la página del presupuesto de ese enlace (nunca una URL que llegue del formulario). */
function quotePath(token: string, link: PortalLink, quoteId: string): string {
  return link.kind === "quote" ? `/p/q/${token}` : `/p/c/${token}/q/${quoteId}`;
}

const emailSchema = z.email().max(254);

/** Un fallo inesperado (red, base de datos) no rompe la página: sale como error genérico. */
async function attempt<T>(what: string, run: () => Promise<T>): Promise<T | { ok: false; error: "generic" }> {
  try {
    return await run();
  } catch (error) {
    console.error(`[portal] ${what}`, error);
    return { ok: false, error: "generic" };
  }
}

export async function acceptQuoteAction(_prev: AcceptFormState, form: FormData): Promise<AcceptFormState> {
  const locale = localeOf(form);
  const t = portalCopy(locale);
  const values = { name: normalizeName(text(form, "name")), email: normalizeEmail(text(form, "email")), signature: normalizeName(text(form, "signature")) };
  const token = text(form, "token");
  const quoteId = idSchema.safeParse(text(form, "quote_id"));
  const version = text(form, "version");
  if (!isPortalToken(token) || !quoteId.success || !version || version.length > 64) {
    return { status: "error", message: t("quote.errors.link"), fields: {}, values };
  }

  const fields: Partial<Record<AcceptField, string>> = {};
  if (values.name.length < 1 || values.name.length > 120) fields.name = t("quote.errors.name");
  if (!emailSchema.safeParse(values.email).success) fields.email = t("quote.errors.email");
  if (values.signature.length > 120) fields.signature = t("quote.errors.signature");
  if (text(form, "consent") !== "yes") fields.consent = t("quote.errors.consent");
  if (Object.keys(fields).length > 0) return { status: "error", message: null, fields, values };

  const requestHeaders = await headers();
  const outcome = await attempt("aceptar", () =>
    acceptQuoteFromLink({
      token,
      quoteId: quoteId.data,
      version,
      signerName: values.name,
      signerEmail: values.email,
      signature: values.signature || null,
      request: requestEvidence((name) => requestHeaders.get(name)),
    }),
  );
  if (!outcome.ok) return { status: "error", message: t(FAILURE_KEYS[outcome.error]), fields: {}, values };
  redirect(`${quotePath(token, outcome.link, quoteId.data)}?done=accepted`);
}

export async function rejectQuoteAction(_prev: RejectFormState, form: FormData): Promise<RejectFormState> {
  const t = portalCopy(localeOf(form));
  const reason = text(form, "reason").trim();
  const token = text(form, "token");
  const quoteId = idSchema.safeParse(text(form, "quote_id"));
  if (!isPortalToken(token) || !quoteId.success) return { status: "error", message: t("quote.errors.link"), reason };
  if (reason.length > 500) return { status: "error", message: t("quote.errors.reason"), reason };
  const outcome = await attempt("rechazar", () => rejectQuoteFromLink({ token, quoteId: quoteId.data, reason: reason || null }));
  if (!outcome.ok) return { status: "error", message: t(FAILURE_KEYS[outcome.error]), reason };
  redirect(`${quotePath(token, outcome.link, quoteId.data)}?done=rejected`);
}

export async function sendRequestAction(_prev: RequestFormState, form: FormData): Promise<RequestFormState> {
  const t = portalCopy(localeOf(form));
  const values = { subject: text(form, "subject").trim(), description: text(form, "description").trim(), urgent: text(form, "urgent") === "yes" };
  const token = text(form, "token");
  if (!isPortalToken(token)) return { status: "error", message: t("quote.errors.link"), fields: {}, values };
  const fields: Partial<Record<"subject" | "description", string>> = {};
  if (values.subject.length < 1 || values.subject.length > 200) fields.subject = t("space.sections.requests.errors.subject");
  if (values.description.length < 1 || values.description.length > 5000) fields.description = t("space.sections.requests.errors.description");
  if (Object.keys(fields).length > 0) return { status: "error", message: null, fields, values };

  const outcome = await attempt("pedir algo", () => createPortalRequest({ token, ...values }));
  if (outcome.ok) return { status: "sent" };
  const message =
    outcome.error === "rate_limited"
      ? t("space.sections.requests.errors.rateLimited")
      : outcome.error === "link"
        ? t("quote.errors.link")
        : outcome.error === "unavailable"
          ? t("quote.errors.unavailable")
          : t("space.sections.requests.errors.generic");
  return { status: "error", message, fields: {}, values };
}
