import { NextResponse } from "next/server";
import { runCouncilCron } from "@/council/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { cronAuthorized } from "@/server/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Cada agente son unas cuantas llamadas al modelo: margen amplio, y lo que no quepa lo sigue la
// siguiente llamada (la cola se queda en la base de datos).
export const maxDuration = 800;

/**
 * Cron del consejo de agentes (mismo CRON_SECRET que /api/cron/daily). Programarlo CADA HORA
 * (`0 * * * *`): encola lo que toca en la zona de cada org (el briefing del lunes a las 8:00, el
 * cierre del día 5, el comercial de cada mañana, los seguimientos a 30/60/90 días) y ejecuta lo
 * pendiente. Idempotente. Sin ANTHROPIC_API_KEY responde 200 con configured: false y no hace nada.
 */
export async function POST(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const result = await runCouncilCron(createAdminClient(), { deadlineMs: 700_000 });
  const failed = result.outcomes.filter((o) => o.status === "failed").length;
  return NextResponse.json(
    {
      ok: failed === 0,
      configured: result.configured,
      enqueued: result.enqueued,
      outcomes: result.outcomes.map((o) => ({
        agent: o.agent,
        org: o.orgId,
        trigger: o.trigger,
        status: o.status,
        published: o.published.length,
        report: o.reportId,
        error: o.error,
      })),
    },
    { status: failed === 0 ? 200 : 207 },
  );
}
