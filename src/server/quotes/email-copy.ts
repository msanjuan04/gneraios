// Textos del email de un presupuesto, en el idioma del presupuesto (que es el del cliente). El
// español vive en src/i18n/messages/es/quotes.json (quotes.email), como el resto de la UI; el
// catalán y el inglés, aquí, con la misma forma. Solo texto plano: es lo que el socio revisa y
// retoca antes de enviar. Sin el número: en un borrador aún no lo tiene (va en el PDF adjunto).

import { createTranslator } from "next-intl";
import type { CivilDate } from "@/domain/dates/civil-date";
import { formatMoney } from "@/domain/money";
import es from "@/i18n/messages/es/quotes.json";

export type QuoteEmailLocale = "es" | "ca" | "en";

type QuoteEmailCopy = (typeof es)["quotes"]["email"];

const ca: QuoteEmailCopy = {
  subject: "Pressupost: {title} · {issuer}",
  body: "Hola,\n\nUs enviem el pressupost «{title}». El trobareu adjunt en PDF.\n\n{summary}\n\nÉs vàlid fins al {validUntil}. Si us encaixa, responeu aquest correu i el posem en marxa.\n\nGràcies,\n{issuer}",
  oneOff: "Pagament únic: {amount}",
  monthly: "Quota mensual: {amount}/mes",
  yearly: "Quota anual: {amount}/any",
  usage: "Serveis per ús: segons consum, als preus indicats",
  vatIncluded: "Imports amb IVA inclòs.",
};

const en: QuoteEmailCopy = {
  subject: "Quote: {title} · {issuer}",
  body: "Hello,\n\nPlease find attached our quote “{title}” in PDF.\n\n{summary}\n\nIt is valid until {validUntil}. If it works for you, just reply to this email and we will get started.\n\nThank you,\n{issuer}",
  oneOff: "One-off payment: {amount}",
  monthly: "Monthly fee: {amount}/month",
  yearly: "Yearly fee: {amount}/year",
  usage: "Usage-based services: as used, at the prices shown",
  vatIncluded: "Amounts include VAT.",
};

const CATALOGS: Record<QuoteEmailLocale, QuoteEmailCopy> = { es: es.quotes.email, ca, en };
const MONEY_LOCALE: Record<QuoteEmailLocale, string> = { es: "es-ES", ca: "ca-ES", en: "en-IE" };

export type QuoteEmailParams = {
  title: string;
  issuerName: string;
  validUntil: CivilDate;
  /** Totales con IVA de cada tipo (null si no hay líneas de ese tipo). */
  oneOffCents: number | null;
  monthlyCents: number | null;
  yearlyCents: number | null;
  hasUsage: boolean;
};

const dmy = (date: CivilDate) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;

/** Asunto y cuerpo del email, listos para revisar. */
export function renderQuoteEmail(locale: QuoteEmailLocale, p: QuoteEmailParams): { subject: string; body: string } {
  const t = createTranslator({ locale, messages: { email: CATALOGS[locale] }, namespace: "email" });
  const money = (cents: number) => formatMoney(cents, { locale: MONEY_LOCALE[locale] });
  const summary = [
    p.oneOffCents !== null ? t("oneOff", { amount: money(p.oneOffCents) }) : null,
    p.monthlyCents !== null ? t("monthly", { amount: money(p.monthlyCents) }) : null,
    p.yearlyCents !== null ? t("yearly", { amount: money(p.yearlyCents) }) : null,
    p.hasUsage ? t("usage") : null,
  ]
    .filter((line): line is string => line !== null)
    .map((line) => `– ${line}`);
  if (summary.length > 0) summary.push(t("vatIncluded"));
  const values = { title: p.title, issuer: p.issuerName, validUntil: dmy(p.validUntil), summary: summary.join("\n") };
  return { subject: t("subject", values), body: t("body", values) };
}
