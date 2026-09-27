import "server-only";

// Conexión del consejo con la app: el runner con Supabase (service_role), los datos de cada org y
// Claude si hay clave. Lo usan el cron (/api/cron/council) y "Ejecutar ahora".

import type { Db } from "@/server/billing/context";
import { SupabaseCouncilData } from "./data/supabase";
import { runPendingJobs, type JobOutcome, type RunnerDeps } from "./runner";
import { ClaudeRuntime, isClaudeConfigured } from "./runtime/claude";
import { dueScheduledJobs, localNow } from "./schedule";
import { SupabaseCouncilStore } from "./store/supabase";

let claude: ClaudeRuntime | null = null;

/** Las dependencias del runner en producción. Sin ANTHROPIC_API_KEY no hay runtime (el runner lo explica). */
export function councilDeps(admin: Db): RunnerDeps {
  return {
    store: new SupabaseCouncilStore(admin),
    dataFor: (orgId) => new SupabaseCouncilData(admin, orgId),
    runtimeFor: () => {
      if (!isClaudeConfigured()) return null;
      claude ??= new ClaudeRuntime();
      return claude;
    },
  };
}

export type CouncilCronResult = { configured: boolean; enqueued: number; outcomes: JobOutcome[] };

/**
 * El cron del consejo: en cada org encola lo programado que toca (briefing del lunes, cierre del
 * día 5, comercial diario…) y los seguimientos a 30/60/90 días que vencen, y ejecuta lo pendiente
 * hasta agotar el tiempo. Idempotente: cada trabajo programado lleva su clave de periodo. Sin
 * clave de la API no encola nada (no se acumulan trabajos que no se pueden hacer).
 */
export async function runCouncilCron(admin: Db, opts: { now?: Date; deadlineMs?: number } = {}): Promise<CouncilCronResult> {
  if (!isClaudeConfigured()) return { configured: false, enqueued: 0, outcomes: [] };
  const deps = councilDeps(admin);
  const now = opts.now ?? new Date();
  let enqueued = 0;
  for (const org of await deps.store.orgs()) {
    try {
      const settings = await deps.store.agentSettings(org.id);
      for (const job of dueScheduledJobs({ orgId: org.id, timeZone: org.timezone, now, settings })) {
        if ((await deps.store.enqueueJob(job)).created) enqueued += 1;
      }
      const today = localNow(now, org.timezone).date;
      for (const review of await deps.store.dueReviews(org.id, today)) {
        const rec = await deps.store.recommendation(org.id, review.recommendationId);
        if (!rec) continue;
        const { created } = await deps.store.enqueueJob({
          orgId: org.id,
          agent: rec.agent,
          trigger: "review",
          payload: { task: "review", review_id: review.id, recommendation_id: rec.id, horizon_days: review.horizonDays },
          dedupeKey: `review:${review.id}`,
        });
        if (created) enqueued += 1;
      }
    } catch (error) {
      console.error("[council] cron", org.id, error);
    }
  }
  const outcomes = await runPendingJobs(deps, { deadlineMs: opts.deadlineMs });
  return { configured: true, enqueued, outcomes };
}
