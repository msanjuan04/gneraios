// Emails de seguridad de la entrada con código (sin "server-only": se prueban con Vitest). En el
// idioma del socio: "¿eres tú?" al usar el código en un dispositivo nuevo, y el aviso de que su
// código ha cambiado (lo cambie él o se lo cambie otro socio).

import { createTranslator } from "next-intl";
import { brand } from "@/brand";
import caEmails from "@/i18n/messages/ca/emails.json";
import enEmails from "@/i18n/messages/en/emails.json";
import esEmails from "@/i18n/messages/es/emails.json";
import { deepMerge, type Messages } from "@/i18n/messages/merge";

export type SecurityEmailLocale = "es" | "ca" | "en";
export type RenderedSecurityEmail = { subject: string; text: string; html: string };

const INTL: Record<SecurityEmailLocale, string> = { es: "es-ES", ca: "ca-ES", en: "en-IE" };
const CATALOGS: Record<SecurityEmailLocale, Messages> = {
  es: esEmails as Messages,
  ca: deepMerge(esEmails as Messages, caEmails as Messages),
  en: deepMerge(esEmails as Messages, enEmails as Messages),
};

type Loose = (key: string, values?: Record<string, string | number>) => string;

export function securityLocale(value: unknown): SecurityEmailLocale {
  return value === "ca" || value === "en" ? value : "es";
}

function translator(locale: SecurityEmailLocale): Loose {
  const t = createTranslator({ locale, messages: CATALOGS[locale] }) as unknown as Loose;
  return (key, values) => t(`emails.security.${key}`, { app: brand.product, ...values });
}

const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** HTML sencillo con la marca: párrafos y, si hay, un botón. */
function layout(paragraphs: string[], button?: { label: string; url: string }, footnote?: string): string {
  const p = (text: string) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#04060a">${escape(text)}</p>`;
  const cta = button
    ? `<p style="margin:24px 0"><a href="${escape(button.url)}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:${brand.palette.blue};color:#ffffff;font-weight:700;font-size:15px;text-decoration:none">${escape(button.label)}</a></p>`
    : "";
  const note = footnote ? `<p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#5b6270">${escape(footnote)}</p>` : "";
  return `<!doctype html><html><body style="margin:0;padding:32px 16px;background:#f5f6f8;font-family:${brand.fontFamily},-apple-system,Segoe UI,Roboto,sans-serif"><div style="max-width:520px;margin:0 auto;padding:32px;border-radius:16px;background:#ffffff"><p style="margin:0 0 24px;font-size:13px;font-weight:800;letter-spacing:.08em;color:${brand.palette.blueDeep}">${escape(brand.product)}</p>${paragraphs.map(p).join("")}${cta}${note}</div></body></html>`;
}

/** "Alguien ha escrito tu código en un dispositivo nuevo: ¿eres tú?" */
export function renderDeviceEmail(
  locale: SecurityEmailLocale,
  p: { name: string; device: string; at: Date; timeZone: string; url: string; minutes: number },
): RenderedSecurityEmail {
  const t = translator(locale);
  const when = new Intl.DateTimeFormat(INTL[locale], { dateStyle: "long", timeStyle: "short", timeZone: p.timeZone }).format(p.at);
  const hello = t("hello", { name: p.name });
  const body = t("deviceBody", { device: p.device, when });
  const confirm = t("deviceConfirm", { minutes: p.minutes });
  const notYou = t("deviceNotYou");
  return {
    subject: t("deviceSubject", { device: p.device }),
    text: [hello, "", body, "", `${confirm} ${p.url}`, "", notYou].join("\n"),
    html: layout([hello, body, confirm], { label: t("deviceButton"), url: p.url }, notYou),
  };
}

/** "Tu código ha cambiado": lo ha creado o cambiado el propio socio, o otro socio (`by`). */
export function renderCodeChangedEmail(
  locale: SecurityEmailLocale,
  p: { name: string; by: string | null; hadCode: boolean },
): RenderedSecurityEmail {
  const t = translator(locale);
  const hello = t("hello", { name: p.name });
  const what = p.by
    ? t(p.hadCode ? "codeByChanged" : "codeByNew", { by: p.by })
    : t(p.hadCode ? "codeSelfChanged" : "codeSelfNew");
  const notYou = t("codeNotYou");
  return {
    subject: t("codeSubject"),
    text: [hello, "", what, "", notYou].join("\n"),
    html: layout([hello, what], undefined, notYou),
  };
}
