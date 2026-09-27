// Rentabilidad por cliente y proyecto (get_client_profitability): lo facturado en un periodo entre
// las horas registradas (la tarifa efectiva) frente al €/hora objetivo de la org. Lo facturado sale
// de la vista project_contract_revenue (la ÚNICA definición de lo facturado de un proyecto) y el
// reparto, la tarifa y su semáforo, de src/domain/projects/economics: las mismas funciones que la
// ficha del cliente y la del proyecto. Sin horas no hay tarifa: se dice qué falta, nunca se inventa.
// El margen necesita el coste por hora de cada socio, que aún no está.

import { z } from "zod";
import { compareCivil, maxCivil, parseCivilDate, type CivilDate } from "@/domain/dates/civil-date";
import { addMonths, monthEnd, monthOf, monthRange, monthsEndingAt, type Month } from "@/domain/metrics";
import { aggregateEconomics, projectEconomics, rateVsTargetBps, scaleCents, sumBy, type RateStanding } from "@/domain/projects";
import type { CouncilClient, CouncilProject } from "../data/types";
import { clientHref, m, projectHref } from "./common";
import { formatMetricValue, monthLabel, rangePeriod } from "./format";
import { defineTool, type Metric, type ToolRow } from "./types";

const SOURCE =
  "Lo facturado de cada contrato (vista project_contract_revenue: base sin IVA de lo emitido, rectificativas restadas; la misma definición que Proyectos) y las horas registradas en Proyectos (time_entries, también las importadas de GTiQ).";

/** El semáforo de Proyectos (rateStanding): verde, ámbar (por debajo pero cerca) y rojo. */
const STANDING_TEXT: Record<RateStanding, string> = {
  good: "en el objetivo o por encima",
  warning: "algo por debajo del objetivo",
  bad: "claramente por debajo del objetivo",
  none: "sin tarifa",
};

const MAX_CLIENT_ROWS = 15;
const MAX_ROWS = 30;

/** El primer mes con horas de principio a fin: el de la primera hora si empieza en su primera semana; si no, el siguiente. */
function firstCoveredMonth(firstLoggedOn: CivilDate): Month {
  const month = monthOf(firstLoggedOn);
  return parseCivilDate(firstLoggedOn).day <= 7 ? month : addMonths(month, 1);
}

type ClientFigures = {
  client: CouncilClient;
  projects: CouncilProject[];
  invoicedCents: number;
  /** Facturado de los contratos de sus proyectos: lo que se compara con las horas. */
  trackedCents: number;
  minutes: number;
  rateCents: number | null;
  standing: RateStanding;
  /** Lo que falta para tener tarifa (null si la hay o si no hay nada que medir). */
  lacking: "hours" | "contract" | null;
};

export const getClientProfitability = defineTool({
  name: "get_client_profitability",
  description:
    "Rentabilidad por cliente (y por proyecto cuando un cliente tiene varios, o todos los de client_id) en los últimos N meses cerrados: lo facturado neto (vista project_contract_revenue, la misma definición que Proyectos), las horas registradas (Proyectos, también las importadas de GTiQ) y la tarifa efectiva (facturado de los contratos de sus proyectos / horas) frente al €/hora objetivo de la org, con lo que faltó facturar para llegar al objetivo con esas horas. Si un cliente ha facturado sin horas registradas lo dice como dato que falta, sin tarifa. Sin ninguna hora en el periodo devuelve missing_data. No da el margen: falta el coste por hora de cada socio.",
  input: z
    .object({
      months: z.number().int().min(1).max(24).default(6).describe("Meses cerrados hacia atrás (el periodo empieza cuando empiezan las horas registradas)"),
      client_id: z.string().min(1).optional().describe("Solo este cliente, con el detalle de todos sus proyectos"),
    })
    .strict(),
  async run(ctx, { months, client_id }) {
    const target = ctx.targetHourlyRateCents;
    const lastClosed = addMonths(monthOf(ctx.today), -1);
    const requestedFrom = monthsEndingAt(lastClosed, months)[0]!;
    const to = monthEnd(lastClosed);
    const [projects, allEntries, allRevenue, clients] = await Promise.all([
      ctx.data.projects(),
      ctx.data.timeEntries(requestedFrom, to),
      ctx.data.contractRevenue(requestedFrom, to),
      ctx.data.clients(),
    ]);
    if (client_id && !clients.some((c) => c.id === client_id)) throw new Error(`No existe el cliente ${client_id}`);

    // Solo meses con horas: si las horas empiezan a mitad del periodo, lo facturado de antes no tiene horas con las que compararlo.
    const firstLoggedOn = allEntries.reduce<CivilDate | null>((min, e) => (min === null || compareCivil(e.workedOn, min) < 0 ? e.workedOn : min), null);
    const from = firstLoggedOn ? maxCivil(requestedFrom, firstCoveredMonth(firstLoggedOn)) : requestedFrom;
    const covered = compareCivil(from, lastClosed) <= 0;
    const entries = covered ? allEntries.filter((e) => compareCivil(e.workedOn, from) >= 0) : [];
    const revenue = allRevenue.filter((r) => compareCivil(r.issuedOn, covered ? from : requestedFrom) >= 0);
    const period = rangePeriod(covered ? from : requestedFrom, to);
    const periodMonths = monthRange(covered ? from : requestedFrom, lastClosed).length;

    const minutesByProject = sumBy(entries, (e) => e.projectId, (e) => e.minutes);
    const revenueByContract = sumBy(revenue, (r) => r.contractId, (r) => r.baseCents);
    const invoicedByClient = sumBy(revenue, (r) => r.clientId, (r) => r.baseCents);
    const projectsByContract = sumBy(projects.filter((p) => p.contractId !== null), (p) => p.contractId!, () => 1);
    const minutesByContract = sumBy(projects.filter((p) => p.contractId !== null), (p) => p.contractId!, (p) => minutesByProject.get(p.id) ?? 0);
    const minutesOf = (p: CouncilProject) => minutesByProject.get(p.id) ?? 0;
    const contractRevenueOf = (p: CouncilProject) => (p.contractId ? (revenueByContract.get(p.contractId) ?? 0) : 0);
    const clientProjects = projects.filter((p) => p.clientId !== null);
    const internalMinutes = projects.filter((p) => p.clientId === null).reduce((sum, p) => sum + minutesOf(p), 0);

    // Sin ninguna hora en el periodo no hay tarifa que dar: lo facturado de cada cliente, como contexto.
    if (entries.length === 0) {
      const names = new Map(clients.map((c) => [c.id, c.name]));
      return {
        tool: "get_client_profitability",
        status: "missing_data",
        subject: "client_profitability",
        period: { from: covered ? from : requestedFrom, to },
        source: SOURCE,
        href: "/projects",
        summary:
          firstLoggedOn && !covered
            ? `Las horas se registran desde el ${firstLoggedOn}: aún no hay un mes cerrado entero con horas para calcular la tarifa efectiva.`
            : "Sin horas registradas en el periodo no se puede calcular la tarifa efectiva (€/hora) de ningún cliente.",
        metrics: [m.eur("profit.target_rate", "€/hora objetivo de la org (Ajustes)", target, ctx.today, "/settings")],
        rows: [...invoicedByClient]
          .filter(([id, cents]) => cents > 0 && (!client_id || id === client_id))
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([clientId, cents]) => ({
            subject: `client:${clientId}`,
            label: names.get(clientId) ?? "—",
            href: clientHref(clientId),
            fields: {},
            metrics: [m.eur(`profit.client.${clientId}.invoiced`, "Facturado neto en el periodo (contratos del cliente)", cents, period, clientHref(clientId))],
          })),
        missing: {
          what: "Horas registradas por cliente en el periodo",
          needs: ["Registrar las horas en Proyectos (con el temporizador o a mano) o importar las de GTiQ", "Coste por hora de cada socio (para el margen)"],
          href: "/projects",
        },
      };
    }

    // Por cliente: lo facturado de cada contrato una sola vez entre las horas de todos sus proyectos (aggregateEconomics).
    const figures: ClientFigures[] = [];
    for (const client of clients) {
      if (client_id && client.id !== client_id) continue;
      const own = clientProjects.filter((p) => p.clientId === client.id);
      const invoicedCents = invoicedByClient.get(client.id) ?? 0;
      const minutes = own.reduce((sum, p) => sum + minutesOf(p), 0);
      if (invoicedCents === 0 && minutes === 0) continue;
      const contracts = new Set(own.flatMap((p) => (p.contractId ? [p.contractId] : [])));
      const trackedCents = [...contracts].reduce((sum, id) => sum + (revenueByContract.get(id) ?? 0), 0);
      let rateCents: number | null = null;
      let standing: RateStanding = "none";
      let lacking: ClientFigures["lacking"] = null;
      if (minutes === 0) lacking = invoicedCents > 0 ? "hours" : null;
      else if (contracts.size === 0) lacking = invoicedCents > 0 ? "contract" : null;
      else {
        const economics = aggregateEconomics(
          own.map((p) => ({ contractId: p.contractId, contractRevenueCents: contractRevenueOf(p), loggedMinutes: minutesOf(p) })),
          target,
        );
        rateCents = economics.rateCents;
        standing = economics.standing;
      }
      figures.push({ client, projects: own, invoicedCents, trackedCents, minutes, rateCents, standing, lacking });
    }

    const gapOf = (f: ClientFigures) => (f.rateCents !== null && f.rateCents < target ? scaleCents(target, f.minutes, 60) - f.trackedCents : null);
    const order = (f: ClientFigures) => (gapOf(f) !== null ? 0 : f.lacking ? 1 : 2);
    figures.sort((a, b) => order(a) - order(b) || (gapOf(b) ?? 0) - (gapOf(a) ?? 0) || b.invoicedCents - a.invoicedCents);

    const rows: ToolRow[] = [];
    for (const f of figures.slice(0, MAX_CLIENT_ROWS)) {
      const id = f.client.id;
      const href = clientHref(id);
      const metrics: Metric[] = [
        m.eur(`profit.client.${id}.invoiced`, "Facturado neto en el periodo (contratos del cliente)", f.invoicedCents, period, href),
        m.minutes(`profit.client.${id}.minutes`, "Horas registradas en sus proyectos", f.minutes, period, href),
      ];
      if (f.rateCents !== null) {
        metrics.push(
          m.eur(`profit.client.${id}.rate`, "Tarifa efectiva por hora (facturado de los contratos de sus proyectos / horas)", f.rateCents, period, href),
          m.bps(`profit.client.${id}.rate_vs_target`, "Tarifa efectiva frente al €/hora objetivo", rateVsTargetBps(f.rateCents, target) ?? 0, period),
        );
      }
      const gap = gapOf(f);
      if (gap !== null && gap > 0) metrics.push(m.eur(`profit.client.${id}.gap`, "Lo que faltó facturar para llegar al €/hora objetivo con esas horas", gap, period, href));
      const untracked = f.invoicedCents - f.trackedCents;
      if (f.minutes > 0 && untracked > 0) metrics.push(m.eur(`profit.client.${id}.untracked`, "Facturado por contratos sin proyecto (sin horas con las que compararlo)", untracked, period, href));
      rows.push({
        subject: `client:${id}`,
        label: f.client.name,
        href,
        fields: {
          cliente_id: id,
          estado_cliente: f.client.status,
          tarifa: STANDING_TEXT[f.standing],
          proyectos: f.projects.map((p) => p.name).join(", ") || null,
          falta: f.lacking === "hours" ? "Horas registradas: ha facturado sin horas en el periodo" : f.lacking === "contract" ? "Enlazar sus proyectos con el contrato que los paga" : null,
        },
        metrics,
      });

      // Por proyecto, cuando es útil: el cliente tiene varios con horas o se pide el detalle de uno.
      const active = f.projects.filter((p) => minutesOf(p) > 0 || contractRevenueOf(p) !== 0);
      if (!(client_id || active.length > 1)) continue;
      for (const project of active) {
        const economics = projectEconomics(
          {
            contractId: project.contractId,
            contractRevenueCents: contractRevenueOf(project),
            projectMinutes: minutesOf(project),
            contractMinutes: project.contractId ? (minutesByContract.get(project.contractId) ?? 0) : 0,
            contractProjects: project.contractId ? (projectsByContract.get(project.contractId) ?? 0) : 0,
          },
          target,
        );
        const phref = projectHref(project.id);
        const projectMetrics: Metric[] = [m.minutes(`profit.project.${project.id}.minutes`, "Horas registradas en el proyecto", minutesOf(project), period, phref)];
        if (economics.revenueCents !== null) {
          projectMetrics.push(m.eur(`profit.project.${project.id}.invoiced`, "Facturado del contrato que le corresponde (repartido por horas si lo comparte)", economics.revenueCents, period, phref));
        }
        if (economics.rateCents !== null) {
          projectMetrics.push(
            m.eur(`profit.project.${project.id}.rate`, "Tarifa efectiva por hora del proyecto", economics.rateCents, period, phref),
            m.bps(`profit.project.${project.id}.rate_vs_target`, "Tarifa efectiva del proyecto frente al €/hora objetivo", rateVsTargetBps(economics.rateCents, target) ?? 0, period),
          );
        }
        rows.push({
          subject: `project:${project.id}`,
          label: `${f.client.name} · ${project.name}`,
          href: phref,
          fields: {
            cliente_id: id,
            estado: project.status,
            tarifa: STANDING_TEXT[economics.standing],
            contrato_compartido: economics.shared,
            sin_contrato: project.contractId === null ? "Sin contrato: no hay facturado que medir" : null,
          },
          metrics: projectMetrics,
        });
      }
    }

    const overall = aggregateEconomics(
      clientProjects.filter((p) => !client_id || p.clientId === client_id).map((p) => ({ contractId: p.contractId, contractRevenueCents: contractRevenueOf(p), loggedMinutes: minutesOf(p) })),
      target,
    );
    const invoiced = figures.reduce((sum, f) => sum + f.invoicedCents, 0);
    const withoutRate = figures.filter((f) => f.lacking !== null);
    const untrackedTotal = figures.reduce((sum, f) => sum + (f.lacking !== null ? f.invoicedCents : Math.max(0, f.invoicedCents - f.trackedCents)), 0);
    const below = figures.filter((f) => f.standing === "bad" || f.standing === "warning").length;

    const metrics: Metric[] = [
      m.eur("profit.target_rate", "€/hora objetivo de la org (Ajustes)", target, ctx.today, "/settings"),
      m.months("profit.months", "Meses del periodo (con horas registradas)", periodMonths, period),
      m.eur("profit.invoiced", client_id ? "Facturado neto del cliente en el periodo" : "Facturado neto en el periodo (todos los clientes)", invoiced, period),
      m.minutes("profit.minutes", "Horas registradas en proyectos de clientes", overall.minutes, period, "/projects"),
    ];
    if (overall.rateCents !== null) {
      metrics.push(
        m.eur("profit.rate", "Tarifa efectiva por hora de los clientes con horas", overall.rateCents, period, "/projects"),
        m.bps("profit.rate_vs_target", "Tarifa efectiva frente al €/hora objetivo", rateVsTargetBps(overall.rateCents, target) ?? 0, period),
      );
    }
    if (!client_id && internalMinutes > 0) metrics.push(m.minutes("profit.internal_minutes", "Horas en proyectos internos (sin cliente)", internalMinutes, period, "/projects"));
    metrics.push(
      m.count("profit.below_target", "Clientes por debajo del €/hora objetivo", below, period),
      m.count("profit.without_rate", "Clientes que han facturado sin horas con las que calcular su tarifa", withoutRate.length, period),
    );
    if (untrackedTotal > 0) metrics.push(m.eur("profit.untracked", "Facturado sin horas con las que compararlo", untrackedTotal, period));

    const notes = [
      "El margen necesita el coste por hora de cada socio, que aún no está: se compara la tarifa efectiva (facturado / horas) con el €/hora objetivo.",
      "Lo facturado cuenta en el mes en que se emite: un cargo anual, un hito o un trabajo puntual pueden mover la tarifa de un periodo corto.",
    ];
    if (firstLoggedOn && compareCivil(from, requestedFrom) > 0) {
      notes.unshift(`Las horas registradas empiezan el ${firstLoggedOn}: el periodo empieza en ${monthLabel(from)} para no comparar facturación sin horas.`);
    }
    if (ctx.policy.policy.target_hourly_rate_cents !== target) {
      notes.push("La política del consejo tiene su propio precio por hora objetivo: aquí se usa el de Ajustes de la org, el mismo con el que Proyectos pinta la tarifa.");
    }
    const lacksHours = withoutRate.some((f) => f.lacking === "hours");
    const lacksContract = withoutRate.some((f) => f.lacking === "contract");

    return {
      tool: "get_client_profitability",
      status: "ok",
      subject: "client_profitability",
      period: { from, to },
      source: SOURCE,
      href: "/projects",
      summary:
        overall.rateCents === null
          ? `${formatMetricValue(periodMonths, "months")} con horas, pero ningún cliente tiene tarifa que medir.`
          : `${formatMetricValue(periodMonths, "months")}: tarifa efectiva de ${formatMetricValue(overall.rateCents, "eur_cents")} por hora frente a un objetivo de ${formatMetricValue(target, "eur_cents")}.`,
      metrics,
      rows: rows.slice(0, MAX_ROWS),
      missing:
        withoutRate.length === 0
          ? null
          : {
              what: "Horas de los clientes que han facturado en el periodo sin horas con las que calcular su tarifa",
              needs: [
                ...(lacksHours ? ["Registrar sus horas en Proyectos (o importarlas de GTiQ)"] : []),
                ...(lacksContract ? ["Enlazar cada proyecto con el contrato que lo paga"] : []),
              ],
              href: "/projects",
            },
      notes,
    };
  },
});
