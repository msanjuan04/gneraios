// El contexto con el que trabajan las tools en una ejecución: los datos del negocio (con caché
// por ejecución, para que varias tools no repitan las mismas lecturas), la política vigente y los
// umbrales de la org.

import { readOrgSettings } from "@/app/[org]/settings/schema";
import { metricsSettings } from "@/server/metrics/sources";
import { effectiveThresholds, type Thresholds } from "./agents.config";
import type { CouncilData } from "./data/types";
import type { ResolvedPolicy } from "./policy/schema";
import type { AgentSettingsRecord, CouncilStore } from "./store/types";
import { readWeeklyCapacity } from "./tools/capacity";
import type { ToolContext } from "./tools/types";
import { AGENT_NAMES } from "./types";

/** Envuelve el acceso a datos con una caché por llamada: la misma lectura, una sola vez por ejecución. */
export function cachedData(data: CouncilData): CouncilData {
  const cache = new Map<string, Promise<unknown>>();
  const wrap =
    <A extends unknown[], R>(name: string, fn: (...args: A) => Promise<R>) =>
    (...args: A): Promise<R> => {
      const key = `${name}:${JSON.stringify(args)}`;
      let hit = cache.get(key) as Promise<R> | undefined;
      if (!hit) {
        hit = fn.apply(data, args);
        cache.set(key, hit);
        hit.catch(() => cache.delete(key));
      }
      return hit;
    };
  return {
    org: wrap("org", data.org),
    members: wrap("members", data.members),
    issuers: wrap("issuers", data.issuers),
    contractLines: wrap("contractLines", data.contractLines),
    forecastContracts: wrap("forecastContracts", data.forecastContracts),
    revenueRows: wrap("revenueRows", data.revenueRows),
    clientRevenue: wrap("clientRevenue", data.clientRevenue),
    snapshots: wrap("snapshots", data.snapshots),
    clients: wrap("clients", data.clients),
    invoices: wrap("invoices", data.invoices),
    openInvoicesOn: wrap("openInvoicesOn", data.openInvoicesOn),
    payments: wrap("payments", data.payments),
    deals: wrap("deals", data.deals),
    stageHistory: wrap("stageHistory", data.stageHistory),
    stages: wrap("stages", data.stages),
    sources: wrap("sources", data.sources),
    activities: wrap("activities", data.activities),
    seo: wrap("seo", data.seo),
    finance: wrap("finance", data.finance),
    projects: wrap("projects", data.projects),
    timeEntries: wrap("timeEntries", data.timeEntries),
    contractRevenue: wrap("contractRevenue", data.contractRevenue),
    openTasks: wrap("openTasks", data.openTasks),
  };
}

/** Los umbrales de todos los agentes juntos (las claves no se repiten entre agentes). */
export function mergedThresholds(settings: readonly AgentSettingsRecord[]): Thresholds {
  const out: Thresholds = {};
  for (const agent of AGENT_NAMES) {
    Object.assign(out, effectiveThresholds(agent, settings.find((s) => s.agent === agent)?.thresholds));
  }
  return out;
}

export async function buildToolContext(opts: {
  orgId: string;
  today: string;
  data: CouncilData;
  store: Pick<CouncilStore, "pastRecommendations" | "upsellRules">;
  policy: ResolvedPolicy;
  settings: readonly AgentSettingsRecord[];
}): Promise<ToolContext> {
  const org = await opts.data.org();
  const metrics = metricsSettings(org.settings as never);
  return {
    orgId: opts.orgId,
    today: opts.today,
    timeZone: org.timezone,
    data: opts.data,
    council: {
      pastRecommendations: (filter) => opts.store.pastRecommendations(opts.orgId, filter),
      upsellRules: () => opts.store.upsellRules(opts.orgId),
    },
    policy: opts.policy,
    thresholds: mergedThresholds(opts.settings),
    renewalWindowDays: metrics.renewalWindowDays,
    concentrationAlertBps: metrics.concentrationAlertBps,
    // El mismo lector que Proyectos (readOrgSettings): una sola definición del objetivo de €/hora.
    targetHourlyRateCents: readOrgSettings(org.settings).target_hourly_rate_cents,
    weeklyCapacity: readWeeklyCapacity(org.settings),
  };
}
