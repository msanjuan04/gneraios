// Quién nos escribe: si es una persona o una máquina. Se usa para decidir si un correo de alguien
// desconocido merece abrir un lead. Estricto a propósito: es mejor perder un lead raro que llenar
// Leads de newsletters y avisos.

import { domainOf, normalizeAddress } from "./message";

/** Partes del correo que delatan un envío automático. */
export type SenderSignals = {
  from: string;
  /** Cabeceras en minúsculas, tal y como las deja el analizador de correo. */
  headers?: Readonly<Record<string, string | undefined>>;
  /** Asunto, por si el remitente es una persona pero el correo es un aviso («Factura disponible»). */
  subject?: string;
  /** Cuerpo en texto: una newsletter lleva casi siempre un pie para darse de baja. */
  bodyText?: string;
};

const AUTOMATED_LOCAL_PARTS = new Set([
  "noreply", "no-reply", "no_reply", "donotreply", "do-not-reply", "notifications", "notification", "notificaciones",
  "mailer-daemon", "postmaster", "bounce", "bounces", "alerts", "alertas", "newsletter", "news", "marketing",
  "billing", "facturacion", "facturas", "invoice", "invoices", "support", "soporte", "ayuda", "help", "hello",
  "team", "info-noreply", "automated", "system", "admin", "webmaster", "security", "seguridad", "updates",
]);

/**
 * Dominios de proveedores y entidades que nos escriben por sistema: nunca son un cliente nuevo.
 * Es una lista corta y revisable; lo que falte se corrige con el filtro de cabeceras.
 */
const PROVIDER_DOMAINS = new Set([
  "ionos.es", "ionos.com", "1und1.de", "google.com", "googlemail.com", "accounts.google.com", "youtube.com",
  "meta.com", "facebook.com", "facebookmail.com", "instagram.com", "linkedin.com", "mail.linkedin.com",
  "openai.com", "anthropic.com", "vercel.com", "supabase.io", "supabase.com", "github.com", "stripe.com",
  "paypal.com", "apple.com", "microsoft.com", "amazon.es", "amazon.com", "bbva.es", "bbva.com", "caixabank.es",
  "santander.es", "agenciatributaria.gob.es", "seg-social.es", "correos.es", "notion.so", "slack.com", "zoom.us",
  "calendly.com", "canva.com", "figma.com", "mailchimp.com", "sendgrid.net", "hubspot.com",
  "semrush.com", "ahrefs.com", "moz.com", "similarweb.com", "zapier.com", "typeform.com", "eventbrite.com",
  "booking.com", "airbnb.com", "tiktok.com", "x.com", "twitter.com", "pinterest.com", "whatsapp.com",
]);

/** Administraciones: lo que llega de ahí son avisos oficiales, nunca un cliente nuevo. */
const OFFICIAL = /(\.gob\.es|\.gov|\.gencat\.cat|\.europa\.eu|\.seg-social\.es)$/i;

/** Quien escribe en frío a todo el mundo suele firmar desde estos buzones. */
const COLD_OUTREACH_LOCAL = /^(comercial|ventas|marketing|sales|press|prensa|publicidad|promociones|ofertas|rrhh|hr)\d*$/;

/** El pie de toda newsletter: «darse de baja», «unsubscribe»… */
const BULK_FOOTER = /(unsubscribe|darse de baja|date de baja|cancelar (la )?suscripci|no desea(s)? recibir|ver (el )?(mensaje|correo) en (el )?navegador|view (this email )?in (your )?browser|dar-te de baixa|donar-vos de baixa)/i;

const BULK_PRECEDENCE = new Set(["bulk", "list", "junk"]);

/**
 * Cierto si el correo parece enviado por una máquina o una lista y no por una persona escribiendo
 * a nuestro buzón. Cualquiera de estas señales basta.
 */
export function isAutomatedSender(signals: SenderSignals): boolean {
  const address = normalizeAddress(signals.from);
  const at = address.lastIndexOf("@");
  if (at < 1) return true;
  const local = address.slice(0, at);
  const domain = domainOf(address) ?? "";

  if (AUTOMATED_LOCAL_PARTS.has(local) || /^(no-?reply|do-?not-?reply)/.test(local)) return true;
  if (isProviderDomain(domain) || OFFICIAL.test(domain)) return true;
  if (COLD_OUTREACH_LOCAL.test(local)) return true;
  if (signals.bodyText && BULK_FOOTER.test(signals.bodyText)) return true;

  const headers = signals.headers ?? {};
  // Las listas y newsletters traen estas cabeceras por obligación legal.
  if (headers["list-unsubscribe"] || headers["list-id"]) return true;
  const precedence = headers.precedence?.trim().toLowerCase();
  if (precedence && BULK_PRECEDENCE.has(precedence)) return true;
  const autoSubmitted = headers["auto-submitted"]?.trim().toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") return true;
  if (headers["x-auto-response-suppress"]) return true;
  return false;
}

/** El dominio o un subdominio suyo: `mail.linkedin.com` cuenta como `linkedin.com`. */
function isProviderDomain(domain: string): boolean {
  if (!domain) return false;
  const parts = domain.split(".");
  for (let i = 0; i < parts.length - 1; i++) {
    if (PROVIDER_DOMAINS.has(parts.slice(i).join("."))) return true;
  }
  return false;
}

/**
 * El nombre con el que se abre la ficha: el que viene en la cabecera («Nadia Pérez <…>») y, si no
 * hay, el de la dirección («nadia.perez@…» → «Nadia Perez»).
 */
export function leadNameFor(from: { name?: string; address: string }): string {
  const name = from.name?.trim().replace(/^["']|["']$/g, "");
  if (name && name.toLowerCase() !== normalizeAddress(from.address)) return name.slice(0, 200);
  const local = normalizeAddress(from.address).split("@")[0] ?? "";
  const words = local.split(/[._+-]+/).filter((word) => /[a-z]/i.test(word));
  if (words.length === 0) return from.address.slice(0, 200);
  return words.map((word) => word[0]!.toUpperCase() + word.slice(1)).join(" ").slice(0, 200);
}

/** El título de la oportunidad: el asunto sin «Re:» ni «Fwd:», o uno genérico si viene vacío. */
export function leadTitleFor(subject: string, fallback: string): string {
  const base = subject.replace(/^\s*((re|rv|fwd|fw|tr)\s*:\s*)+/i, "").trim();
  return (base || fallback).slice(0, 200);
}
