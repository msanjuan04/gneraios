"use client";

import { CircleAlert, LoaderCircle, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { runAgentNow } from "@/app/[org]/council/actions";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AgentStatusView } from "@/council/queries";
import { cn } from "@/lib/utils";
import { AGENT_ICONS } from "./meta";
import { notAfter } from "@/lib/relative-time";

/** Los nueve agentes con su estado (cola, último resultado, presupuesto) y "Ejecutar ahora". */
export function AgentStrip({
  agents,
  slug,
  canRun,
  configured,
  cadence,
}: {
  agents: AgentStatusView[];
  slug: string;
  canRun: boolean;
  configured: boolean;
  /** Cuándo trabaja cada agente, ya traducido. */
  cadence: Record<string, string>;
}) {
  const t = useTranslations("council.strip");
  const tAgents = useTranslations("council.agents");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [launching, setLaunching] = useState<string | null>(null);
  const busy = agents.some((a) => a.pending + a.running > 0);

  // Mientras haya algo en cola o trabajando, se refresca la pantalla sola (5 minutos como mucho).
  useEffect(() => {
    if (!busy) return;
    const interval = setInterval(() => router.refresh(), 6000);
    const stop = setTimeout(() => clearInterval(interval), 5 * 60_000);
    return () => {
      clearInterval(interval);
      clearTimeout(stop);
    };
  }, [busy, router]);

  const run = (agent: string) =>
    startTransition(async () => {
      setLaunching(agent);
      const result = await runAgentNow(slug, agent);
      setLaunching(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("queued", { agent: tAgents(`${agent}.name`) }));
      router.refresh();
    });

  return (
    <section aria-label={t("label")} className="rounded-2xl border bg-card">
      <ul className="grid sm:grid-cols-2 xl:grid-cols-3">
        {agents.map((a) => {
          const Icon = AGENT_ICONS[a.agent];
          const working = a.running > 0 || launching === a.agent;
          const queued = !working && a.pending > 0;
          const failed = a.lastStatus === "failed";
          let status: string;
          if (!a.enabled) status = t("disabled");
          else if (a.budgetExhausted) status = t("paused");
          else if (working) status = t("working");
          else if (queued) status = t("pending");
          else if (a.lastFinishedAt) status = t(failed ? "lastFailed" : "last", { when: format.relativeTime(notAfter(new Date(a.lastFinishedAt), now), now) });
          else status = t("never");
          return (
            <li key={a.agent} className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0 sm:[&:nth-last-child(-n+2)]:border-b-0 xl:[&:nth-last-child(-n+3)]:border-b-0">
              <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-xl bg-secondary", a.enabled ? "text-primary" : "text-muted-foreground")}>
                <Icon aria-hidden className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className={cn("truncate text-sm font-semibold", !a.enabled && "text-muted-foreground")}>{tAgents(`${a.agent}.name`)}</p>
                <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                  {working && <LoaderCircle aria-hidden className="size-3 shrink-0 animate-spin text-primary" />}
                  {failed && !working && !queued && a.enabled && <CircleAlert aria-hidden className="size-3 shrink-0 text-destructive" />}
                  <span className={cn("truncate", (a.budgetExhausted || (failed && !working && !queued)) && a.enabled && "text-warning")}>
                    {failed && a.lastError && !working && !queued ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-help underline decoration-dotted underline-offset-2">{status}</span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">{a.lastError}</TooltipContent>
                      </Tooltip>
                    ) : (
                      status
                    )}
                  </span>
                  <span aria-hidden className="text-muted-foreground/50">·</span>
                  <span className="truncate">{cadence[a.agent]}</span>
                </p>
              </div>
              {canRun && a.runnable && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("runNow", { agent: tAgents(`${a.agent}.name`) })}
                  title={t("runNow", { agent: tAgents(`${a.agent}.name`) })}
                  disabled={!configured || !a.enabled || a.budgetExhausted || working || queued || pending}
                  onClick={() => run(a.agent)}
                >
                  {launching === a.agent ? <LoaderCircle className="animate-spin" /> : <Play />}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
