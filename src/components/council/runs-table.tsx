"use client";

import { ChevronRight } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Fragment, useState } from "react";
import type { RunView } from "@/council/queries";
import { cn } from "@/lib/utils";
import { AGENT_ICONS, count, usd } from "./meta";

const STATUS_TONE: Record<string, string> = {
  succeeded: "text-success",
  failed: "text-destructive",
  running: "text-primary",
  skipped: "text-muted-foreground",
};

/** El registro de ejecuciones: entrada, tools con sus argumentos, salida, tokens, coste y duración. */
export function RunsTable({ runs, locale }: { runs: RunView[]; locale: string }) {
  const t = useTranslations("council.runs");
  const tAgents = useTranslations("council.agents");
  const format = useFormatter();
  const [open, setOpen] = useState<string | null>(null);
  if (runs.length === 0) return <p className="rounded-2xl border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">{t("empty")}</p>;
  return (
    <div className="overflow-x-auto rounded-2xl border bg-card">
      <table className="w-full min-w-[56rem] text-sm">
        <thead className="border-b text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-medium">{t("when")}</th>
            <th className="px-4 py-2 font-medium">{t("agent")}</th>
            <th className="px-4 py-2 font-medium">{t("trigger")}</th>
            <th className="px-4 py-2 font-medium">{t("status")}</th>
            <th className="px-4 py-2 font-medium">{t("model")}</th>
            <th className="px-4 py-2 text-right font-medium">{t("tokens")}</th>
            <th className="px-4 py-2 text-right font-medium">{t("cost")}</th>
            <th className="px-4 py-2 text-right font-medium">{t("duration")}</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const Icon = AGENT_ICONS[run.agent];
            const expanded = open === run.id;
            const output = run.output ?? {};
            const published = Array.isArray(output.published) ? output.published.length : 0;
            const silenced = Array.isArray(output.silenced) ? (output.silenced as { title: string; reason: string }[]) : [];
            const issues = Array.isArray(output.issues) ? (output.issues as string[]) : [];
            return (
              <Fragment key={run.id}>
                <tr className={cn("cursor-pointer border-b last:border-b-0 hover:bg-muted/40", expanded && "bg-muted/40")} onClick={() => setOpen(expanded ? null : run.id)}>
                  <td className="px-4 py-2 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      <ChevronRight aria-hidden className={cn("size-3.5 text-muted-foreground transition-transform", expanded && "rotate-90")} />
                      {format.dateTime(new Date(run.startedAt), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <span className="inline-flex items-center gap-1.5">
                      <Icon aria-hidden className="size-3.5 text-primary" />
                      {tAgents(`${run.agent}.name`)}
                      {run.parentRunId && <span className="text-xs text-muted-foreground">· {t("review")}</span>}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{t.has(`triggers.${run.trigger}`) ? t(`triggers.${run.trigger}`) : run.trigger}</td>
                  <td className={cn("px-4 py-2 font-semibold", STATUS_TONE[run.status])}>{t(`statuses.${run.status}`)}</td>
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{run.model ?? run.runtime}</td>
                  <td className="px-4 py-2 text-right tabular">
                    {count(run.inputTokens, locale)} / {count(run.outputTokens, locale)}
                    {run.cacheReadTokens > 0 && <span className="block text-[11px] text-muted-foreground">{t("cacheRead", { tokens: count(run.cacheReadTokens, locale) })}</span>}
                  </td>
                  <td className="px-4 py-2 text-right tabular">{usd(run.costUsdMicros, locale)}</td>
                  <td className="px-4 py-2 text-right text-muted-foreground tabular">{run.durationMs === null ? "—" : `${(run.durationMs / 1000).toFixed(1)} s`}</td>
                </tr>
                {expanded && (
                  <tr className="border-b bg-muted/20 last:border-b-0">
                    <td colSpan={8} className="px-6 py-4">
                      <div className="grid gap-4 lg:grid-cols-2">
                        <section>
                          <h4 className="text-xs font-bold tracking-wide text-muted-foreground uppercase">{t("toolCalls", { count: run.toolCalls.length })}</h4>
                          <ul className="mt-2 space-y-1.5">
                            {run.toolCalls.map((call) => (
                              <li key={call.id} className="rounded-lg border bg-background/60 px-3 py-2 text-xs">
                                <p className="flex flex-wrap items-center gap-2">
                                  <span className="font-mono font-semibold">{call.name}</span>
                                  <span className={cn(call.status === "error" || call.status === "denied" ? "text-destructive" : call.status === "missing_data" ? "text-warning" : "text-muted-foreground")}>{t(`callStatus.${call.status}`)}</span>
                                  <span className="ml-auto text-muted-foreground tabular">{call.durationMs} ms</span>
                                </p>
                                <p className="mt-1 font-mono break-all text-muted-foreground">{JSON.stringify(call.input)}</p>
                                <p className="mt-1 text-muted-foreground">{call.summary}</p>
                              </li>
                            ))}
                          </ul>
                        </section>
                        <section className="space-y-3 text-xs">
                          <div>
                            <h4 className="font-bold tracking-wide text-muted-foreground uppercase">{t("result")}</h4>
                            <p className="mt-1">{t("resultLine", { published, silenced: silenced.length, attempts: run.attempts })}</p>
                          </div>
                          {silenced.length > 0 && (
                            <div>
                              <h4 className="font-bold tracking-wide text-muted-foreground uppercase">{t("silenced")}</h4>
                              <ul className="mt-1 space-y-1">
                                {silenced.map((s, i) => (
                                  <li key={i}>
                                    <span className="font-semibold">{s.title}</span> — <span className="text-muted-foreground">{s.reason}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {issues.length > 0 && (
                            <div>
                              <h4 className="font-bold tracking-wide text-muted-foreground uppercase">{t("issues")}</h4>
                              <ul className="mt-1 list-disc space-y-1 pl-4 text-muted-foreground">
                                {issues.map((issue, i) => (
                                  <li key={i}>{issue}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {run.error && (
                            <div>
                              <h4 className="font-bold tracking-wide text-muted-foreground uppercase">{t("error")}</h4>
                              <p className="mt-1 text-destructive">{run.error}</p>
                            </div>
                          )}
                        </section>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
