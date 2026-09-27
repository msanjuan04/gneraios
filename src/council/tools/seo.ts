// SEO de la web propia (módulo /seo): get_seo_summary. Tráfico de Search Console y GA4 del último
// periodo frente al anterior, y lo que traen al negocio las fuentes que cuentan como SEO.

import { z } from "zod";
import { addDays } from "@/domain/dates/civil-date";
import { periodEnd, resolveSeoSourceIds, searchTotals, seoImpact, webTotals } from "@/domain/seo";
import { changeBps, m } from "./common";
import { formatMetricValue, rangePeriod } from "./format";
import { channelRows } from "./pipeline";
import { defineTool, type Metric } from "./types";

export const getSeoSummary = defineTool({
  name: "get_seo_summary",
  description:
    "SEO de la web propia: clics, impresiones, CTR y posición media de Search Console, sesiones y conversiones orgánicas de GA4 del último periodo frente al anterior, y lo que han traído al negocio las fuentes que cuentan como SEO (leads, ganados y facturación).",
  input: z.object({ days: z.number().int().min(7).max(90).default(28) }).strict(),
  async run(ctx, { days }) {
    const today = ctx.today;
    const seo = await ctx.data.seo(addDays(today, -(2 * days + 10)), today);
    if (!seo || (seo.searchDays.length === 0 && seo.organicDays.length === 0)) {
      return {
        tool: "get_seo_summary",
        status: "missing_data",
        subject: "seo",
        period: null,
        source: "Search Console y GA4 (módulo SEO).",
        href: "/seo",
        summary: "No hay datos de SEO de la web propia.",
        metrics: [],
        missing: {
          what: "Datos de Search Console y GA4 de la web propia",
          needs: ["Conectar Google en SEO", "Dar de alta la web propia como principal"],
          href: "/seo",
        },
      };
    }
    const end = periodEnd(today, seo.lastDataOn);
    const range = { from: addDays(end, -(days - 1)), to: end };
    const previous = { from: addDays(range.from, -days), to: addDays(range.from, -1) };
    const now = searchTotals(seo.searchDays, range);
    const before = searchTotals(seo.searchDays, previous);
    const organicNow = webTotals(seo.organicDays, range);
    const organicBefore = webTotals(seo.organicDays, previous);
    const period = rangePeriod(range.from, range.to);
    const prevPeriod = rangePeriod(previous.from, previous.to);

    const metrics: Metric[] = [
      m.days("seo.period_days", "Días del periodo", days, period),
      m.count("seo.clicks", "Clics en Google", now.clicks, period, "/seo"),
      m.count("seo.clicks.previous", "Clics en Google (periodo anterior)", before.clicks, prevPeriod, "/seo"),
      m.count("seo.impressions", "Impresiones en Google", now.impressions, period, "/seo"),
      m.count("seo.sessions", "Sesiones orgánicas (GA4)", organicNow.sessions, period, "/seo"),
      m.count("seo.conversions", "Conversiones orgánicas (GA4)", organicNow.conversions, period, "/seo"),
    ];
    const clicksChange = changeBps(now.clicks, before.clicks);
    if (clicksChange !== null) metrics.push(m.bps("seo.clicks.change", "Variación de clics frente al periodo anterior", clicksChange, period));
    const impressionsChange = changeBps(now.impressions, before.impressions);
    if (impressionsChange !== null) metrics.push(m.bps("seo.impressions.change", "Variación de impresiones frente al periodo anterior", impressionsChange, period));
    const sessionsChange = changeBps(organicNow.sessions, organicBefore.sessions);
    if (sessionsChange !== null) metrics.push(m.bps("seo.sessions.change", "Variación de sesiones orgánicas", sessionsChange, period));
    if (now.ctr !== null) metrics.push(m.bps("seo.ctr", "CTR medio", Math.round(now.ctr * 10_000), period));
    if (now.position !== null) metrics.push(m.position("seo.position", "Posición media", Math.round(now.position * 10) / 10, period));
    if (before.position !== null) metrics.push(m.position("seo.position.previous", "Posición media (periodo anterior)", Math.round(before.position * 10) / 10, prevPeriod));

    const org = await ctx.data.org();
    const { channel, sources } = await channelRows(ctx, range.from, range.to);
    const { ids } = resolveSeoSourceIds(org.settings, sources);
    const impact = seoImpact(channel, ids);
    metrics.push(
      m.count("seo.business.leads", "Leads de las fuentes SEO", impact.leads, period, "/seo"),
      m.count("seo.business.won", "Deals ganados de las fuentes SEO", impact.won, period, "/seo"),
      m.eur("seo.business.billed", "Facturado a clientes que llegaron por SEO", impact.billedCents, period, "/seo"),
    );
    if (impact.share.billed !== null) metrics.push(m.bps("seo.business.billed_share", "Parte de la facturación del periodo", Math.round(impact.share.billed * 10_000), period));

    return {
      tool: "get_seo_summary",
      status: "ok",
      subject: "seo",
      period: range,
      source: `Search Console y GA4 de «${seo.label}» (seo_daily_metrics, web_analytics_daily) y el CRM.`,
      href: "/seo",
      summary: `${formatMetricValue(now.clicks, "count")} clics y ${formatMetricValue(organicNow.sessions, "count")} sesiones orgánicas en ${days} días.`,
      metrics,
      notes: ids.length === 0 ? ["Ninguna fuente de adquisición cuenta como SEO: elige cuáles en SEO → Negocio."] : [],
    };
  },
});
