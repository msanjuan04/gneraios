// Textos de los emails de facturación, en el idioma del cliente (es/ca/en). Solo texto plano:
// es lo que mejor llega y lo que el socio puede revisar y retocar antes de enviar.

import { createTranslator } from "next-intl";
import type { CivilDate } from "@/domain/dates/civil-date";
import { formatMoney } from "@/domain/money";
import { formatIban } from "@/domain/tax-id";
import ca from "@/i18n/messages/ca/emails.json";
import en from "@/i18n/messages/en/emails.json";
import es from "@/i18n/messages/es/emails.json";

export type EmailLocale = "es" | "ca" | "en";
export type EmailTemplate = "invoice" | "payment_reminder";
export type PaymentMethod = "transfer" | "sepa_debit" | "card" | "cash" | "other";

const CATALOGS = { es, ca, en } as const;
const MONEY_LOCALE: Record<EmailLocale, string> = { es: "es-ES", ca: "ca-ES", en: "en-IE" };

export type EmailParams = {
  number: string;
  issuerName: string;
  totalCents: number;
  outstandingCents?: number;
  issuedOn: CivilDate;
  dueOn: CivilDate | null;
  paymentMethod: PaymentMethod;
  iban: string | null;
};

const dmy = (date: CivilDate | null) => (date ? `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}` : "—");

/** Asunto y cuerpo de un email, listos para revisar. */
export function renderEmail(template: EmailTemplate, locale: EmailLocale, p: EmailParams): { subject: string; body: string } {
  const t = createTranslator({ locale, messages: CATALOGS[locale], namespace: "emails" });
  const money = (cents: number) => formatMoney(cents, { locale: MONEY_LOCALE[locale] });
  const payment =
    p.paymentMethod === "transfer" && p.iban
      ? t("paymentTransfer", { iban: formatIban(p.iban) })
      : t("paymentOther", { method: t(`method.${p.paymentMethod}`) });
  const values = {
    number: p.number,
    issuer: p.issuerName,
    total: money(p.totalCents),
    outstanding: money(p.outstandingCents ?? p.totalCents),
    issued: dmy(p.issuedOn),
    due: dmy(p.dueOn),
    payment,
  };
  return { subject: t(`${template}.subject`, values), body: t(`${template}.body`, values) };
}
