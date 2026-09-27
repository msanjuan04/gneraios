// Texto del resumen semanal, en el idioma de cada socio: asunto, texto plano y HTML (con estilos
// en línea: los clientes de email no leen hojas de estilo). Sin "server-only": se prueba con Vitest.

import { createTranslator } from "next-intl";
import { brand } from "@/brand";
import { type CalendarEvent, eventDetail, eventSummary, formatAmount, type Translate } from "@/domain/calendar";
import { addDays, type CivilDate } from "@/domain/dates/civil-date";
import { formatMoney } from "@/domain/money";
import esCalendar from "@/i18n/messages/es/calendar.json";
import esCouncil from "@/i18n/messages/es/council.json";
import esDashboard from "@/i18n/messages/es/dashboard.json";
import caEmails from "@/i18n/messages/ca/emails.json";
import enEmails from "@/i18n/messages/en/emails.json";
import esEmails from "@/i18n/messages/es/emails.json";
import esProfitability from "@/i18n/messages/es/profitability.json";
import { deepMerge, type Messages } from "@/i18n/messages/merge";
import type { UpcomingWeek } from "@/server/calendar/upcoming";
import type { DigestOrgData } from "./data";

export type DigestLocale = "es" | "ca" | "en";

const INTL: Record<DigestLocale, string> = { es: "es-ES", ca: "ca-ES", en: "en-IE" };
// El calendario y la cola de "Por hacer" solo están en español: ca/en caen a él, como en la app.
// La fila de la rentabilidad de "Por hacer" vive en profitability.json (se fusiona con dashboard).
const SHARED = deepMerge(esCalendar as Messages, esDashboard as Messages, esCouncil as Messages, esProfitability as Messages);
const CATALOGS: Record<DigestLocale, Messages> = {
  es: deepMerge(SHARED, esEmails as Messages),
  ca: deepMerge(SHARED, esEmails as Messages, caEmails as Messages),
  en: deepMerge(SHARED, esEmails as Messages, enEmails as Messages),
};

type Loose = ((key: string, values?: Record<string, string | number>) => string) & { has: (key: string) => boolean };

/** Eventos de la semana que caben en el email; el resto, en el calendario. */
const MAX_EVENTS = 14;

export type RenderedDigest = { subject: string; text: string; html: string; pushTitle: string; pushBody: string };

const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderWeeklyDigest(input: {
  locale: DigestLocale;
  orgName: string;
  firstName: string;
  appUrl: string;
  slug: string;
  data: DigestOrgData;
  week: UpcomingWeek;
}): RenderedDigest {
  const { locale, data, week } = input;
  const t = createTranslator({ locale, messages: CATALOGS[locale] }) as unknown as Loose;
  const d = (key: string, values?: Record<string, string | number>) => t(`emails.digest.${key}`, values);
  const cal: Translate = (key, values) => t(`calendar.${key}`, values);
  const intl = INTL[locale];
  const money = (cents: number) => formatMoney(cents, { locale: intl, currency: data.money.currency, wholeUnits: true });
  const day = (date: CivilDate, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(intl, { ...opts, timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
  const amountFormat = { t: cal, moneyLocale: intl, currency: data.money.currency };
  const base = `${input.appUrl.replace(/\/$/, "")}/${input.slug}`;

  const range = d("range", {
    from: day(data.weekStart, { day: "numeric", month: "long" }),
    to: day(addDays(data.weekStart, 6), { day: "numeric", month: "long" }),
  });
  const todoCount = data.queue.reduce((sum, item) => sum + item.count, 0);
  const collections = week.collections.expectedCents;
  const subject = d("subject", { org: input.orgName, collections: money(collections), todo: todoCount });

  // Secciones: cada una como filas [etiqueta, valor] o [texto, importe].
  const lastWeek: [string, string][] = [
    [d("collected"), money(data.lastWeek.collectedCents)],
    [d("invoiced", { count: data.lastWeek.invoicesIssued }), money(data.lastWeek.invoicedNetCents)],
    [d("newDeals"), String(data.lastWeek.newDeals)],
  ];
  const status: [string, string][] = [
    [d("mrr"), `${money(data.mrrCents)}${d("perMonth")}`],
    [d("outstanding"), money(data.receivables.outstandingCents)],
  ];
  if (data.receivables.overdueCount > 0) {
    status.push([d("overdue", { count: data.receivables.overdueCount }), money(data.receivables.overdueCents)]);
  }

  const goals: string[] = [];
  if (data.goals.mrr) {
    const g = data.goals.mrr;
    goals.push(
      d("goalMrr", {
        current: money(g.currentCents),
        target: money(g.targetCents),
        percent: Math.round(g.progressBps / 100),
        status: t(`dashboard.goals.status.${g.status}`),
      }),
    );
  }
  if (data.goals.revenue) {
    const g = data.goals.revenue;
    goals.push(
      d("goalRevenue", {
        year: g.year,
        invoiced: money(g.invoicedCents),
        target: money(g.targetCents),
        gap: money(g.gapCents),
        status: t(`dashboard.goals.status.${g.status}`),
      }),
    );
  }

  const events: { date: CivilDate; event: CalendarEvent }[] = week.days.flatMap((w) => w.events.map((event) => ({ date: w.date, event })));
  const shown = events.slice(0, MAX_EVENTS);
  const eventRows = shown.map(({ date, event }) => {
    const detail = eventDetail(event, cal);
    const summary = [eventSummary(event, cal), detail].filter(Boolean).join(" · ");
    return {
      when: day(date, { weekday: "short", day: "numeric" }),
      summary,
      amount: event.amountCents === null ? "" : formatAmount(event.amountCents, event.amountPeriod, amountFormat),
      overdue: event.status === "overdue",
    };
  });
  const moreEvents = events.length - shown.length;

  const councilWho = (agent: string) => (t.has(`council.agents.${agent}.name`) ? t(`council.agents.${agent}.name`) : agent);
  const queueRows = data.queue.map((item) => ({
    text: t(`dashboard.actionQueue.items.${item.key}.title`, { count: item.count }),
    amount: item.amountCents ? money(item.amountCents) : "",
    href: item.href,
  }));

  // --- Texto plano ---------------------------------------------------------------
  const lines: string[] = [d("hello", { name: input.firstName }), range, ""];
  lines.push(d("lastWeekTitle"), ...lastWeek.map(([k, v]) => `· ${k}: ${v}`), "");
  lines.push(d("statusTitle"), ...status.map(([k, v]) => `· ${k}: ${v}`), "");
  if (goals.length > 0) lines.push(d("goalsTitle"), ...goals.map((g) => `· ${g}`), "");
  lines.push(d("weekTitle"));
  if (eventRows.length === 0) lines.push(`· ${d("weekEmpty")}`);
  for (const row of eventRows) lines.push(`· ${row.when} · ${row.summary}${row.amount ? ` · ${row.amount}` : ""}`);
  if (moreEvents > 0) lines.push(`· ${d("moreEvents", { count: moreEvents })}`);
  if (week.overdue.length > 0) lines.push(`· ${d("overdueEvents", { count: week.overdue.length })}`);
  if (data.council.length > 0) {
    lines.push("", d("councilTitle"));
    for (const r of data.council) lines.push(`· ${r.title} (${councilWho(r.agent)} · ${t(`council.urgency.${r.urgency}`)})`);
  }
  lines.push("", d("todoTitle"));
  if (queueRows.length === 0) lines.push(`· ${d("todoEmpty")}`);
  for (const row of queueRows) lines.push(`· ${row.text}${row.amount ? ` · ${row.amount}` : ""}`);
  lines.push("", `${d("open")}: ${base}`, "", d("footer"));
  const text = lines.join("\n");

  // --- HTML ----------------------------------------------------------------------
  const c = { bg: brand.palette.black, card: "#0d1117", border: "#1f2630", text: "#f5f7fa", muted: "#8b95a5", blue: brand.palette.blueBright, red: brand.palette.red };
  const section = (title: string, body: string) =>
    `<tr><td style="padding:20px 24px 4px;font:700 13px/1.4 Manrope,Arial,sans-serif;color:${c.muted};text-transform:uppercase;letter-spacing:.06em">${escape(title)}</td></tr><tr><td style="padding:0 24px">${body}</td></tr>`;
  const kv = (rows: [string, string][]) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:6px 0;font:400 14px/1.4 Manrope,Arial,sans-serif;color:${c.muted}">${escape(k)}</td><td align="right" style="padding:6px 0;font:700 14px/1.4 Manrope,Arial,sans-serif;color:${c.text}">${escape(v)}</td></tr>`,
      )
      .join("")}</table>`;
  const list = (rows: { left: string; right: string; red?: boolean; href?: string }[], empty: string) =>
    rows.length === 0
      ? `<p style="margin:6px 0;font:400 14px/1.5 Manrope,Arial,sans-serif;color:${c.muted}">${escape(empty)}</p>`
      : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows
          .map((r) => {
            const left = escape(r.left);
            const inner = r.href ? `<a href="${escape(r.href)}" style="color:${r.red ? c.red : c.text};text-decoration:none">${left}</a>` : left;
            return `<tr><td style="padding:7px 0;border-top:1px solid ${c.border};font:500 14px/1.45 Manrope,Arial,sans-serif;color:${r.red ? c.red : c.text}">${inner}</td><td align="right" style="padding:7px 0 7px 12px;border-top:1px solid ${c.border};font:700 14px/1.45 Manrope,Arial,sans-serif;color:${c.text};white-space:nowrap">${escape(r.right)}</td></tr>`;
          })
          .join("")}</table>`;

  const weekList = list(
    eventRows.map((r) => ({ left: `${r.when} · ${r.summary}`, right: r.amount, red: r.overdue })),
    d("weekEmpty"),
  );
  const extraWeek = [
    moreEvents > 0 ? d("moreEvents", { count: moreEvents }) : null,
    week.overdue.length > 0 ? d("overdueEvents", { count: week.overdue.length }) : null,
  ]
    .filter(Boolean)
    .map((s) => `<p style="margin:8px 0 0;font:400 13px/1.5 Manrope,Arial,sans-serif;color:${c.muted}">${escape(s!)}</p>`)
    .join("");

  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(subject)}</title></head>
<body style="margin:0;padding:0;background:${c.bg}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${c.bg}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${c.card};border:1px solid ${c.border};border-radius:20px">
<tr><td style="padding:28px 24px 0;font:800 13px/1 Manrope,Arial,sans-serif;color:${c.blue};letter-spacing:.08em;text-transform:uppercase">${escape(brand.product)} · ${escape(input.orgName)}</td></tr>
<tr><td style="padding:12px 24px 0;font:800 28px/1.2 Manrope,Arial,sans-serif;color:${c.text}">${escape(d("hello", { name: input.firstName }))}</td></tr>
<tr><td style="padding:6px 24px 0;font:400 15px/1.5 Manrope,Arial,sans-serif;color:${c.muted}">${escape(range)}</td></tr>
${section(d("lastWeekTitle"), kv(lastWeek))}
${section(d("statusTitle"), kv(status))}
${goals.length > 0 ? section(d("goalsTitle"), list(goals.map((g) => ({ left: g, right: "" })), "")) : ""}
${section(d("weekTitle"), weekList + extraWeek)}
${data.council.length > 0 ? section(d("councilTitle"), list(data.council.map((r) => ({ left: `${r.title} · ${councilWho(r.agent)}`, right: t(`council.urgency.${r.urgency}`), href: `${base}/council` })), "")) : ""}
${section(d("todoTitle"), list(queueRows.map((r) => ({ left: r.text, right: r.amount, href: `${input.appUrl.replace(/\/$/, "")}${r.href}` })), d("todoEmpty")))}
<tr><td style="padding:24px"><a href="${escape(base)}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:${c.blue};color:#fff;font:700 14px/1 Manrope,Arial,sans-serif;text-decoration:none">${escape(d("open"))}</a></td></tr>
<tr><td style="padding:0 24px 24px;font:400 12px/1.5 Manrope,Arial,sans-serif;color:${c.muted}">${escape(d("footer"))}</td></tr>
</table></td></tr></table></body></html>`;

  const pushBody = d("pushBody", {
    collections: money(collections),
    count: week.collections.expectedCount,
    todo: todoCount,
  });
  return { subject, text, html, pushTitle: d("pushTitle"), pushBody };
}
