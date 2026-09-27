import { brand } from "@/brand";
import { addMonths, monthEnd, type Month } from "@/domain/metrics/months";
import { formatMoney } from "@/domain/money";
import { formatHours } from "@/domain/projects/duration";
import {
  type ClientMonthReport,
  type ReportDeliverable,
  type ReportInvoice,
  type ReportMetric,
  type ReportPosition,
  type ReportService,
  reportMonthParam,
  type ReportWeb,
} from "@/domain/reports";
import { formatPdfDate, formatPeriod, intlLocale, pdfText } from "./format";
import { interpolate } from "./labels";
import { getReportPdfLabels, type ReportPdfLabels } from "./report-labels";
import type { LabeledValue } from "./view-model";

// Todo lo que imprime el informe mensual, ya en texto y en el idioma del cliente. Como en la
// factura y el presupuesto, la plantilla solo maqueta: qué se dice y cómo se decide aquí, y se
// prueba sin generar el PDF. Las comparaciones son neutras («+12 % frente a julio»): ni colores
// de bien o mal ni previsiones.

/** Una fila de lista: título, detalle debajo y un dato a la derecha (fecha, estado…). */
export type ReportItemView = { title: string; detail: string | null; aside: string | null; link: string | null };

export type ReportTileView = { label: string; value: string; delta: string | null; caption: string | null };

/** Una barra del gráfico de canales: `ratio` y `previousRatio` van de 0 a 1 sobre la mayor. */
export type ReportBarView = { label: string; value: string; ratio: number; previousRatio: number | null; delta: string | null };

export type ReportInvoiceRowView = { number: string; date: string; due: string; total: string; outstanding: string; status: string };

export type ReportInvoiceHeaders = ReportInvoiceRowView;

export type ReportWebView = {
  title: string;
  subtitle: string;
  tiles: ReportTileView[];
  channels: { title: string; legend: { current: string; previous: string | null }; rows: ReportBarView[] } | null;
  queries: {
    title: string;
    headers: { query: string; clicks: string; previous: string | null; position: string };
    rows: { query: string; clicks: string; previous: string | null; position: string }[];
  } | null;
  notes: string[];
};

export type ReportView = {
  /** Etiqueta BCP 47 del documento ("es-ES"). */
  language: string;
  /** Título del PDF y de la cabecera de las páginas siguientes. */
  title: string;
  author: string;
  documentType: string;
  /** "Agosto de 2026" */
  headline: string;
  /** El cliente. */
  subtitle: string;
  dates: LabeledValue[];
  notice: string | null;
  summary: LabeledValue[];
  workDone: { title: string; empty: string | null; groups: { title: string; items: ReportItemView[] }[] };
  hours: { title: string; rows: LabeledValue[]; total: LabeledValue } | null;
  nextSteps: { title: string; empty: string | null; items: ReportItemView[]; more: string | null };
  deliverables: { title: string; items: ReportItemView[] } | null;
  web: ReportWebView | null;
  /** Recurrentes y proyectos; el título de cada grupo solo si hay de los dos. */
  services: { title: string; groups: { title: string | null; items: ReportItemView[] }[] } | null;
  invoices: {
    title: string;
    headers: ReportInvoiceHeaders;
    issued: { title: string; rows: ReportInvoiceRowView[]; empty: string | null };
    pending: { title: string; rows: ReportInvoiceRowView[] } | null;
    total: LabeledValue | null;
    allPaid: string | null;
    note: string;
  };
  runningHeader: string;
  footer: { text: string; pageLabel: (current: number, total: number) => string };
};

/** Un texto de actividad no ocupa más que esto: el resto está en su ficha. */
const BODY_MAX = 320;
const QUERY_MAX = 90;

type Formatters = {
  labels: ReportPdfLabels;
  language: string;
  int: (value: number) => string;
  decimal: (value: number) => string;
  change: (value: number) => string;
  money: (cents: number) => string;
  hours: (minutes: number) => string;
};

const numberFormats = new Map<string, Intl.NumberFormat>();

function numberFormat(language: string, key: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const cacheKey = `${language}:${key}`;
  let nf = numberFormats.get(cacheKey);
  if (!nf) {
    nf = new Intl.NumberFormat(language, options);
    numberFormats.set(cacheKey, nf);
  }
  return nf;
}

function formatters(labels: ReportPdfLabels, language: string): Formatters {
  // "always": es-ES no agrupa los números de 4 cifras por defecto ("1682").
  const int = numberFormat(language, "int", { maximumFractionDigits: 0, useGrouping: "always" });
  const decimal = numberFormat(language, "decimal", { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: "always" });
  const change = numberFormat(language, "change", { style: "percent", maximumFractionDigits: 0, signDisplay: "exceptZero" });
  return {
    labels,
    language,
    int: (value) => pdfText(int.format(value)),
    decimal: (value) => pdfText(decimal.format(value)),
    change: (value) => pdfText(change.format(value)),
    money: (cents) => pdfText(formatMoney(cents, { locale: language })),
    hours: (minutes) => pdfText(formatHours(minutes, language)),
  };
}

function capitalize(text: string, language: string): string {
  return text ? text.charAt(0).toLocaleUpperCase(language) + text.slice(1) : text;
}

function clean(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? pdfText(text) : null;
}

function clamp(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}

const monthKey = (month: Month) => month.slice(5, 7) as keyof ReportPdfLabels["months"];

/** "agosto" */
function monthName(month: Month, f: Formatters): string {
  return f.labels.months[monthKey(month)];
}

/** "Agosto de 2026" */
function monthTitle(month: Month, f: Formatters): string {
  return capitalize(interpolate(f.labels.monthYear, { month: monthName(month, f), year: month.slice(0, 4) }), f.language);
}

/** "frente a julio" (el mes anterior al del informe). */
function versus(month: Month, f: Formatters): string {
  return f.labels.versus[monthKey(addMonths(month, -1))];
}

/** "+12 %" y «frente a julio»; con el mes anterior a cero, su valor. */
function relativeDelta(metric: ReportMetric, compared: boolean, month: Month, f: Formatters): Pick<ReportTileView, "delta" | "caption"> {
  if (!compared || metric.previous === null) return { delta: null, caption: null };
  if (metric.change === null) return { delta: interpolate(f.labels.web.previousMonth, { value: f.int(metric.previous) }), caption: null };
  if (Math.abs(metric.change) < 0.005) return { delta: f.labels.web.noChange, caption: versus(month, f) };
  return { delta: f.change(metric.change), caption: versus(month, f) };
}

/** "1,2 posiciones más arriba" (más arriba es un número más bajo). */
function positionDelta(position: ReportPosition, compared: boolean, month: Month, f: Formatters): Pick<ReportTileView, "delta" | "caption"> {
  if (!compared || position.gain === null) return { delta: null, caption: null };
  const rounded = Math.round(position.gain * 10) / 10;
  if (rounded === 0) return { delta: f.labels.web.noChange, caption: versus(month, f) };
  const forms = rounded > 0 ? f.labels.web.positionUp : f.labels.web.positionDown;
  const abs = Math.abs(rounded);
  const value = pdfText(numberFormat(f.language, "gain", { maximumFractionDigits: 1 }).format(abs));
  return { delta: interpolate(abs === 1 ? forms.one : forms.other, { value }), caption: versus(month, f) };
}

function channelDelta(change: number | null, compared: boolean, f: Formatters): string | null {
  if (!compared || change === null) return null;
  return Math.abs(change) < 0.005 ? f.labels.web.noChange : f.change(change);
}

function webView(web: ReportWeb, month: Month, f: Formatters): ReportWebView {
  const w = f.labels.web;
  const tiles: ReportTileView[] = [];
  const { search, visits } = web;
  if (search) {
    tiles.push({ label: w.clicks, value: f.int(search.clicks.value), ...relativeDelta(search.clicks, search.compared, month, f) });
    tiles.push({ label: w.impressions, value: f.int(search.impressions.value), ...relativeDelta(search.impressions, search.compared, month, f) });
    tiles.push({
      label: w.position,
      value: search.position.value === null ? "—" : f.decimal(search.position.value),
      ...positionDelta(search.position, search.compared, month, f),
    });
  }
  if (visits) tiles.push({ label: w.visits, value: f.int(visits.sessions.value), ...relativeDelta(visits.sessions, visits.compared, month, f) });

  let channels: ReportWebView["channels"] = null;
  if (visits?.channels && visits.channels.length > 0) {
    const max = Math.max(1, ...visits.channels.map((c) => Math.max(c.sessions, c.previous ?? 0)));
    channels = {
      title: w.channels,
      legend: {
        current: capitalize(monthName(month, f), f.language),
        previous: visits.compared ? capitalize(monthName(addMonths(month, -1), f), f.language) : null,
      },
      rows: visits.channels.map((c) => ({
        label: w.channelNames[c.channel],
        value: f.int(c.sessions),
        ratio: c.sessions / max,
        previousRatio: visits.compared && c.previous !== null ? c.previous / max : null,
        delta: channelDelta(c.change, visits.compared, f),
      })),
    };
  }

  const compared = search?.compared ?? false;
  const queries: ReportWebView["queries"] =
    web.topQueries.length > 0
      ? {
          title: w.queries,
          headers: { query: w.query, clicks: w.queryClicks, previous: compared ? w.queryPrevious : null, position: w.queryPosition },
          rows: web.topQueries.map((q) => ({
            query: clamp(pdfText(q.query), QUERY_MAX),
            clicks: f.int(q.clicks),
            previous: compared ? (q.previousClicks === null ? "—" : f.int(q.previousClicks)) : null,
            position: q.position === null ? "—" : f.decimal(q.position),
          })),
        }
      : null;

  const notes: string[] = [];
  const partial = new Set<string>();
  for (const block of [search, visits]) {
    if (block && !block.complete) partial.add(interpolate(w.partial, { from: formatPdfDate(block.range.from), to: formatPdfDate(block.range.to) }));
  }
  notes.push(...partial);
  if ([search, visits].some((block) => block && !block.compared)) notes.push(w.noComparison);
  notes.push(w.measured);
  if (web.source === "demo") notes.push(w.demo);

  return { title: w.title, subtitle: interpolate(w.subtitle, { site: pdfText(web.site) }), tiles, channels, queries, notes };
}

function serviceItem(service: ReportService, showContract: boolean, f: Formatters): ReportItemView {
  const s = f.labels.services;
  // «Mensual · Desde el 01/01/2026 hasta el 31/12/2026 · En pausa parte del mes · Contrato».
  const since = interpolate(s.since, { date: formatPdfDate(service.startsOn) });
  const range = service.endsOn ? `${since} ${interpolate(s.until, { date: formatPdfDate(service.endsOn) })}` : since;
  const detail = [s.types[service.billingType], range, service.pausedInMonth ? s.paused : null, showContract ? pdfText(service.contractTitle) : null]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
  return { title: pdfText(service.description), detail, aside: null, link: null };
}

/** "figma.com/file/abc" a partir de la URL, para leerla de un vistazo. */
function shortUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return clamp(`${parsed.hostname.replace(/^www\./, "")}${path}`, 60);
  } catch {
    return clamp(url, 60);
  }
}

function deliverableItem(item: ReportDeliverable, f: Formatters): ReportItemView {
  const d = f.labels.deliverables;
  const detail = item.kind === "file" ? [d.file, clean(item.fileName)] : [d.link, item.url ? pdfText(shortUrl(item.url)) : null];
  return {
    title: pdfText(item.title),
    detail: detail.filter((part): part is string => Boolean(part)).join(" · "),
    aside: formatPdfDate(item.sharedOn),
    link: item.url,
  };
}

function invoiceRow(invoice: ReportInvoice, f: Formatters): ReportInvoiceRowView {
  return {
    number: pdfText(invoice.number),
    date: formatPdfDate(invoice.issuedOn),
    due: invoice.dueOn ? formatPdfDate(invoice.dueOn) : "—",
    total: f.money(invoice.totalCents),
    outstanding: invoice.outstandingCents > 0 ? f.money(invoice.outstandingCents) : "—",
    status: f.labels.invoices.statuses[invoice.status],
  };
}

/** "informe-2026-08-clinica-dental-mar-blau.pdf" */
export function reportPdfFilename(report: Pick<ClientMonthReport, "locale" | "month" | "clientName">): string {
  const client = report.clientName
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return `${[getReportPdfLabels(report.locale).filename, reportMonthParam(report.month), client].filter(Boolean).join("-")}.pdf`;
}

/** Resuelve el informe a texto. */
export function buildReportView(report: ClientMonthReport): ReportView {
  const labels = getReportPdfLabels(report.locale);
  const language = intlLocale(report.locale);
  const f = formatters(labels, language);
  const { month } = report;
  const client = pdfText(report.clientName);
  const sender = pdfText(report.senderName);
  const headline = monthTitle(month, f);
  const title = `${labels.document} · ${headline} · ${client}`;
  const generated = formatPdfDate(report.generatedOn);

  const dates: LabeledValue[] = [
    { label: labels.header.period, value: formatPeriod(month, report.inProgress ? report.generatedOn : monthEnd(month)) ?? "" },
    { label: labels.header.generatedOn, value: generated },
    { label: labels.header.sender, value: sender },
  ];

  const summary: LabeledValue[] = [
    { label: labels.summary.tasksDone, value: f.int(report.workDone.tasks.length) },
    { label: labels.summary.nextSteps, value: f.int(report.nextSteps.items.length + report.nextSteps.more) },
  ];
  if (report.deliverables.length > 0) summary.push({ label: labels.summary.deliverables, value: f.int(report.deliverables.length) });
  if (report.web?.visits) summary.push({ label: labels.summary.visits, value: f.int(report.web.visits.sessions.value) });
  if (report.hours) summary.push({ label: labels.summary.hours, value: f.hours(report.hours.totalMinutes) });

  // Lo hecho, por proyecto (en orden alfabético) y, al final, las reuniones y comunicaciones.
  const byProject = new Map<string, { title: string; items: ReportItemView[] }>();
  for (const task of report.workDone.tasks) {
    const group = byProject.get(task.projectId) ?? { title: pdfText(task.projectName), items: [] };
    group.items.push({ title: pdfText(task.title), detail: null, aside: formatPdfDate(task.completedOn), link: null });
    byProject.set(task.projectId, group);
  }
  const groups = [...byProject.values()].sort((a, b) => a.title.localeCompare(b.title, language));
  if (report.workDone.activities.length > 0) {
    groups.push({
      title: labels.workDone.activities,
      items: report.workDone.activities.map((activity) => ({
        title: `${labels.workDone.kinds[activity.kind]} · ${pdfText(activity.title)}`,
        detail: activity.body ? clamp(pdfText(activity.body), BODY_MAX) : null,
        aside: formatPdfDate(activity.occurredOn),
        link: null,
      })),
    });
  }

  const services = [...report.services.recurring, ...report.services.oneOff];
  const showContract = new Set(services.map((s) => s.contractTitle)).size > 1;
  const serviceGroups = [
    { title: labels.services.recurring, list: report.services.recurring },
    { title: labels.services.oneOff, list: report.services.oneOff },
  ]
    .filter((group) => group.list.length > 0)
    .map((group, _, all) => ({
      title: all.length > 1 ? group.title : null,
      items: group.list.map((service) => serviceItem(service, showContract, f)),
    }));

  const inv = labels.invoices;
  const { issued, pending, pendingTotalCents } = report.invoices;
  const hasInvoices = issued.length > 0 || pending.length > 0;

  return {
    language,
    title,
    author: sender,
    documentType: labels.document,
    headline,
    subtitle: client,
    dates,
    notice: report.inProgress ? interpolate(labels.header.inProgress, { date: generated }) : null,
    summary,
    workDone: { title: labels.workDone.title, empty: groups.length === 0 ? labels.workDone.empty : null, groups },
    hours: report.hours
      ? {
          title: labels.hours.title,
          rows: report.hours.projects.map((p) => ({ label: p.name ? pdfText(p.name) : labels.hours.other, value: f.hours(p.minutes) })),
          total: { label: labels.hours.total, value: f.hours(report.hours.totalMinutes) },
        }
      : null,
    nextSteps: {
      title: labels.nextSteps.title,
      empty: report.nextSteps.items.length === 0 ? labels.nextSteps.empty : null,
      items: report.nextSteps.items.map((step) => ({
        title: pdfText(step.title),
        detail: pdfText(step.projectName),
        aside: labels.nextSteps.status[step.status],
        link: null,
      })),
      more: report.nextSteps.more > 0 ? interpolate(labels.nextSteps.more, { count: f.int(report.nextSteps.more) }) : null,
    },
    deliverables:
      report.deliverables.length > 0
        ? { title: labels.deliverables.title, items: report.deliverables.map((item) => deliverableItem(item, f)) }
        : null,
    web: report.web ? webView(report.web, month, f) : null,
    services: serviceGroups.length > 0 ? { title: labels.services.title, groups: serviceGroups } : null,
    invoices: {
      title: inv.title,
      headers: { number: inv.number, date: inv.date, due: inv.due, total: inv.total, outstanding: inv.outstanding, status: inv.status },
      issued: { title: inv.issued, rows: issued.map((i) => invoiceRow(i, f)), empty: issued.length === 0 ? inv.noneIssued : null },
      pending: pending.length > 0 ? { title: inv.pending, rows: pending.map((i) => invoiceRow(i, f)) } : null,
      total: pendingTotalCents > 0 ? { label: interpolate(inv.pendingTotal, { date: generated }), value: f.money(pendingTotalCents) } : null,
      allPaid: pendingTotalCents <= 0 && hasInvoices ? interpolate(inv.allPaid, { date: generated }) : null,
      note: interpolate(inv.note, { date: generated }),
    },
    runningHeader: title,
    footer: {
      text: [sender, brand.website.replace(/^https?:\/\//, "").replace(/\/$/, "")].filter(Boolean).join(" · "),
      pageLabel: (current, total) => interpolate(labels.footer.page, { current, total }),
    },
  };
}
